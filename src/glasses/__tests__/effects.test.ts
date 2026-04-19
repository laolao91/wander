import { describe, it, expect, vi, afterEach } from 'vitest'
import { EffectRunner } from '../effects'
import type { Event } from '../state'
import { DEFAULT_SETTINGS } from '../screens/types'
import * as api from '../api'

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
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── fetch-pois ────────────────────────────────────────────────────────

describe('fetch-pois effect', () => {
  it('dispatches position-updated then pois-loaded on success', async () => {
    vi.spyOn(api, 'fetchPois').mockResolvedValue([MOCK_POI])
    const { runner, dispatched } = makeRunner()
    await runner.run({ type: 'fetch-pois' })
    expect(dispatched.map((e) => e.type)).toEqual([
      'position-updated',
      'pois-loaded',
    ])
    const loaded = dispatched[1] as Extract<Event, { type: 'pois-loaded' }>
    expect(loaded.pois).toHaveLength(1)
    expect(loaded.isBackgroundRefresh).toBe(false)
  })

  it('dispatches pois-failed reason=location when geolocation fails', async () => {
    const { runner, dispatched } = makeRunner({ geolocate: async () => null })
    await runner.run({ type: 'fetch-pois' })
    expect(dispatched).toEqual([{ type: 'pois-failed', reason: 'location' }])
  })

  it('dispatches pois-failed reason=network when fetchPois throws', async () => {
    vi.spyOn(api, 'fetchPois').mockRejectedValue(
      new api.ApiError('boom', '/poi', 500),
    )
    const { runner, dispatched } = makeRunner()
    await runner.run({ type: 'fetch-pois' })
    expect(dispatched.at(-1)).toEqual({ type: 'pois-failed', reason: 'network' })
  })

  it('treats 400 from /api/poi as a location failure', async () => {
    vi.spyOn(api, 'fetchPois').mockRejectedValue(
      new api.ApiError('bad lat', '/poi', 400),
    )
    const { runner, dispatched } = makeRunner()
    await runner.run({ type: 'fetch-pois' })
    expect(dispatched.at(-1)).toEqual({ type: 'pois-failed', reason: 'location' })
  })

  it('backgroundRefresh sets isBackgroundRefresh=true on the pois-loaded event', async () => {
    vi.spyOn(api, 'fetchPois').mockResolvedValue([MOCK_POI])
    const { runner, dispatched } = makeRunner()
    await runner.backgroundRefresh()
    const loaded = dispatched.find((e) => e.type === 'pois-loaded') as Extract<
      Event,
      { type: 'pois-loaded' }
    >
    expect(loaded.isBackgroundRefresh).toBe(true)
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
