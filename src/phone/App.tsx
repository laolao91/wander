/**
 * Phone companion app root.
 *
 * Layout (2026-04-28 redesign, matching wander-mockup.html):
 *   - Custom header: Wander logo pill + current tab name + G2 status dot
 *   - Scrollable content area (full-width, flex-1)
 *   - Bottom tab bar: Nearby | Settings  ← matches mockup p-tabbar
 *
 * Effect handling:
 *   persist-settings     → saveSettings(kv)
 *   broadcast-settings   → dispatches 'wander-settings-changed' CustomEvent
 *                          so the glasses bridge (same WebView) can apply them
 *   request-location     → navigator.geolocation.getCurrentPosition
 *   geocode-location     → GET /api/geocode → location-label-resolved
 *   fetch-nearby-pois    → fetchPois → nearby-pois-loaded / nearby-fetch-failed
 *   cache-nearby-pois    → saveNearbyCache(kv) — non-fatal on error
 *
 * G2 connection status:
 *   bridge.ts dispatches 'wander-g2-status' CustomEvent when device status
 *   changes. App listens and shows a coloured dot in the header.
 *
 * Boot sequence:
 *   1. loadSettings(kv)       → settings-hydrated
 *   2. loadNearbyCache(kv)    → nearby-pois-loaded (stale) if present
 *      NearbyTab mounts → auto-dispatches nearby-refresh-requested if idle
 */

import { useState, useEffect, useRef } from 'react'
import { reduce, INITIAL_STATE } from './state'
import {
  loadSettings,
  saveSettings,
  saveNearbyCache,
  loadNearbyCache,
} from './storage'
import type { KVStore } from './storage'
import type { PhoneEvent, PhoneEffect, PhoneState } from './types'
import { categoryIdsToCategories } from './types'
import { fetchPois } from '../glasses/api'
import { bridgeGeolocate } from '../glasses/appsBridge'
import { sdkGeolocate } from '../glasses/sdkLocation'
import { SettingsTab } from './tabs/SettingsTab'
import { NearbyTab } from './tabs/NearbyTab'
import { FavoritesTab } from './tabs/FavoritesTab'
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Poi } from '../glasses/api'

// ─── KV store (browser localStorage adapter) ─────────────────────────────

function createBrowserKVStore(): KVStore {
  return {
    async get(key) {
      try {
        const val = window.localStorage.getItem(key)
        return val === null || val === '' ? null : val
      } catch {
        return null
      }
    },
    async set(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        console.warn('[wander][phone] localStorage.setItem failed for key', key)
      }
    },
  }
}

const kv: KVStore =
  typeof window !== 'undefined'
    ? createBrowserKVStore()
    : { get: async () => null, set: async () => {} }

// ─── Effect runner ────────────────────────────────────────────────────────

/**
 * Falls back to `navigator.geolocation` (then APPS Bridge on failure/
 * absence) when the Even Hub SDK location attempt comes back empty. This
 * is the pre-SDK `request-location` behaviour, extracted verbatim so it
 * can run as a second-tier fallback after `sdkGeolocate()`.
 */
export function requestLocationViaNavigatorOrBridge(dispatch: (e: PhoneEvent) => void): void {
  if (!navigator.geolocation) {
    // No native geolocation at all — try APPS Bridge (the Android
    // companion app) before giving up. Resolves null if it isn't
    // installed/running, in which case we fall through to the same
    // failure message as before.
    bridgeGeolocate().then((fix) => {
      if (fix) {
        dispatch({ type: 'location-acquired', lat: fix.lat, lng: fix.lng, source: 'bridge' })
        return
      }
      dispatch({ type: 'location-failed', message: 'Geolocation not supported on this device.' })
    })
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      dispatch({
        type: 'location-acquired',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        source: 'native',
      })
    },
    (err) => {
      // Map raw GeolocationPositionError codes to actionable messages.
      // Code 1 (PERMISSION_DENIED) can fire on Android even when the user
      // hasn't denied anything — EvenHub's prototype/sideload WebView
      // doesn't always forward the host app's location permission into the
      // WebView context. Production installs (via EvenHub store) resolve
      // this. Code 2/3 are genuine device/timeout failures.
      //
      // Before surfacing a failure, try APPS Bridge — if the user has it
      // installed and running, it sources GPS straight from Android,
      // independent of the host WebView's permission forwarding.
      bridgeGeolocate().then((fix) => {
        if (fix) {
          dispatch({ type: 'location-acquired', lat: fix.lat, lng: fix.lng, source: 'bridge' })
          return
        }
        let message: string
        if (err.code === 1 /* PERMISSION_DENIED */) {
          message =
            'Location permission is required. If you\'ve already granted it, try force-quitting and reopening the app.'
        } else if (err.code === 2 /* POSITION_UNAVAILABLE */) {
          message = 'Your location couldn\'t be determined. Make sure location services are enabled.'
        } else {
          message = 'Location request timed out. Check your location settings and try again.'
        }
        dispatch({ type: 'location-failed', message })
      })
    },
    { timeout: 10_000, maximumAge: 30_000 },
  )
}

export function runEffect(effect: PhoneEffect, dispatch: (e: PhoneEvent) => void): void {
  switch (effect.type) {
    case 'persist-settings':
      saveSettings(kv, effect.settings).then(() => {
        dispatch({ type: 'sync-completed' })
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown storage error'
        console.error('[wander][phone] persist-settings failed', err)
        dispatch({ type: 'sync-failed', message: msg })
      })
      return

    case 'broadcast-settings': {
      // Notify the glasses bridge (running in the same WebView) that settings
      // changed. bridge.ts listens for this event and applies a settings-changed
      // event to the glasses reducer so the next POI fetch uses the new values.
      const mappedCategories = categoryIdsToCategories(effect.settings.enabledCategories)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('wander-settings-changed', {
            detail: {
              radiusMiles: effect.settings.radiusMiles,
              categories: mappedCategories,
              units: effect.settings.units,
              sort: effect.settings.sort,
              maxResults: effect.settings.maxResults,
              manualLocation: effect.settings.manualLocation,
            },
          }),
        )
      }
      return
    }

    case 'geocode-location':
      fetch(`/api/geocode?lat=${effect.lat}&lng=${effect.lng}`)
        .then((r) => r.json())
        .then((data: { label?: string }) => {
          if (typeof data.label === 'string') {
            dispatch({ type: 'location-label-resolved', label: data.label })
          }
        })
        .catch((err: unknown) => {
          // Non-fatal — header falls back to "Near you".
          console.warn('[wander][phone] geocode-location failed', err)
        })
      return

    case 'request-location': {
      // Manual location short-circuit: skip GPS when a manual location is set.
      if (effect.manualLocation) {
        dispatch({ type: 'location-acquired', lat: effect.manualLocation.lat, lng: effect.manualLocation.lng, source: 'manual' })
        return
      }
      // Dev simulator mock — reads VITE_MOCK_LAT/LNG from .env.local.
      // Tree-shaken out of production builds (import.meta.env.DEV = false).
      if (import.meta.env.DEV) {
        const mockLat = parseFloat(import.meta.env.VITE_MOCK_LAT ?? '')
        const mockLng = parseFloat(import.meta.env.VITE_MOCK_LNG ?? '')
        if (!isNaN(mockLat) && !isNaN(mockLng)) {
          dispatch({ type: 'location-acquired', lat: mockLat, lng: mockLng, source: 'native' })
          return
        }
      }
      // Even-Realities-native SDK location (phone-side getAppLocation via
      // the Even Hub bridge) is the primary source — try it first. It
      // never throws and resolves null on any failure (old host SDK,
      // bridge unavailable, no fix, permission issue), in which case we
      // fall through to the existing navigator.geolocation → APPS Bridge
      // chain unchanged.
      sdkGeolocate().then((fix) => {
        if (fix) {
          dispatch({ type: 'location-acquired', lat: fix.lat, lng: fix.lng, source: 'native' })
          return
        }
        requestLocationViaNavigatorOrBridge(dispatch)
      })
      return
    }

    case 'fetch-nearby-pois':
      fetchPois({
        lat: effect.lat,
        lng: effect.lng,
        radiusMiles: effect.settings.radiusMiles,
        categories: categoryIdsToCategories(effect.settings.enabledCategories),
        sort: effect.settings.sort !== 'proximity' ? effect.settings.sort : undefined,
        limit: effect.settings.maxResults,
      }).then((page) => {
        dispatch({ type: 'nearby-pois-loaded', pois: page.items, fetchedAt: Date.now() })
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'fetch failed'
        dispatch({ type: 'nearby-fetch-failed', message: msg })
      })
      return

    case 'cache-nearby-pois':
      saveNearbyCache(kv, effect.pois, effect.fetchedAt).catch((err: unknown) => {
        console.warn('[wander][phone] cache-nearby-pois write failed', err)
      })
      return
  }
}

// ─── App root ─────────────────────────────────────────────────────────────

type Tab = 'nearby' | 'settings' | 'favorites'

export function App() {
  const [tab, setTab] = useState<Tab>('nearby')

  // G2 connection status — null = not yet known (grey), true = connected
  // (green), false = disconnected (amber). Set by 'wander-g2-status'
  // CustomEvents dispatched from bridge.ts via bridge.onDeviceStatusChanged.
  const [g2Connected, setG2Connected] = useState<boolean | null>(null)
  useEffect(() => {
    const handler = (e: Event) => {
      const { connected } = (e as CustomEvent<{ connected: boolean }>).detail
      setG2Connected(connected)
    }
    window.addEventListener('wander-g2-status', handler)
    return () => window.removeEventListener('wander-g2-status', handler)
  }, [])

  const [favorites, setFavorites] = useState<Poi[]>([])

  useEffect(() => {
    // Subscribe to live updates from the glasses bridge.
    const handler = (e: Event) => {
      const { favorites: favs } = (e as CustomEvent<{ favorites: Poi[] }>).detail
      setFavorites(favs)
    }
    window.addEventListener('wander-favorites-changed', handler)

    // Seed initial state from SDK storage in case bridge fired before mount.
    waitForEvenAppBridge().then((bridge) => {
      bridge.getLocalStorage('wander_favorites').then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as unknown
            if (Array.isArray(parsed)) {
              const favs = parsed.filter(
                (x): x is Poi =>
                  typeof x === 'object' &&
                  x !== null &&
                  typeof (x as Record<string, unknown>).id === 'string' &&
                  typeof (x as Record<string, unknown>).name === 'string',
              )
              setFavorites(favs)
            }
          } catch {
            // Ignore corrupt data.
          }
        }
      }).catch(() => {})
    }).catch(() => {})

    return () => window.removeEventListener('wander-favorites-changed', handler)
  }, [])

  const [phoneState, setPhoneState] = useState<PhoneState>(INITIAL_STATE)
  const phoneStateRef = useRef<PhoneState>(INITIAL_STATE)
  phoneStateRef.current = phoneState

  const dispatchRef = useRef<(e: PhoneEvent) => void>(null!)
  dispatchRef.current = (event: PhoneEvent) => {
    const result = reduce(phoneStateRef.current, event)
    phoneStateRef.current = result.state
    setPhoneState(result.state)
    for (const eff of result.effects) {
      runEffect(eff, dispatchRef.current)
    }
  }
  const dispatch = (e: PhoneEvent) => dispatchRef.current(e)

  // Boot: load settings then check stale nearby cache.
  useEffect(() => {
    loadSettings(kv)
      .then((settings) => {
        dispatchRef.current({ type: 'settings-hydrated', settings })
      })
      .catch((err: unknown) => {
        console.warn('[wander][phone] loadSettings failed, using defaults', err)
      })

    loadNearbyCache(kv)
      .then((cached) => {
        if (cached) {
          dispatchRef.current({
            type: 'nearby-pois-loaded',
            pois: cached.pois,
            fetchedAt: cached.fetchedAt,
          })
        }
      })
      .catch((err: unknown) => {
        console.warn('[wander][phone] loadNearbyCache failed', err)
      })
  }, [])

  // ── Render ──────────────────────────────────────────────────────────

  const tabTitle = tab === 'nearby' ? 'Nearby' : tab === 'settings' ? 'Settings' : 'Saved'

  // Header right-side badges are mutually exclusive with "Manual" (a
  // manual-location fix always reports locationSource: 'manual', never
  // 'bridge') but the Bridge badge and the GPS location label can show
  // together — both describe the same non-manual fix from two angles.
  const showManualBadge = phoneState.settings.manualLocation !== null
  const showBridgeBadge = phoneState.nearby.locationSource === 'bridge' && !showManualBadge
  const showLocationLabel = tab === 'nearby' && phoneState.nearby.location !== null && !showManualBadge
  const showHeaderRightGroup = showManualBadge || showBridgeBadge || showLocationLabel

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-bg">

      {/* ── App header: Wander logo pill + current tab title ── */}
      <div className="shrink-0 h-[52px] px-4 flex items-center bg-surface rounded-b-[6px]">
        <div className="flex items-center gap-2 min-w-0 w-full">
          {/* Logo pill */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-[22px] h-[22px] rounded-full bg-accent flex items-center justify-center">
              <span className="text-[11px] font-semibold text-white leading-none">W</span>
            </div>
            <span className="text-[13px] text-text-dim leading-none">Wander</span>
          </div>
          <span className="text-[15px] text-text-dim leading-none">/</span>
          <span className="text-[15px] text-text leading-none font-normal">{tabTitle}</span>

          {/* Manual location badge — all tabs when override is active */}
          {showManualBadge && (
            <span className="ml-auto text-[11px] font-semibold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded shrink-0">
              📍 Manual
            </span>
          )}
          {/* Bridge badge + location label — non-manual fixes; both can show together */}
          {!showManualBadge && (showBridgeBadge || showLocationLabel) && (
            <span className="ml-auto flex items-center gap-1.5 min-w-0">
              {showBridgeBadge && (
                <span
                  className="text-[11px] font-semibold text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded shrink-0"
                  title="Native GPS was unavailable — using the APPS Bridge Android app for location"
                >
                  🌐 Bridge
                </span>
              )}
              {showLocationLabel && (
                <span className="text-[11px] text-text-dim truncate">
                  {phoneState.nearby.location?.label ?? 'Near you'}
                </span>
              )}
            </span>
          )}

          {/* G2 connection status dot — null=grey (unknown), true=green, false=amber */}
          <span
            className={[
              'shrink-0 w-2 h-2 rounded-full',
              !showHeaderRightGroup ? 'ml-auto' : '',
              g2Connected === null
                ? 'bg-text-dim opacity-40'
                : g2Connected
                  ? 'bg-green-500'
                  : 'bg-yellow-500',
            ].join(' ')}
            title={
              g2Connected === null
                ? 'G2: waiting'
                : g2Connected
                  ? 'G2: connected'
                  : 'G2: disconnected'
            }
          />
        </div>
      </div>

      {/* ── Disconnect banner — more prominent than the header dot alone ── */}
      {g2Connected === false && (
        <div className="shrink-0 px-4 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20 text-center">
          <span className="text-[11px] text-yellow-500">⚠ Glasses disconnected — navigation paused</span>
        </div>
      )}

      {/* ── Scrollable content — full width ── */}
      <div className="flex-1 min-h-0 overflow-y-auto w-full">
        {tab === 'nearby' ? (
          <NearbyTab state={phoneState} dispatch={dispatch} />
        ) : tab === 'settings' ? (
          <SettingsTab state={phoneState} dispatch={dispatch} />
        ) : (
          <FavoritesTab
            favorites={favorites}
            units={phoneState.settings.units}
            userLocation={
              phoneState.settings.manualLocation ?? phoneState.nearby.location
            }
          />
        )}
      </div>

      {/* ── Version stamp ── */}
      <div className="shrink-0 text-center py-0.5 text-[10px] text-text-dim opacity-40 select-none bg-bg">
        v{__APP_VERSION__}
      </div>

      {/* ── Bottom tab bar — matches mockup p-tabbar ── */}
      <nav className="shrink-0 flex items-stretch bg-surface border-t border-border">
        <button
          type="button"
          onClick={() => setTab('nearby')}
          className={[
            'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 cursor-pointer transition-colors',
            tab === 'nearby' ? 'text-accent' : 'text-text-dim',
          ].join(' ')}
        >
          <span className="text-[20px] leading-none select-none" aria-hidden>◉</span>
          <span className="text-[10px] tracking-[-0.1px]">Nearby</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('settings')}
          className={[
            'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 cursor-pointer transition-colors',
            tab === 'settings' ? 'text-accent' : 'text-text-dim',
          ].join(' ')}
        >
          <span className="text-[20px] leading-none select-none" aria-hidden>⚙</span>
          <span className="text-[10px] tracking-[-0.1px]">Settings</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('favorites')}
          className={[
            'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 cursor-pointer transition-colors',
            tab === 'favorites' ? 'text-accent' : 'text-text-dim',
          ].join(' ')}
        >
          <span className="text-[20px] leading-none select-none" aria-hidden>★</span>
          <span className="text-[10px] tracking-[-0.1px]">Saved</span>
        </button>
      </nav>

    </div>
  )
}
