/**
 * Tests for the Phase I Nearby data layer:
 *   - categoryIdToCategory / categoryIdsToCategories mapping
 *   - Nearby reducer transitions (all events in the fetch lifecycle)
 *   - loadNearbyCache / saveNearbyCache storage round-trips
 *
 * UI wiring (geolocation, fetch calls, NearbyTab.tsx) is Phase I session 1
 * — nothing UI-related is tested here.
 */

import { describe, it, expect } from 'vitest'
import { INITIAL_STATE, reduce } from '../state'
import {
  loadNearbyCache,
  saveNearbyCache,
  createMemoryKVStore,
  STORAGE_KEYS,
} from '../storage'
import {
  categoryIdToCategory,
  categoryIdsToCategories,
  ALL_CATEGORIES,
  INITIAL_NEARBY_STATE,
  type Poi,
  type PhoneState,
} from '../types'

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makePoi(overrides: Partial<Poi> = {}): Poi {
  return {
    id: 'test-1',
    name: 'Test POI',
    category: 'landmark',
    categoryIcon: '★',
    lat: 40.7128,
    lng: -74.006,
    distanceMeters: 100,
    distanceMiles: 0.06,
    bearingDegrees: 90,
    walkMinutes: 2,
    wikiTitle: null,
    wikiSummary: null,
    websiteUrl: null,
    source: 'osm',
    ...overrides,
  }
}

function nearby(state: PhoneState) {
  return state.nearby
}

// ─── Category mapping ──────────────────────────────────────────────────────

describe('categoryIdToCategory — all 8 mappings', () => {
  const cases: [Parameters<typeof categoryIdToCategory>[0], ReturnType<typeof categoryIdToCategory>][] = [
    ['historic',    'landmark'],
    ['parks',       'park'],
    ['museums',     'museum'],
    ['religious',   'religion'],
    ['publicArt',   'art'],
    ['libraries',   'library'],
    ['restaurants', 'food'],
    ['nightlife',   'nightlife'],
  ]
  for (const [id, expected] of cases) {
    it(`${id} → ${expected}`, () => {
      expect(categoryIdToCategory(id)).toBe(expected)
    })
  }
})

describe('categoryIdsToCategories', () => {
  it('maps an empty array to an empty array', () => {
    expect(categoryIdsToCategories([])).toEqual([])
  })

  it('maps a subset correctly', () => {
    expect(categoryIdsToCategories(['historic', 'restaurants', 'nightlife'])).toEqual([
      'landmark',
      'food',
      'nightlife',
    ])
  })

  it('maps all 8 categories and produces 8 API names', () => {
    const result = categoryIdsToCategories(ALL_CATEGORIES)
    expect(result).toHaveLength(8)
    expect(result).toEqual([
      'landmark', 'park', 'museum', 'religion',
      'art', 'library', 'food', 'nightlife',
    ])
  })

  it('preserves input order', () => {
    const result = categoryIdsToCategories(['nightlife', 'historic'])
    expect(result).toEqual(['nightlife', 'landmark'])
  })

  it('does not mutate the input array', () => {
    const input = ['historic', 'parks'] as const
    categoryIdsToCategories(input)
    expect(input).toEqual(['historic', 'parks'])
  })
})

// ─── INITIAL_NEARBY_STATE ─────────────────────────────────────────────────

describe('INITIAL_NEARBY_STATE', () => {
  it('boots idle with no pois, no location, no error', () => {
    expect(INITIAL_NEARBY_STATE.fetchStatus).toBe('idle')
    expect(INITIAL_NEARBY_STATE.pois).toEqual([])
    expect(INITIAL_NEARBY_STATE.location).toBeNull()
    expect(INITIAL_NEARBY_STATE.lastFetchTs).toBeNull()
    expect(INITIAL_NEARBY_STATE.errorMessage).toBeNull()
  })
})

// ─── Reducer: nearby-refresh-requested ────────────────────────────────────

describe('nearby-refresh-requested', () => {
  it('transitions to locating and emits request-location', () => {
    const result = reduce(INITIAL_STATE, { type: 'nearby-refresh-requested' })
    expect(nearby(result.state).fetchStatus).toBe('locating')
    expect(result.effects).toEqual([{ type: 'request-location' }])
  })

  it('clears a previous errorMessage', () => {
    const withError: PhoneState = {
      ...INITIAL_STATE,
      nearby: { ...INITIAL_NEARBY_STATE, fetchStatus: 'error-location', errorMessage: 'denied' },
    }
    const result = reduce(withError, { type: 'nearby-refresh-requested' })
    expect(nearby(result.state).errorMessage).toBeNull()
  })

  it('preserves existing pois while re-fetching (no flash-of-empty)', () => {
    const pois = [makePoi()]
    const withPois: PhoneState = {
      ...INITIAL_STATE,
      nearby: { ...INITIAL_NEARBY_STATE, fetchStatus: 'success', pois, lastFetchTs: 1000 },
    }
    const result = reduce(withPois, { type: 'nearby-refresh-requested' })
    expect(nearby(result.state).pois).toBe(pois)
    expect(nearby(result.state).lastFetchTs).toBe(1000)
  })
})

// ─── Reducer: location-acquired ───────────────────────────────────────────

describe('location-acquired', () => {
  const locatingState: PhoneState = {
    ...INITIAL_STATE,
    nearby: { ...INITIAL_NEARBY_STATE, fetchStatus: 'locating' },
  }

  it('transitions to fetching and emits fetch-nearby-pois with location + settings', () => {
    const result = reduce(locatingState, { type: 'location-acquired', lat: 40.71, lng: -74.0 })
    expect(nearby(result.state).fetchStatus).toBe('fetching')
    expect(nearby(result.state).location).toEqual({ lat: 40.71, lng: -74.0, label: null })
    expect(result.effects).toEqual([{
      type: 'fetch-nearby-pois',
      lat: 40.71,
      lng: -74.0,
      settings: locatingState.settings,
    }])
  })

  it('preserves an existing reverse-geocode label on the location', () => {
    const withLabel: PhoneState = {
      ...INITIAL_STATE,
      nearby: {
        ...INITIAL_NEARBY_STATE,
        fetchStatus: 'locating',
        location: { lat: 40.71, lng: -74.0, label: 'Upper West Side' },
      },
    }
    const result = reduce(withLabel, { type: 'location-acquired', lat: 40.72, lng: -74.01 })
    expect(nearby(result.state).location?.label).toBe('Upper West Side')
  })

  it('bakes in current settings at emit time (snapshot)', () => {
    const customState: PhoneState = {
      ...locatingState,
      settings: { radiusMiles: 1.5, enabledCategories: ['museums'] },
    }
    const result = reduce(customState, { type: 'location-acquired', lat: 0, lng: 0 })
    const effect = result.effects[0]
    if (effect.type === 'fetch-nearby-pois') {
      expect(effect.settings.radiusMiles).toBe(1.5)
      expect(effect.settings.enabledCategories).toEqual(['museums'])
    }
  })
})

// ─── Reducer: location-failed ─────────────────────────────────────────────

describe('location-failed', () => {
  it('transitions to error-location with message, no effects', () => {
    const result = reduce(INITIAL_STATE, { type: 'location-failed', message: 'Permission denied' })
    expect(nearby(result.state).fetchStatus).toBe('error-location')
    expect(nearby(result.state).errorMessage).toBe('Permission denied')
    expect(result.effects).toEqual([])
  })
})

// ─── Reducer: location-label-resolved ────────────────────────────────────

describe('location-label-resolved', () => {
  it('patches the label on an existing location, no effects', () => {
    const withLocation: PhoneState = {
      ...INITIAL_STATE,
      nearby: {
        ...INITIAL_NEARBY_STATE,
        fetchStatus: 'fetching',
        location: { lat: 40.71, lng: -74.0, label: null },
      },
    }
    const result = reduce(withLocation, { type: 'location-label-resolved', label: 'SoHo, NYC' })
    expect(nearby(result.state).location?.label).toBe('SoHo, NYC')
    expect(result.effects).toEqual([])
  })

  it('is a no-op when location is null (label arrived before coords)', () => {
    const result = reduce(INITIAL_STATE, { type: 'location-label-resolved', label: 'Somewhere' })
    expect(result.state).toBe(INITIAL_STATE)
  })

  it('does not change fetchStatus', () => {
    const fetching: PhoneState = {
      ...INITIAL_STATE,
      nearby: {
        ...INITIAL_NEARBY_STATE,
        fetchStatus: 'fetching',
        location: { lat: 0, lng: 0, label: null },
      },
    }
    const result = reduce(fetching, { type: 'location-label-resolved', label: 'X' })
    expect(nearby(result.state).fetchStatus).toBe('fetching')
  })
})

// ─── Reducer: nearby-pois-loaded ─────────────────────────────────────────

describe('nearby-pois-loaded', () => {
  const fetchingState: PhoneState = {
    ...INITIAL_STATE,
    nearby: {
      ...INITIAL_NEARBY_STATE,
      fetchStatus: 'fetching',
      location: { lat: 40.71, lng: -74.0, label: null },
    },
  }

  it('transitions to success, stores pois + timestamp, emits cache effect', () => {
    const pois = [makePoi({ id: 'a' }), makePoi({ id: 'b' })]
    const result = reduce(fetchingState, { type: 'nearby-pois-loaded', pois, fetchedAt: 9000 })
    expect(nearby(result.state).fetchStatus).toBe('success')
    expect(nearby(result.state).pois).toBe(pois)
    expect(nearby(result.state).lastFetchTs).toBe(9000)
    expect(nearby(result.state).errorMessage).toBeNull()
    expect(result.effects).toEqual([{ type: 'cache-nearby-pois', pois, fetchedAt: 9000 }])
  })

  it('accepts an empty pois array (no results nearby)', () => {
    const result = reduce(fetchingState, { type: 'nearby-pois-loaded', pois: [], fetchedAt: 1 })
    expect(nearby(result.state).fetchStatus).toBe('success')
    expect(nearby(result.state).pois).toEqual([])
  })

  it('clears a previous error message on success', () => {
    const withError: PhoneState = {
      ...INITIAL_STATE,
      nearby: { ...INITIAL_NEARBY_STATE, fetchStatus: 'error-network', errorMessage: 'timeout' },
    }
    const result = reduce(withError, { type: 'nearby-pois-loaded', pois: [], fetchedAt: 1 })
    expect(nearby(result.state).errorMessage).toBeNull()
  })
})

// ─── Reducer: nearby-fetch-failed ────────────────────────────────────────

describe('nearby-fetch-failed', () => {
  it('transitions to error-network with message, no effects', () => {
    const result = reduce(INITIAL_STATE, { type: 'nearby-fetch-failed', message: 'Network error' })
    expect(nearby(result.state).fetchStatus).toBe('error-network')
    expect(nearby(result.state).errorMessage).toBe('Network error')
    expect(result.effects).toEqual([])
  })

  it('does not wipe the existing pois (retry can still show stale data)', () => {
    const withPois: PhoneState = {
      ...INITIAL_STATE,
      nearby: { ...INITIAL_NEARBY_STATE, fetchStatus: 'fetching', pois: [makePoi()], lastFetchTs: 5000 },
    }
    const result = reduce(withPois, { type: 'nearby-fetch-failed', message: 'timeout' })
    expect(nearby(result.state).pois).toHaveLength(1)
    expect(nearby(result.state).lastFetchTs).toBe(5000)
  })
})

// ─── Reducer: nearby doesn't disturb settings ────────────────────────────

describe('nearby events do not disturb Settings state', () => {
  it('nearby-pois-loaded leaves settings unchanged', () => {
    const result = reduce(INITIAL_STATE, { type: 'nearby-pois-loaded', pois: [], fetchedAt: 1 })
    expect(result.state.settings).toBe(INITIAL_STATE.settings)
    expect(result.state.syncStatus).toBe(INITIAL_STATE.syncStatus)
  })

  it('settings change leaves nearby unchanged', () => {
    const result = reduce(INITIAL_STATE, { type: 'radius-changed', radiusMiles: 1.5 })
    expect(result.state.nearby).toBe(INITIAL_STATE.nearby)
  })
})

// ─── Nearby cache storage ─────────────────────────────────────────────────

describe('saveNearbyCache → loadNearbyCache round-trip', () => {
  it('preserves pois array and fetchedAt timestamp', async () => {
    const kv = createMemoryKVStore()
    const pois = [makePoi({ id: 'x' }), makePoi({ id: 'y', name: 'Y Place' })]
    await saveNearbyCache(kv, pois, 123456789)

    const loaded = await loadNearbyCache(kv)
    expect(loaded).not.toBeNull()
    expect(loaded!.fetchedAt).toBe(123456789)
    expect(loaded!.pois).toHaveLength(2)
    expect(loaded!.pois[0].id).toBe('x')
    expect(loaded!.pois[1].name).toBe('Y Place')
  })

  it('uses the canonical storage keys from spec §10', async () => {
    const kv = createMemoryKVStore()
    await saveNearbyCache(kv, [makePoi()], 1000)
    expect(await kv.get(STORAGE_KEYS.poiCache)).not.toBeNull()
    expect(await kv.get(STORAGE_KEYS.poiCacheTs)).toBe('1000')
    expect(STORAGE_KEYS.poiCache).toBe('wander_last_poi_cache')
    expect(STORAGE_KEYS.poiCacheTs).toBe('wander_last_fetch_ts')
  })

  it('returns null when cache is empty', async () => {
    const kv = createMemoryKVStore()
    expect(await loadNearbyCache(kv)).toBeNull()
  })

  it('returns null when only one key exists (partial write)', async () => {
    const kv = createMemoryKVStore({ wander_last_poi_cache: '[]' })
    expect(await loadNearbyCache(kv)).toBeNull()
  })

  it('returns null on malformed JSON in the pois key', async () => {
    const kv = createMemoryKVStore({
      wander_last_poi_cache: 'not-json{',
      wander_last_fetch_ts: '1000',
    })
    expect(await loadNearbyCache(kv)).toBeNull()
  })

  it('returns null when timestamp is not a valid number', async () => {
    const kv = createMemoryKVStore({
      wander_last_poi_cache: '[]',
      wander_last_fetch_ts: 'banana',
    })
    expect(await loadNearbyCache(kv)).toBeNull()
  })

  it('drops malformed entries but keeps valid ones (partial-corrupt cache)', async () => {
    const valid = makePoi({ id: 'good' })
    const kv = createMemoryKVStore({
      wander_last_poi_cache: JSON.stringify([valid, { bad: true }, 42, null]),
      wander_last_fetch_ts: '1000',
    })
    const loaded = await loadNearbyCache(kv)
    expect(loaded).not.toBeNull()
    expect(loaded!.pois).toHaveLength(1)
    expect(loaded!.pois[0].id).toBe('good')
  })

  it('accepts an empty pois array (valid — no results nearby)', async () => {
    const kv = createMemoryKVStore()
    await saveNearbyCache(kv, [], 500)
    const loaded = await loadNearbyCache(kv)
    expect(loaded).not.toBeNull()
    expect(loaded!.pois).toEqual([])
    expect(loaded!.fetchedAt).toBe(500)
  })
})
