import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Map tile proxy — fetches CARTO dark-style tiles server-side and
 * returns them with CORS headers so the browser canvas can draw them
 * without tainting (required for PNG export via `canvas.toBlob`).
 *
 * Tile source: CartoDB `dark_nolabels` — dark background (#121212),
 * light-grey streets. This combination converts cleanly to the G2's
 * 4-bit greyscale display: background → gray4 0–1, streets → gray4
 * 6–9, white route overlay → gray4 15.
 *
 * Attribution (required by CartoDB ToS):
 *   © OpenStreetMap contributors, © CARTO
 *
 * GET /api/map?z={z}&x={x}&y={y}
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const { z, x, y } = req.query

  if (typeof z !== 'string' || typeof x !== 'string' || typeof y !== 'string') {
    res.status(400).json({ error: 'z, x, y query params required' })
    return
  }

  const zi = parseInt(z, 10)
  const xi = parseInt(x, 10)
  const yi = parseInt(y, 10)

  if (
    isNaN(zi) || isNaN(xi) || isNaN(yi) ||
    zi < 1 || zi > 19 ||
    xi < 0 || yi < 0
  ) {
    res.status(400).json({ error: 'invalid tile coordinates' })
    return
  }

  const tileUrl = `https://a.basemaps.cartocdn.com/dark_nolabels/${zi}/${xi}/${yi}.png`

  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 6000)

  try {
    const upstream = await fetch(tileUrl, {
      headers: {
        'User-Agent': 'Wander/1.0 (wander-six-phi.vercel.app)',
        Accept: 'image/png',
      },
      signal: ctrl.signal,
    })

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: 'upstream tile fetch failed' })
      return
    }

    const buffer = await upstream.arrayBuffer()

    res.setHeader('Content-Type', 'image/png')
    // Tiles are stable (streets don't change daily) — cache aggressively.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('X-Tile-Attribution', '© OpenStreetMap contributors, © CARTO')
    res.status(200).send(Buffer.from(buffer))
  } catch (err) {
    console.error('[map] tile proxy error', { zi, xi, yi, err })
    res.status(502).json({ error: 'tile upstream error' })
  } finally {
    clearTimeout(timeout)
  }
}
