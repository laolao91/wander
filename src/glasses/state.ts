/**
 * Pure state reducer for the glasses app.
 *
 * Phase 3 prep: this file owns "given the current state and an event,
 * what's the next state?" The bridge layer (Phase 3 proper) maps
 * physical glasses events (CLICK, DOUBLE_CLICK, SCROLL_TOP/BOTTOM) into
 * the dispatch envelope below, and renders the resulting `Screen`.
 *
 * Keeping the reducer pure means:
 *   - It's trivially unit-testable without the SDK or simulator
 *   - The bridge can be swapped/mocked for tests
 *   - State transitions are documented in code, not in a bridge file
 *     full of side-effects
 *
 * No async work, no fetches, no SDK calls — those live in the bridge.
 */

import type { Poi, Route, WikiArticle, Category } from './api'
import type {
  Screen,
  PoiDetailAction,
  Settings,
} from './screens/types'
import { canTransition, DEFAULT_SETTINGS } from './screens/types'
import { LIST_DISPLAY_LIMIT } from './render'

// ─── Top-level state ───────────────────────────────────────────────────

export interface AppState {
  screen: Screen
  /** Last-known POI list, retained across detail/wiki/nav for back-nav. */
  poiList: Poi[]
  /** Whether `/api/poi` flagged a further page available past `poiList`. */
  poiListHasMore: boolean
  /** Last-known location. Refreshed on every fetch attempt. */
  position: { lat: number; lng: number } | null
  /** Pending refresh result while user is in non-POI_LIST screens. */
  pendingPoiRefresh: { pois: Poi[]; hasMore: boolean } | null
  settings: Settings
}

// LOADING messages are also a poor-man's progress indicator: when the
// boot sequence hangs on real hardware, the user sees which step is
// stuck. Step 1 is "Getting your location...", step 2 (after geolocate
// succeeds and `position-updated` fires) flips to "Fetching nearby
// places...". Field-test 2026-04-24 §2.1.
export const LOADING_MSG_GEOLOCATE = 'Getting your location...'
export const LOADING_MSG_FETCH = 'Fetching nearby places...'
// Phase E: shown while "More results" is fetching the next server page.
// Distinct from FETCH so the user can tell whether this is the initial
// load (geolocate first) or a follow-on page request.
export const LOADING_MSG_FETCH_MORE = 'Loading more places...'

export const INITIAL_STATE: AppState = {
  screen: { name: 'LOADING', message: LOADING_MSG_GEOLOCATE },
  poiList: [],
  poiListHasMore: false,
  position: null,
  pendingPoiRefresh: null,
  settings: DEFAULT_SETTINGS,
}

// ─── Events ────────────────────────────────────────────────────────────

/**
 * The reducer's input alphabet. Two flavours:
 *
 *   1. *User events* — translated by the bridge from glasses input
 *      (CLICK_EVENT, DOUBLE_CLICK_EVENT, SCROLL_TOP/BOTTOM_EVENT) into
 *      semantic verbs (`tap`, `back`, `cursor-up`, `cursor-down`).
 *
 *   2. *System events* — async results landing back in the reducer
 *      (`pois-loaded`, `route-loaded`, `wiki-loaded`, `*-failed`,
 *      `position-updated`).
 *
 * The bridge owns the side-effects (fetch, geolocation, SDK push) and
 * dispatches the result events when they complete.
 */
export type Event =
  // User events
  | { type: 'tap'; itemIndex?: number } // POI_LIST passes which item
  | { type: 'back' }
  | { type: 'cursor-up' }
  | { type: 'cursor-down' }
  | { type: 'request-exit' } // bridge dispatches on double-tap from top-level
  // POI_LIST sentinel actions (Phase 4d)
  | { type: 'load-more' }
  | { type: 'refresh-pois' }
  // System events
  | {
      type: 'pois-loaded'
      pois: Poi[]
      hasMore: boolean
      /** 'replace' overwrites the list (initial fetch / refresh).
       *  'append' concatenates onto the existing list (load-more). */
      mode: 'replace' | 'append'
      isBackgroundRefresh: boolean
    }
  | { type: 'pois-failed'; reason: 'location' | 'network' | 'empty' }
  | { type: 'route-loaded'; route: Route }
  | { type: 'route-failed' }
  | { type: 'wiki-loaded'; article: WikiArticle }
  | { type: 'wiki-failed' }
  | { type: 'position-updated'; lat: number; lng: number }
  | { type: 'settings-changed'; settings: Partial<Settings> }
  | { type: 'retry' }

/**
 * Side-effects the reducer requests from the bridge, returned alongside
 * the next state. The reducer never executes these directly.
 */
export type Effect =
  | {
      type: 'fetch-pois'
      offset: number
      mode: 'replace' | 'append'
    }
  | { type: 'fetch-route'; from: { lat: number; lng: number }; to: Poi }
  | { type: 'fetch-wiki'; title: string; lang: string | null }
  | { type: 'open-url'; url: string }
  | { type: 'start-nav-watch' }
  | { type: 'stop-nav-watch' }
  | { type: 'exit-app' }

export interface ReducerResult {
  state: AppState
  effects: Effect[]
}

// ─── Reducer ───────────────────────────────────────────────────────────

export function reduce(state: AppState, event: Event): ReducerResult {
  switch (event.type) {
    case 'pois-loaded':
      return onPoisLoaded(
        state,
        event.pois,
        event.hasMore,
        event.mode,
        event.isBackgroundRefresh,
      )

    case 'pois-failed':
      return next(state, errorScreenForReason(event.reason))

    case 'route-loaded':
      return onRouteLoaded(state, event.route)

    case 'route-failed':
      return next(state, {
        name: 'ERROR_NETWORK',
        message: 'Could not load directions',
        retryAction: 'fetch-route',
      })

    case 'wiki-loaded':
      return onWikiLoaded(state, event.article)

    case 'wiki-failed':
      return next(state, {
        name: 'ERROR_NETWORK',
        message: 'Could not load article',
        retryAction: 'fetch-wiki',
      })

    case 'position-updated':
      return onPositionUpdated(state, event.lat, event.lng)

    case 'settings-changed':
      return {
        state: { ...state, settings: { ...state.settings, ...event.settings } },
        effects: [{ type: 'fetch-pois', offset: 0, mode: 'replace' }],
      }

    case 'retry':
      return onRetry(state)

    case 'load-more':
      return onLoadMore(state)

    case 'refresh-pois':
      return onRefreshPois(state)

    case 'tap':
      return onTap(state, event.itemIndex)

    case 'back':
      return onBack(state)

    case 'cursor-up':
      return onCursorMove(state, -1)

    case 'cursor-down':
      return onCursorMove(state, +1)

    case 'request-exit':
      return onRequestExit(state)
  }
}

function onRequestExit(state: AppState): ReducerResult {
  // Don't stack confirms.
  if (state.screen.name === 'CONFIRM_EXIT') return noop(state)
  return next(state, { name: 'CONFIRM_EXIT', returnTo: state.screen, cursorIndex: 0 })
}

// ─── Per-event handlers ────────────────────────────────────────────────

function onPoisLoaded(
  state: AppState,
  pois: Poi[],
  hasMore: boolean,
  mode: 'replace' | 'append',
  isBackgroundRefresh: boolean,
): ReducerResult {
  // ─── Append (load-more) ──────────────────────────────────────────────
  // Append-mode is always foreground-initiated by the user tapping "More",
  // but the response can land after they've navigated to POI_DETAIL/etc.
  // We always merge into poiList so back-navigation shows the longer list,
  // and only update the live POI_LIST screen when that's where they are.
  if (mode === 'append') {
    const merged = [...state.poiList, ...pois]
    const nextState = {
      ...state,
      poiList: merged,
      poiListHasMore: hasMore,
    }
    // Phase E: append-fetch is preceded by goLoading, so the live screen
    // is LOADING (not POI_LIST). Either way, snap the visible window to
    // the first newly-fetched item with cursor at top.
    const prevPoiCount = state.poiList.length
    if (state.screen.name === 'POI_LIST' || state.screen.name === 'LOADING') {
      return next(nextState, {
        name: 'POI_LIST',
        pois: merged,
        hasMore,
        displayOffset: prevPoiCount,
        cursorIndex: 0,
      })
    }
    return { state: nextState, effects: [] }
  }

  // ─── Replace (initial fetch / refresh / settings change) ─────────────
  if (pois.length === 0) {
    const filtersAreNarrow =
      state.settings.radiusMiles < 1.5 ||
      state.settings.categories.length < ALL_CATEGORIES.length
    return next(
      { ...state, poiList: [], poiListHasMore: false, pendingPoiRefresh: null },
      { name: 'ERROR_EMPTY', filtersAreNarrow },
    )
  }

  // Background refresh: only swap the list in if user is on POI_LIST,
  // otherwise hold the new data until they navigate back.
  if (isBackgroundRefresh && state.screen.name !== 'POI_LIST') {
    return {
      state: { ...state, pendingPoiRefresh: { pois, hasMore } },
      effects: [],
    }
  }

  return next(
    {
      ...state,
      poiList: pois,
      poiListHasMore: hasMore,
      pendingPoiRefresh: null,
    },
    { name: 'POI_LIST', pois, hasMore, displayOffset: 0, cursorIndex: 0 },
  )
}

function onLoadMore(state: AppState): ReducerResult {
  if (state.screen.name !== 'POI_LIST') return noop(state)
  const offset = state.screen.displayOffset ?? 0
  const nextOffset = offset + LIST_DISPLAY_LIMIT

  // Phase E: if we still have un-displayed items locally, just advance
  // the visible window — instant, no network round-trip. Reset cursor
  // to the top of the new window.
  if (nextOffset < state.screen.pois.length) {
    return next(state, {
      ...state.screen,
      displayOffset: nextOffset,
      cursorIndex: 0,
    })
  }

  // Local cache is exhausted. Only meaningful if the server has more.
  if (!state.screen.hasMore) return noop(state)

  // Surface a LOADING screen ("Loading more places…") so the user gets
  // visible feedback while the fetch is in flight. onPoisLoaded with
  // mode='append' will return us to POI_LIST and bump displayOffset to
  // the start of the new items.
  return next(
    state,
    { name: 'LOADING', message: LOADING_MSG_FETCH_MORE },
    [{ type: 'fetch-pois', offset: state.poiList.length, mode: 'append' }],
  )
}

function onRefreshPois(state: AppState): ReducerResult {
  // User-initiated refresh from the POI_LIST sentinel. Surface a LOADING
  // screen so they get visual feedback while the fetch is in flight; the
  // 'pois-loaded' event will route back to POI_LIST.
  return goLoading(state, 'fetch-pois')
}

function onRouteLoaded(state: AppState, route: Route): ReducerResult {
  // Route fetches only originate from the POI_ACTIONS screen (the
  // "Navigate" action). If the user has navigated away before the
  // response lands, drop it on the floor.
  if (state.screen.name !== 'POI_ACTIONS') return noop(state)
  return next(
    state,
    {
      name: 'NAV_ACTIVE',
      destination: state.screen.poi,
      route,
      currentStepIndex: 0,
      position: state.position,
      arrived: false,
    },
    [{ type: 'start-nav-watch' }],
  )
}

function onWikiLoaded(state: AppState, article: WikiArticle): ReducerResult {
  // Wiki fetches only originate from POI_ACTIONS ("Read More" action).
  // On exit, WIKI_READ returns to POI_DETAIL (not POI_ACTIONS) so the
  // user sees the summary and can re-tap if they want actions again.
  if (state.screen.name !== 'POI_ACTIONS') return noop(state)
  return next(state, {
    name: 'WIKI_READ',
    fromPoi: state.screen.poi,
    article,
    pageIndex: 0,
  })
}

function onPositionUpdated(state: AppState, lat: number, lng: number): ReducerResult {
  const position = { lat, lng }
  if (state.screen.name === 'NAV_ACTIVE') {
    // Phase 3 proper will compute step advancement + arrival here.
    // Stub: just stash the position; geometry math goes in a helper later.
    return {
      state: { ...state, position, screen: { ...state.screen, position } },
      effects: [],
    }
  }
  if (state.screen.name === 'LOADING') {
    // Boot/refresh in progress and we just got a position fix — flip the
    // LOADING message to the "fetching" step so the user knows we're past
    // geolocation. See INITIAL_STATE comment for the rationale.
    return {
      state: {
        ...state,
        position,
        screen: { ...state.screen, message: LOADING_MSG_FETCH },
      },
      effects: [],
    }
  }
  return { state: { ...state, position }, effects: [] }
}

function onRetry(state: AppState): ReducerResult {
  switch (state.screen.name) {
    case 'ERROR_NETWORK':
      switch (state.screen.retryAction) {
        case 'fetch-pois':
          return goLoading(state, 'fetch-pois')
        case 'fetch-route':
          // Caller needs to know where to retry to; bridge handles that.
          return goLoading(state, null)
        case 'fetch-wiki':
          return goLoading(state, null)
      }
      break
    case 'ERROR_LOCATION':
    case 'ERROR_EMPTY':
      return goLoading(state, 'fetch-pois')
    default:
      return noop(state)
  }
  return noop(state)
}

function onTap(state: AppState, itemIndex?: number): ReducerResult {
  switch (state.screen.name) {
    case 'POI_LIST': {
      // Phase G: cursor and itemIndex are relative to the *visible*
      // window, which may include a leading "▲ Previous" sentinel
      // (when displayOffset > 0), the POI rows, and trailing
      // "▼ More" / "↻ Refresh" sentinels. Translate to a global
      // poi index via displayOffset.
      const idx = itemIndex ?? state.screen.cursorIndex ?? 0
      const offset = state.screen.displayOffset ?? 0
      const remaining = state.screen.pois.length - offset
      const displayed = Math.min(Math.max(remaining, 0), LIST_DISPLAY_LIMIT)
      const showPrev = offset > 0
      const hasLocalMore = offset + LIST_DISPLAY_LIMIT < state.screen.pois.length
      const showMore = hasLocalMore || state.screen.hasMore
      const poiBase = showPrev ? 1 : 0
      // Previous sentinel
      if (showPrev && idx === 0) {
        return next(state, {
          ...state.screen,
          displayOffset: Math.max(0, offset - LIST_DISPLAY_LIMIT),
          cursorIndex: 0,
        })
      }
      // POI row
      if (idx >= poiBase && idx < poiBase + displayed) {
        const poi = state.screen.pois[offset + (idx - poiBase)]
        if (!poi) return noop(state)
        return next(state, { name: 'POI_DETAIL', poi })
      }
      const moreIdx = showMore ? poiBase + displayed : -1
      const refreshIdx = poiBase + displayed + (showMore ? 1 : 0)
      if (idx === moreIdx) {
        return reduce(state, { type: 'load-more' })
      }
      if (idx === refreshIdx) {
        return reduce(state, { type: 'refresh-pois' })
      }
      return noop(state)
    }

    case 'POI_DETAIL':
      // Single-tap opens the action menu. Actions are computed fresh
      // from the POI so OSM-only entries (no wiki/website) don't show
      // phantom slots in the cursor.
      return next(state, {
        name: 'POI_ACTIONS',
        poi: state.screen.poi,
        actions: actionsForPoi(state.screen.poi),
        cursorIndex: 0,
      })

    case 'POI_ACTIONS': {
      const action = state.screen.actions[state.screen.cursorIndex]
      if (!action) return noop(state)
      return executePoiDetailAction(state, state.screen.poi, action)
    }

    case 'WIKI_READ':
      // Tap returns to POI_DETAIL (the read-only view) — user can
      // re-tap from there to reach POI_ACTIONS again if they want.
      return next(state, { name: 'POI_DETAIL', poi: state.screen.fromPoi })

    case 'NAV_ACTIVE':
      // Tap stops navigation, returns to POI_DETAIL.
      return next(
        state,
        { name: 'POI_DETAIL', poi: state.screen.destination },
        [{ type: 'stop-nav-watch' }],
      )

    case 'CONFIRM_EXIT':
      // cursor 0 = "No, keep exploring", cursor 1 = "Yes, exit"
      if (state.screen.cursorIndex === 1) {
        return { state, effects: [{ type: 'exit-app' }] }
      }
      return next(state, state.screen.returnTo)

    case 'LOADING':
    case 'ERROR_LOCATION':
    case 'ERROR_NETWORK':
    case 'ERROR_EMPTY':
      return onRetry(state)
  }
}

function onBack(state: AppState): ReducerResult {
  switch (state.screen.name) {
    case 'POI_ACTIONS':
      // POI_ACTIONS is a sub-screen of POI_DETAIL; backing out returns
      // to the detail view rather than all the way to the list.
      return next(state, { name: 'POI_DETAIL', poi: state.screen.poi })

    case 'POI_DETAIL':
    case 'WIKI_READ':
    case 'ERROR_NETWORK':
      return applyPendingRefresh(state)

    case 'NAV_ACTIVE':
      return {
        ...applyPendingRefresh(state),
        effects: [{ type: 'stop-nav-watch' }],
      }

    case 'CONFIRM_EXIT':
      // Back from confirm = "No" — go back to where we came from.
      return next(state, state.screen.returnTo)

    case 'POI_LIST':
    case 'LOADING':
    case 'ERROR_LOCATION':
    case 'ERROR_EMPTY':
      // Top-level — bridge routes back/double-tap through `request-exit`
      // to surface the confirm-exit prompt instead.
      return noop(state)
  }
}

function onCursorMove(state: AppState, delta: number): ReducerResult {
  if (state.screen.name === 'POI_ACTIONS') {
    const max = state.screen.actions.length - 1
    const nextIndex = clamp(state.screen.cursorIndex + delta, 0, max)
    if (nextIndex === state.screen.cursorIndex) return noop(state)
    return next(state, { ...state.screen, cursorIndex: nextIndex })
  }
  if (state.screen.name === 'POI_LIST') {
    // Cursor walks across (Previous?) + POI rows + (More?) + Refresh.
    // Bounds derived from visible window only — cursor never leaves
    // what's painted on the firmware.
    const offset = state.screen.displayOffset ?? 0
    const remaining = state.screen.pois.length - offset
    const displayed = Math.min(Math.max(remaining, 0), LIST_DISPLAY_LIMIT)
    const showPrev = offset > 0
    const hasLocalMore = offset + LIST_DISPLAY_LIMIT < state.screen.pois.length
    const showMore = hasLocalMore || state.screen.hasMore
    const total = (showPrev ? 1 : 0) + displayed + (showMore ? 1 : 0) + 1
    const max = total - 1
    const cur = state.screen.cursorIndex ?? 0
    const nextIndex = clamp(cur + delta, 0, max)
    if (nextIndex === cur) return noop(state)
    return next(state, { ...state.screen, cursorIndex: nextIndex })
  }
  if (state.screen.name === 'WIKI_READ') {
    // Scroll advances pageIndex so users can read past the first page of
    // the Wikipedia article. Without this, "1/N" is shown but the user
    // is stuck on page 1 — regression observed 2026-04-24 sim run.
    const max = state.screen.article.pages.length - 1
    const nextIndex = clamp(state.screen.pageIndex + delta, 0, max)
    if (nextIndex === state.screen.pageIndex) return noop(state)
    return next(state, { ...state.screen, pageIndex: nextIndex })
  }
  if (state.screen.name === 'CONFIRM_EXIT') {
    const nextIndex = clamp(state.screen.cursorIndex + delta, 0, 1)
    if (nextIndex === state.screen.cursorIndex) return noop(state)
    return next(state, { ...state.screen, cursorIndex: nextIndex })
  }
  return noop(state)
}

function executePoiDetailAction(
  state: AppState,
  poi: Poi,
  action: PoiDetailAction,
): ReducerResult {
  switch (action) {
    case 'navigate':
      if (!state.position) {
        return next(state, {
          name: 'ERROR_LOCATION',
          message: 'Need GPS to start navigation',
        })
      }
      return {
        state,
        effects: [{ type: 'fetch-route', from: state.position, to: poi }],
      }
    case 'safari':
      return poi.websiteUrl
        ? { state, effects: [{ type: 'open-url', url: poi.websiteUrl }] }
        : noop(state)
    case 'read-more':
      if (!poi.wikiTitle) return noop(state)
      return {
        state,
        effects: [{ type: 'fetch-wiki', title: poi.wikiTitle, lang: state.settings.lang }],
      }
    case 'back':
      return applyPendingRefresh(state)
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

const ALL_CATEGORIES: Category[] = [
  'landmark', 'park', 'museum', 'religion', 'art', 'library', 'food', 'nightlife',
]

function actionsForPoi(poi: Poi): PoiDetailAction[] {
  const actions: PoiDetailAction[] = ['navigate']
  if (poi.websiteUrl) actions.push('safari')
  if (poi.wikiTitle) actions.push('read-more')
  actions.push('back')
  return actions
}

function applyPendingRefresh(state: AppState): ReducerResult {
  // If there's a pending refresh, prefer it; otherwise fall back to the
  // last-known list so back-navigation always lands on POI_LIST with the
  // freshest data we have.
  const pending = state.pendingPoiRefresh
  const pois = pending?.pois ?? state.poiList
  const hasMore = pending ? pending.hasMore : state.poiListHasMore
  return next(
    {
      ...state,
      poiList: pois,
      poiListHasMore: hasMore,
      pendingPoiRefresh: null,
    },
    { name: 'POI_LIST', pois, hasMore, displayOffset: 0, cursorIndex: 0 },
  )
}

function goLoading(state: AppState, effect: 'fetch-pois' | null): ReducerResult {
  return next(
    state,
    { name: 'LOADING', message: LOADING_MSG_GEOLOCATE },
    effect ? [{ type: effect, offset: 0, mode: 'replace' }] : [],
  )
}

function errorScreenForReason(reason: 'location' | 'network' | 'empty'): Screen {
  if (reason === 'location') {
    return { name: 'ERROR_LOCATION', message: 'Could not get your location' }
  }
  if (reason === 'empty') {
    return { name: 'ERROR_EMPTY', filtersAreNarrow: false }
  }
  return {
    name: 'ERROR_NETWORK',
    message: 'Network unavailable',
    retryAction: 'fetch-pois',
  }
}

/** Build a ReducerResult and validate the screen transition in dev. */
function next(state: AppState, screen: Screen, effects: Effect[] = []): ReducerResult {
  if (
    state.screen.name !== screen.name &&
    !canTransition(state.screen.name, screen.name)
  ) {
    // Throw in dev; in prod the bridge will catch and log. Phase 3 will
    // wire a softer fallback. For now, fail loudly so tests catch bugs.
    throw new Error(
      `Illegal screen transition: ${state.screen.name} → ${screen.name}`,
    )
  }
  return { state: { ...state, screen }, effects }
}

function noop(state: AppState): ReducerResult {
  return { state, effects: [] }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}
