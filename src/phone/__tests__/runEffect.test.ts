/**
 * Tests for App.tsx's `runEffect` handling of the `request-location`
 * effect — specifically the source-priority ordering introduced when the
 * Even Hub SDK location attempt (`sdkGeolocate`) was added ahead of the
 * existing navigator.geolocation → APPS Bridge fallback chain:
 *
 *   manual-location short-circuit
 *     → DEV-mode mock coords (.env.local)
 *       → sdkGeolocate() (Even-Realities-native, phone-side SDK bridge)
 *         → navigator.geolocation (Even-Realities-native, browser API)
 *           → bridgeGeolocate() (APPS Bridge, third-party, last resort)
 *
 * `reduce`'s emitted effects are covered separately in state.test.ts /
 * nearby.test.ts — this file is only about what `runEffect` does with a
 * `request-location` effect once it has one.
 *
 * Test environment is `node` (see vitest.config.ts), so `navigator` exists
 * as a Node global but `navigator.geolocation` is undefined unless a test
 * stubs it — that's used below to exercise the "no navigator.geolocation"
 * branch without needing jsdom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../glasses/sdkLocation', () => ({
  sdkGeolocate: vi.fn(),
}))
vi.mock('../../glasses/appsBridge', () => ({
  bridgeGeolocate: vi.fn(),
}))
// App.tsx statically imports the tab components, which in turn import
// `even-toolkit/web` — a package whose internal ESM relative imports only
// resolve under Vite's bundler resolution, not plain Vitest/Node module
// resolution (vitest.config.ts runs in `node` env without jsdom, and this
// project has no jsdom dependency). Stubbing the three tab modules (and
// the SDK's waitForEvenAppBridge, used for favorites-seeding in the React
// component below runEffect) lets this file import App.tsx's exports
// without pulling in that unresolvable subtree. Nothing in App.tsx itself
// is touched to make this work.
vi.mock('../tabs/SettingsTab', () => ({ SettingsTab: () => null }))
vi.mock('../tabs/NearbyTab', () => ({ NearbyTab: () => null }))
vi.mock('../tabs/FavoritesTab', () => ({ FavoritesTab: () => null }))
vi.mock('@evenrealities/even_hub_sdk', () => ({ waitForEvenAppBridge: vi.fn(() => Promise.reject(new Error('not available in tests'))) }))

import { runEffect, requestLocationViaNavigatorOrBridge } from '../App'
import { sdkGeolocate } from '../../glasses/sdkLocation'
import { bridgeGeolocate } from '../../glasses/appsBridge'
import type { PhoneEvent } from '../types'

const mockSdkGeolocate = vi.mocked(sdkGeolocate)
const mockBridgeGeolocate = vi.mocked(bridgeGeolocate)

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Captures every event passed to dispatch, in order. */
function dispatchSpy(): { dispatch: (e: PhoneEvent) => void; calls: PhoneEvent[] } {
  const calls: PhoneEvent[] = []
  return { dispatch: (e: PhoneEvent) => calls.push(e), calls }
}

beforeEach(() => {
  mockSdkGeolocate.mockReset()
  mockBridgeGeolocate.mockReset()
  // Neutralize the DEV-mode mock-coords short-circuit (.env.local sets
  // VITE_MOCK_LAT/LNG, and import.meta.env.DEV is true under vitest) so
  // these tests exercise the SDK/navigator/bridge chain instead.
  vi.stubEnv('VITE_MOCK_LAT', '')
  vi.stubEnv('VITE_MOCK_LNG', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ─── Manual-location short-circuit ─────────────────────────────────────────

describe('runEffect request-location — manual location short-circuit', () => {
  it('dispatches location-acquired synchronously and never calls sdkGeolocate', () => {
    const { dispatch, calls } = dispatchSpy()

    runEffect(
      { type: 'request-location', manualLocation: { label: 'Times Square', lat: 40.758, lng: -73.985 } },
      dispatch,
    )

    expect(calls).toEqual([
      { type: 'location-acquired', lat: 40.758, lng: -73.985, source: 'manual' },
    ])
    expect(mockSdkGeolocate).not.toHaveBeenCalled()
    expect(mockBridgeGeolocate).not.toHaveBeenCalled()
  })
})

// ─── SDK as primary source ─────────────────────────────────────────────────

describe('runEffect request-location — sdkGeolocate primary source', () => {
  it('dispatches location-acquired with source "native" on an SDK fix, without touching navigator/bridge', async () => {
    mockSdkGeolocate.mockResolvedValue({ lat: 35.1, lng: -80.1 })
    const { dispatch, calls } = dispatchSpy()

    runEffect({ type: 'request-location', manualLocation: null }, dispatch)

    // sdkGeolocate() is async — flush microtasks.
    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toEqual([
      { type: 'location-acquired', lat: 35.1, lng: -80.1, source: 'native' },
    ])
    expect(mockBridgeGeolocate).not.toHaveBeenCalled()
  })
})

// ─── SDK empty → falls through to navigator/bridge chain ───────────────────

describe('runEffect request-location — sdkGeolocate empty falls through', () => {
  it('falls through to APPS Bridge (no navigator.geolocation in node env) and dispatches its fix', async () => {
    mockSdkGeolocate.mockResolvedValue(null)
    mockBridgeGeolocate.mockResolvedValue({ lat: 12.34, lng: 56.78 })
    const { dispatch, calls } = dispatchSpy()

    runEffect({ type: 'request-location', manualLocation: null }, dispatch)

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(mockBridgeGeolocate).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      { type: 'location-acquired', lat: 12.34, lng: 56.78, source: 'bridge' },
    ])
  })

  it('dispatches location-failed when both sdkGeolocate and APPS Bridge come back empty', async () => {
    mockSdkGeolocate.mockResolvedValue(null)
    mockBridgeGeolocate.mockResolvedValue(null)
    const { dispatch, calls } = dispatchSpy()

    runEffect({ type: 'request-location', manualLocation: null }, dispatch)

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toEqual([
      { type: 'location-failed', message: 'Geolocation not supported on this device.' },
    ])
  })
})

// ─── requestLocationViaNavigatorOrBridge in isolation ──────────────────────

describe('requestLocationViaNavigatorOrBridge', () => {
  it('tries APPS Bridge directly when navigator.geolocation is absent, and dispatches its fix', async () => {
    mockBridgeGeolocate.mockResolvedValue({ lat: 1, lng: 2 })
    const { dispatch, calls } = dispatchSpy()

    requestLocationViaNavigatorOrBridge(dispatch)

    await Promise.resolve()
    await Promise.resolve()

    expect(mockBridgeGeolocate).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([{ type: 'location-acquired', lat: 1, lng: 2, source: 'bridge' }])
  })

  it('dispatches location-failed when APPS Bridge also comes back empty', async () => {
    mockBridgeGeolocate.mockResolvedValue(null)
    const { dispatch, calls } = dispatchSpy()

    requestLocationViaNavigatorOrBridge(dispatch)

    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toEqual([
      { type: 'location-failed', message: 'Geolocation not supported on this device.' },
    ])
  })
})

// ─── geocode-location effect ───────────────────────────────────────────────

describe('runEffect geocode-location', () => {
  // API_BASE (src/glasses/api.ts) is `import.meta.env.DEV ? '/api' : 'https://...'`,
  // evaluated once at module load, and Vitest always runs with DEV=true — so
  // asserting against the *imported* API_BASE value is circular here too (see
  // the matching comment in location-search.test.ts). Stub DEV to false and
  // force a fresh module instance via resetModules() + dynamic import of
  // '../App' so `runEffect` is bound to a `geocoding`/`api` module graph that
  // actually re-evaluated API_BASE under DEV=false.
  it('calls /api/geocode with the absolute production URL when DEV is false', async () => {
    vi.stubEnv('DEV', false)
    vi.resetModules()
    const { runEffect: runEffectUnderProdEnv } = await import('../App')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ label: 'Somewhere' }),
    } as Response)

    runEffectUnderProdEnv({ type: 'geocode-location', lat: 1, lng: 2 }, vi.fn())

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://wander-six-phi.vercel.app/api/geocode?lat='),
    )

    fetchSpy.mockRestore()
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
