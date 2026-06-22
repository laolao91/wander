import { describe, it, expect, vi } from 'vitest'
import { sdkGeolocate, sdkWatchPosition } from '../sdkLocation'
import type { LocationBridge, LocationBridgeGetter } from '../sdkLocation'
import { AppLocationAccuracy } from '@evenrealities/even_hub_sdk'
import type { AppLocation } from '@evenrealities/even_hub_sdk'

// ─── Fake bridge ────────────────────────────────────────────────────────────

class FakeLocationBridge implements LocationBridge {
  getAppLocationCalls: unknown[] = []
  startAppLocationUpdatesCalls: unknown[] = []
  stopAppLocationUpdatesCalls = 0
  onAppLocationChangedCallback: ((location: AppLocation) => void) | null = null
  unsubscribeFn = vi.fn()

  getAppLocationResult: AppLocation | null | Error = null
  startAppLocationUpdatesResult: boolean | Error = true
  stopAppLocationUpdatesResult: boolean | Error = true

  async getAppLocation(options?: unknown): Promise<AppLocation | null> {
    this.getAppLocationCalls.push(options)
    if (this.getAppLocationResult instanceof Error) throw this.getAppLocationResult
    return this.getAppLocationResult
  }

  async startAppLocationUpdates(options?: unknown): Promise<boolean> {
    this.startAppLocationUpdatesCalls.push(options)
    if (this.startAppLocationUpdatesResult instanceof Error) throw this.startAppLocationUpdatesResult
    return this.startAppLocationUpdatesResult
  }

  async stopAppLocationUpdates(): Promise<boolean> {
    this.stopAppLocationUpdatesCalls++
    if (this.stopAppLocationUpdatesResult instanceof Error) throw this.stopAppLocationUpdatesResult
    return this.stopAppLocationUpdatesResult
  }

  onAppLocationChanged(callback: (location: AppLocation) => void): () => void {
    this.onAppLocationChangedCallback = callback
    return this.unsubscribeFn
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('sdkGeolocate', () => {
  it('resolves { lat, lng } mapped from a successful getAppLocation', async () => {
    const bridge = new FakeLocationBridge()
    bridge.getAppLocationResult = { latitude: 35.1, longitude: -80.1, heading: 90 }
    const getBridge: LocationBridgeGetter = () => Promise.resolve(bridge)
    expect(await sdkGeolocate(getBridge)).toEqual({ lat: 35.1, lng: -80.1 })
  })

  it('resolves null when getAppLocation resolves null', async () => {
    const bridge = new FakeLocationBridge()
    bridge.getAppLocationResult = null
    const getBridge: LocationBridgeGetter = () => Promise.resolve(bridge)
    expect(await sdkGeolocate(getBridge)).toBeNull()
  })

  it('resolves null when getAppLocation rejects/throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bridge = new FakeLocationBridge()
    bridge.getAppLocationResult = new Error('native call failed')
    const getBridge: LocationBridgeGetter = () => Promise.resolve(bridge)
    expect(await sdkGeolocate(getBridge)).toBeNull()
  })

  it('resolves null when getBridge() itself rejects/throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const getBridge: LocationBridgeGetter = () => Promise.reject(new Error('bridge unavailable'))
    expect(await sdkGeolocate(getBridge)).toBeNull()
  })

  it('resolves null if the resolved location has non-finite/missing lat or lng', async () => {
    const bridge = new FakeLocationBridge()
    bridge.getAppLocationResult = { latitude: NaN, longitude: -80.1 }
    const getBridge: LocationBridgeGetter = () => Promise.resolve(bridge)
    expect(await sdkGeolocate(getBridge)).toBeNull()

    const bridge2 = new FakeLocationBridge()
    bridge2.getAppLocationResult = { latitude: 35.1 } as unknown as AppLocation
    const getBridge2: LocationBridgeGetter = () => Promise.resolve(bridge2)
    expect(await sdkGeolocate(getBridge2)).toBeNull()
  })

  it('calls getAppLocation with high accuracy and a timeout around 8000ms', async () => {
    const bridge = new FakeLocationBridge()
    bridge.getAppLocationResult = { latitude: 1, longitude: 2 }
    const getBridge: LocationBridgeGetter = () => Promise.resolve(bridge)
    await sdkGeolocate(getBridge)
    expect(bridge.getAppLocationCalls).toEqual([{ accuracy: AppLocationAccuracy.High, timeoutMs: 8000 }])
  })
})

describe('sdkWatchPosition', () => {
  it('subscribes via onAppLocationChanged and calls startAppLocationUpdates with expected options', async () => {
    const bridge = new FakeLocationBridge()
    const getBridge: LocationBridgeGetter = () => Promise.resolve(bridge)
    sdkWatchPosition(() => {}, getBridge)
    await Promise.resolve()
    await Promise.resolve()
    expect(bridge.onAppLocationChangedCallback).not.toBeNull()
    expect(bridge.startAppLocationUpdatesCalls).toEqual([
      { accuracy: AppLocationAccuracy.High, intervalMs: 3000, distanceFilter: 5 },
    ])
  })

  it('forwards each onAppLocationChanged firing as onPosition(lat, lng, heading ?? null)', async () => {
    const bridge = new FakeLocationBridge()
    const getBridge: LocationBridgeGetter = () => Promise.resolve(bridge)
    const positions: Array<[number, number, number | null | undefined]> = []
    sdkWatchPosition((lat, lng, heading) => positions.push([lat, lng, heading]), getBridge)
    await Promise.resolve()
    await Promise.resolve()

    bridge.onAppLocationChangedCallback!({ latitude: 1, longitude: 2, heading: 45 })
    bridge.onAppLocationChangedCallback!({ latitude: 3, longitude: 4 })
    expect(positions).toEqual([[1, 2, 45], [3, 4, null]])
  })

  it('cancel() after subscription start unsubscribes and stops updates', async () => {
    const bridge = new FakeLocationBridge()
    const getBridge: LocationBridgeGetter = () => Promise.resolve(bridge)
    const cancel = sdkWatchPosition(() => {}, getBridge)
    await Promise.resolve()
    await Promise.resolve()

    cancel()
    await Promise.resolve()

    expect(bridge.unsubscribeFn).toHaveBeenCalledTimes(1)
    expect(bridge.stopAppLocationUpdatesCalls).toBe(1)
  })

  it('cancel() before the bridge resolves prevents subscribing/starting updates', async () => {
    const bridge = new FakeLocationBridge()
    const { promise, resolve } = deferred<LocationBridge>()
    const getBridge: LocationBridgeGetter = () => promise

    const cancel = sdkWatchPosition(() => {}, getBridge)
    cancel()

    resolve(bridge)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(bridge.onAppLocationChangedCallback).toBeNull()
    expect(bridge.startAppLocationUpdatesCalls).toEqual([])
  })

  it('never throws synchronously even if getBridge() rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const getBridge: LocationBridgeGetter = () => Promise.reject(new Error('bridge unavailable'))

    let cancel: (() => void) | null = null
    expect(() => {
      cancel = sdkWatchPosition(() => {}, getBridge)
    }).not.toThrow()

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(warnSpy).toHaveBeenCalled()
    expect(() => cancel!()).not.toThrow()
  })
})
