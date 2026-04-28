/**
 * Settings persistence — typed getters/setters over a generic KV store.
 *
 * The `KVStore` seam is intentional. In production the phone runs
 * inside the EvenHub Flutter WebView, where spec §17 mandates
 * `bridge.setLocalStorage` / `bridge.getLocalStorage` (browser
 * `localStorage` is unreliable in that host). An adapter at the App.tsx
 * boot wraps the SDK bridge into this interface and passes it in.
 * Tests and dev harnesses use the in-memory `createMemoryKVStore`.
 *
 * Storage keys are pinned by WANDER_BUILD_SPEC.md §10 and echoed in
 * HANDOFF.md §B3:
 *   wander_radius         — number (miles)
 *   wander_categories     — JSON array of CategoryId
 *
 * Two POI-cache keys from the same spec (`wander_last_poi_cache`,
 * `wander_last_fetch_ts`) are scoped to Phase 6 work (Nearby tab) and
 * deliberately not touched here.
 */

import {
  ALL_CATEGORIES,
  DEFAULT_SETTINGS,
  RADIUS_CHOICES,
  type CategoryId,
  type Poi,
  type RadiusMiles,
  type Settings,
} from './types'

export const STORAGE_KEYS = {
  // Settings (Phase H)
  radius: 'wander_radius',
  categories: 'wander_categories',
  // Nearby cache (Phase I) — WANDER_BUILD_SPEC.md §10
  poiCache: 'wander_last_poi_cache',
  poiCacheTs: 'wander_last_fetch_ts',
} as const

/**
 * Minimal key-value store interface. Async because `bridge.setLocalStorage`
 * returns a Promise — we can't assume sync. `get` returns `null` for
 * missing keys; the bridge adapter maps the SDK's empty-string result
 * to `null` so callers have a single missing-sentinel to branch on.
 *
 * No `remove` operation — the Settings flow only ever overwrites, and
 * the SDK's `EvenAppBridge` doesn't expose a delete method (SDK 0.0.10
 * `dist/index.d.ts`). Adding one would require a `set(key, '')`
 * convention which the empty-string-is-missing rule conflicts with.
 */
export interface KVStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

/**
 * In-memory KVStore. Used by unit tests and any dev harness that doesn't
 * have an SDK bridge available.
 */
export function createMemoryKVStore(
  seed: Record<string, string> = {},
): KVStore {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    async get(key) {
      return map.has(key) ? (map.get(key) as string) : null
    },
    async set(key, value) {
      map.set(key, value)
    },
  }
}

/**
 * Structural subset of the SDK's `EvenAppBridge` we need for storage.
 * Taking the structural type (not the full class) means tests can pass
 * a plain object and the phone UI can pass the real bridge — no SDK
 * import from this module.
 */
export interface BridgeStorageFacade {
  setLocalStorage(key: string, value: string): Promise<boolean>
  getLocalStorage(key: string): Promise<string>
}

/**
 * Adapter that exposes the SDK's bridge as a `KVStore`.
 *
 * Two quirks to handle:
 *   1. `getLocalStorage` returns `Promise<string>` with no null in the
 *      type. The SDK's behavior for missing keys is undocumented on
 *      0.0.10 — empirically it resolves to `""`. We treat empty string
 *      as "missing" so callers see a single sentinel (`null`).
 *   2. `setLocalStorage` returns `Promise<boolean>` where `false`
 *      signals a host-side write failure. We translate `false` into a
 *      thrown Error so callers can surface it as a sync-failed event
 *      rather than silently dropping the write.
 */
export function createBridgeKVStore(bridge: BridgeStorageFacade): KVStore {
  return {
    async get(key) {
      const raw = await bridge.getLocalStorage(key)
      return raw === '' ? null : raw
    },
    async set(key, value) {
      const ok = await bridge.setLocalStorage(key, value)
      if (!ok) {
        throw new Error(`bridge.setLocalStorage returned false for key ${key}`)
      }
    },
  }
}

/**
 * Load settings from the KV store, falling back to defaults for any
 * key that's missing or malformed. Never throws — a corrupt storage
 * entry is treated the same as a missing one.
 */
export async function loadSettings(kv: KVStore): Promise<Settings> {
  const [radiusRaw, categoriesRaw] = await Promise.all([
    kv.get(STORAGE_KEYS.radius),
    kv.get(STORAGE_KEYS.categories),
  ])
  return {
    radiusMiles: parseRadius(radiusRaw),
    enabledCategories: parseCategories(categoriesRaw),
  }
}

/**
 * Persist settings to the KV store. Writes happen in parallel — if one
 * fails the error propagates (the caller runs this as a `persist-settings`
 * effect and is responsible for deciding what to do on failure).
 */
export async function saveSettings(
  kv: KVStore,
  settings: Settings,
): Promise<void> {
  await Promise.all([
    kv.set(STORAGE_KEYS.radius, String(settings.radiusMiles)),
    kv.set(STORAGE_KEYS.categories, JSON.stringify(settings.enabledCategories)),
  ])
}

// ─── Parsers ────────────────────────────────────────────────────────────

/**
 * Accept only the 5 mockup-prescribed radius values. Anything else
 * (including legacy values from an older schema) snaps back to default.
 */
function parseRadius(raw: string | null): RadiusMiles {
  if (raw === null) return DEFAULT_SETTINGS.radiusMiles
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.radiusMiles
  const match = RADIUS_CHOICES.find((r) => r === n)
  return match ?? DEFAULT_SETTINGS.radiusMiles
}

/**
 * Parse the persisted categories array. Tolerant to:
 *   - null / missing → defaults
 *   - malformed JSON → defaults
 *   - non-array JSON → defaults
 *   - array with unknown category ids → unknowns dropped, knowns kept
 *     (this lets a future schema add categories without breaking older
 *     installs, and vice versa)
 */
function parseCategories(raw: string | null): readonly CategoryId[] {
  if (raw === null) return DEFAULT_SETTINGS.enabledCategories
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_SETTINGS.enabledCategories
  }
  if (!Array.isArray(parsed)) return DEFAULT_SETTINGS.enabledCategories
  const known = new Set<CategoryId>(ALL_CATEGORIES)
  const filtered = parsed.filter((x): x is CategoryId =>
    typeof x === 'string' && known.has(x as CategoryId),
  )
  return filtered
}

// ─── Nearby cache (Phase I) ────────────────────────────────────────────────

export interface NearbyCacheEntry {
  pois: readonly Poi[]
  fetchedAt: number
}

/**
 * Load the cached POI list from storage. Returns null when:
 *   - Keys are missing (first run)
 *   - JSON is malformed
 *   - The stored array doesn't look like Poi[] (shape guard)
 *
 * Intentionally lenient on individual POI fields — we prefer showing
 * slightly stale or partial data over showing nothing.
 */
export async function loadNearbyCache(kv: KVStore): Promise<NearbyCacheEntry | null> {
  const [cacheRaw, tsRaw] = await Promise.all([
    kv.get(STORAGE_KEYS.poiCache),
    kv.get(STORAGE_KEYS.poiCacheTs),
  ])
  if (cacheRaw === null || tsRaw === null) return null

  const fetchedAt = Number(tsRaw)
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(cacheRaw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  // Minimal shape guard: each item must at least have id + name strings.
  const pois = parsed.filter(
    (x): x is Poi =>
      typeof x === 'object' &&
      x !== null &&
      typeof (x as Record<string, unknown>).id === 'string' &&
      typeof (x as Record<string, unknown>).name === 'string',
  )

  return { pois, fetchedAt }
}

/**
 * Persist the current Nearby POI list and fetch timestamp to storage.
 * Errors propagate — the caller (App.tsx `cache-nearby-pois` handler)
 * logs and swallows; a cache write failure is non-fatal.
 */
export async function saveNearbyCache(
  kv: KVStore,
  pois: readonly Poi[],
  fetchedAt: number,
): Promise<void> {
  await Promise.all([
    kv.set(STORAGE_KEYS.poiCache, JSON.stringify(pois)),
    kv.set(STORAGE_KEYS.poiCacheTs, String(fetchedAt)),
  ])
}
