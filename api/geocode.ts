/**
 * GET /api/geocode?lat=&lng=
 *
 * Reverse-geocodes a coordinate pair to a human-readable neighbourhood
 * label using Nominatim (OpenStreetMap). Returns the most specific
 * useful fragment of the address — neighbourhood/suburb first, falling
 * back to city or county so the header always shows something readable.
 *
 * Response: { label: string }
 *
 * Errors are non-fatal — the phone UI shows "Near you" as a fallback
 * when this call fails or is slow.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from './_lib/cors.js'

const UA = 'Wander/1.0 (Even Realities G2 companion app; steven.lao30@gmail.com)'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const TIMEOUT_MS = 6000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  const lat = parseFloat(String(req.query.lat ?? ''))
  const lng = parseFloat(String(req.query.lng ?? ''))

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required' })
  }

  const url = new URL(NOMINATIM_URL)
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lng))
  url.searchParams.set('format', 'json')
  url.searchParams.set('zoom', '14') // neighbourhood level

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const r = await fetch(url.toString(), {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en',
      },
      signal: controller.signal,
    })

    if (!r.ok) {
      return res.status(502).json({ error: 'Nominatim error', status: r.status })
    }

    const data = await r.json() as NominatimResponse
    const label = pickLabel(data)
    return res.status(200).json({ label })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return res.status(502).json({ error: msg })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Nominatim response shape (partial) ─────────────────────────────────

interface NominatimResponse {
  address?: {
    neighbourhood?: string
    suburb?: string
    quarter?: string
    village?: string
    town?: string
    city?: string
    county?: string
    state?: string
  }
}

/**
 * Pick the most specific useful label fragment. We want neighbourhood-level
 * granularity (e.g. "Upper West Side") rather than the full address, so the
 * phone header stays short and readable.
 */
function pickLabel(data: NominatimResponse): string {
  const a = data.address ?? {}
  return (
    a.neighbourhood ??
    a.suburb ??
    a.quarter ??
    a.village ??
    a.town ??
    a.city ??
    a.county ??
    a.state ??
    'Near you'
  )
}
