import { describe, it, expect, vi } from 'vitest'
import { bridgeGeolocate, bridgeWatchPosition } from '../appsBridge'
import type { BridgeSocket, BridgeSocketFactory } from '../appsBridge'

// ─── Fake socket ─────────────────────────────────────────────────────────

type Listener = (event: { data: unknown }) => void

class FakeSocket implements BridgeSocket {
  sent: string[] = []
  closed = false
  private listeners: Record<string, Listener[]> = {}

  send(data: string): void {
    if (this.closed) throw new Error('send on closed socket')
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener)
  }

  emit(type: string, event: { data: unknown } = { data: undefined }): void {
    for (const l of this.listeners[type] ?? []) l(event)
  }
}

function gpsFrame(lat: number | null, lng: number | null, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'gps', data: { lat, lng, ...extra } })
}

describe('bridgeGeolocate', () => {
  it('resolves a fix from a valid gps frame after hello', async () => {
    let socket: FakeSocket | null = null
    const factory: BridgeSocketFactory = () => {
      socket = new FakeSocket()
      return socket
    }
    const promise = bridgeGeolocate(factory)
    socket!.emit('open')
    expect(socket!.sent[0]).toContain('client_hello')
    socket!.emit('message', { data: gpsFrame(35.1, -80.1, { heading: 90, speed: 1, accuracy: 5 }) })
    const fix = await promise
    expect(fix).toEqual({ lat: 35.1, lng: -80.1 })
    expect(socket!.sent.at(-1)).toContain('client_goodbye')
    expect(socket!.closed).toBe(true)
  })

  it('ignores a gps frame with null lat/lng and waits for a real fix', async () => {
    let socket: FakeSocket | null = null
    const factory: BridgeSocketFactory = () => {
      socket = new FakeSocket()
      return socket
    }
    const promise = bridgeGeolocate(factory)
    socket!.emit('open')
    socket!.emit('message', { data: gpsFrame(null, null) })
    socket!.emit('message', { data: gpsFrame(10, 20) })
    const fix = await promise
    expect(fix).toEqual({ lat: 10, lng: 20 })
  })

  it('ignores malformed JSON and unrelated frame types', async () => {
    let socket: FakeSocket | null = null
    const factory: BridgeSocketFactory = () => {
      socket = new FakeSocket()
      return socket
    }
    const promise = bridgeGeolocate(factory)
    socket!.emit('open')
    socket!.emit('message', { data: 'not json' })
    socket!.emit('message', { data: JSON.stringify({ type: 'media', data: {} }) })
    socket!.emit('message', { data: gpsFrame(1, 2) })
    const fix = await promise
    expect(fix).toEqual({ lat: 1, lng: 2 })
  })

  it('resolves null when the connection errors', async () => {
    let socket: FakeSocket | null = null
    const factory: BridgeSocketFactory = () => {
      socket = new FakeSocket()
      return socket
    }
    const promise = bridgeGeolocate(factory)
    socket!.emit('error')
    expect(await promise).toBeNull()
  })

  it('resolves null when the socket factory throws (bridge not installed)', async () => {
    const factory: BridgeSocketFactory = () => {
      throw new Error('connection refused')
    }
    expect(await bridgeGeolocate(factory)).toBeNull()
  })

  it('resolves null on timeout if no fix ever arrives', async () => {
    vi.useFakeTimers()
    let socket: FakeSocket | null = null
    const factory: BridgeSocketFactory = () => {
      socket = new FakeSocket()
      return socket
    }
    const promise = bridgeGeolocate(factory)
    socket!.emit('open')
    await vi.advanceTimersByTimeAsync(8000)
    expect(await promise).toBeNull()
    vi.useRealTimers()
  })
})

describe('bridgeWatchPosition', () => {
  it('calls onPosition for every valid fix and heartbeats every 15s', () => {
    vi.useFakeTimers()
    let socket: FakeSocket | null = null
    const factory: BridgeSocketFactory = () => {
      socket = new FakeSocket()
      return socket
    }
    const positions: Array<[number, number, number | null | undefined]> = []
    const cancel = bridgeWatchPosition((lat, lng, heading) => positions.push([lat, lng, heading]), factory)

    socket!.emit('open')
    expect(socket!.sent[0]).toContain('client_hello')

    socket!.emit('message', { data: gpsFrame(1, 2, { heading: 45 }) })
    socket!.emit('message', { data: gpsFrame(3, 4, { heading: null }) })
    expect(positions).toEqual([[1, 2, 45], [3, 4, null]])

    vi.advanceTimersByTime(15000)
    expect(socket!.sent.some((m) => m.includes('client_heartbeat'))).toBe(true)

    cancel()
    expect(socket!.sent.at(-1)).toContain('client_goodbye')
    expect(socket!.closed).toBe(true)
    vi.useRealTimers()
  })

  it('cancel() before open still closes cleanly and suppresses a late open', () => {
    vi.useFakeTimers()
    let socket: FakeSocket | null = null
    const factory: BridgeSocketFactory = () => {
      socket = new FakeSocket()
      return socket
    }
    const cancel = bridgeWatchPosition(() => {}, factory)
    cancel()
    expect(socket!.closed).toBe(true)
    socket!.emit('open')
    // Cancelled before open fired — hello/heartbeat must not be sent even
    // if a late 'open' event arrives after cancel() already ran.
    expect(socket!.sent.some((m) => m.includes('client_hello'))).toBe(false)
    expect(socket!.sent.some((m) => m.includes('client_heartbeat'))).toBe(false)
    vi.useRealTimers()
  })

  it('stops on socket error/close without throwing', () => {
    let socket: FakeSocket | null = null
    const factory: BridgeSocketFactory = () => {
      socket = new FakeSocket()
      return socket
    }
    const cancel = bridgeWatchPosition(() => {}, factory)
    socket!.emit('open')
    expect(() => socket!.emit('error')).not.toThrow()
    expect(() => cancel()).not.toThrow()
  })

  it('returns a no-op cancel when the socket factory throws', () => {
    const factory: BridgeSocketFactory = () => {
      throw new Error('connection refused')
    }
    const cancel = bridgeWatchPosition(() => {}, factory)
    expect(() => cancel()).not.toThrow()
  })
})
