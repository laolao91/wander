/**
 * Phone companion app root.
 *
 * Wires the PhoneState reducer, settings persistence (KV store), and
 * tab routing. Phase H (2026-04-26) wires the Settings tab; the Nearby
 * tab remains a placeholder until Phase I.
 *
 * Effect handling:
 *   persist-settings  → saveSettings(kv, settings)  (browser localStorage)
 *   broadcast-settings → no-op + console.log in v1.0 — glasses picks up
 *     new settings on the next "Refresh nearby" via the /api/poi query
 *     params the glasses reducer sends. A direct phone→glasses bridge
 *     channel is deferred to Phase I (HANDOFF_2026-04-26_part2.md §3.9).
 *
 * KV store note (storage.ts line 8):
 *   The spec recommends bridge.setLocalStorage in the EvenHub WebView.
 *   For Phase H we use browser localStorage — empirically the Flutter
 *   host does not wipe it between opens. If that assumption breaks,
 *   replace createBrowserKVStore() with createBridgeKVStore(bridge) from
 *   a shared boot promise alongside initGlasses().
 *   CLAUDE: See HANDOFF_2026-04-26_part2.md §3.8 for the note on this.
 */

import { AppShell, NavBar, ScreenHeader, Card } from 'even-toolkit/web'
import type { NavItem } from 'even-toolkit/web'
import { useState, useEffect, useRef } from 'react'
import { reduce, INITIAL_STATE } from './state'
import { loadSettings, saveSettings } from './storage'
import type { KVStore, } from './storage'
import type { PhoneEvent, PhoneEffect, PhoneState } from './types'
import { SettingsTab } from './tabs/SettingsTab'

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
        // Quota exceeded or storage not available — log and continue.
        console.warn('[wander][phone] localStorage.setItem failed for key', key)
      }
    },
  }
}

// Module-level KV store singleton — created once before the component
// mounts so it's stable across re-renders. Falls back to no-op in SSR.
const kv: KVStore =
  typeof window !== 'undefined'
    ? createBrowserKVStore()
    : { get: async () => null, set: async () => {} }

// ─── Tab config ───────────────────────────────────────────────────────────

const TAB_ITEMS: NavItem[] = [
  { id: 'nearby', label: 'Nearby' },
  { id: 'settings', label: 'Settings' },
]

// ─── Effect runner ────────────────────────────────────────────────────────

/**
 * Run a single PhoneEffect. Called synchronously after each dispatch so
 * async side-effects (persist, broadcast) start immediately without
 * requiring a separate useEffect cleanup cycle.
 */
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

    case 'broadcast-settings':
      // v1.0: no direct phone→glasses bridge channel. The glasses re-reads
      // settings from PhoneState on the next fetch-pois, which is triggered
      // by tapping "Refresh nearby" on the glasses. Log so field tests can
      // confirm settings are being emitted.
      // CLAUDE: When Phase I lands, wire this to bridge.callEvenApp or the
      // shared storage keys from storage.ts so the glasses picks them up.
      console.log('[wander][phone] broadcast-settings (no-op in v1.0)', effect.settings)
      return
  }
}

// ─── App root ─────────────────────────────────────────────────────────────

export function App() {
  const [tab, setTab] = useState<string>('nearby')

  // Phone state lives here. We manage it with useState + a ref so dispatch
  // always reads the latest state without stale-closure problems.
  const [phoneState, setPhoneState] = useState<PhoneState>(INITIAL_STATE)
  const phoneStateRef = useRef<PhoneState>(INITIAL_STATE)
  phoneStateRef.current = phoneState

  // Stable dispatch — runs reduce, updates state, fires effects.
  // Defined with useRef so child components don't get a new reference on
  // every render (important for Toggle onChange which fires on every tap).
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

  // Boot: load persisted settings and hydrate state once.
  useEffect(() => {
    loadSettings(kv).then((settings) => {
      dispatchRef.current({ type: 'settings-hydrated', settings })
    }).catch((err: unknown) => {
      // Non-fatal — keep running with DEFAULT_SETTINGS.
      console.warn('[wander][phone] loadSettings failed, using defaults', err)
    })
  }, [])

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <AppShell header={<NavBar items={TAB_ITEMS} activeId={tab} onNavigate={setTab} />}>
      {tab === 'settings' ? (
        <SettingsTab state={phoneState} dispatch={dispatch} />
      ) : (
        /* Nearby tab — Phase I placeholder */
        <div className="px-3 pt-4 pb-8">
          <ScreenHeader title="Wander" subtitle="Discover what's around you" />
          <Card className="mt-3">
            <p className="text-[15px] tracking-[-0.2px] text-text">
              Nearby places will appear here once Phase I lands.
            </p>
          </Card>
        </div>
      )}
    </AppShell>
  )
}
