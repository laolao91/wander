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
  OsEventTypeList,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { renderInPlaceUpdate, renderScreen } from './render'
import { EffectRunner } from './effects'
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
  bridge: Pick<EvenAppBridge, 'shutDownPageContainer'>,
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
        // From the list, double-click means exit the app.
        void bridge.shutDownPageContainer(0)
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
      // Double-click maps to "back" on screens we can back out of, and
      // "exit" on top-level screens (per spec §10).
      if (isTopLevelScreen(state.screen.name)) {
        void bridge.shutDownPageContainer(0)
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
