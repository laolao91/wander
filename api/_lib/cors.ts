import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Apply permissive CORS headers and handle OPTIONS preflight.
 *
 * Why this is needed: in prototype mode (QR-code scan), EvenHub loads the
 * app directly from wander-six-phi.vercel.app, making all API calls
 * same-origin — no CORS required. When the app is installed as an EHPK,
 * EvenHub serves the bundle from an internal origin, so every fetch to
 * wander-six-phi.vercel.app is cross-origin. WebKit reports a blocked
 * cross-origin request as "Load failed" (it never exposes CORS details),
 * which is exactly the error seen on installed EHPK but not in prototype
 * mode or the simulator.
 *
 * Returns `true` if the request was a preflight (caller should return
 * immediately without further processing).
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Accept-Language, Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }

  return false
}
