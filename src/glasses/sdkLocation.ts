/**
 * Even Hub SDK location client — native phone-location bridge.
 *
 * `@evenrealities/even_hub_sdk` ^0.0.11 added a native phone-location API
 * (`getAppLocation`/`startAppLocationUpdates`/`stopAppLocationUpdates`/
 * `onAppLocationChanged`) exposed via `waitForEvenAppBridge()`. This module
 * wraps that API in the same defensive style as `appsBridge.ts`'s APPS
 * Bridge client: every function here resolves null / never calls back
 * rather than throwing, so callers' existing "no position" handling is
 * unchanged regardless of whether the native bridge is present, slow, or
 * misbehaving.
 */

import { AppLocationAccuracy, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { AppLocation, EvenAppBridge } from '@evenrealities/even_hub_sdk'

const ONE_SHOT_TIMEOUT_MS = 8000
const WATCH_INTERVAL_MS = 3000
const WATCH_DISTANCE_FILTER_M = 5

/** Minimal surface we need from EvenAppBridge — lets tests inject a fake. */
export type LocationBridge = Pick<
  EvenAppBridge,
  'getAppLocation' | 'startAppLocationUpdates' | 'stopAppLocationUpdates' | 'onAppLocationChanged'
>

export type LocationBridgeGetter = () => Promise<LocationBridge>

function defaultGetBridge(): Promise<LocationBridge> {
  return waitForEvenAppBridge()
}

function toLatLng(location: AppLocation | null | undefined): { lat: number; lng: number } | null {
  if (!location) return null
  const { latitude, longitude } = location
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return null
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return null
  return { lat: latitude, lng: longitude }
}

/**
 * One-shot lookup via the native bridge. Mirrors the `{ lat, lng } | null`
 * shape of `defaultGeolocate`/`bridgeGeolocate`.
 */
export async function sdkGeolocate(
  getBridge: LocationBridgeGetter = defaultGetBridge,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const bridge = await getBridge()
    const location = await bridge.getAppLocation({
      accuracy: AppLocationAccuracy.High,
      timeoutMs: ONE_SHOT_TIMEOUT_MS,
    })
    return toLatLng(location)
  } catch (err) {
    console.warn('[wander][sdk-geo] geolocate failed', err)
    return null
  }
}

/**
 * Continuous watch via the native bridge. Returns a synchronous cancel
 * function immediately; subscription/start happen once the bridge promise
 * resolves, unless cancel() was already called by then. Mirrors
 * `defaultWatchPosition`/`bridgeWatchPosition`'s `(onPosition) => cancel`.
 */
export function sdkWatchPosition(
  onPosition: (lat: number, lng: number, heading?: number | null) => void,
  getBridge: LocationBridgeGetter = defaultGetBridge,
): () => void {
  let cancelled = false
  let unsubscribe: (() => void) | null = null
  let resolvedBridge: LocationBridge | null = null

  void (async () => {
    try {
      const bridge = await getBridge()
      if (cancelled) return
      resolvedBridge = bridge

      unsubscribe = bridge.onAppLocationChanged((location) => {
        const mapped = toLatLng(location)
        if (!mapped) return
        onPosition(mapped.lat, mapped.lng, location.heading ?? null)
      })

      try {
        await bridge.startAppLocationUpdates({
          accuracy: AppLocationAccuracy.High,
          intervalMs: WATCH_INTERVAL_MS,
          distanceFilter: WATCH_DISTANCE_FILTER_M,
        })
      } catch (err) {
        console.warn('[wander][sdk-geo] startAppLocationUpdates failed', err)
      }
    } catch (err) {
      console.warn('[wander][sdk-geo] watch start failed — bridge unavailable', err)
    }
  })()

  return () => {
    if (cancelled) return
    cancelled = true
    try {
      unsubscribe?.()
    } catch (err) {
      console.warn('[wander][sdk-geo] unsubscribe failed', err)
    }
    if (resolvedBridge) {
      resolvedBridge.stopAppLocationUpdates().catch((err) => {
        console.warn('[wander][sdk-geo] stopAppLocationUpdates failed', err)
      })
    }
  }
}
