/**
 * GET /api/geocode
 *
 * Two modes, selected by query parameter:
 *
 *   ?q=<query>       Forward geocode — returns up to 5 matching places.
 *                    Response: { results: Array<{ label, lat, lng }> }
 *
 *   ?lat=&lng=       Reverse geocode — returns a neighbourhood label.
 *                    Response: { label: string }
 *
 * Both use Nominatim (OpenStreetMap). Errors are non-fatal on the
 * phone side — the UI shows "Near you" / empty results as a fallback.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from './_lib/cors.js'

const UA = 'Wander/1.0 (Even Realities G2 companion app; steven.lao30@gmail.com)'
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
const TIMEOUT_MS = 6000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  const q = String(req.query.q ?? '').trim()
  if (q) return forwardGeocode(q, res)

  const lat = parseFloat(String(req.query.lat ?? ''))
  const lng = parseFloat(String(req.query.lng ?? ''))

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Provide either q= for forward geocode or lat= and lng= for reverse geocode' })
  }

  return reverseGeocode(lat, lng, res)
}

// ─── Forward geocode ─────────────────────────────────────────────────────

interface NominatimSearchResult {
  display_name: string
  lat: string
  lon: string
}

export function buildForwardLabel(item: { display_name: string }): string {
  const parts = item.display_name.split(', ')
  return parts.slice(0, 3).join(', ')
}

async function forwardGeocode(q: string, res: VercelResponse) {
  const url = new URL(`${NOMINATIM_BASE}/search`)
  url.searchParams.set('q', q)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '5')
  url.searchParams.set('addressdetails', '1')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      signal: controller.signal,
    })

    if (!r.ok) {
      return res.status(502).json({ error: 'Nominatim error', status: r.status })
    }

    const data = await r.json() as NominatimSearchResult[]
    const results = data.map((item) => ({
      label: buildForwardLabel(item),
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }))
    return res.status(200).json({ results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return res.status(502).json({ error: msg })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Reverse geocode ─────────────────────────────────────────────────────

interface NominatimReverseResponse {
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

async function reverseGeocode(lat: number, lng: number, res: VercelResponse) {
  const url = new URL(`${NOMINATIM_BASE}/reverse`)
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lng))
  url.searchParams.set('format', 'json')
  url.searchParams.set('zoom', '14')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      signal: controller.signal,
    })
    if (!r.ok) return res.status(502).json({ error: 'Nominatim error', status: r.status })
    const data = await r.json() as NominatimReverseResponse
    const label = pickReverseLabel(data)
    return res.status(200).json({ label })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return res.status(502).json({ error: msg })
  } finally {
    clearTimeout(timer)
  }
}

function pickReverseLabel(data: NominatimReverseResponse): string {
  const a = data.address ?? {}
  return (
    a.neighbourhood ?? a.suburb ?? a.quarter ?? a.village ??
    a.town ?? a.city ?? a.county ?? a.state ?? 'Near you'
  )
}
