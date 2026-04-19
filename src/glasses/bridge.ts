/**
 * Glasses bridge — the SDK seam.
 *
 * Three responsibilities, kept as thin as possible so all the logic is
 * testable in `state.ts`, `render.ts`, and `effects.ts`:
 *
 *   1. Boot the SDK (`waitForEvenAppBridge`, `createStartUpPageContainer`).
 *   2. Translate physical glasses events (CLICK / SCROLL_TOP / etc.) into
 *      reducer events (`tap`, `cursor-up`, …).
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

export async function initGlasses(): Promise<void> {
  const bridge = await waitForEvenAppBridge()
  let state: AppState = INITIAL_STATE

  const runner = new EffectRunner({
    dispatch: (event) => dispatch(event),
    getSettings: () => state.settings,
    exitApp: () => void bridge.shutDownPageContainer(0),
  })

  // Boot screen — the LOADING screen rendered by renderScreen.
  const initial = renderScreen(state.screen)
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: initial.containerTotalNum,
      textObject: initial.textObject,
      listObject: initial.listObject,
    }),
  )

  // Kick off the first POI fetch and start the background refresh timer.
  runner.runAll([{ type: 'fetch-pois' }])
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
      void bridge.textContainerUpgrade(upgrade)
      return
    }
  }
  void bridge.rebuildPageContainer(renderScreen(next))
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
  // List events come from POI_LIST (or any future list screen). They
  // carry the selected item index, which the reducer needs for `tap`.
  if (evt.listEvent) {
    const e = evt.listEvent
    switch (e.eventType) {
      case OsEventTypeList.CLICK_EVENT:
        dispatch({ type: 'tap', itemIndex: e.currentSelectItemIndex })
        return
      case OsEventTypeList.SCROLL_TOP_EVENT:
        dispatch({ type: 'cursor-up' })
        return
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        dispatch({ type: 'cursor-down' })
        return
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        // From the list, double-click surfaces the exit confirmation
        // (the reducer transitions to CONFIRM_EXIT, the runner's
        // 'exit-app' effect is what actually shuts the app down).
        dispatch({ type: 'request-exit' })
        return
    }
    return
  }

  // Text/sys events come from text-only screens (POI_DETAIL, NAV_ACTIVE,
  // WIKI_READ, ERROR_*, LOADING). No item index — the reducer uses the
  // current cursor position instead.
  const e = evt.textEvent ?? evt.sysEvent
  if (!e) return

  switch (e.eventType) {
    case OsEventTypeList.CLICK_EVENT:
      dispatch({ type: 'tap' })
      return

    case OsEventTypeList.SCROLL_TOP_EVENT:
      dispatch({ type: 'cursor-up' })
      return

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      dispatch({ type: 'cursor-down' })
      return

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      // Double-click surfaces an exit prompt on top-level screens (so a
      // single missed tap doesn't close the app); on inner screens it
      // navigates back.
      if (isTopLevelScreen(state.screen.name)) {
        dispatch({ type: 'request-exit' })
      } else {
        dispatch({ type: 'back' })
      }
      return
  }
}

function isTopLevelScreen(name: AppState['screen']['name']): boolean {
  return (
    name === 'POI_LIST' ||
    name === 'LOADING' ||
    name === 'ERROR_LOCATION' ||
    name === 'ERROR_EMPTY'
  )
}
