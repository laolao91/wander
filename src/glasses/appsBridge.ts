/**
 * APPS Bridge client — optional Android-side GPS fallback.
 *
 * APPS Bridge (https://gitlab.com/homeauto.cc/appsbridge) is a third-party
 * Android companion app. When installed and running, it opens a local
 * WebSocket server on 127.0.0.1:7071 and streams GPS independent of the
 * Even Hub host WebView's navigator.geolocation permission plumbing — the
 * thing that's been unreliable on Android (see effects.ts/App.tsx callers).
 *
 * This module is only ever reached as a *fallback*, after
 * navigator.geolocation has already failed, timed out, or is unavailable.
 * If APPS Bridge isn't installed or isn't running, the WebSocket simply
 * fails to open (or never produces a fix); every function here resolves
 * null / never calls back rather than throwing, so callers' existing
 * "no position" handling is unchanged.
 *
 * Protocol reference: APPSBRIDGE_GUIDE.md (saved from the bridge's repo).
 */

const BRIDGE_URL = 'ws://127.0.0.1:7071'
const APP_ID = 'com.stevenlao.wander'
const APP_NAME = 'Wander'
const HEARTBEAT_MS = 15000
const ONE_SHOT_TIMEOUT_MS = 8000

interface BridgeFix {
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  accuracy: number | null
}

/** Minimal surface we need from a WebSocket — lets tests inject a fake. */
export interface BridgeSocket {
  send(data: string): void
  close(): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'error' | 'close', listener: () => void): void
}

export type BridgeSocketFactory = (url: string) => BridgeSocket

function defaultSocketFactory(url: string): BridgeSocket {
  return new WebSocket(url) as unknown as BridgeSocket
}

function helloMessage(): string {
  return JSON.stringify({
    type: 'client_hello',
    app: APP_ID,
    name: APP_NAME,
    components: ['gps'],
    managedLifecycle: true,
  })
}

function heartbeatMessage(): string {
  return JSON.stringify({ type: 'client_heartbeat', active: true, components: ['gps'] })
}

function goodbyeMessage(): string {
  return JSON.stringify({ type: 'client_goodbye', active: false })
}

/**
 * Parses a `gps` frame per APPSBRIDGE_GUIDE.md. Returns null for anything
 * that isn't a well-formed gps frame with real lat/lng — APPS Bridge is an
 * external, unauthenticated local process, so its frames get the same
 * defensive treatment as any other untrusted input in this codebase.
 */
function parseGpsFrame(raw: unknown): BridgeFix | null {
  if (typeof raw !== 'object' || raw === null) return null
  const msg = raw as Record<string, unknown>
  if (msg.type !== 'gps') return null
  const data = msg.data
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  const { lat, lng } = d
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return { lat, lng, speed: num(d.speed), heading: num(d.heading), accuracy: num(d.accuracy) }
}

function parseMessageData(data: unknown): unknown {
  if (typeof data !== 'string') return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

/**
 * One-shot lookup: connect, hello, wait for the first real fix (or
 * timeout / connection failure), goodbye, close. Mirrors the
 * `{ lat, lng } | null` shape of `defaultGeolocate` in effects.ts.
 */
export function bridgeGeolocate(
  socketFactory: BridgeSocketFactory = defaultSocketFactory,
): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    let settled = false
    let socket: BridgeSocket | null = null

    const finish = (fix: BridgeFix | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket?.send(goodbyeMessage())
      } catch {
        // socket may already be closed/broken — best-effort goodbye only.
      }
      try {
        socket?.close()
      } catch {
        // ignore
      }
      console.log('[wander][bridge] one-shot result', fix ? 'fix' : 'no fix')
      resolve(fix ? { lat: fix.lat, lng: fix.lng } : null)
    }

    const timer = setTimeout(() => finish(null), ONE_SHOT_TIMEOUT_MS)

    try {
      socket = socketFactory(BRIDGE_URL)
    } catch {
      clearTimeout(timer)
      console.warn('[wander][bridge] socket factory threw — bridge unavailable')
      resolve(null)
      return
    }

    socket.addEventListener('open', () => {
      console.log('[wander][bridge] connected, sending client_hello')
      try {
        socket?.send(helloMessage())
      } catch {
        finish(null)
      }
    })

    socket.addEventListener('message', (event) => {
      const fix = parseGpsFrame(parseMessageData(event.data))
      if (fix) finish(fix)
    })

    socket.addEventListener('error', () => finish(null))
    socket.addEventListener('close', () => finish(null))
  })
}

/**
 * Continuous watch: connect once, hello, emit on every real fix, heartbeat
 * every 15s per the bridge's managed-lifecycle contract, goodbye + close
 * on cancel. Mirrors `defaultWatchPosition`'s `(onPosition) => cancel`.
 */
export function bridgeWatchPosition(
  onPosition: (lat: number, lng: number, heading?: number | null) => void,
  socketFactory: BridgeSocketFactory = defaultSocketFactory,
): () => void {
  let socket: BridgeSocket | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let cancelled = false

  const stop = () => {
    if (cancelled) return
    cancelled = true
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    try {
      socket?.send(goodbyeMessage())
    } catch {
      // ignore
    }
    try {
      socket?.close()
    } catch {
      // ignore
    }
  }

  try {
    socket = socketFactory(BRIDGE_URL)
  } catch {
    console.warn('[wander][bridge] socket factory threw — bridge unavailable')
    return () => {}
  }

  socket.addEventListener('open', () => {
    if (cancelled) return
    console.log('[wander][bridge] watch connected, sending client_hello')
    try {
      socket?.send(helloMessage())
    } catch {
      stop()
      return
    }
    heartbeatTimer = setInterval(() => {
      try {
        socket?.send(heartbeatMessage())
      } catch {
        stop()
      }
    }, HEARTBEAT_MS)
  })

  socket.addEventListener('message', (event) => {
    if (cancelled) return
    const fix = parseGpsFrame(parseMessageData(event.data))
    if (fix) onPosition(fix.lat, fix.lng, fix.heading)
  })

  socket.addEventListener('error', () => stop())
  socket.addEventListener('close', () => stop())

  return stop
}
