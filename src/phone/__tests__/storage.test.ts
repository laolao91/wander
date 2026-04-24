import { describe, it, expect } from 'vitest'
import {
  createBridgeKVStore,
  createMemoryKVStore,
  loadSettings,
  saveSettings,
  STORAGE_KEYS,
  type BridgeStorageFacade,
} from '../storage'
import { DEFAULT_SETTINGS, type Settings } from '../types'

// ─── Round-trip ────────────────────────────────────────────────────────

describe('saveSettings → loadSettings round-trip', () => {
  it('preserves a non-default radius and arbitrary category set', async () => {
    const kv = createMemoryKVStore()
    const original: Settings = {
      radiusMiles: 1.5,
      enabledCategories: ['libraries', 'nightlife'],
    }
    await saveSettings(kv, original)
    const loaded = await loadSettings(kv)
    expect(loaded).toEqual(original)
  })

  it('preserves an empty category set (user opted out of everything)', async () => {
    const kv = createMemoryKVStore()
    const original: Settings = {
      radiusMiles: 0.25,
      enabledCategories: [],
    }
    await saveSettings(kv, original)
    const loaded = await loadSettings(kv)
    expect(loaded.enabledCategories).toEqual([])
    expect(loaded.radiusMiles).toBe(0.25)
  })

  it('uses the canonical storage keys from spec §10', async () => {
    const kv = createMemoryKVStore()
    await saveSettings(kv, DEFAULT_SETTINGS)
    expect(await kv.get(STORAGE_KEYS.radius)).not.toBeNull()
    expect(await kv.get(STORAGE_KEYS.categories)).not.toBeNull()
    expect(STORAGE_KEYS.radius).toBe('wander_radius')
    expect(STORAGE_KEYS.categories).toBe('wander_categories')
  })
})

// ─── Defaults on missing / malformed ───────────────────────────────────

describe('loadSettings — empty + corrupt cases', () => {
  it('returns defaults when store is empty', async () => {
    const kv = createMemoryKVStore()
    const loaded = await loadSettings(kv)
    expect(loaded).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back to default radius on invalid number string', async () => {
    const kv = createMemoryKVStore({ wander_radius: 'not a number' })
    const loaded = await loadSettings(kv)
    expect(loaded.radiusMiles).toBe(DEFAULT_SETTINGS.radiusMiles)
  })

  it('falls back to default radius on out-of-range number', async () => {
    // 2.5 isn't in RADIUS_CHOICES even though it parses fine
    const kv = createMemoryKVStore({ wander_radius: '2.5' })
    const loaded = await loadSettings(kv)
    expect(loaded.radiusMiles).toBe(DEFAULT_SETTINGS.radiusMiles)
  })

  it('falls back to default categories on malformed JSON', async () => {
    const kv = createMemoryKVStore({ wander_categories: 'not-json{' })
    const loaded = await loadSettings(kv)
    expect(loaded.enabledCategories).toEqual(
      DEFAULT_SETTINGS.enabledCategories,
    )
  })

  it('falls back to default categories on non-array JSON', async () => {
    const kv = createMemoryKVStore({
      wander_categories: '{"historic": true}',
    })
    const loaded = await loadSettings(kv)
    expect(loaded.enabledCategories).toEqual(
      DEFAULT_SETTINGS.enabledCategories,
    )
  })

  it('drops unknown category ids from a mixed-known/unknown array', async () => {
    const kv = createMemoryKVStore({
      wander_categories: JSON.stringify(['historic', 'unicorns', 'parks']),
    })
    const loaded = await loadSettings(kv)
    expect(loaded.enabledCategories).toEqual(['historic', 'parks'])
  })

  it('returns an empty list when every stored id is unknown', async () => {
    // Forward-compat check: future schemas may rename categories, and
    // the phone has to keep booting even if nothing recognized persists.
    const kv = createMemoryKVStore({
      wander_categories: JSON.stringify(['old-id-1', 'old-id-2']),
    })
    const loaded = await loadSettings(kv)
    expect(loaded.enabledCategories).toEqual([])
  })
})

// ─── Independence ──────────────────────────────────────────────────────

describe('loadSettings — partial stores', () => {
  it('uses default radius when only categories are stored', async () => {
    const kv = createMemoryKVStore({
      wander_categories: JSON.stringify(['museums']),
    })
    const loaded = await loadSettings(kv)
    expect(loaded.radiusMiles).toBe(DEFAULT_SETTINGS.radiusMiles)
    expect(loaded.enabledCategories).toEqual(['museums'])
  })

  it('uses default categories when only radius is stored', async () => {
    const kv = createMemoryKVStore({ wander_radius: '1.0' })
    const loaded = await loadSettings(kv)
    expect(loaded.radiusMiles).toBe(1.0)
    expect(loaded.enabledCategories).toEqual(
      DEFAULT_SETTINGS.enabledCategories,
    )
  })
})

// ─── KVStore ──────────────────────────────────────────────────────────

describe('createMemoryKVStore', () => {
  it('get returns null for unknown keys', async () => {
    const kv = createMemoryKVStore()
    expect(await kv.get('nothing')).toBeNull()
  })

  it('set then get round-trips a value', async () => {
    const kv = createMemoryKVStore()
    await kv.set('k', 'v')
    expect(await kv.get('k')).toBe('v')
  })

  it('seeds from the passed-in record', async () => {
    const kv = createMemoryKVStore({ a: '1', b: '2' })
    expect(await kv.get('a')).toBe('1')
    expect(await kv.get('b')).toBe('2')
  })
})

// ─── Bridge adapter ────────────────────────────────────────────────────

function createFakeBridge(
  options: {
    initial?: Record<string, string>
    setReturns?: boolean
  } = {},
): BridgeStorageFacade & { map: Map<string, string>; calls: string[] } {
  const map = new Map<string, string>(Object.entries(options.initial ?? {}))
  const calls: string[] = []
  return {
    map,
    calls,
    async setLocalStorage(key, value) {
      calls.push(`set:${key}=${value}`)
      if (options.setReturns === false) return false
      map.set(key, value)
      return true
    },
    async getLocalStorage(key) {
      calls.push(`get:${key}`)
      // SDK 0.0.10 empirically returns '' for missing keys.
      return map.get(key) ?? ''
    },
  }
}

describe('createBridgeKVStore', () => {
  it('maps the SDK empty-string result to null on missing keys', async () => {
    const bridge = createFakeBridge()
    const kv = createBridgeKVStore(bridge)
    expect(await kv.get('wander_radius')).toBeNull()
  })

  it('returns the stored value untouched when present', async () => {
    const bridge = createFakeBridge({ initial: { wander_radius: '1.0' } })
    const kv = createBridgeKVStore(bridge)
    expect(await kv.get('wander_radius')).toBe('1.0')
  })

  it('forwards set calls to the bridge', async () => {
    const bridge = createFakeBridge()
    const kv = createBridgeKVStore(bridge)
    await kv.set('wander_radius', '0.5')
    expect(bridge.map.get('wander_radius')).toBe('0.5')
  })

  it('throws when the bridge returns false from setLocalStorage', async () => {
    const bridge = createFakeBridge({ setReturns: false })
    const kv = createBridgeKVStore(bridge)
    await expect(kv.set('wander_radius', '0.5')).rejects.toThrow(
      /setLocalStorage returned false/,
    )
  })

  it('plugs into loadSettings end-to-end', async () => {
    const bridge = createFakeBridge({
      initial: {
        wander_radius: '1.5',
        wander_categories: JSON.stringify(['museums', 'religious']),
      },
    })
    const kv = createBridgeKVStore(bridge)
    const loaded = await loadSettings(kv)
    expect(loaded.radiusMiles).toBe(1.5)
    expect(loaded.enabledCategories).toEqual(['museums', 'religious'])
  })

  it('plugs into saveSettings end-to-end', async () => {
    const bridge = createFakeBridge()
    const kv = createBridgeKVStore(bridge)
    const custom: Settings = {
      radiusMiles: 0.25,
      enabledCategories: ['libraries'],
    }
    await saveSettings(kv, custom)
    expect(bridge.map.get(STORAGE_KEYS.radius)).toBe('0.25')
    expect(bridge.map.get(STORAGE_KEYS.categories)).toBe('["libraries"]')
  })
})
