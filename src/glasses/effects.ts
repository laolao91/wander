/**
 * Effect runner — executes the side-effects requested by the reducer.
 *
 * The reducer returns `Effect[]` alongside each new state; the bridge
 * passes those effects here. The runner performs the I/O (geolocation,
 * HTTP, window.open, GPS watch lifetime) and dispatches the resulting
 * events back into the reducer.
 *
 * All browser APIs are injected via `EffectRunnerDeps` so the runner is
 * unit-testable without a DOM. Defaults wire up `navigator.geolocation`
 * and `window.open` for production use.
 */

import { ApiError, fetchPois, fetchRoute, fetchWiki } from './api'
import type { Event, Effect } from './state'
import type { Settings } from './screens/types'

export interface EffectRunnerDeps {
  /** Send an event back into the reducer. */
  dispatch: (event: Event) => void
  /** Latest settings — read fresh on every fetch. */
  getSettings: () => Settings
  /** One-shot location lookup; null on permission denied / failure. */
  geolocate?: () => Promise<{ lat: number; lng: number } | null>
  /** Open an external URL (Safari on the companion phone). */
  openUrl?: (url: string) => void
  /** Continuous GPS watch; returns a cancel function. */
  watchPosition?: (
    onPosition: (lat: number, lng: number) => void,
  ) => () => void
  /** Tear down the page container and exit the app (CONFIRM_EXIT → "Yes"). */
  exitApp?: () => void
}

export class EffectRunner {
  private readonly deps: Required<EffectRunnerDeps>
  private cancelNavWatch: (() => void) | null = null

  constructor(deps: EffectRunnerDeps) {
    this.deps = {
      dispatch: deps.dispatch,
      getSettings: deps.getSettings,
      geolocate: deps.geolocate ?? defaultGeolocate,
      openUrl: deps.openUrl ?? defaultOpenUrl,
      watchPosition: deps.watchPosition ?? defaultWatchPosition,
      exitApp: deps.exitApp ?? (() => {}),
    }
  }

  /** Fire-and-forget runner for the effect list returned by the reducer. */
  runAll(effects: Effect[]): void {
    for (const e of effects) void this.run(e)
  }

  async run(effect: Effect): Promise<void> {
    switch (effect.type) {
      case 'fetch-pois':
        await this.runFetchPois(effect.offset, effect.mode, false)
        return
      case 'fetch-route':
        await this.runFetchRoute(effect.from, effect.to.lat, effect.to.lng)
        return
      case 'fetch-wiki':
        await this.runFetchWiki(effect.title, effect.lang)
        return
      case 'open-url':
        this.deps.openUrl(effect.url)
        return
      case 'start-nav-watch':
        this.startNavWatch()
        return
      case 'stop-nav-watch':
        this.stopNavWatch()
        return
      case 'exit-app':
        this.deps.exitApp()
        return
    }
  }

  /**
   * The bridge calls this directly on its 5-minute timer — background
   * refreshes don't go through the reducer's effect path because the
   * `pois-loaded` event needs `isBackgroundRefresh: true`. Always
   * fetches page 0 in replace mode; if the user has loaded extra pages,
   * background refresh resets back to the first page.
   */
  async backgroundRefresh(): Promise<void> {
    await this.runFetchPois(0, 'replace', true)
  }

  /** Bridge calls this on shutdown to stop any in-flight GPS watch. */
  dispose(): void {
    this.stopNavWatch()
  }

  // ─── Effect implementations ──────────────────────────────────────────

  private async runFetchPois(
    offset: number,
    mode: 'replace' | 'append',
    isBackgroundRefresh: boolean,
  ): Promise<void> {
    console.log('[wander][fetch] begin', { offset, mode, isBackgroundRefresh })
    const pos = await this.deps.geolocate()
    if (!pos) {
      console.warn('[wander][fetch] no position — dispatching pois-failed/location')
      this.deps.dispatch({ type: 'pois-failed', reason: 'location' })
      return
    }
    this.deps.dispatch({ type: 'position-updated', lat: pos.lat, lng: pos.lng })
    const settings = this.deps.getSettings()

    try {
      console.log('[wander][fetch] /api/poi', {
        lat: pos.lat,
        lng: pos.lng,
        offset,
        categories: settings.categories.length,
      })
      const page = await fetchPois({
        lat: pos.lat,
        lng: pos.lng,
        radiusMiles: settings.radiusMiles,
        categories: settings.categories,
        lang: settings.lang ?? undefined,
        offset,
      })
      console.log('[wander][fetch] got page', { items: page.items.length, hasMore: page.hasMore })
      this.deps.dispatch({
        type: 'pois-loaded',
        pois: page.items,
        hasMore: page.hasMore,
        mode,
        isBackgroundRefresh,
      })
    } catch (err) {
      console.warn('[wander][fetch] failed', err)
      this.deps.dispatch({ type: 'pois-failed', reason: reasonFor(err) })
    }
  }

  private async runFetchRoute(
    from: { lat: number; lng: number },
    toLat: number,
    toLng: number,
  ): Promise<void> {
    try {
      const route = await fetchRoute({
        fromLat: from.lat,
        fromLng: from.lng,
        toLat,
        toLng,
        lang: this.deps.getSettings().lang ?? undefined,
      })
      this.deps.dispatch({ type: 'route-loaded', route })
    } catch {
      this.deps.dispatch({ type: 'route-failed' })
    }
  }

  private async runFetchWiki(title: string, lang: string | null): Promise<void> {
    try {
      const article = await fetchWiki({
        title,
        lang: lang ?? this.deps.getSettings().lang ?? undefined,
      })
      this.deps.dispatch({ type: 'wiki-loaded', article })
    } catch {
      this.deps.dispatch({ type: 'wiki-failed' })
    }
  }

  private startNavWatch(): void {
    this.stopNavWatch()
    this.cancelNavWatch = this.deps.watchPosition((lat, lng) => {
      this.deps.dispatch({ type: 'position-updated', lat, lng })
    })
  }

  private stopNavWatch(): void {
    if (this.cancelNavWatch) {
      this.cancelNavWatch()
      this.cancelNavWatch = null
    }
  }
}

// ─── Reason inference ────────────────────────────────────────────────────

function reasonFor(err: unknown): 'location' | 'network' | 'empty' {
  if (err instanceof ApiError && err.status === 400) {
    // /api/poi returns 400 on missing/invalid lat/lng — treat as location.
    return 'location'
  }
  return 'network'
}

// ─── Browser-API defaults ────────────────────────────────────────────────

// ⚠️ REMOVE BEFORE EVENHUB STORE SUBMISSION ⚠️
// Dev-only mock: the simulator's WebView has no geolocation, so we honor
// VITE_MOCK_LAT / VITE_MOCK_LNG from .env.local when running under Vite
// dev (`import.meta.env.DEV === true`). Gated on DEV so it is stripped
// from the production bundle, but we still want to delete this block
// before submission — no spoofed or dummy data should ship.
// Tracked in memory: project_wander_dev_geo_mock.md.
function readDevMockCoords(): { lat: number; lng: number } | null {
  if (!import.meta.env.DEV) return null
  const lat = parseFloat(import.meta.env.VITE_MOCK_LAT ?? '')
  const lng = parseFloat(import.meta.env.VITE_MOCK_LNG ?? '')
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

// Wall-clock ceiling for the one-shot geolocation lookup. The SDK's
// PositionOptions.timeout is 10s, but on real G2 hardware we've seen the
// WebView's getCurrentPosition never fire either callback — the loading
// screen hangs indefinitely. This outer race guarantees the reducer
// always hears back (null → ERROR_LOCATION → user sees retry).
const GEOLOCATE_WALL_CLOCK_MS = 15000

function defaultGeolocate(): Promise<{ lat: number; lng: number } | null> {
  const mock = readDevMockCoords()
  if (mock) {
    console.log('[wander][geo] using DEV mock', mock)
    return Promise.resolve(mock)
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    console.warn('[wander][geo] no navigator.geolocation — resolving null')
    return Promise.resolve(null)
  }
  console.log('[wander][geo] getCurrentPosition start')
  const gps = new Promise<{ lat: number; lng: number } | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        console.log('[wander][geo] got fix', { lat: p.coords.latitude, lng: p.coords.longitude })
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude })
      },
      (err) => {
        console.warn('[wander][geo] error', err.code, err.message)
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  })
  const wallClock = new Promise<null>((resolve) =>
    setTimeout(() => {
      console.warn('[wander][geo] wall-clock 15s — giving up')
      resolve(null)
    }, GEOLOCATE_WALL_CLOCK_MS),
  )
  return Promise.race([gps, wallClock])
}

function defaultOpenUrl(url: string): void {
  if (typeof window === 'undefined') return
  // Phase F (2026-04-26): try `_system` first — Cordova/Capacitor and
  // many WebView wrappers honor this target to escape the in-app
  // browser and route the URL through the OS browser instead. Field
  // test 2026-04-25 confirmed that `_blank` opens inside EvenHub's
  // overlay, which captures glasses input. If `_system` returns a
  // truthy window, the host accepted; otherwise fall back to `_blank`
  // so we still open *something*.
  const sys = window.open(url, '_system', 'noopener,noreferrer')
  if (sys) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function defaultWatchPosition(
  onPosition: (lat: number, lng: number) => void,
): () => void {
  const mock = readDevMockCoords()
  if (mock) {
    // Fire once on next tick so subscribers see the same contract as the
    // real API (asynchronous first sample). No ongoing updates — the
    // simulator has nothing to update from.
    const timer = setTimeout(() => onPosition(mock.lat, mock.lng), 0)
    return () => clearTimeout(timer)
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onPosition(p.coords.latitude, p.coords.longitude),
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}
