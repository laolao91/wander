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
  RetryContext,
} from './screens/types'
import { canTransition, DEFAULT_SETTINGS } from './screens/types'
import { LIST_DISPLAY_LIMIT } from './render'
import { haversine } from './geo'

// ─── Top-level state ───────────────────────────────────────────────────

export interface AppState {
  screen: Screen
  /** Last-known POI list, retained across detail/wiki/nav for back-nav. */
  poiList: Poi[]
  /** Whether `/api/poi` flagged a further page available past `poiList`. */
  poiListHasMore: boolean
  /** Last-known location. Refreshed on every fetch attempt. */
  position: { lat: number; lng: number } | null
  /** When `poiList` was last fetched from the server, as epoch ms. */
  lastFetchTs: number | null
  /** Pending refresh result while user is in non-POI_LIST screens. */
  pendingPoiRefresh: { pois: Poi[]; hasMore: boolean; fetchedAt: number | null } | null
  settings: Settings
  favorites: Poi[]
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
  lastFetchTs: null,
  pendingPoiRefresh: null,
  settings: DEFAULT_SETTINGS,
  favorites: [],
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
      /** When this page was fetched, as epoch ms — origin: effects.ts. */
      fetchedAt?: number | null
    }
  | { type: 'pois-failed'; reason: 'location' | 'network' | 'empty' }
  | { type: 'route-loaded'; route: Route }
  | { type: 'route-failed'; from: { lat: number; lng: number }; to: Poi }
  | { type: 'wiki-loaded'; article: WikiArticle }
  | { type: 'wiki-failed'; title: string; lang: string | null }
  | { type: 'position-updated'; lat: number; lng: number; heading?: number | null; source?: 'gps' | 'manual' }
  | { type: 'settings-changed'; settings: Partial<Settings> }
  | { type: 'retry' }
  | { type: 'favorite-toggled'; poi: Poi }
  | { type: 'favorites-loaded'; favorites: Poi[] }

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
  | { type: 'save-favorites'; favorites: Poi[] }

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
        event.fetchedAt ?? null,
      )

    case 'pois-failed':
      return next(state, errorScreenForReason(event.reason))

    case 'route-loaded':
      return onRouteLoaded(state, event.route)

    case 'route-failed': {
      // Identity-check against the *current* screen's POI, not just its
      // name: the fetch stays in flight while the originating screen
      // stays put (executePoiDetailAction / NAV_ACTIVE reroute don't
      // change screens while their effect runs), so the user can back out
      // and land on a *different* POI_ACTIONS/NAV_ACTIVE before this
      // stale fetch resolves. Without the id check we'd attach a
      // retryContext pairing the right-looking current screen with the
      // wrong (stale) retry target — a silent wrong-destination retry,
      // worse than the dead end this task set out to fix. No match ->
      // undefined -> onRetry's existing POI_LIST fallback.
      let retryContext: RetryContext | undefined
      if (state.screen.name === 'POI_ACTIONS' && state.screen.poi.id === event.to.id) {
        retryContext = { kind: 'fetch-route', screen: state.screen, from: event.from, to: event.to }
      } else if (state.screen.name === 'NAV_ACTIVE' && state.screen.destination.id === event.to.id) {
        retryContext = { kind: 'fetch-route', screen: state.screen, from: event.from, to: event.to }
      }
      return next(state, {
        name: 'ERROR_NETWORK',
        message: 'Could not load directions',
        retryAction: 'fetch-route',
        retryContext,
      })
    }

    case 'wiki-loaded':
      return onWikiLoaded(state, event.article)

    case 'wiki-failed': {
      // Same staleness hazard as route-failed above, but identity here is
      // wikiTitle (the thing that actually determined what was fetched),
      // not poi.id — a POI could theoretically share nothing else, but
      // wikiTitle is what fetch-wiki keyed on.
      const retryContext: RetryContext | undefined =
        state.screen.name === 'POI_ACTIONS' && state.screen.poi.wikiTitle === event.title
          ? { kind: 'fetch-wiki', screen: state.screen, title: event.title, lang: event.lang }
          : undefined
      return next(state, {
        name: 'ERROR_NETWORK',
        message: 'Could not load article',
        retryAction: 'fetch-wiki',
        retryContext,
      })
    }

    case 'position-updated':
      return onPositionUpdated(state, event.lat, event.lng, event.heading ?? null, event.source ?? 'gps')

    case 'settings-changed': {
      // Display-only fields don't affect what gets fetched (params, sort,
      // limit) — skip the refetch when that's the only thing that
      // *actually changed*, to avoid a burst of redundant fetches during
      // rapid settings changes (Wander_v2_Research.md M6). `units` is the
      // only such field today. `lang` deliberately does NOT join this list
      // (Task 18 / L8) — it changes what language POI/wiki/route requests
      // ask the server for, so a lang-only change must still refetch.
      //
      // This must diff *values* (current vs. next), not just check which
      // keys are present in `event.settings` — bridge.ts's
      // handleSettingsChanged forwards the complete Settings snapshot on
      // every change (radiusMiles/categories are always present,
      // unconditionally), so a key-presence check would see all keys on
      // every call and never skip the refetch in production, even when
      // only units actually changed.
      //
      // Every field besides `units` must appear in this conjunction (as an
      // "unchanged" check) — otherwise a simultaneous units + $otherField
      // change (e.g. the very first settings-hydrated broadcast after boot,
      // which can carry multiple real diffs from DEFAULT_SETTINGS at once)
      // would be misclassified as "only units changed" and silently skip a
      // refetch that field's own change legitimately needs. `lang` is
      // included here for exactly that reason.
      const nextSettings = { ...state.settings, ...event.settings }
      const onlyUnitsChanged =
        state.settings.units !== nextSettings.units &&
        state.settings.radiusMiles === nextSettings.radiusMiles &&
        sameCategories(state.settings.categories, nextSettings.categories) &&
        state.settings.sort === nextSettings.sort &&
        state.settings.maxResults === nextSettings.maxResults &&
        state.settings.lang === nextSettings.lang &&
        sameManualLocation(state.settings.manualLocation, nextSettings.manualLocation)
      return {
        state: { ...state, settings: nextSettings },
        effects: onlyUnitsChanged ? [] : [{ type: 'fetch-pois', offset: 0, mode: 'replace' }],
      }
    }

    case 'retry':
      return onRetry(state)

    case 'favorite-toggled':
      return onFavoriteToggled(state, event.poi)

    case 'favorites-loaded':
      return { state: { ...state, favorites: event.favorites }, effects: [] }

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
  }
}

// ─── Per-event handlers ────────────────────────────────────────────────

function onPoisLoaded(
  state: AppState,
  pois: Poi[],
  hasMore: boolean,
  mode: 'replace' | 'append',
  isBackgroundRefresh: boolean,
  fetchedAt: number | null,
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
      lastFetchTs: fetchedAt,
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
        lastFetchTs: fetchedAt,
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
      state: { ...state, pendingPoiRefresh: { pois, hasMore, fetchedAt } },
      effects: [],
    }
  }

  return next(
    {
      ...state,
      poiList: pois,
      poiListHasMore: hasMore,
      pendingPoiRefresh: null,
      lastFetchTs: fetchedAt,
    },
    { name: 'POI_LIST', pois, hasMore, displayOffset: 0, cursorIndex: 0, lastFetchTs: fetchedAt },
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
  if (state.screen.name === 'POI_ACTIONS') {
    // Initial navigation: enter NAV_ACTIVE and start the GPS watch.
    return next(
      state,
      {
        name: 'NAV_ACTIVE',
        destination: state.screen.poi,
        route,
        currentStepIndex: 0,
        position: state.position,
        arrived: false,
        heading: null,
      },
      [{ type: 'start-nav-watch' }],
    )
  }
  if (state.screen.name === 'NAV_ACTIVE') {
    // Re-route (tap in NAV_ACTIVE): update the route in-place without
    // restarting the GPS watch — it's already running.
    return next(state, { ...state.screen, route, currentStepIndex: 0, arrived: false })
  }
  // User navigated away before the route landed — drop it.
  return noop(state)
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

function onPositionUpdated(
  state: AppState,
  lat: number,
  lng: number,
  heading: number | null,
  source: 'gps' | 'manual' = 'gps',
): ReducerResult {
  const position = { lat, lng }

  if (state.screen.name === 'NAV_ACTIVE' && source === 'manual') {
    // A manual-location fix is a pinned search origin, not a real GPS
    // reading. The 5-minute background refresh timer runs regardless of
    // screen and would otherwise teleport the nav position/heading (and
    // could spuriously trigger arrival) using stale pin coords. Ignore
    // entirely while navigating — the GPS watch (source: 'gps') is the
    // sole legitimate position feed during NAV_ACTIVE. See
    // Wander_v2_Research.md M1.
    return noop(state)
  }

  if (state.screen.name === 'NAV_ACTIVE') {
    const screen = state.screen
    // GPS heading reads null when the device is stationary — keep showing
    // the last known direction arrow rather than flickering it away.
    const nextHeading = heading ?? screen.heading ?? null

    // Arrival: within 20m of destination → mark arrived, stop GPS watch.
    const distToDest = haversine(lat, lng, screen.destination.lat, screen.destination.lng)
    if (distToDest < 20) {
      return {
        state: { ...state, position, screen: { ...screen, position, arrived: true, heading: nextHeading } },
        effects: [{ type: 'stop-nav-watch' }],
      }
    }

    // Step advancement: within 25m of current step's endPoint → advance index.
    const step = screen.route.steps[screen.currentStepIndex]
    let nextStepIndex = screen.currentStepIndex
    if (
      step?.endPoint !== null &&
      step?.endPoint !== undefined &&
      screen.currentStepIndex < screen.route.steps.length - 1
    ) {
      const distToStepEnd = haversine(lat, lng, step.endPoint[0], step.endPoint[1])
      if (distToStepEnd < 25) {
        nextStepIndex = screen.currentStepIndex + 1
      }
    }

    return {
      state: {
        ...state,
        position,
        screen: { ...screen, position, currentStepIndex: nextStepIndex, heading: nextHeading },
      },
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
    case 'ERROR_NETWORK': {
      const { retryAction, retryContext } = state.screen
      if (retryAction === 'fetch-pois') {
        return goLoading(state, 'fetch-pois')
      }
      if (retryAction === 'fetch-route' && retryContext?.kind === 'fetch-route') {
        return next(state, retryContext.screen, [
          { type: 'fetch-route', from: retryContext.from, to: retryContext.to },
        ])
      }
      if (retryAction === 'fetch-wiki' && retryContext?.kind === 'fetch-wiki') {
        return next(state, retryContext.screen, [
          { type: 'fetch-wiki', title: retryContext.title, lang: retryContext.lang },
        ])
      }
      // Defensive fallback — no context to restore (user navigated away
      // before the failure landed). Return to the list rather than
      // dead-ending; matches onBack's existing ERROR_NETWORK handling.
      return applyPendingRefresh(state)
    }
    case 'ERROR_LOCATION':
    case 'ERROR_EMPTY':
      return goLoading(state, 'fetch-pois')
    default:
      return noop(state)
  }
}

function onFavoriteToggled(state: AppState, poi: Poi): ReducerResult {
  const alreadySaved = state.favorites.some(f => f.id === poi.id)
  const nextFavorites = alreadySaved
    ? state.favorites.filter(f => f.id !== poi.id)
    : [...state.favorites, poi]
  const nextState = { ...state, favorites: nextFavorites }
  const saveEffect: Effect = { type: 'save-favorites', favorites: nextFavorites }
  // Rebuild POI_ACTIONS so the ★ Save / ★ Saved label flips immediately.
  if (state.screen.name === 'POI_ACTIONS') {
    return next(
      nextState,
      { ...state.screen, actions: actionsForPoi(state.screen.poi, nextFavorites) },
      [saveEffect],
    )
  }
  return { state: nextState, effects: [saveEffect] }
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
        actions: actionsForPoi(state.screen.poi, state.favorites),
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
      // Tap re-routes from current GPS position — useful when the user
      // has made a wrong turn and needs fresh directions. The GPS watch
      // keeps running; onRouteLoaded updates the route in-place.
      if (!state.position) {
        return next(state, { name: 'ERROR_LOCATION', message: 'Need GPS to reroute' }, [
          { type: 'stop-nav-watch' },
        ])
      }
      return {
        state,
        effects: [{ type: 'fetch-route', from: state.position, to: state.screen.destination }],
      }

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
      // POI_ACTIONS is a sub-screen of POI_DETAIL; backing out (double-tap)
      // returns to the detail view rather than all the way to the list.
      return next(state, { name: 'POI_DETAIL', poi: state.screen.poi })

    case 'POI_DETAIL':
    case 'ERROR_NETWORK':
      // Back from detail / network error → POI_LIST (applying any pending refresh).
      return applyPendingRefresh(state)

    case 'WIKI_READ':
      // Back from wiki → POI_DETAIL (not the full list). The user was
      // reading about a POI; backing out returns them to that POI's detail.
      return next(state, { name: 'POI_DETAIL', poi: state.screen.fromPoi })

    case 'NAV_ACTIVE':
      // Back from navigation → POI_DETAIL. Route is implicitly discarded
      // by leaving NAV_ACTIVE; a fresh tap on "Navigate" will re-fetch it.
      return next(
        state,
        { name: 'POI_DETAIL', poi: state.screen.destination },
        [{ type: 'stop-nav-watch' }],
      )

    case 'POI_LIST':
    case 'LOADING':
    case 'ERROR_LOCATION':
    case 'ERROR_EMPTY':
      // Top-level — nowhere to go back to, so exit the app.
      // shutDownPageContainer(1) shows EvenHub's native confirmation dialog.
      return { state, effects: [{ type: 'exit-app' }] }
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
    case 'favorite-add':
    case 'favorite-remove':
      return reduce(state, { type: 'favorite-toggled', poi })
    case 'close':
      // Dismiss the action menu and return to the POI detail view.
      return next(state, { name: 'POI_DETAIL', poi })
    case 'back':
      return applyPendingRefresh(state)
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

const ALL_CATEGORIES: Category[] = [
  'landmark', 'park', 'museum', 'religion', 'art', 'library', 'food', 'nightlife',
]

function actionsForPoi(poi: Poi, favorites: Poi[]): PoiDetailAction[] {
  const actions: PoiDetailAction[] = ['navigate']
  if (poi.websiteUrl) actions.push('safari')
  if (poi.wikiTitle) actions.push('read-more')
  const isFav = favorites.some(f => f.id === poi.id)
  actions.push(isFav ? 'favorite-remove' : 'favorite-add')
  // 'close' dismisses the action menu and returns to POI_DETAIL.
  // 'back' goes all the way back to POI_LIST.
  actions.push('close')
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
  const lastFetchTs = pending ? pending.fetchedAt : state.lastFetchTs
  return next(
    {
      ...state,
      poiList: pois,
      poiListHasMore: hasMore,
      pendingPoiRefresh: null,
      lastFetchTs,
    },
    { name: 'POI_LIST', pois, hasMore, displayOffset: 0, cursorIndex: 0, lastFetchTs },
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

/**
 * Order-independent set comparison for `Settings.categories`. The phone
 * side re-appends a category to the end of `enabledCategories` when it's
 * re-enabled (see `src/phone/state.ts`'s `toggleCategory`), rather than
 * re-sorting into canonical order — so the same logical set of enabled
 * categories can legitimately arrive in a different order across two
 * `settings-changed` events. A reference/array-order comparison would
 * treat that as a "change" and defeat the units-only fetch-skip in
 * `reduce`'s `settings-changed` case.
 */
function sameCategories(a: readonly Category[], b: readonly Category[]): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  return b.every((c) => setA.has(c))
}

/** Value comparison for `Settings.manualLocation` (object-or-null). */
function sameManualLocation(
  a: { lat: number; lng: number } | null,
  b: { lat: number; lng: number } | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.lat === b.lat && a.lng === b.lng
}

