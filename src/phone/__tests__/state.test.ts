import { describe, it, expect } from 'vitest'
import { INITIAL_STATE, reduce } from '../state'
import {
  DEFAULT_SETTINGS,
  type ManualLocation,
  type PhoneEvent,
  type PhoneState,
  type Settings,
} from '../types'

// ─── Fixtures ──────────────────────────────────────────────────────────

function state(overrides: Partial<PhoneState> = {}): PhoneState {
  return { ...INITIAL_STATE, ...overrides }
}

function customSettings(overrides: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

function apply(s: PhoneState, ...events: PhoneEvent[]): PhoneState {
  let current = s
  for (const e of events) {
    current = reduce(current, e).state
  }
  return current
}

// ─── Boot state ────────────────────────────────────────────────────────

describe('INITIAL_STATE', () => {
  it('boots with default settings, idle sync, no error', () => {
    expect(INITIAL_STATE.settings).toBe(DEFAULT_SETTINGS)
    expect(INITIAL_STATE.syncStatus).toBe('idle')
    expect(INITIAL_STATE.syncError).toBeNull()
  })
})

// ─── Hydration ─────────────────────────────────────────────────────────

describe('settings-hydrated', () => {
  it('replaces settings and broadcasts them (no persist, no request-location)', () => {
    const hydrated: Settings = customSettings({ radiusMiles: 1.5 })
    const result = reduce(INITIAL_STATE, {
      type: 'settings-hydrated',
      settings: hydrated,
    })
    expect(result.state.settings).toEqual(hydrated)
    expect(result.effects.map((e) => e.type)).toEqual(['broadcast-settings'])
  })

  it('does not disturb in-flight sync status', () => {
    const syncing = state({ syncStatus: 'syncing' })
    const result = reduce(syncing, {
      type: 'settings-hydrated',
      settings: DEFAULT_SETTINGS,
    })
    expect(result.state.syncStatus).toBe('syncing')
  })

  it('broadcasts hydrated settings so the glasses learn them at boot', () => {
    const loaded = {
      radiusMiles: 1.5 as const,
      enabledCategories: ['historic'] as const,
      units: 'metric' as const,
      sort: 'name' as const,
      maxResults: 10 as const,
      manualLocation: null,
      lang: null,
    }
    const result = reduce(INITIAL_STATE, { type: 'settings-hydrated', settings: loaded })
    const broadcast = result.effects.find((e) => e.type === 'broadcast-settings')
    expect(broadcast).toBeDefined()
    if (broadcast?.type === 'broadcast-settings') {
      expect(broadcast.settings).toEqual(loaded)
    }
    // Hydration should NOT trigger a relocate/refetch — the phone doesn't
    // need to re-request location just because it loaded settings from disk.
    expect(result.effects.some((e) => e.type === 'request-location')).toBe(false)
  })
})

// ─── Radius ────────────────────────────────────────────────────────────

describe('radius-changed', () => {
  it('updates radius, transitions to syncing, emits persist + broadcast + request-location', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'radius-changed',
      radiusMiles: 1.5,
    })
    expect(result.state.settings.radiusMiles).toBe(1.5)
    expect(result.state.syncStatus).toBe('syncing')
    // v1.2: settings changes also auto-refresh the Nearby tab.
    expect(result.state.nearby.fetchStatus).toBe('locating')
    expect(result.effects).toEqual([
      { type: 'persist-settings', settings: result.state.settings },
      { type: 'broadcast-settings', settings: result.state.settings },
      { type: 'request-location', manualLocation: null },
    ])
  })

  it('no-ops when radius is unchanged', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'radius-changed',
      radiusMiles: DEFAULT_SETTINGS.radiusMiles,
    })
    expect(result.state).toBe(INITIAL_STATE)
    expect(result.effects).toEqual([])
  })

  it('preserves enabled categories untouched', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'radius-changed',
      radiusMiles: 0.25,
    })
    expect(result.state.settings.enabledCategories).toBe(
      DEFAULT_SETTINGS.enabledCategories,
    )
  })
})

// ─── Categories ────────────────────────────────────────────────────────

describe('category-toggled', () => {
  it('turns a default-on category off', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'category-toggled',
      category: 'historic',
    })
    expect(result.state.settings.enabledCategories).not.toContain('historic')
  })

  it('turns a default-off category on', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'category-toggled',
      category: 'nightlife',
    })
    expect(result.state.settings.enabledCategories).toContain('nightlife')
  })

  it('toggle is its own inverse (off→on→off returns to original set)', () => {
    const after = apply(
      INITIAL_STATE,
      { type: 'category-toggled', category: 'nightlife' },
      { type: 'category-toggled', category: 'nightlife' },
    )
    expect([...after.settings.enabledCategories].sort()).toEqual(
      [...DEFAULT_SETTINGS.enabledCategories].sort(),
    )
  })

  it('emits persist + broadcast + request-location effects', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'category-toggled',
      category: 'libraries',
    })
    // v1.2: settings changes also auto-refresh the Nearby tab.
    expect(result.state.nearby.fetchStatus).toBe('locating')
    expect(result.effects).toEqual([
      { type: 'persist-settings', settings: result.state.settings },
      { type: 'broadcast-settings', settings: result.state.settings },
      { type: 'request-location', manualLocation: null },
    ])
  })

  it('transitions sync status to syncing and clears prior error', () => {
    const errored = state({ syncStatus: 'error', syncError: 'boom' })
    const result = reduce(errored, {
      type: 'category-toggled',
      category: 'parks',
    })
    expect(result.state.syncStatus).toBe('syncing')
    expect(result.state.syncError).toBeNull()
  })

  it('does not mutate the original enabledCategories reference', () => {
    const before = INITIAL_STATE.settings.enabledCategories
    reduce(INITIAL_STATE, { type: 'category-toggled', category: 'historic' })
    expect(INITIAL_STATE.settings.enabledCategories).toBe(before)
    expect(before).toEqual(DEFAULT_SETTINGS.enabledCategories)
  })
})

// ─── Sync lifecycle ────────────────────────────────────────────────────

describe('sync lifecycle events', () => {
  it('sync-started marks syncing and clears prior error', () => {
    const errored = state({ syncStatus: 'error', syncError: 'old error' })
    const result = reduce(errored, { type: 'sync-started' })
    expect(result.state.syncStatus).toBe('syncing')
    expect(result.state.syncError).toBeNull()
    expect(result.effects).toEqual([])
  })

  it('sync-completed marks synced and clears error', () => {
    const syncing = state({ syncStatus: 'syncing' })
    const result = reduce(syncing, { type: 'sync-completed' })
    expect(result.state.syncStatus).toBe('synced')
    expect(result.state.syncError).toBeNull()
    expect(result.effects).toEqual([])
  })

  it('sync-failed captures the message and marks error', () => {
    const syncing = state({ syncStatus: 'syncing' })
    const result = reduce(syncing, {
      type: 'sync-failed',
      message: 'glasses disconnected',
    })
    expect(result.state.syncStatus).toBe('error')
    expect(result.state.syncError).toBe('glasses disconnected')
    expect(result.effects).toEqual([])
  })
})

// ─── Units ─────────────────────────────────────────────────────────────

describe('units-changed', () => {
  it('updates settings.units to metric and triggers sync + location refresh', () => {
    const { state: next, effects } = reduce(INITIAL_STATE, { type: 'units-changed', units: 'metric' })
    expect(next.settings.units).toBe('metric')
    expect(next.syncStatus).toBe('syncing')
    expect(effects.some(e => e.type === 'persist-settings')).toBe(true)
    expect(effects.some(e => e.type === 'broadcast-settings')).toBe(true)
    expect(effects.some(e => e.type === 'request-location')).toBe(true)
  })

  it('is a noop when units are already the same value', () => {
    const state = { ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, units: 'metric' as const } }
    const result = reduce(state, { type: 'units-changed', units: 'metric' })
    expect(result.state).toBe(state)
    expect(result.effects).toHaveLength(0)
  })
})

// ─── Language ─────────────────────────────────────────────────────────

describe('lang-changed', () => {
  it('lang-changed updates settings and broadcasts (but does not request-location)', () => {
    const result = reduce(INITIAL_STATE, { type: 'lang-changed', lang: 'fr' })
    expect(result.state.settings.lang).toBe('fr')
    const broadcast = result.effects.find((e) => e.type === 'broadcast-settings')
    expect(broadcast).toBeDefined()
    if (broadcast?.type === 'broadcast-settings') {
      expect(broadcast.settings.lang).toBe('fr')
    }
  })

  it('lang-changed is a noop if the value is unchanged', () => {
    const state = { ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, lang: 'fr' } }
    const result = reduce(state, { type: 'lang-changed', lang: 'fr' })
    expect(result.effects).toEqual([])
  })

  it('lang-changed mirrors units-changed: triggers sync + persist + broadcast + request-location', () => {
    const { state: next, effects } = reduce(INITIAL_STATE, { type: 'lang-changed', lang: 'ja' })
    expect(next.settings.lang).toBe('ja')
    expect(next.syncStatus).toBe('syncing')
    expect(effects.some((e) => e.type === 'persist-settings')).toBe(true)
    expect(effects.some((e) => e.type === 'broadcast-settings')).toBe(true)
    expect(effects.some((e) => e.type === 'request-location')).toBe(true)
  })
})

// ─── Max results ──────────────────────────────────────────────────────

describe('max-results-changed', () => {
  it('updates maxResults and triggers sync', () => {
    const { state: next, effects } = reduce(INITIAL_STATE, { type: 'max-results-changed', maxResults: 10 })
    expect(next.settings.maxResults).toBe(10)
    expect(next.syncStatus).toBe('syncing')
    expect(effects.some(e => e.type === 'persist-settings')).toBe(true)
    expect(effects.some(e => e.type === 'broadcast-settings')).toBe(true)
  })
  it('is a noop when maxResults unchanged', () => {
    const state = { ...INITIAL_STATE, settings: { ...INITIAL_STATE.settings, maxResults: 10 as const } }
    const result = reduce(state, { type: 'max-results-changed', maxResults: 10 })
    expect(result.state).toBe(state)
    expect(result.effects).toHaveLength(0)
  })
})

// ─── Sort ─────────────────────────────────────────────────────────────

describe('sort-changed', () => {
  it('updates sort to name and triggers sync', () => {
    const { state: next, effects } = reduce(INITIAL_STATE, { type: 'sort-changed', sort: 'name' })
    expect(next.settings.sort).toBe('name')
    expect(next.syncStatus).toBe('syncing')
    expect(effects.some(e => e.type === 'persist-settings')).toBe(true)
    expect(effects.some(e => e.type === 'broadcast-settings')).toBe(true)
  })
  it('is a noop when sort unchanged', () => {
    const result = reduce(INITIAL_STATE, { type: 'sort-changed', sort: 'proximity' })
    expect(result.state).toBe(INITIAL_STATE)
    expect(result.effects).toHaveLength(0)
  })
})

// ─── Immutability ──────────────────────────────────────────────────────

describe('reducer purity', () => {
  it('does not mutate input state on a no-op', () => {
    const snapshot = JSON.stringify(INITIAL_STATE)
    reduce(INITIAL_STATE, {
      type: 'radius-changed',
      radiusMiles: DEFAULT_SETTINGS.radiusMiles,
    })
    expect(JSON.stringify(INITIAL_STATE)).toBe(snapshot)
  })

  it('does not mutate input state on a real change', () => {
    const snapshot = JSON.stringify(INITIAL_STATE)
    reduce(INITIAL_STATE, { type: 'radius-changed', radiusMiles: 1.5 })
    expect(JSON.stringify(INITIAL_STATE)).toBe(snapshot)
  })
})

// ─── Manual location ───────────────────────────────────────────────────────

const TEST_LOCATION: ManualLocation = {
  label: 'Times Square, Manhattan, New York',
  lat: 40.758,
  lng: -73.9855,
}

describe('manual-location-selected', () => {
  it('saves location to settings', () => {
    const result = reduce(INITIAL_STATE, { type: 'manual-location-selected', location: TEST_LOCATION })
    expect(result.state.settings.manualLocation).toEqual(TEST_LOCATION)
  })

  it('emits persist-settings, broadcast-settings, request-location', () => {
    const result = reduce(INITIAL_STATE, { type: 'manual-location-selected', location: TEST_LOCATION })
    expect(result.effects.map((e) => e.type)).toEqual(['persist-settings', 'broadcast-settings', 'request-location'])
  })

  it('request-location carries the new manualLocation', () => {
    const result = reduce(INITIAL_STATE, { type: 'manual-location-selected', location: TEST_LOCATION })
    const rl = result.effects.find((e) => e.type === 'request-location') as { type: 'request-location'; manualLocation: ManualLocation | null } | undefined
    expect(rl?.manualLocation).toEqual(TEST_LOCATION)
  })

  it('sets nearby fetchStatus to locating', () => {
    const result = reduce(INITIAL_STATE, { type: 'manual-location-selected', location: TEST_LOCATION })
    expect(result.state.nearby.fetchStatus).toBe('locating')
  })
})

describe('manual-location-cleared', () => {
  it('nulls out manualLocation in settings', () => {
    const withManual = apply(INITIAL_STATE, { type: 'manual-location-selected', location: TEST_LOCATION })
    const result = reduce(withManual, { type: 'manual-location-cleared' })
    expect(result.state.settings.manualLocation).toBeNull()
  })

  it('request-location carries null manualLocation', () => {
    const withManual = apply(INITIAL_STATE, { type: 'manual-location-selected', location: TEST_LOCATION })
    const result = reduce(withManual, { type: 'manual-location-cleared' })
    const rl = result.effects.find((e) => e.type === 'request-location') as { type: 'request-location'; manualLocation: ManualLocation | null } | undefined
    expect(rl?.manualLocation).toBeNull()
  })
})
