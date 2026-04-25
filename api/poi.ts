import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveLang } from './_lib/lang.js'

/**
 * GET /api/poi?lat=&lng=&radius=&categories=&offset=
 *
 * Fetches + merges nearby points of interest from Wikipedia GeoSearch
 * and OpenStreetMap Overpass. Sorted ascending by walking distance.
 *
 * Response shape: `{ items: Poi[], hasMore: boolean }`.
 *   - `items` is the page slice [offset, offset+PAGE_SIZE).
 *   - `hasMore` is true iff a strictly later page would contain at least
 *     one item — the client uses this to decide whether to render the
 *     "More results" sentinel on POI_LIST. See WANDER_BUILD_SPEC.md §6.6.
 *
 * Pagination is best-effort: cursor stability isn't guaranteed across
 * calls because the underlying Wikipedia/Overpass response sets shift
 * (different OSM mirrors return slightly different result orderings).
 * For Phase 4d we accept the trade — pages are mostly stable and the
 * impact of a small shift mid-walk is minimal.
 *
 * See WANDER_BUILD_SPEC.md §4 and §5.
 */

const UA = 'Wander/1.0 (Even Realities G2 companion app; steven.lao30@gmail.com)'
const PAGE_SIZE = 20
// Hard upstream cap so a malicious or buggy client can't ask for an
// effectively unbounded merge+sort. Two pages past the spec radius is
// already more POIs than a pedestrian needs in a single browse session.
const MAX_RESULTS_TOTAL = 60
const DEFAULT_RADIUS_MI = 0.75
const MAX_RADIUS_MI = 1.5
const MILES_TO_METERS = 1609.344
const WALK_METERS_PER_MINUTE = 80 // ~5 km/h
const DEDUP_RADIUS_M = 25 // names must also be similar to merge
const WIKI_TIMEOUT_MS = 8000
// Overpass mirrors are raced in parallel, so this is the max any single
// mirror gets before we give up on it. Must stay well under Vercel's
// serverless function limit (10s Hobby). Overpass's own timeout directive
// (`[timeout:N]`) is set lower to encourage fast fail.
const OVERPASS_TIMEOUT_MS = 7000

// Overpass main endpoint is frequently overloaded ("Dispatcher_Client timeout").
// Try mirrors in order until one returns parseable JSON. Kumi Systems is the
// go-to community mirror and is generally faster.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

type Category =
  | 'landmark'
  | 'park'
  | 'museum'
  | 'religion'
  | 'art'
  | 'library'
  | 'food'
  | 'nightlife'

const CATEGORY_ICON: Record<Category, string> = {
  landmark: '\u2605', // ★
  park: '\u25A0', // ■
  museum: '\u25B2', // ▲
  religion: '\u2020', // †
  art: '\u25CB', // ○
  library: '\u25C9', // ◉
  food: '\u25C6', // ◆
  nightlife: '\u25CF', // ●
}

const ALL_CATEGORIES: Category[] = [
  'landmark',
  'park',
  'museum',
  'religion',
  'art',
  'library',
  'food',
  'nightlife',
]

// Categories to query from Overpass. Wikipedia covers landmark/park/museum
// reasonably well on its own; Overpass fills the infrastructure gap.
const OVERPASS_QUERIES: Record<Exclude<Category, 'landmark'>, string[]> = {
  park: [
    'nwr[leisure=park]',
    'nwr[leisure=garden]',
    'nwr[leisure=nature_reserve]',
  ],
  museum: [
    'nwr[tourism=museum]',
    'nwr[tourism=gallery]',
    'nwr[amenity=arts_centre]',
  ],
  religion: ['nwr[amenity=place_of_worship]'],
  art: ['nwr[tourism=artwork]'],
  library: ['nwr[amenity=library]'],
  food: [
    'nwr[amenity=restaurant]',
    'nwr[amenity=cafe]',
    'nwr[amenity=fast_food]',
  ],
  nightlife: ['nwr[amenity=bar]', 'nwr[amenity=pub]', 'nwr[amenity=nightclub]'],
}

type Poi = {
  id: string
  name: string
  category: Category
  categoryIcon: string
  lat: number
  lng: number
  distanceMiles: number
  distanceMeters: number
  bearingDegrees: number
  walkMinutes: number
  wikiTitle: string | null
  wikiSummary: string | null
  websiteUrl: string | null
  source: 'wikipedia' | 'osm'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const lat = parseFloat(req.query.lat as string)
  const lng = parseFloat(req.query.lng as string)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'Required numeric query params: lat, lng' })
    return
  }

  const radiusMi = clamp(
    parseFloat((req.query.radius as string) ?? '') || DEFAULT_RADIUS_MI,
    0.1,
    MAX_RADIUS_MI,
  )
  const radiusM = radiusMi * MILES_TO_METERS

  const offset = clamp(
    Number.isFinite(parseInt(req.query.offset as string, 10))
      ? parseInt(req.query.offset as string, 10)
      : 0,
    0,
    MAX_RESULTS_TOTAL,
  )

  const enabled = parseCategories(req.query.categories)
  // Diagnostic logging — visible in Vercel function logs. Added 2026-04-24
  // to investigate why a NYC test returned only 1 POI. Tag is short so it's
  // grep-friendly in the Vercel UI.
  console.log(
    '[poi] req',
    JSON.stringify({
      lat,
      lng,
      radiusMi,
      offset,
      enabled: Array.from(enabled),
      categoriesRaw: typeof req.query.categories === 'string' ? req.query.categories : null,
    }),
  )
  if (enabled.size === 0) {
    console.log('[poi] empty: no categories enabled')
    res.status(200).json({ items: [], hasMore: false })
    return
  }

  const lang = resolveLang(req.query.lang, req.headers['accept-language'])

  try {
    const wantsWikiCategories = enabled.has('landmark')
    const wantsOverpass = ALL_CATEGORIES.some(
      (c) => c !== 'landmark' && enabled.has(c),
    )

    const [wiki, osm] = await Promise.all([
      wantsWikiCategories ? fetchWikipedia(lat, lng, radiusM, lang) : Promise.resolve([]),
      wantsOverpass ? fetchOverpass(lat, lng, radiusM, enabled) : Promise.resolve([]),
    ])
    console.log('[poi] sources', JSON.stringify({ wiki: wiki.length, osm: osm.length }))

    const deduped = dedupe([...wiki, ...osm])
    const filtered = deduped.filter((p) => enabled.has(p.category))
    const allMerged = filtered
      .map((p) => enrichDistance(p, lat, lng))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, MAX_RESULTS_TOTAL)

    const items = allMerged.slice(offset, offset + PAGE_SIZE)
    const hasMore = offset + PAGE_SIZE < allMerged.length
    console.log(
      '[poi] result',
      JSON.stringify({
        deduped: deduped.length,
        filtered: filtered.length,
        merged: allMerged.length,
        items: items.length,
        hasMore,
        // Sample the first 3 names so logs are readable without dumping
        // every result.
        sample: items.slice(0, 3).map((p) => `${p.category}:${p.name}`),
      }),
    )

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    res.setHeader('Vary', 'Accept-Language')
    res.status(200).json({ items, hasMore })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    console.error('[poi] fail', msg)
    res.status(502).json({ error: 'POI fetch failed', detail: msg })
  }
}

// ─── Wikipedia ─────────────────────────────────────────────────────────────

async function fetchWikipedia(
  lat: number,
  lng: number,
  radiusM: number,
  lang: string,
): Promise<Omit<Poi, 'distanceMiles' | 'distanceMeters' | 'bearingDegrees' | 'walkMinutes'>[]> {
  // Wikipedia caps geosearch radius at 10000m.
  const safeRadius = Math.min(Math.round(radiusM), 10000)
  const params = new URLSearchParams({
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(safeRadius),
    ggslimit: '30',
    prop: 'coordinates|extracts',
    exintro: '1',
    explaintext: '1',
    exlimit: '30',
    format: 'json',
    formatversion: '2',
    origin: '*',
  })
  const url = `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), WIKI_TIMEOUT_MS)
  let r: Response
  try {
    r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!r.ok) return []

  type WikiPage = {
    pageid: number
    title: string
    extract?: string
    coordinates?: Array<{ lat: number; lon: number; primary?: string }>
  }
  const data = (await r.json()) as { query?: { pages?: WikiPage[] } }
  const pages = data.query?.pages ?? []

  return pages
    .filter((p) => p.coordinates?.[0])
    .map((p) => {
      const coord = p.coordinates![0]
      const wikiTitle = p.title.replace(/\s/g, '_')
      return {
        id: `wiki_${p.pageid}`,
        name: p.title,
        category: 'landmark' as Category,
        categoryIcon: CATEGORY_ICON.landmark,
        lat: coord.lat,
        lng: coord.lon,
        wikiTitle,
        wikiSummary: truncateSummary(p.extract ?? null),
        websiteUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`,
        source: 'wikipedia' as const,
      }
    })
}

// ─── Overpass ──────────────────────────────────────────────────────────────

async function fetchOverpass(
  lat: number,
  lng: number,
  radiusM: number,
  enabled: Set<Category>,
): Promise<Omit<Poi, 'distanceMiles' | 'distanceMeters' | 'bearingDegrees' | 'walkMinutes'>[]> {
  const radius = Math.round(radiusM)

  // Build a single Overpass query combining all enabled OSM categories.
  // Each `nwr` selector is tagged via a synthetic `:cat` suffix we parse back.
  const selectors: Array<{ cat: Exclude<Category, 'landmark'>; selector: string }> = []
  for (const [cat, sels] of Object.entries(OVERPASS_QUERIES) as [
    Exclude<Category, 'landmark'>,
    string[],
  ][]) {
    if (!enabled.has(cat)) continue
    for (const s of sels) selectors.push({ cat, selector: s })
  }
  if (selectors.length === 0) return []

  const unions = selectors
    .map(({ selector }) => `${selector}(around:${radius},${lat},${lng});`)
    .join('\n  ')

  // Overpass's own timeout — kept short so a slow mirror gives up server-side
  // before our per-mirror fetch timeout kills the connection.
  const query = `[out:json][timeout:5];
(
  ${unions}
);
out center tags 100;`

  // Race all mirrors in parallel. The first one that returns parseable JSON
  // wins. Sequential fallback used to blow Vercel's 10s function budget
  // when a mirror hung — parallelizing keeps worst-case at a single timeout.
  const elements = await raceOverpass(query)
  if (elements === null) return []

  const results = elements
    .map((el) => {
      const tags = el.tags ?? {}
      const name = tags.name || tags['name:en']
      if (!name) return null
      const lat = el.lat ?? el.center?.lat
      const lon = el.lon ?? el.center?.lon
      if (lat == null || lon == null) return null

      const cat = categorizeOsm(tags)
      if (!cat || !enabled.has(cat)) return null

      const website =
        tags.website ||
        tags['contact:website'] ||
        tags.url ||
        null

      return {
        id: `osm_${el.type[0]}${el.id}`,
        name,
        category: cat,
        categoryIcon: CATEGORY_ICON[cat],
        lat,
        lng: lon,
        wikiTitle: null,
        wikiSummary: null,
        websiteUrl: website,
        source: 'osm' as const,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  return results
}

/**
 * Fire the query at every Overpass mirror simultaneously and resolve with
 * the first one that returns real JSON. Returns null if all fail/timeout.
 *
 * Why: sequential fallback blew the 10s serverless budget whenever the
 * first mirror hung. Overpass is chronically flaky — racing costs a bit
 * of upstream load but makes us resilient to any single mirror being down.
 */
async function raceOverpass(
  query: string,
): Promise<Array<{
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}> | null> {
  type El = {
    type: 'node' | 'way' | 'relation'
    id: number
    lat?: number
    lon?: number
    center?: { lat: number; lon: number }
    tags?: Record<string, string>
  }

  const attempts = OVERPASS_ENDPOINTS.map(async (endpoint): Promise<El[]> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS)
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'text/plain' },
        body: query,
        signal: ctrl.signal,
      })
      if (!r.ok) throw new Error(`${endpoint} -> ${r.status}`)
      const text = await r.text()
      // Overpass HTML error pages ("server too busy") come back at 200.
      if (text.trimStart().startsWith('<')) throw new Error('html response')
      const parsed = JSON.parse(text) as { elements?: El[] }
      return parsed.elements ?? []
    } finally {
      clearTimeout(timer)
    }
  })

  try {
    return await Promise.any(attempts)
  } catch {
    // AggregateError — every mirror failed.
    return null
  }
}

function categorizeOsm(tags: Record<string, string>): Category | null {
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'nature_reserve') return 'park'
  if (tags.tourism === 'museum' || tags.tourism === 'gallery' || tags.amenity === 'arts_centre') return 'museum'
  if (tags.amenity === 'place_of_worship') return 'religion'
  if (tags.tourism === 'artwork') return 'art'
  if (tags.amenity === 'library') return 'library'
  if (tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'fast_food') return 'food'
  if (tags.amenity === 'bar' || tags.amenity === 'pub' || tags.amenity === 'nightclub') return 'nightlife'
  return null
}

// ─── Dedupe / enrich ───────────────────────────────────────────────────────

type LiteP = Omit<
  Poi,
  'distanceMiles' | 'distanceMeters' | 'bearingDegrees' | 'walkMinutes'
>

/**
 * Drop near-duplicate POIs. Two results collapse if they are within
 * DEDUP_RADIUS_M meters AND their names share a meaningful prefix or
 * one contains the other. Wikipedia wins on ties.
 */
function dedupe(items: LiteP[]): LiteP[] {
  const kept: LiteP[] = []
  for (const item of items) {
    const dupIdx = kept.findIndex(
      (k) =>
        haversine(k.lat, k.lng, item.lat, item.lng) < DEDUP_RADIUS_M &&
        namesLikelySame(k.name, item.name),
    )
    if (dupIdx === -1) {
      kept.push(item)
    } else if (item.source === 'wikipedia' && kept[dupIdx].source === 'osm') {
      kept[dupIdx] = item
    }
  }
  return kept
}

function namesLikelySame(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, '')
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  // Share first 6 chars
  const headLen = 6
  if (na.length >= headLen && nb.length >= headLen && na.slice(0, headLen) === nb.slice(0, headLen)) {
    return true
  }
  return false
}

function enrichDistance(p: LiteP, userLat: number, userLng: number): Poi {
  const distanceMeters = haversine(userLat, userLng, p.lat, p.lng)
  return {
    ...p,
    distanceMeters: Math.round(distanceMeters),
    distanceMiles: Math.round((distanceMeters / MILES_TO_METERS) * 100) / 100,
    bearingDegrees: Math.round(bearing(userLat, userLng, p.lat, p.lng)),
    walkMinutes: Math.max(1, Math.round(distanceMeters / WALK_METERS_PER_MINUTE)),
  }
}

// ─── Math / utils ──────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function parseCategories(raw: unknown): Set<Category> {
  if (typeof raw !== 'string' || !raw.trim()) {
    // Default set per spec §5
    return new Set(['landmark', 'park', 'museum', 'religion', 'food'])
  }
  const set = new Set<Category>()
  for (const token of raw.split(',').map((s) => s.trim().toLowerCase())) {
    if ((ALL_CATEGORIES as string[]).includes(token)) {
      set.add(token as Category)
    }
  }
  return set
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}

function truncateSummary(s: string | null, max = 280): string | null {
  if (!s) return null
  const cleaned = s.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice) + '..'
}
