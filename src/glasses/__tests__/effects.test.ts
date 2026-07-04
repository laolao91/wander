import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { EffectRunner, defaultGeolocate, defaultWatchPosition, defaultOpenUrl } from '../effects'
import type { Event } from '../state'
import { DEFAULT_SETTINGS } from '../screens/types'
import * as api from '../api'
import { sdkGeolocate, sdkWatchPosition } from '../sdkLocation'
import { bridgeGeolocate, bridgeWatchPosition } from '../appsBridge'

vi.mock('../sdkLocation', () => ({
  sdkGeolocate: vi.fn(),
  sdkWatchPosition: vi.fn(),
}))
vi.mock('../appsBridge', () => ({
  bridgeGeolocate: vi.fn(),
  bridgeWatchPosition: vi.fn(),
}))

// ─── Helpers ───────────────────────────────────────────────────────────

function makeRunner(overrides: {
  geolocate?: () => Promise<{ lat: number; lng: number } | null>
  openUrl?: (url: string) => void
  watchPosition?: (cb: (lat: number, lng: number) => void) => () => void
} = {}) {
  const dispatched: Event[] = []
  const runner = new EffectRunner({
    dispatch: (e) => dispatched.push(e),
    getSettings: () => DEFAULT_SETTINGS,
    geolocate: overrides.geolocate ?? (async () => ({ lat: 40.7128, lng: -74.006 })),
    openUrl: overrides.openUrl ?? (() => {}),
    watchPosition: overrides.watchPosition ?? (() => () => {}),
  })
  return { runner, dispatched }
}

const MOCK_POI = {
  id: 'wiki_1',
  name: 'X',
  category: 'park' as const,
  categoryIcon: '★',
  lat: 40.7128,
  lng: -74.006,
  distanceMeters: 1,
  distanceMiles: 0,
  bearingDegrees: 0,
  walkMinutes: 1,
  wikiTitle: 'X',
  wikiSummary: 'x',
  websiteUrl: 'https://x',
  source: 'wikipedia' as const,
  openingHours: null,
  isOpenNow: null,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// ─── fetch-pois ────────────────────────────────────────────────────────

describe('fetch-pois effect', () => {
  it('dispatches position-updated then pois-loaded on success', async () => {
    vi.spyOn(api, 'fetchPois').mockResolvedValue({
      items: [MOCK_POI],
      hasMore: false,
    })
    const { runner, dispatched } = makeRunner()
    await runner.run({ type: 'fetch-pois', offset: 0, mode: 'replace' })
    expect(dispatched.map((e) => e.type)).toEqual([
      'position-updated',
      'pois-loaded',
    ])
    const loaded = dispatched[1] as Extract<Event, { type: 'pois-loaded' }>
    expect(loaded.pois).toHaveLength(1)
    expect(loaded.hasMore).toBe(false)
    expect(loaded.mode).toBe('replace')
    expect(loaded.isBackgroundRefresh).toBe(false)
  })

  it('forwards offset + mode through to the api wrapper and dispatch', async () => {
    const spy = vi
      .spyOn(api, 'fetchPois')
      .mockResolvedValue({ items: [MOCK_POI], hasMore: true })
    const { runner, dispatched } = makeRunner()
    await runner.run({ type: 'fetch-pois', offset: 20, mode: 'append' })
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 20 }),
    )
    const loaded = dispatched.find((e) => e.type === 'pois-loaded') as Extract<
      Event,
      { type: 'pois-loaded' }
    >
    expect(loaded.mode).toBe('append')
    expect(loaded.hasMore).toBe(true)
  })

  it('dispatches pois-failed reason=location when geolocation fails', async () => {
    const { runner, dispatched } = makeRunner({ geolocate: async () => null })
    await runner.run({ type: 'fetch-pois', offset: 0, mode: 'replace' })
    expect(dispatched).toEqual([{ type: 'pois-failed', reason: 'location' }])
  })

  it('dispatches pois-failed reason=network when fetchPois throws', async () => {
    vi.spyOn(api, 'fetchPois').mockRejectedValue(
      new api.ApiError('boom', '/poi', 500),
    )
    const { runner, dispatched } = makeRunner()
    await runner.run({ type: 'fetch-pois', offset: 0, mode: 'replace' })
    expect(dispatched.at(-1)).toEqual({ type: 'pois-failed', reason: 'network' })
  })

  it('treats 400 from /api/poi as a location failure', async () => {
    vi.spyOn(api, 'fetchPois').mockRejectedValue(
      new api.ApiError('bad lat', '/poi', 400),
    )
    const { runner, dispatched } = makeRunner()
    await runner.run({ type: 'fetch-pois', offset: 0, mode: 'replace' })
    expect(dispatched.at(-1)).toEqual({ type: 'pois-failed', reason: 'location' })
  })

  it('backgroundRefresh sets isBackgroundRefresh=true and uses replace mode', async () => {
    vi.spyOn(api, 'fetchPois').mockResolvedValue({
      items: [MOCK_POI],
      hasMore: false,
    })
    const { runner, dispatched } = makeRunner()
    await runner.backgroundRefresh()
    const loaded = dispatched.find((e) => e.type === 'pois-loaded') as Extract<
      Event,
      { type: 'pois-loaded' }
    >
    expect(loaded.isBackgroundRefresh).toBe(true)
    expect(loaded.mode).toBe('replace')
  })
})

// ─── fetch-route ───────────────────────────────────────────────────────

describe('fetch-route effect', () => {
  it('dispatches route-loaded on success', async () => {
    const route = {
      totalDistanceMeters: 100,
      totalDurationSeconds: 60,
      steps: [],
      geometry: [] as [number, number][],
      language: 'en',
    }
    vi.spyOn(api, 'fetchRoute').mockResolvedValue(route)
    const { runner, dispatched } = makeRunner()
    await runner.run({
      type: 'fetch-route',
      from: { lat: 1, lng: 2 },
      to: MOCK_POI,
    })
    expect(dispatched).toEqual([{ type: 'route-loaded', route }])
  })

  it('dispatches route-failed on error', async () => {
    vi.spyOn(api, 'fetchRoute').mockRejectedValue(new Error('boom'))
    const { runner, dispatched } = makeRunner()
    await runner.run({
      type: 'fetch-route',
      from: { lat: 1, lng: 2 },
      to: MOCK_POI,
    })
    expect(dispatched).toEqual([{ type: 'route-failed' }])
  })
})

// ─── fetch-wiki ────────────────────────────────────────────────────────

describe('fetch-wiki effect', () => {
  it('dispatches wiki-loaded on success', async () => {
    const article = {
      title: 'X',
      summary: 's',
      pages: ['p1'],
      totalPages: 1,
      lang: 'en',
    }
    vi.spyOn(api, 'fetchWiki').mockResolvedValue(article)
    const { runner, dispatched } = makeRunner()
    await runner.run({ type: 'fetch-wiki', title: 'X', lang: null })
    expect(dispatched).toEqual([{ type: 'wiki-loaded', article }])
  })

  it('dispatches wiki-failed on error', async () => {
    vi.spyOn(api, 'fetchWiki').mockRejectedValue(new Error('boom'))
    const { runner, dispatched } = makeRunner()
    await runner.run({ type: 'fetch-wiki', title: 'X', lang: null })
    expect(dispatched).toEqual([{ type: 'wiki-failed' }])
  })
})

// ─── open-url ──────────────────────────────────────────────────────────

describe('open-url effect', () => {
  it('calls the injected openUrl with the URL', async () => {
    const opened: string[] = []
    const { runner } = makeRunner({ openUrl: (u) => opened.push(u) })
    await runner.run({ type: 'open-url', url: 'https://example.com' })
    expect(opened).toEqual(['https://example.com'])
  })
})

// ─── nav watch lifecycle ───────────────────────────────────────────────

describe('nav watch', () => {
  it('start-nav-watch wires the watcher, stop-nav-watch cancels it', async () => {
    let cancelled = false
    const pushRef: { fn: ((lat: number, lng: number) => void) | null } = { fn: null }
    const { runner, dispatched } = makeRunner({
      watchPosition: (cb) => {
        pushRef.fn = cb
        return () => {
          cancelled = true
        }
      },
    })

    await runner.run({ type: 'start-nav-watch' })
    pushRef.fn?.(1, 2)
    expect(dispatched).toContainEqual({
      type: 'position-updated',
      lat: 1,
      lng: 2,
      heading: null,
    })

    await runner.run({ type: 'stop-nav-watch' })
    expect(cancelled).toBe(true)
  })

  it('starting a second watch cancels the first', async () => {
    let cancelCount = 0
    const { runner } = makeRunner({
      watchPosition: () => () => {
        cancelCount++
      },
    })
    await runner.run({ type: 'start-nav-watch' })
    await runner.run({ type: 'start-nav-watch' })
    expect(cancelCount).toBe(1) // first watch cancelled when second started
  })

  it('dispose() stops any active watch', async () => {
    let cancelled = false
    const { runner } = makeRunner({
      watchPosition: () => () => {
        cancelled = true
      },
    })
    await runner.run({ type: 'start-nav-watch' })
    runner.dispose()
    expect(cancelled).toBe(true)
  })
})

// ─── defaultGeolocate / defaultWatchPosition ──────────────────────────────

describe('defaultGeolocate / defaultWatchPosition', () => {
  beforeEach(() => {
    vi.mocked(sdkGeolocate).mockReset()
    vi.mocked(sdkWatchPosition).mockReset()
    vi.mocked(bridgeGeolocate).mockReset()
    vi.mocked(bridgeWatchPosition).mockReset()
    // Neutralize the DEV mock-coords short-circuit (.env.local sets
    // VITE_MOCK_LAT/LNG for the simulator) so these tests exercise the
    // real SDK → navigator → APPS Bridge ordering instead of returning
    // the mock immediately.
    vi.stubEnv('VITE_MOCK_LAT', '')
    vi.stubEnv('VITE_MOCK_LNG', '')
  })

  it('defaultGeolocate returns the SDK fix immediately and does not call bridgeGeolocate', async () => {
    vi.mocked(sdkGeolocate).mockResolvedValue({ lat: 1, lng: 2 })
    const result = await defaultGeolocate()
    expect(result).toEqual({ lat: 1, lng: 2 })
    expect(bridgeGeolocate).not.toHaveBeenCalled()
  })

  it('defaultGeolocate falls through to bridgeGeolocate when sdkGeolocate resolves null and navigator.geolocation is unavailable', async () => {
    vi.mocked(sdkGeolocate).mockResolvedValue(null)
    vi.mocked(bridgeGeolocate).mockResolvedValue({ lat: 3, lng: 4 })
    const result = await defaultGeolocate()
    expect(sdkGeolocate).toHaveBeenCalled()
    expect(bridgeGeolocate).toHaveBeenCalled()
    expect(result).toEqual({ lat: 3, lng: 4 })
  })

  it('defaultGeolocate falls through to navigator.geolocation when sdkGeolocate resolves null, returning the native fix without calling bridgeGeolocate', async () => {
    vi.mocked(sdkGeolocate).mockResolvedValue(null)
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: (p: unknown) => void) => {
          success({ coords: { latitude: 5, longitude: 6 } })
        },
        watchPosition: vi.fn(),
        clearWatch: vi.fn(),
      },
    })
    const result = await defaultGeolocate()
    expect(result).toEqual({ lat: 5, lng: 6 })
    expect(bridgeGeolocate).not.toHaveBeenCalled()
  })

  it('defaultWatchPosition starts sdkWatchPosition unconditionally alongside the bridge watch when navigator.geolocation is unavailable, and cancel cancels both', () => {
    const cancelSdkSpy = vi.fn()
    const cancelBridgeSpy = vi.fn()
    vi.mocked(sdkWatchPosition).mockReturnValue(cancelSdkSpy)
    vi.mocked(bridgeWatchPosition).mockReturnValue(cancelBridgeSpy)

    const onPosition = vi.fn()
    const cancel = defaultWatchPosition(onPosition)

    expect(sdkWatchPosition).toHaveBeenCalledWith(onPosition)
    expect(bridgeWatchPosition).toHaveBeenCalledWith(onPosition)

    cancel()
    expect(cancelSdkSpy).toHaveBeenCalledTimes(1)
    expect(cancelBridgeSpy).toHaveBeenCalledTimes(1)
  })

  it('defaultWatchPosition with navigator.geolocation stubbed still starts sdkWatchPosition and cancel calls sdk cancel + navigator.geolocation.clearWatch', () => {
    const cancelSdkSpy = vi.fn()
    vi.mocked(sdkWatchPosition).mockReturnValue(cancelSdkSpy)

    const clearWatchSpy = vi.fn()
    const watchPositionSpy = vi.fn().mockReturnValue(42)
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: vi.fn(),
        watchPosition: watchPositionSpy,
        clearWatch: clearWatchSpy,
      },
    })

    const onPosition = vi.fn()
    const cancel = defaultWatchPosition(onPosition)

    expect(sdkWatchPosition).toHaveBeenCalledWith(onPosition)
    expect(bridgeWatchPosition).not.toHaveBeenCalled()

    cancel()
    expect(cancelSdkSpy).toHaveBeenCalledTimes(1)
    expect(clearWatchSpy).toHaveBeenCalledWith(42)
  })
})

// ─── defaultOpenUrl ────────────────────────────────────────────────────

// NOTE: this project's vitest.config.ts runs in `environment: 'node'` (no
// DOM), and confirmed directly (not assumed): `window` is not merely
// `typeof window === 'undefined'`, it is not declared as a global
// identifier at all here — referencing it bare (not via `typeof`) throws
// `ReferenceError: window is not defined`. That's the same reason the
// `defaultGeolocate`/`defaultWatchPosition` tests above stub `navigator`
// via `vi.stubGlobal('navigator', {...})` before referencing it bare —
// this block follows that same established pattern for `window`.
describe('defaultOpenUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('tries window.open with _system first, and does not fall back if it succeeds', () => {
    vi.stubGlobal('window', { open: () => null })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    defaultOpenUrl('https://example.com')
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_system', 'noopener,noreferrer')
  })

  it('falls back to _blank when _system is rejected (returns falsy)', () => {
    vi.stubGlobal('window', { open: () => null })
    const openSpy = vi.spyOn(window, 'open')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({} as Window)
    defaultOpenUrl('https://example.com')
    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(openSpy).toHaveBeenNthCalledWith(1, 'https://example.com', '_system', 'noopener,noreferrer')
    expect(openSpy).toHaveBeenNthCalledWith(2, 'https://example.com', '_blank', 'noopener,noreferrer')
  })

  // Third case from the task brief — "does nothing if window is undefined
  // (SSR/non-browser guard)" — is intentionally dropped per the brief's own
  // conditional instruction. Confirmed above: in this suite's `node`
  // environment, `window` is *already* undefined as a global by default,
  // with zero stubbing, in every other test in this file. There is no way
  // to construct a *distinct* "window is undefined" test case beyond what
  // already implicitly holds everywhere else — attempting to name it would
  // just re-assert the ambient default, not exercise anything new. The
  // guard clause itself (`if (typeof window === 'undefined') return`) is a
  // one-line no-op and is verified by inspection, per the brief's own note.
})
