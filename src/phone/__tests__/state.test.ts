import { describe, it, expect } from 'vitest'
import { INITIAL_STATE, reduce } from '../state'
import {
  DEFAULT_SETTINGS,
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
  it('replaces settings without emitting effects', () => {
    const hydrated: Settings = customSettings({ radiusMiles: 1.5 })
    const result = reduce(INITIAL_STATE, {
      type: 'settings-hydrated',
      settings: hydrated,
    })
    expect(result.state.settings).toEqual(hydrated)
    expect(result.effects).toEqual([])
  })

  it('does not disturb in-flight sync status', () => {
    const syncing = state({ syncStatus: 'syncing' })
    const result = reduce(syncing, {
      type: 'settings-hydrated',
      settings: DEFAULT_SETTINGS,
    })
    expect(result.state.syncStatus).toBe('syncing')
  })
})

// ─── Radius ────────────────────────────────────────────────────────────

describe('radius-changed', () => {
  it('updates radius, transitions to syncing, emits persist + broadcast', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'radius-changed',
      radiusMiles: 1.5,
    })
    expect(result.state.settings.radiusMiles).toBe(1.5)
    expect(result.state.syncStatus).toBe('syncing')
    expect(result.effects).toEqual([
      { type: 'persist-settings', settings: result.state.settings },
      { type: 'broadcast-settings', settings: result.state.settings },
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

  it('emits persist + broadcast effects', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'category-toggled',
      category: 'libraries',
    })
    expect(result.effects).toEqual([
      { type: 'persist-settings', settings: result.state.settings },
      { type: 'broadcast-settings', settings: result.state.settings },
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
