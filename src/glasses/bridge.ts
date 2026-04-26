/**
 * Glasses bridge — the SDK seam.
 *
 * Three responsibilities, kept as thin as possible so all the logic is
 * testable in `state.ts`, `render.ts`, and `effects.ts`:
 *
 *   1. Boot the SDK (`waitForEvenAppBridge`, `createStartUpPageContainer`).
 *   2. Translate physical glasses events (CLICK / SCROLL_TOP / etc.) into
 *      reducer events (`tap`, `cursor-up`, ...).
 *   3. After every dispatch, push the new screen to the SDK — preferring
 *      `textContainerUpgrade` for in-place updates and falling back to
 *      `rebuildPageContainer` when the screen layout changes.
 *
 * Background refresh runs on a 5-minute interval; it bypasses the
 * reducer's effect path so the resulting `pois-loaded` event can carry
 * `isBackgroundRefresh: true` (the reducer parks the new list while the
 * user is mid-detail and applies it on the next back-navigation).
 */

import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  EvenHubEvent,
  ImageRawDataUpdate,
  OsEventTypeList,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { ID_MAP, renderInPlaceUpdate, renderScreen } from './render'
import { EffectRunner } from './effects'
import { encodeMinimapPng, type MinimapInput } from './minimap'
import {
  INITIAL_STATE,
  reduce,
  type AppState,
  type Event,
} from './state'

const BACKGROUND_REFRESH_MS = 5 * 60 * 1000

// Scroll-cooldown window. Spec §17: the G2 firmware can double-fire a
// single R1-ring or temple gesture at scroll boundaries. We absorb those
// bounces but err on the side of letting legitimate scrolls through —
// field-test 2026-04-24 reported "scrolling feels laggy resulting in
// misinputs" at 300ms, so we tightened to 150ms. If real bounces leak
// through at 150, raise; if scrolling still feels sluggish, drop further.
// Direction-agnostic: a fast reversal within the window is treated as a
// bounce, not a user action.
const SCROLL_COOLDOWN_MS = 150
let _lastScrollAt = 0

// Phase F (2026-04-26): manual double-tap detector. The SDK's native
// DOUBLE_CLICK_EVENT doesn't fire reliably on real BLE — field tests
// 2026-04-24 and 2026-04-25 both showed double-tap unresponsive on
// every screen except (intermittently) LOADING. This is a fallback:
// two CLICK_EVENTs within MANUAL_DOUBLE_CLICK_WINDOW_MS are promoted
// to a single `request-exit`. The first tap's effect still fires
// (we dispatch immediately), but the user's intent — exit — wins
// when they confirm the prompt. Tune by adjusting the window.
const MANUAL_DOUBLE_CLICK_WINDOW_MS = 350
let _lastClickAt = 0

/** Test-only: reset module-level runtime state between test cases. */
export function _resetBridgeEventState(): void {
  _lastScrollAt = 0
  _lastClickAt = 0
}

/**
 * Returns true if this CLICK arrived within the manual double-tap
 * window. Caller should dispatch `request-exit` instead of `tap` and
 * skip the rest of its handler. Resets the timestamp on detection so
 * a third quick click isn't again treated as a double.
 */
function isManualDoubleClick(): boolean {
  const now = Date.now()
  const delta = now - _lastClickAt
  if (_lastClickAt > 0 && delta < MANUAL_DOUBLE_CLICK_WINDOW_MS) {
    _lastClickAt = 0
    return true
  }
  _lastClickAt = now
  return false
}

/**
 * Normalize the SDK's `eventType` field. Per the documented SDK quirk
 * (WANDER_BUILD_SPEC §17): `CLICK_EVENT = 0` deserializes to `undefined`
 * over the real BLE bridge. We treat `undefined` the same as CLICK.
 */
function normalizeEventType(
  raw: OsEventTypeList | undefined,
): OsEventTypeList {
  return raw === undefined ? OsEventTypeList.CLICK_EVENT : raw
}

export async function initGlasses(): Promise<void> {
  // Boot-step logging — added 2026-04-24 to diagnose §2.1 (boot stuck on
  // LOADING). Once the log capture story (§2.7) is solved, these tags
  // pinpoint where the boot sequence hangs on real hardware.
  console.log('[wander][boot] waitForEvenAppBridge')
  const bridge = await waitForEvenAppBridge()
  console.log('[wander][boot] bridge ready')
  let state: AppState = INITIAL_STATE

  const runner = new EffectRunner({
    dispatch: (event) => dispatch(event),
    getSettings: () => state.settings,
    exitApp: () => void bridge.shutDownPageContainer(0),
    // Phase G (2026-04-26): speculative attempt to escape the EvenHub
    // in-app browser overlay (which captures glasses input). The SDK's
    // public method enum doesn't list a URL-opening method, but
    // `callEvenApp` accepts an arbitrary string method name — if the
    // host happens to expose `openExternalUrl` (or similar), it will
    // route through the OS browser and free the glasses cursor. If it
    // rejects (method unknown), we fall back to `_system` then `_blank`.
    openUrl: (url) => openExternalUrl(bridge, url),
  })

  // Boot screen — the LOADING screen rendered by renderScreen.
  const initial = renderScreen(state.screen)
  console.log('[wander][boot] createStartUpPageContainer')
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: initial.containerTotalNum,
      textObject: initial.textObject,
      listObject: initial.listObject,
    }),
  )
  console.log('[wander][boot] startup container painted')

  // Kick off the first POI fetch and start the background refresh timer.
  console.log('[wander][boot] dispatch fetch-pois')
  runner.runAll([{ type: 'fetch-pois', offset: 0, mode: 'replace' }])
  const refreshTimer = setInterval(() => {
    void runner.backgroundRefresh()
  }, BACKGROUND_REFRESH_MS)

  // Wire glasses events → reducer events.
  const unsubscribe = bridge.onEvenHubEvent((evt) => {
    translateGlassesEvent(evt, state, dispatch, bridge)
  })

  // Stop the background timer and any GPS watch on system exit.
  // (The unsubscribe + clearInterval calls are safe to call multiple times.)
  const cleanup = () => {
    clearInterval(refreshTimer)
    unsubscribe()
    runner.dispose()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', cleanup)
  }

  function dispatch(event: Event): void {
    const prev = state
    const result = reduce(prev, event)
    state = result.state

    if (prev.screen !== state.screen) {
      pushScreen(bridge, prev.screen.name, state.screen)
      // NAV_ACTIVE → push the minimap PNG into the image container.
      // We do this after every screen-object change while on NAV_ACTIVE
      // (entry rebuild, position updates, arrival), so the user-position
      // triangle stays in sync with whatever the body text is showing.
      if (state.screen.name === 'NAV_ACTIVE') {
        void pushMinimap(bridge, state.screen)
      }
    }

    runner.runAll(result.effects)
  }
}

// ─── SDK push ────────────────────────────────────────────────────────────

function pushScreen(
  bridge: EvenAppBridge,
  prevName: AppState['screen']['name'],
  next: AppState['screen'],
): void {
  // Same screen-kind → try the cheap in-place upgrade (cursor move,
  // wiki page flip, NAV_ACTIVE position update). Different kind → full
  // rebuild so the container layout changes too.
  if (prevName === next.name) {
    const upgrade = renderInPlaceUpdate(next)
    if (upgrade) {
      // Phase D 2026-04-25: previously `void`'d — any SDK rejection was
      // swallowed. Field test surfaced symptoms consistent with silent
      // SDK errors on POI_LIST rebuilds. Log so we can see them.
      Promise.resolve(bridge.textContainerUpgrade(upgrade)).catch((err) => {
        console.error('[wander][sdk] textContainerUpgrade failed', { screen: next.name, err })
      })
      return
    }
  }
  console.log('[wander][sdk] rebuildPageContainer', { from: prevName, to: next.name })
  Promise.resolve(bridge.rebuildPageContainer(renderScreen(next))).catch((err) => {
    console.error('[wander][sdk] rebuildPageContainer failed', { screen: next.name, err })
  })
}

// ─── Minimap push ────────────────────────────────────────────────────────

/**
 * Encode the NAV_ACTIVE minimap to PNG and push it into the image
 * container. The host converts our PNG to gray4 internally — see the
 * SDK's `ImageRawDataUpdateResult.imageToGray4Failed`.
 *
 * Errors are swallowed and logged: a failed minimap push shouldn't
 * derail navigation (the text-only body is still useful on its own).
 */
async function pushMinimap(
  bridge: Pick<EvenAppBridge, 'updateImageRawData'>,
  screen: Extract<AppState['screen'], { name: 'NAV_ACTIVE' }>,
): Promise<void> {
  const input: MinimapInput = {
    geometry: screen.route.geometry,
    destination: { lat: screen.destination.lat, lng: screen.destination.lng },
    position: screen.position,
    headingDegrees: null,
  }
  try {
    const png = await encodeMinimapPng(input)
    if (!png) return
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: ID_MAP,
        containerName: 'nav-minimap',
        imageData: Array.from(png),
      }),
    )
  } catch (err) {
    console.warn('[wander] minimap push failed', err)
  }
}

// ─── Event translation ──────────────────────────────────────────────────

/**
 * Map the SDK's physical event into one (or zero) reducer events.
 * Exported for unit tests — the bridge's I/O wiring is the only piece
 * we can't easily test, so factoring the translation out keeps the
 * uncovered surface tiny.
 */
export function translateGlassesEvent(
  evt: EvenHubEvent,
  state: AppState,
  dispatch: (e: Event) => void,
  // Kept in the signature for callers/tests; the bridge no longer needs
  // to call shutDownPageContainer directly (exit flows through the
  // CONFIRM_EXIT screen + 'exit-app' effect now).
  _bridge?: Pick<EvenAppBridge, 'shutDownPageContainer'>,
): void {
  // Phase 0 diagnostic — captures source (list/text/sys), eventType, and
  // full payload so we can see what real hardware is sending vs the
  // simulator. Remove once input bugs (HANDOFF §A1–A3) are fixed.
  try {
    const source = evt.listEvent
      ? 'list'
      : evt.textEvent
        ? 'text'
        : evt.sysEvent
          ? 'sys'
          : 'none'
    const inner = evt.listEvent ?? evt.textEvent ?? evt.sysEvent
    const rawType = inner?.eventType
    console.log(
      '[wander][evt]',
      'screen=' + state.screen.name,
      'source=' + source,
      'eventType=' + String(rawType) + (rawType === undefined ? ' (undefined=CLICK?)' : ''),
      JSON.stringify(evt),
    )
  } catch {
    // Never let logging break event routing.
  }

  // List events come from POI_LIST (or any future list screen). They
  // carry the selected item index, which the reducer needs for `tap`.
  // If `evt.listEvent` is present but the event type doesn't match any
  // list-screen case, we fall through to the text/sys handler rather
  // than returning — HANDOFF §A1 notes real hardware may deliver a
  // meaningful textEvent alongside an unrecognized listEvent.
  if (evt.listEvent) {
    const e = evt.listEvent
    const type = normalizeEventType(e.eventType)
    switch (type) {
      case OsEventTypeList.CLICK_EVENT:
        dispatch({ type: 'tap', itemIndex: e.currentSelectItemIndex })
        // Phase F: a follow-on click within the window promotes to exit.
        if (isManualDoubleClick()) dispatch({ type: 'request-exit' })
        return
      case OsEventTypeList.SCROLL_TOP_EVENT:
        if (scrollOnCooldown()) return
        dispatch({ type: 'cursor-up' })
        return
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        if (scrollOnCooldown()) return
        dispatch({ type: 'cursor-down' })
        return
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        // Double-tap from any screen surfaces the exit-confirmation
        // prompt. The reducer gates `request-exit` so repeated
        // double-taps while already on CONFIRM_EXIT don't stack.
        dispatch({ type: 'request-exit' })
        return
    }
    // Fall through — listEvent present but no recognized type.
  }

  // Text/sys events come from text-only screens (POI_DETAIL, NAV_ACTIVE,
  // WIKI_READ, ERROR_*, LOADING). No item index — the reducer uses the
  // current cursor position instead.
  const e = evt.textEvent ?? evt.sysEvent
  if (!e) return

  const type = normalizeEventType(e.eventType)
  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      dispatch({ type: 'tap' })
      // Phase F: manual double-tap fallback (see isManualDoubleClick).
      if (isManualDoubleClick()) dispatch({ type: 'request-exit' })
      return

    case OsEventTypeList.SCROLL_TOP_EVENT:
      if (scrollOnCooldown()) return
      dispatch({ type: 'cursor-up' })
      return

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      if (scrollOnCooldown()) return
      dispatch({ type: 'cursor-down' })
      return

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      // Unified: double-tap always surfaces the exit-confirmation
      // prompt, regardless of screen. HANDOFF §A3 — the prior
      // top-level-vs-inner branching was confusing on real hardware.
      dispatch({ type: 'request-exit' })
      return
  }
}

function scrollOnCooldown(): boolean {
  const now = Date.now()
  if (now - _lastScrollAt < SCROLL_COOLDOWN_MS) return true
  _lastScrollAt = now
  return false
}

/**
 * Open an external URL "on the phone" in a way that doesn't capture
 * glasses input. Tries (in order):
 *   1. `bridge.callEvenApp('openExternalUrl', { url })` — speculative;
 *      EvenHub's public API doesn't document this method but the
 *      callEvenApp signature accepts arbitrary method names. If a
 *      handler exists, the host routes through the OS browser and
 *      Wander stays foregrounded. Field test 2026-04-26 will tell us.
 *   2. `window.open(url, '_system', ...)` — Cordova/Capacitor
 *      convention for "open in the OS browser, don't trap me in this
 *      WebView." Some Flutter inappwebview hosts honor this hint.
 *   3. `window.open(url, '_blank', ...)` — last resort. This is the
 *      original behavior that lands in EvenHub's in-app browser overlay
 *      and captures glasses input. We accept the trap rather than
 *      drop the action entirely.
 * Errors at any step are swallowed and logged so a buggy URL never
 * crashes Wander mid-walk.
 */
async function openExternalUrl(bridge: EvenAppBridge, url: string): Promise<void> {
  try {
    // Speculative — if the host doesn't know this method, this rejects.
    await bridge.callEvenApp('openExternalUrl', { url })
    console.log('[wander][openUrl] routed via host openExternalUrl')
    return
  } catch (err) {
    console.log('[wander][openUrl] host openExternalUrl unavailable', err)
  }
  if (typeof window === 'undefined') return
  try {
    const sys = window.open(url, '_system', 'noopener,noreferrer')
    if (sys) {
      console.log('[wander][openUrl] _system accepted')
      return
    }
  } catch {
    // _system unsupported — fall through.
  }
  console.log('[wander][openUrl] falling back to _blank (input lock expected)')
  window.open(url, '_blank', 'noopener,noreferrer')
}
