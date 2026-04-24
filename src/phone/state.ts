/**
 * Phone reducer. Pure: `reduce(state, event) → { state, effects }`.
 *
 * Mirrors `src/glasses/state.ts`. No fetches, no SDK calls, no
 * `Date.now()` — effects come out as data. The phone UI (or a test) is
 * responsible for running them.
 *
 * Scope note: the Settings tab is the only tab this reducer needs today.
 * Nearby tab state (POI cache, connection indicator) will extend the
 * types + reducer in Phase 6 once §6.3 is resolved.
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
  }
}

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
