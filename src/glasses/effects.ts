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
 * and `window.open` for production use, trying the SDK's native location
 * bridge (sdkLocation.ts) first and falling back to APPS Bridge last.
 */

import { ApiError, fetchPois, fetchRoute, fetchWiki } from './api'
import type { Poi } from './api'
import type { Event, Effect } from './state'
import type { Settings } from './screens/types'
import { bridgeGeolocate, bridgeWatchPosition } from './appsBridge'
import { sdkGeolocate, sdkWatchPosition } from './sdkLocation'
import { readDevMockCoords } from './devMock'

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
    onPosition: (lat: number, lng: number, heading?: number | null) => void,
  ) => () => void
  /** Tear down the page container and exit the app (CONFIRM_EXIT → "Yes"). */
  exitApp?: () => void
  /** Persist the current favorites list to storage. */
  saveFavorites?: (favorites: Poi[]) => Promise<void>
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
      saveFavorites: deps.saveFavorites ?? (async () => {}),
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
        await this.runFetchRoute(effect.from, effect.to)
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
      case 'save-favorites':
        await this.deps.saveFavorites(effect.favorites)
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
    const settings = this.deps.getSettings()

    // Manual location short-circuit: if the user pinned a location on the
    // phone, use those coords directly and skip the GPS round-trip. This
    // keeps the glasses in sync with whatever the phone's Nearby tab shows.
    let pos: { lat: number; lng: number } | null
    if (settings.manualLocation) {
      pos = { lat: settings.manualLocation.lat, lng: settings.manualLocation.lng }
      console.log('[wander][fetch] using manual location', pos)
    } else {
      pos = await this.deps.geolocate()
    }

    if (!pos) {
      console.warn('[wander][fetch] no position — dispatching pois-failed/location')
      this.deps.dispatch({ type: 'pois-failed', reason: 'location' })
      return
    }
    this.deps.dispatch({
      type: 'position-updated',
      lat: pos.lat,
      lng: pos.lng,
      source: settings.manualLocation ? 'manual' : 'gps',
    })

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
        sort: settings.sort !== 'proximity' ? settings.sort : undefined,
        limit: settings.maxResults,
      })
      console.log('[wander][fetch] got page', { items: page.items.length, hasMore: page.hasMore })
      this.deps.dispatch({
        type: 'pois-loaded',
        pois: page.items,
        hasMore: page.hasMore,
        mode,
        isBackgroundRefresh,
        fetchedAt: Date.now(),
      })
    } catch (err) {
      console.warn('[wander][fetch] failed', err)
      this.deps.dispatch({ type: 'pois-failed', reason: reasonFor(err) })
    }
  }

  private async runFetchRoute(
    from: { lat: number; lng: number },
    to: Poi,
  ): Promise<void> {
    try {
      const route = await fetchRoute({
        fromLat: from.lat,
        fromLng: from.lng,
        toLat: to.lat,
        toLng: to.lng,
        lang: this.deps.getSettings().lang ?? undefined,
      })
      this.deps.dispatch({ type: 'route-loaded', route })
    } catch {
      this.deps.dispatch({ type: 'route-failed', from, to })
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
      this.deps.dispatch({ type: 'wiki-failed', title, lang })
    }
  }

  private startNavWatch(): void {
    this.stopNavWatch()
    this.cancelNavWatch = this.deps.watchPosition((lat, lng, heading) => {
      this.deps.dispatch({ type: 'position-updated', lat, lng, heading: heading ?? null })
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

// Wall-clock ceiling for the one-shot geolocation lookup. The SDK's
// PositionOptions.timeout is 10s, but on real G2 hardware we've seen the
// WebView's getCurrentPosition never fire either callback — the loading
// screen hangs indefinitely. This outer race guarantees the reducer
// always hears back (null → ERROR_LOCATION → user sees retry).
const GEOLOCATE_WALL_CLOCK_MS = 15000

export async function defaultGeolocate(): Promise<{ lat: number; lng: number } | null> {
  const mock = readDevMockCoords()
  if (mock) return mock
  // Even-Realities-native path: the SDK's bridge-backed phone-location API
  // (added in @evenrealities/even_hub_sdk 0.0.11). Tried first because it
  // goes through the same native bridge channel as getUserInfo()/
  // getDeviceInfo() rather than navigator.geolocation's WebView permission
  // plumbing — it may sidestep the Android permission-forwarding gap, but
  // this is unconfirmed on real hardware. Never throws; resolves null on
  // any failure (old host SDK, bridge unavailable, no fix), in which case
  // we fall through to the navigator.geolocation logic below, unchanged.
  const sdkFix = await sdkGeolocate()
  if (sdkFix) return sdkFix
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    console.warn('[wander][geo] no navigator.geolocation — trying APPS Bridge fallback')
    return bridgeGeolocate()
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
  const native = await Promise.race([gps, wallClock])
  if (native) return native
  // Native geolocation failed/unavailable/timed out — APPS Bridge (if the
  // user has it installed and running) sources GPS straight from Android,
  // bypassing the host WebView's permission forwarding entirely.
  console.warn('[wander][geo] native failed — trying APPS Bridge fallback')
  return bridgeGeolocate()
}

export function defaultOpenUrl(url: string): void {
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

export function defaultWatchPosition(
  onPosition: (lat: number, lng: number, heading?: number | null) => void,
): () => void {
  const mock = readDevMockCoords()
  if (mock) {
    // Fire once immediately so NAV_ACTIVE gets a position on first paint.
    setTimeout(() => onPosition(mock.lat, mock.lng, null), 0)
    return () => {}
  }
  // Even-Realities-native path: start the SDK bridge-backed watch
  // concurrently with whichever source(s) start below — consistent with
  // this function's existing "concurrent redundant sources, duplicate
  // updates are harmless" pattern. The cancel function below tears every
  // started source down.
  const cancelSdk = sdkWatchPosition(onPosition)

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    console.warn('[wander][geo] no navigator.geolocation — falling back to APPS Bridge watch')
    const cancelBridge = bridgeWatchPosition(onPosition)
    return () => {
      cancelSdk()
      cancelBridge()
    }
  }
  // Native watch stays registered for the lifetime of the nav session. If
  // it ever reports an error, start the APPS Bridge watch alongside it
  // (guarded so we only start it once) rather than tearing native down —
  // native may recover on its own, and a stray duplicate position update
  // from either source is harmless.
  let bridgeCancel: (() => void) | null = null
  const id = navigator.geolocation.watchPosition(
    (p) => onPosition(p.coords.latitude, p.coords.longitude, p.coords.heading ?? null),
    (err) => {
      if (bridgeCancel) return
      console.warn('[wander][geo] watchPosition error', err.code, '— falling back to APPS Bridge')
      bridgeCancel = bridgeWatchPosition(onPosition)
    },
    { enableHighAccuracy: true, maximumAge: 5000 },
  )
  return () => {
    cancelSdk()
    navigator.geolocation.clearWatch(id)
    bridgeCancel?.()
  }
}
