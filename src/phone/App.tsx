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
import { SettingsTab } from './tabs/SettingsTab'
import { NearbyTab } from './tabs/NearbyTab'

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

function runEffect(effect: PhoneEffect, dispatch: (e: PhoneEvent) => void): void {
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

    case 'request-location':
      if (!navigator.geolocation) {
        dispatch({ type: 'location-failed', message: 'Geolocation not supported on this device.' })
        return
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          dispatch({
            type: 'location-acquired',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
        },
        (err) => {
          // Map raw GeolocationPositionError codes to actionable messages.
          // Code 1 (PERMISSION_DENIED) can fire on Android even when the user
          // hasn't denied anything — EvenHub's prototype/sideload WebView
          // doesn't always forward the host app's location permission into the
          // WebView context. Production installs (via EvenHub store) resolve
          // this. Code 2/3 are genuine device/timeout failures.
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
        },
        { timeout: 10_000, maximumAge: 30_000 },
      )
      return

    case 'fetch-nearby-pois':
      fetchPois({
        lat: effect.lat,
        lng: effect.lng,
        radiusMiles: effect.settings.radiusMiles,
        categories: categoryIdsToCategories(effect.settings.enabledCategories),
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

type Tab = 'nearby' | 'settings'

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

  const tabTitle = tab === 'nearby' ? 'Nearby' : 'Settings'

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

          {/* Location label — Nearby tab only */}
          {tab === 'nearby' && phoneState.nearby.location && (
            <span className="ml-auto text-[11px] text-text-dim truncate">
              {phoneState.nearby.location.label ?? 'Near you'}
            </span>
          )}

          {/* G2 connection status dot — null=grey (unknown), true=green, false=amber */}
          <span
            className={[
              'shrink-0 w-2 h-2 rounded-full',
              tab === 'nearby' && phoneState.nearby.location ? '' : 'ml-auto',
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

      {/* ── Scrollable content — full width ── */}
      <div className="flex-1 min-h-0 overflow-y-auto w-full">
        {tab === 'nearby' ? (
          <NearbyTab state={phoneState} dispatch={dispatch} />
        ) : (
          <SettingsTab state={phoneState} dispatch={dispatch} />
        )}
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
      </nav>

    </div>
  )
}
