/**
 * Integration tests for the phone app wiring introduced in Phase H.
 *
 * These tests cover the coordination layer that App.tsx orchestrates
 * (boot → hydrate, dispatch → persist effect → sync lifecycle) without
 * needing a DOM or React. The underlying pure functions (reduce,
 * loadSettings, saveSettings) are individually tested in state.test.ts
 * and storage.test.ts; this file tests how they compose.
 *
 * The test harness here mirrors what App.tsx's `dispatch` + `runEffect`
 * does — if App.tsx changes its wiring, update these helpers too.
 */

import { describe, it, expect } from 'vitest'
import { reduce, INITIAL_STATE } from '../state'
import { loadSettings, saveSettings, createMemoryKVStore } from '../storage'
import type { KVStore } from '../storage'
import type { PhoneEvent, PhoneEffect, PhoneState, Settings } from '../types'
import { DEFAULT_SETTINGS } from '../types'

// ─── Harness ──────────────────────────────────────────────────────────────

/**
 * Simulate the App.tsx `dispatch` + `runEffect` loop synchronously for
 * one event. Returns the final settled state (after any sync-completed /
 * sync-failed event is applied) and the first-order effects that were
 * emitted.
 *
 * Matches the real App.tsx behaviour:
 *   - `persist-settings` → saveSettings(kv) → sync-completed | sync-failed
 *   - `broadcast-settings` → logged no-op in v1.0
 */
async function simulateDispatch(
  state: PhoneState,
  event: PhoneEvent,
  kv: KVStore,
): Promise<{ finalState: PhoneState; firstEffects: readonly PhoneEffect[] }> {
  const result = reduce(state, event)
  let finalState = result.state

  for (const eff of result.effects) {
    if (eff.type === 'persist-settings') {
      try {
        await saveSettings(kv, eff.settings)
        const { state: settled } = reduce(finalState, { type: 'sync-completed' })
        finalState = settled
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'error'
        const { state: settled } = reduce(finalState, { type: 'sync-failed', message })
        finalState = settled
      }
    }
    // broadcast-settings: no-op in v1.0 (same as App.tsx)
  }

  return { finalState, firstEffects: result.effects }
}

// ─── Boot sequence ────────────────────────────────────────────────────────

describe('boot sequence: loadSettings → settings-hydrated', () => {
  it('state reflects stored settings after hydration', async () => {
    const kv = createMemoryKVStore()
    const stored: Settings = { radiusMiles: 1.5, enabledCategories: ['museums', 'nightlife'] }
    await saveSettings(kv, stored)

    const loaded = await loadSettings(kv)
    const { state } = reduce(INITIAL_STATE, { type: 'settings-hydrated', settings: loaded })

    expect(state.settings.radiusMiles).toBe(1.5)
    expect(state.settings.enabledCategories).toEqual(['museums', 'nightlife'])
  })

  it('boots with defaults when store is empty', async () => {
    const kv = createMemoryKVStore()
    const loaded = await loadSettings(kv)
    const { state } = reduce(INITIAL_STATE, { type: 'settings-hydrated', settings: loaded })

    expect(state.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('hydration does not emit any effects (no persist/broadcast on boot)', async () => {
    const kv = createMemoryKVStore()
    const loaded = await loadSettings(kv)
    const result = reduce(INITIAL_STATE, { type: 'settings-hydrated', settings: loaded })

    expect(result.effects).toEqual([])
  })

  it('syncStatus stays idle after hydration', async () => {
    const kv = createMemoryKVStore()
    const loaded = await loadSettings(kv)
    const { state } = reduce(INITIAL_STATE, { type: 'settings-hydrated', settings: loaded })

    expect(state.syncStatus).toBe('idle')
  })
})

// ─── Settings change → persist → sync-completed ───────────────────────────

describe('settings change → persist effect → sync-completed', () => {
  it('radius change is persisted and state ends up synced', async () => {
    const kv = createMemoryKVStore()
    const { finalState } = await simulateDispatch(
      INITIAL_STATE,
      { type: 'radius-changed', radiusMiles: 1.0 },
      kv,
    )

    expect(finalState.settings.radiusMiles).toBe(1.0)
    expect(finalState.syncStatus).toBe('synced')
    expect(finalState.syncError).toBeNull()
  })

  it('persisted radius survives a loadSettings round-trip', async () => {
    const kv = createMemoryKVStore()
    await simulateDispatch(INITIAL_STATE, { type: 'radius-changed', radiusMiles: 0.25 }, kv)

    const reloaded = await loadSettings(kv)
    expect(reloaded.radiusMiles).toBe(0.25)
  })

  it('category toggle is persisted and state ends up synced', async () => {
    const kv = createMemoryKVStore()
    const { finalState } = await simulateDispatch(
      INITIAL_STATE,
      { type: 'category-toggled', category: 'nightlife' },
      kv,
    )

    expect(finalState.settings.enabledCategories).toContain('nightlife')
    expect(finalState.syncStatus).toBe('synced')
  })

  it('persisted categories survive a loadSettings round-trip', async () => {
    const kv = createMemoryKVStore()
    await simulateDispatch(INITIAL_STATE, { type: 'category-toggled', category: 'nightlife' }, kv)

    const reloaded = await loadSettings(kv)
    expect(reloaded.enabledCategories).toContain('nightlife')
  })

  it('emits persist-settings + broadcast-settings effects', async () => {
    const kv = createMemoryKVStore()
    const { firstEffects } = await simulateDispatch(
      INITIAL_STATE,
      { type: 'radius-changed', radiusMiles: 1.5 },
      kv,
    )

    expect(firstEffects.map((e) => e.type)).toEqual([
      'persist-settings',
      'broadcast-settings',
    ])
  })
})

// ─── Persist failure → sync-failed ────────────────────────────────────────

describe('persist-settings failure → sync-failed', () => {
  it('state ends with syncStatus=error and captured message', async () => {
    // A KV store that always throws on set
    const failingKv: KVStore = {
      async get() { return null },
      async set() { throw new Error('quota exceeded') },
    }

    const { finalState } = await simulateDispatch(
      INITIAL_STATE,
      { type: 'radius-changed', radiusMiles: 1.5 },
      failingKv,
    )

    expect(finalState.syncStatus).toBe('error')
    expect(finalState.syncError).toMatch(/quota exceeded/)
  })

  it('settings state update is NOT rolled back on persist failure', async () => {
    // The in-memory reducer change is authoritative even if storage fails —
    // the user's intent is honoured; we just surface the sync error.
    const failingKv: KVStore = {
      async get() { return null },
      async set() { throw new Error('io error') },
    }

    const { finalState } = await simulateDispatch(
      INITIAL_STATE,
      { type: 'radius-changed', radiusMiles: 0.25 },
      failingKv,
    )

    expect(finalState.settings.radiusMiles).toBe(0.25)
    expect(finalState.syncStatus).toBe('error')
  })
})

// ─── Multi-change sequence ────────────────────────────────────────────────

describe('sequential settings changes', () => {
  it('two radius changes in sequence both persist correctly', async () => {
    const kv = createMemoryKVStore()
    let current = INITIAL_STATE

    const r1 = await simulateDispatch(current, { type: 'radius-changed', radiusMiles: 0.5 }, kv)
    current = r1.finalState

    const r2 = await simulateDispatch(current, { type: 'radius-changed', radiusMiles: 1.0 }, kv)
    current = r2.finalState

    expect(current.settings.radiusMiles).toBe(1.0)
    const reloaded = await loadSettings(kv)
    expect(reloaded.radiusMiles).toBe(1.0)
  })

  it('toggle then untoggle leaves KV with the final state', async () => {
    const kv = createMemoryKVStore()
    let current = INITIAL_STATE

    const r1 = await simulateDispatch(current, { type: 'category-toggled', category: 'nightlife' }, kv)
    current = r1.finalState
    expect(current.settings.enabledCategories).toContain('nightlife')

    const r2 = await simulateDispatch(current, { type: 'category-toggled', category: 'nightlife' }, kv)
    current = r2.finalState
    expect(current.settings.enabledCategories).not.toContain('nightlife')

    const reloaded = await loadSettings(kv)
    expect(reloaded.enabledCategories).not.toContain('nightlife')
  })

  it('syncStatus clears the previous error on a new successful change', async () => {
    const kv = createMemoryKVStore()

    // First change fails
    const failKv: KVStore = { async get() { return null }, async set() { throw new Error('fail') } }
    const r1 = await simulateDispatch(INITIAL_STATE, { type: 'radius-changed', radiusMiles: 0.5 }, failKv)
    expect(r1.finalState.syncStatus).toBe('error')

    // Second change to a good KV clears the error
    const r2 = await simulateDispatch(r1.finalState, { type: 'radius-changed', radiusMiles: 1.0 }, kv)
    expect(r2.finalState.syncStatus).toBe('synced')
    expect(r2.finalState.syncError).toBeNull()
  })
})

// ─── Broadcast-settings effect ────────────────────────────────────────────

describe('broadcast-settings effect', () => {
  it('is always emitted alongside persist-settings on a settings change', () => {
    const result = reduce(INITIAL_STATE, { type: 'radius-changed', radiusMiles: 1.5 })

    const types = result.effects.map((e) => e.type)
    expect(types).toContain('broadcast-settings')
  })

  it('carries the new settings, not the previous ones', async () => {
    const result = reduce(INITIAL_STATE, { type: 'radius-changed', radiusMiles: 1.5 })
    const broadcast = result.effects.find((e) => e.type === 'broadcast-settings')

    expect(broadcast).toBeDefined()
    if (broadcast?.type === 'broadcast-settings') {
      expect(broadcast.settings.radiusMiles).toBe(1.5)
    }
  })

  it('is NOT emitted on settings-hydrated (boot is not a change)', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'settings-hydrated',
      settings: { radiusMiles: 1.5, enabledCategories: [] },
    })
    const types = result.effects.map((e) => e.type)
    expect(types).not.toContain('broadcast-settings')
  })
})
