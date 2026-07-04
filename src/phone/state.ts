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
  type CategoryId,
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
      return {
        state: { ...state, settings: event.settings },
        // Broadcast (but don't persist-settings or request-location) on
        // boot: the glasses reducer starts on DEFAULT_SETTINGS and only
        // ever learns real settings via this CustomEvent — without it,
        // every session runs split-brain (phone uses persisted settings,
        // glasses use defaults) until the user changes something. See
        // Wander_v2_Research.md H1. No persist (nothing changed, would
        // just rewrite what we just read) and no request-location
        // (NearbyTab's own mount effect already requests location).
        effects: [{ type: 'broadcast-settings', settings: event.settings }],
      }

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

    case 'units-changed': {
      if (state.settings.units === event.units) return noop(state)
      const nextSettings: Settings = { ...state.settings, units: event.units }
      return withSettingsChange(state, nextSettings)
    }

    case 'max-results-changed': {
      if (state.settings.maxResults === event.maxResults) return noop(state)
      const nextSettings: Settings = { ...state.settings, maxResults: event.maxResults }
      return withSettingsChange(state, nextSettings)
    }

    case 'sort-changed': {
      if (state.settings.sort === event.sort) return noop(state)
      const nextSettings: Settings = { ...state.settings, sort: event.sort }
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
        effects: [{ type: 'request-location', manualLocation: state.settings.manualLocation }],
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
            locationSource: event.source ?? 'native',
          },
        },
        effects: [
          {
            type: 'fetch-nearby-pois',
            lat: event.lat,
            lng: event.lng,
            settings: state.settings,
          },
          // Skip reverse-geocode for manual fixes — the user already
          // supplied an authoritative label via LocationSearchForm; a
          // reverse-geocode result would silently clobber it with a
          // generic neighborhood string once it resolves.
          ...(event.source === 'manual'
            ? []
            : [{ type: 'geocode-location' as const, lat: event.lat, lng: event.lng }]),
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

    case 'manual-location-selected': {
      const nextSettings: Settings = { ...state.settings, manualLocation: event.location }
      return {
        state: {
          ...state,
          settings: nextSettings,
          syncStatus: 'syncing',
          syncError: null,
          nearby: { ...state.nearby, fetchStatus: 'locating', errorMessage: null },
        },
        effects: [
          { type: 'persist-settings', settings: nextSettings },
          { type: 'broadcast-settings', settings: nextSettings },
          { type: 'request-location', manualLocation: nextSettings.manualLocation },
        ],
      }
    }

    case 'manual-location-cleared': {
      const nextSettings: Settings = { ...state.settings, manualLocation: null }
      return {
        state: {
          ...state,
          settings: nextSettings,
          syncStatus: 'syncing',
          syncError: null,
          nearby: { ...state.nearby, fetchStatus: 'locating', errorMessage: null },
        },
        effects: [
          { type: 'persist-settings', settings: nextSettings },
          { type: 'broadcast-settings', settings: nextSettings },
          { type: 'request-location', manualLocation: null },
        ],
      }
    }
  }
}

/**
 * Apply a settings change: update state, mark sync in-flight, and emit
 * persist + broadcast effects. Also triggers a Nearby refresh so the
 * phone POI list immediately reflects the new radius/categories without
 * requiring a manual tap on ↺ Refresh.
 * Kept as a helper because radius-changed and category-toggled both take
 * this same path.
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
      // Reset to locating immediately so the Nearby tab shows a spinner
      // rather than stale results while the fresh fetch is in flight.
      nearby: { ...state.nearby, fetchStatus: 'locating', errorMessage: null },
    },
    effects: [
      { type: 'persist-settings', settings: nextSettings },
      { type: 'broadcast-settings', settings: nextSettings },
      { type: 'request-location', manualLocation: nextSettings.manualLocation },
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
