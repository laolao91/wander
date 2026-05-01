/**
 * Typed client wrappers around the Wander serverless endpoints.
 *
 * Pure functions — no glasses SDK dependency. The bridge layer (Phase 3
 * proper) calls these and routes the results into the screen renderer.
 *
 * All wrappers honour the locale forwarding contract documented in
 * API.md: pass `lang` explicitly when known, otherwise let the browser's
 * `Accept-Language` header reach the server. Errors are normalized into
 * a single `ApiError` so callers don't have to discriminate by endpoint.
 */

// In production (EHPK or Vercel-hosted), the WebView base URL may not be
// wander-six-phi.vercel.app, so relative paths like '/api/poi' can't resolve.
// WebKit throws "The string did not match the expected pattern" when fetch()
// is given a relative URL against a non-http(s) base (e.g. a local file or
// EvenHub's internal scheme). Use the absolute URL in production builds;
// keep relative in dev so Vite's proxy still works.
const API_BASE = import.meta.env.DEV
  ? '/api'
  : 'https://wander-six-phi.vercel.app/api'
// Field-test 2026-04-25 §3.1: glasses observed "Fetching nearby
// places..." stuck for 1+ minute. Vercel Hobby caps function execution
// at 10s, so any wallclock past ~12s on the client means the request
// will never produce a useful response. Two-layer protection:
//   1. AbortController on the fetch (10s) — gives the platform a chance
//      to cancel the underlying socket.
//   2. Outer Promise.race wallclock (12s) — guarantees the caller hears
//      back even if the WebView's fetch ignores `signal.aborted`. Real
//      hardware does sometimes ignore it; the race is the only way to
//      keep ERROR_NETWORK reachable.
const FETCH_ABORT_MS = 10000
const FETCH_WALLCLOCK_MS = 12000

// ─── Wire types (match server response shapes from API.md) ─────────────

export type Category =
  | 'landmark'
  | 'park'
  | 'museum'
  | 'religion'
  | 'art'
  | 'library'
  | 'food'
  | 'nightlife'

export type Source = 'wikipedia' | 'osm'

export interface Poi {
  id: string
  name: string
  category: Category
  categoryIcon: string
  lat: number
  lng: number
  distanceMeters: number
  distanceMiles: number
  bearingDegrees: number
  walkMinutes: number
  wikiTitle: string | null
  wikiSummary: string | null
  websiteUrl: string | null
  source: Source
}

export interface WikiArticle {
  title: string
  summary: string
  pages: string[]
  totalPages: number
  lang: string
}

export type ManeuverType =
  | 'turn-left'
  | 'turn-right'
  | 'sharp-left'
  | 'sharp-right'
  | 'slight-left'
  | 'slight-right'
  | 'straight'
  | 'enter-roundabout'
  | 'exit-roundabout'
  | 'u-turn'
  | 'arrive'
  | 'depart'
  | 'keep-left'
  | 'keep-right'
  | 'unknown'

export interface RouteStep {
  instruction: string
  distanceMeters: number
  durationSeconds: number
  maneuverType: ManeuverType
  street: string | null
}

export interface Route {
  totalDistanceMeters: number
  totalDurationSeconds: number
  steps: RouteStep[]
  /** [lat, lng] pairs — already flipped from ORS's [lng, lat] convention. */
  geometry: [number, number][]
  language: string
}

// ─── Errors ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Public API ────────────────────────────────────────────────────────

export interface FetchPoisInput {
  lat: number
  lng: number
  radiusMiles?: number
  categories?: Category[]
  lang?: string
  /** Page offset into the merged result set; defaults server-side to 0. */
  offset?: number
  signal?: AbortSignal
}

/** Wire shape per `api/poi.ts`. `hasMore` drives the "More results" sentinel. */
export interface PoiPage {
  items: Poi[]
  hasMore: boolean
}

export async function fetchPois(input: FetchPoisInput): Promise<PoiPage> {
  const params = new URLSearchParams()
  params.set('lat', String(input.lat))
  params.set('lng', String(input.lng))
  if (input.radiusMiles != null) params.set('radius', String(input.radiusMiles))
  if (input.categories?.length) params.set('categories', input.categories.join(','))
  if (input.lang) params.set('lang', input.lang)
  if (input.offset != null && input.offset > 0) {
    params.set('offset', String(input.offset))
  }

  return getJson<PoiPage>('/poi', params, input.signal)
}

export interface FetchWikiInput {
  /** Page title — server URL-encodes; pass the raw title from poi.wikiTitle. */
  title: string
  lang?: string
  signal?: AbortSignal
}

export async function fetchWiki(input: FetchWikiInput): Promise<WikiArticle> {
  const params = new URLSearchParams({ title: input.title })
  if (input.lang) params.set('lang', input.lang)
  return getJson<WikiArticle>('/wiki', params, input.signal)
}

export interface FetchRouteInput {
  fromLat: number
  fromLng: number
  toLat: number
  toLng: number
  lang?: string
  signal?: AbortSignal
}

export async function fetchRoute(input: FetchRouteInput): Promise<Route> {
  const params = new URLSearchParams({
    fromLat: String(input.fromLat),
    fromLng: String(input.fromLng),
    toLat: String(input.toLat),
    toLng: String(input.toLng),
  })
  if (input.lang) params.set('lang', input.lang)
  return getJson<Route>('/route', params, input.signal)
}

// ─── Internals ─────────────────────────────────────────────────────────

async function getJson<T>(
  path: string,
  params: URLSearchParams,
  externalSignal?: AbortSignal,
): Promise<T> {
  const url = `${API_BASE}${path}?${params.toString()}`

  // Layer 1: AbortController + caller's signal.
  const ctrl = new AbortController()
  const abortTimer = setTimeout(() => ctrl.abort(), FETCH_ABORT_MS)
  const onExternalAbort = () => ctrl.abort()
  externalSignal?.addEventListener('abort', onExternalAbort)

  // Layer 2: outer wallclock race. Resolves to a sentinel after
  // FETCH_WALLCLOCK_MS, throwing on the caller side regardless of
  // whether the fetch ever completes. Belt-and-braces for WebView
  // platforms that ignore AbortSignal.
  const wallclockSignal: unique symbol = Symbol('wallclock') as never
  let wallclockTimer: ReturnType<typeof setTimeout> | undefined
  const wallclock = new Promise<typeof wallclockSignal>((resolve) => {
    wallclockTimer = setTimeout(() => resolve(wallclockSignal), FETCH_WALLCLOCK_MS)
  })

  try {
    const fetchPromise = fetch(url, { signal: ctrl.signal })
    const winner = await Promise.race([fetchPromise, wallclock])
    if (winner === wallclockSignal) {
      // Best-effort cancel; some WebViews ignore this but it doesn't hurt.
      ctrl.abort()
      throw new ApiError(
        `API ${path} timed out after ${FETCH_WALLCLOCK_MS}ms`,
        path,
        0,
        'wallclock',
      )
    }
    const r = winner as Response
    if (!r.ok) {
      const detail = await safeText(r)
      throw new ApiError(`API ${path} returned ${r.status}`, path, r.status, detail)
    }
    // Race the JSON parse too — body streaming can hang independently of
    // the initial response.
    const jsonRace = await Promise.race([r.json(), wallclock])
    if (jsonRace === wallclockSignal) {
      ctrl.abort()
      throw new ApiError(
        `API ${path} body read timed out after ${FETCH_WALLCLOCK_MS}ms`,
        path,
        0,
        'wallclock-body',
      )
    }
    return jsonRace as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    const msg = err instanceof Error ? err.message : 'unknown error'
    throw new ApiError(`API ${path} request failed: ${msg}`, path, 0)
  } finally {
    clearTimeout(abortTimer)
    if (wallclockTimer !== undefined) clearTimeout(wallclockTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

async function safeText(r: Response): Promise<string | undefined> {
  try {
    const t = await r.text()
    return t ? t.slice(0, 500) : undefined
  } catch {
    return undefined
  }
}
