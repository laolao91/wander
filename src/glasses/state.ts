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

// ─── Top-level state ───────────────────────────────────────────────────

export interface AppState {
  screen: Screen
  /** Last-known POI list, retained across detail/wiki/nav for back-nav. */
  poiList: Poi[]
  /** Last-known location. Refreshed on every fetch attempt. */
  position: { lat: number; lng: number } | null
  /** Pending refresh result while user is in non-POI_LIST screens. */
  pendingPoiRefresh: Poi[] | null
  settings: Settings
}

export const INITIAL_STATE: AppState = {
  screen: { name: 'LOADING', message: 'Finding what is around you' },
  poiList: [],
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
  // System events
  | { type: 'pois-loaded'; pois: Poi[]; isBackgroundRefresh: boolean }
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
  | { type: 'fetch-pois' }
  | { type: 'fetch-route'; from: { lat: number; lng: number }; to: Poi }
  | { type: 'fetch-wiki'; title: string; lang: string | null }
  | { type: 'open-url'; url: string }
  | { type: 'start-nav-watch' }
  | { type: 'stop-nav-watch' }

export interface ReducerResult {
  state: AppState
  effects: Effect[]
}

// ─── Reducer ───────────────────────────────────────────────────────────

export function reduce(state: AppState, event: Event): ReducerResult {
  switch (event.type) {
    case 'pois-loaded':
      return onPoisLoaded(state, event.pois, event.isBackgroundRefresh)

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
        effects: [{ type: 'fetch-pois' }],
      }

    case 'retry':
      return onRetry(state)

    case 'tap':
      return onTap(state, event.itemIndex)

    case 'back':
      return onBack(state)

    case 'cursor-up':
      return onCursorMove(state, -1)

    case 'cursor-down':
      return onCursorMove(state, +1)
  }
}

// ─── Per-event handlers ────────────────────────────────────────────────

function onPoisLoaded(
  state: AppState,
  pois: Poi[],
  isBackgroundRefresh: boolean,
): ReducerResult {
  if (pois.length === 0) {
    const filtersAreNarrow =
      state.settings.radiusMiles < 1.5 ||
      state.settings.categories.length < ALL_CATEGORIES.length
    return next(state, { name: 'ERROR_EMPTY', filtersAreNarrow })
  }

  // Background refresh: only swap the list in if user is on POI_LIST,
  // otherwise hold the new data until they navigate back.
  if (isBackgroundRefresh && state.screen.name !== 'POI_LIST') {
    return { state: { ...state, pendingPoiRefresh: pois }, effects: [] }
  }

  return next(
    { ...state, poiList: pois, pendingPoiRefresh: null },
    { name: 'POI_LIST', pois },
  )
}

function onRouteLoaded(state: AppState, route: Route): ReducerResult {
  if (state.screen.name !== 'POI_DETAIL') return noop(state)
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
  if (state.screen.name !== 'POI_DETAIL') return noop(state)
  return next(state, {
    name: 'WIKI_READ',
    fromPoi: state.screen.poi,
    article,
    pageIndex: 0,
  })
}

function onPositionUpdated(state: AppState, lat: number, lng: number): ReducerResult {
  const position = { lat, lng }
  if (state.screen.name !== 'NAV_ACTIVE') {
    return { state: { ...state, position }, effects: [] }
  }
  // Phase 3 proper will compute step advancement + arrival here.
  // Stub: just stash the position; geometry math goes in a helper later.
  return {
    state: { ...state, position, screen: { ...state.screen, position } },
    effects: [],
  }
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
      if (itemIndex == null) return noop(state)
      const poi = state.screen.pois[itemIndex]
      if (!poi) return noop(state)
      return next(state, {
        name: 'POI_DETAIL',
        poi,
        actions: actionsForPoi(poi),
        cursorIndex: 0,
      })
    }

    case 'POI_DETAIL': {
      const action = state.screen.actions[state.screen.cursorIndex]
      if (!action) return noop(state)
      return executePoiDetailAction(state, state.screen.poi, action)
    }

    case 'WIKI_READ':
      // Tap returns to POI_DETAIL.
      return next(state, {
        name: 'POI_DETAIL',
        poi: state.screen.fromPoi,
        actions: actionsForPoi(state.screen.fromPoi),
        cursorIndex: 0,
      })

    case 'NAV_ACTIVE':
      // Tap stops navigation, returns to POI_DETAIL.
      return next(
        state,
        {
          name: 'POI_DETAIL',
          poi: state.screen.destination,
          actions: actionsForPoi(state.screen.destination),
          cursorIndex: 0,
        },
        [{ type: 'stop-nav-watch' }],
      )

    case 'LOADING':
    case 'ERROR_LOCATION':
    case 'ERROR_NETWORK':
    case 'ERROR_EMPTY':
      return onRetry(state)
  }
}

function onBack(state: AppState): ReducerResult {
  switch (state.screen.name) {
    case 'POI_DETAIL':
    case 'WIKI_READ':
    case 'ERROR_NETWORK':
      return applyPendingRefresh(state)

    case 'NAV_ACTIVE':
      return {
        ...applyPendingRefresh(state),
        effects: [{ type: 'stop-nav-watch' }],
      }

    case 'POI_LIST':
    case 'LOADING':
    case 'ERROR_LOCATION':
    case 'ERROR_EMPTY':
      // Top-level screens — back is a no-op for the reducer; the bridge
      // interprets this as "exit app" via shutDownPageContainer.
      return noop(state)
  }
}

function onCursorMove(state: AppState, delta: number): ReducerResult {
  if (state.screen.name !== 'POI_DETAIL') return noop(state)
  const max = state.screen.actions.length - 1
  const nextIndex = clamp(state.screen.cursorIndex + delta, 0, max)
  if (nextIndex === state.screen.cursorIndex) return noop(state)
  return next(state, { ...state.screen, cursorIndex: nextIndex })
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
  const pois = state.pendingPoiRefresh ?? state.poiList
  return next(
    { ...state, poiList: pois, pendingPoiRefresh: null },
    { name: 'POI_LIST', pois },
  )
}

function goLoading(state: AppState, effect: 'fetch-pois' | null): ReducerResult {
  return next(
    state,
    { name: 'LOADING', message: 'Loading' },
    effect ? [{ type: effect }] : [],
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
