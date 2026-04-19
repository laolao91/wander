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
        await this.runFetchPois(false)
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
   * `pois-loaded` event needs `isBackgroundRefresh: true`.
   */
  async backgroundRefresh(): Promise<void> {
    await this.runFetchPois(true)
  }

  /** Bridge calls this on shutdown to stop any in-flight GPS watch. */
  dispose(): void {
    this.stopNavWatch()
  }

  // ─── Effect implementations ──────────────────────────────────────────

  private async runFetchPois(isBackgroundRefresh: boolean): Promise<void> {
    const pos = await this.deps.geolocate()
    if (!pos) {
      this.deps.dispatch({ type: 'pois-failed', reason: 'location' })
      return
    }
    this.deps.dispatch({ type: 'position-updated', lat: pos.lat, lng: pos.lng })
    const settings = this.deps.getSettings()

    try {
      const pois = await fetchPois({
        lat: pos.lat,
        lng: pos.lng,
        radiusMiles: settings.radiusMiles,
        categories: settings.categories,
        lang: settings.lang ?? undefined,
      })
      this.deps.dispatch({ type: 'pois-loaded', pois, isBackgroundRefresh })
    } catch (err) {
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

function defaultGeolocate(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  })
}

function defaultOpenUrl(url: string): void {
  if (typeof window === 'undefined') return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function defaultWatchPosition(
  onPosition: (lat: number, lng: number) => void,
): () => void {
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
