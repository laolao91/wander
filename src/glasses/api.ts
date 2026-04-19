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

const API_BASE = '/api'
const DEFAULT_TIMEOUT_MS = 12000

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
  signal?: AbortSignal
}

export async function fetchPois(input: FetchPoisInput): Promise<Poi[]> {
  const params = new URLSearchParams()
  params.set('lat', String(input.lat))
  params.set('lng', String(input.lng))
  if (input.radiusMiles != null) params.set('radius', String(input.radiusMiles))
  if (input.categories?.length) params.set('categories', input.categories.join(','))
  if (input.lang) params.set('lang', input.lang)

  return getJson<Poi[]>('/poi', params, input.signal)
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

  // Compose timeout with caller's signal so either can abort the request.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS)
  const onExternalAbort = () => ctrl.abort()
  externalSignal?.addEventListener('abort', onExternalAbort)

  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) {
      const detail = await safeText(r)
      throw new ApiError(`API ${path} returned ${r.status}`, path, r.status, detail)
    }
    return (await r.json()) as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    const msg = err instanceof Error ? err.message : 'unknown error'
    throw new ApiError(`API ${path} request failed: ${msg}`, path, 0)
  } finally {
    clearTimeout(timer)
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
