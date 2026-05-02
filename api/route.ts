import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveLang } from './_lib/lang.js'
import { applyCors } from './_lib/cors.js'

/**
 * GET /api/route?fromLat&fromLng&toLat&toLng
 *
 * Thin proxy around OpenRouteService /v2/directions/foot-walking.
 * ORS_API_KEY lives only in Vercel env vars — never shipped to the client.
 *
 * Returns a simplified shape tuned for the G2 NAV_ACTIVE screen:
 *   { totalDistanceMeters, totalDurationSeconds, steps[], geometry[][] }
 *
 * ORS coordinate order is [lng, lat] (GeoJSON convention). We accept
 * lat/lng on the wire and flip inside the handler.
 */

const UA = 'Wander/1.0 (Even Realities G2 companion app; steven.lao30@gmail.com)'
const FETCH_TIMEOUT_MS = 10000

// Languages ORS supports for turn-by-turn instructions. Anything outside
// this set falls back to English rather than being rejected upstream.
// Source: ORS /v2/directions docs — `language` param enum.
const ORS_SUPPORTED_LANGS = new Set([
  'en', 'de', 'es', 'fr', 'gr', 'he', 'hu', 'id', 'it', 'ja',
  'ne', 'nl', 'nb', 'pl', 'pt', 'ro', 'ru', 'tr', 'zh', 'cz',
])
const DEFAULT_ORS_LANG = 'en'

type OrsStep = {
  distance: number
  duration: number
  type: number
  instruction: string
  name?: string
  way_points?: number[]
}

type OrsResponse = {
  features?: Array<{
    geometry: { type: 'LineString'; coordinates: number[][] }
    properties: {
      summary: { distance: number; duration: number }
      segments: Array<{ distance: number; duration: number; steps: OrsStep[] }>
    }
  }>
  error?: { code: number; message: string } | string
}

type OutStep = {
  instruction: string
  distanceMeters: number
  durationSeconds: number
  maneuverType: string
  street: string | null
}

// ORS step.type is an enum. Mapping from
// https://giscience.github.io/openrouteservice/technical-details/api-documentation.html
const MANEUVER_MAP: Record<number, string> = {
  0: 'turn-left',
  1: 'turn-right',
  2: 'sharp-left',
  3: 'sharp-right',
  4: 'slight-left',
  5: 'slight-right',
  6: 'straight',
  7: 'enter-roundabout',
  8: 'exit-roundabout',
  9: 'u-turn',
  10: 'arrive',
  11: 'depart',
  12: 'keep-left',
  13: 'keep-right',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  const apiKey = process.env.ORS_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server missing ORS_API_KEY' })
    return
  }

  const fromLat = parseFloat(req.query.fromLat as string)
  const fromLng = parseFloat(req.query.fromLng as string)
  const toLat = parseFloat(req.query.toLat as string)
  const toLng = parseFloat(req.query.toLng as string)

  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
    res.status(400).json({
      error:
        'Required numeric query params: fromLat, fromLng, toLat, toLng',
    })
    return
  }

  const language = resolveLang(
    req.query.lang,
    req.headers['accept-language'],
    DEFAULT_ORS_LANG,
    ORS_SUPPORTED_LANGS,
  )

  try {
    const body = {
      coordinates: [
        [fromLng, fromLat],
        [toLng, toLat],
      ],
      instructions: true,
      language,
      units: 'm',
      geometry_simplify: false,
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)

    const orsRes = await fetch(
      'https://api.openrouteservice.org/v2/directions/foot-walking/geojson',
      {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/geo+json',
          'User-Agent': UA,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      },
    ).finally(() => clearTimeout(timer))

    if (!orsRes.ok) {
      const txt = await orsRes.text().catch(() => '')
      res.status(orsRes.status === 404 ? 404 : 502).json({
        error: 'ORS upstream error',
        status: orsRes.status,
        detail: txt.slice(0, 500),
      })
      return
    }

    const data = (await orsRes.json()) as OrsResponse
    const feature = data.features?.[0]

    if (!feature) {
      res.status(502).json({ error: 'ORS returned no route' })
      return
    }

    const summary = feature.properties.summary
    const orsSteps = feature.properties.segments?.[0]?.steps ?? []

    const steps: OutStep[] = orsSteps.map((s) => ({
      instruction: s.instruction,
      distanceMeters: Math.round(s.distance),
      durationSeconds: Math.round(s.duration),
      maneuverType: MANEUVER_MAP[s.type] ?? 'unknown',
      street: s.name && s.name !== '-' ? s.name : null,
    }))

    // Geometry comes back as [lng, lat]; flip to [lat, lng] to match the
    // rest of our app's coordinate convention.
    const geometry = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng])

    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Vary', 'Accept-Language')
    res.status(200).json({
      totalDistanceMeters: Math.round(summary.distance),
      totalDurationSeconds: Math.round(summary.duration),
      steps,
      geometry,
      language,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    res.status(502).json({ error: 'Route fetch failed', detail: msg })
  }
}

