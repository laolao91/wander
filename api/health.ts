import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    app: 'wander',
    version: '1.0.0',
    phase: 1,
    now: new Date().toISOString(),
  })
}
