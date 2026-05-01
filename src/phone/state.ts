/**
 * Phone reducer. Pure: `reduce(state, event) → { state, effects }`.
 *
 * Mirrors `src/glasses/state.ts`. No fetches, no SDK calls, no
 * `Date.now()` — effects come out as data. The phone UI (or a test) is
 * responsible for running them.
 *
 * Phase H (2026-04-27): added Nearby event handlers. The Nearby UI is
 * not yet wired (Phase I), but the reducer is complete and testable now
 * so the next session can start directly on App.tsx + NearbyTab.tsx.
 */

import {
  INITIAL_PHONE_STATE,
  INITIAL_NEARBY_STATE,
  type CategoryId,
  type NearbyState,
  type PhoneEffect,
  type PhoneEvent,
  type PhoneState,
  type ReduceResult,
  type Settings,
} from './types'

export const INITIAL_STATE: PhoneState = INITIAL_PHONE_STATE

export function reduce(state: PhoneState, event: PhoneEvent): ReduceResult {
  switch (event.type) {
    case 'settings-hydrated':
      return noop({
        ...state,
        settings: event.settings,
        // Hydration itself doesn't change sync status — it's just loading
        // from storage, nothing needs broadcasting.
      })

    case 'radius-changed': {
      if (state.settings.radiusMiles === event.radiusMiles) return noop(state)
      const nextSettings: Settings = {
        ...state.settings,
        radiusMiles: event.radiusMiles,
      }
      return withSettingsChange(state, nextSettings)
    }

    case 'category-toggled': {
      const nextSettings = toggleCategory(state.settings, event.category)
      return withSettingsChange(state, nextSettings)
    }

    case 'sync-started':
      return noop({ ...state, syncStatus: 'syncing', syncError: null })

    case 'sync-completed':
      return noop({ ...state, syncStatus: 'synced', syncError: null })

    case 'sync-failed':
      return noop({
        ...state,
        syncStatus: 'error',
        syncError: event.message,
      })

    // ── Nearby ────────────────────────────────────────────────────────

    case 'nearby-refresh-requested':
      // Reset to locating; discard any previous error. Existing pois +
      // lastFetchTs stay visible while the new fetch is in flight so the
      // UI can keep showing stale data rather than going blank.
      return {
        state: {
          ...state,
          nearby: {
            ...state.nearby,
            fetchStatus: 'locating',
            errorMessage: null,
          },
        },
        effects: [{ type: 'request-location' }],
      }

    case 'location-acquired':
      return {
        state: {
          ...state,
          nearby: {
            ...state.nearby,
            fetchStatus: 'fetching',
            location: {
              lat: event.lat,
              lng: event.lng,
              // Label arrives separately via location-label-resolved.
              label: state.nearby.location?.label ?? null,
            },
          },
        },
        effects: [
          {
            type: 'fetch-nearby-pois',
            lat: event.lat,
            lng: event.lng,
            settings: state.settings,
          },
          // Reverse-geocode in parallel — result patches the location label
          // in the header. Non-fatal if it fails or arrives late.
          { type: 'geocode-location', lat: event.lat, lng: event.lng },
        ],
      }

    case 'location-failed':
      return noop({
        ...state,
        nearby: {
          ...state.nearby,
          fetchStatus: 'error-location',
          errorMessage: event.message,
        },
      })

    case 'location-label-resolved':
      // Reverse-geocode label arrived — patch location without changing
      // anything else. Safe to call in any fetchStatus.
      if (!state.nearby.location) return noop(state)
      return noop({
        ...state,
        nearby: {
          ...state.nearby,
          location: { ...state.nearby.location, label: event.label },
        },
      })

    case 'nearby-pois-loaded':
      return {
        state: {
          ...state,
          nearby: {
            ...state.nearby,
            fetchStatus: 'success',
            pois: event.pois,
            lastFetchTs: event.fetchedAt,
            errorMessage: null,
          },
        },
        effects: [
          {
            type: 'cache-nearby-pois',
            pois: event.pois,
            fetchedAt: event.fetchedAt,
          },
        ],
      }

    case 'nearby-fetch-failed':
      return noop({
        ...state,
        nearby: {
          ...state.nearby,
          fetchStatus: 'error-network',
          errorMessage: event.message,
        },
      })
  }
}

// ─── Nearby helpers ───────────────────────────────────────────────────────

/** Reset Nearby state to its initial shape (used by tests). */
export function resetNearby(state: PhoneState): PhoneState {
  return { ...state, nearby: INITIAL_NEARBY_STATE }
}

/** Convenience: patch only the nearby slice without touching settings. */
function withNearby(state: PhoneState, nearby: Partial<NearbyState>): PhoneState {
  return { ...state, nearby: { ...state.nearby, ...nearby } }
}
// Mark as used — withNearby is intentionally available for future callers.
void withNearby

/**
 * Apply a settings change: update state, mark sync in-flight, and emit
 * persist + broadcast effects. Kept as a helper because radius-changed
 * and category-toggled both take this same path.
 */
function withSettingsChange(
  state: PhoneState,
  nextSettings: Settings,
): ReduceResult {
  return {
    state: {
      ...state,
      settings: nextSettings,
      syncStatus: 'syncing',
      syncError: null,
    },
    effects: [
      { type: 'persist-settings', settings: nextSettings },
      { type: 'broadcast-settings', settings: nextSettings },
    ],
  }
}

/** Flip a category's enabled bit. */
function toggleCategory(settings: Settings, category: CategoryId): Settings {
  const enabled = settings.enabledCategories
  const nextEnabled: readonly CategoryId[] = enabled.includes(category)
    ? enabled.filter((c) => c !== category)
    : [...enabled, category]
  return { ...settings, enabledCategories: nextEnabled }
}

function noop(state: PhoneState): ReduceResult {
  return { state, effects: EMPTY_EFFECTS }
}

const EMPTY_EFFECTS: readonly PhoneEffect[] = []
