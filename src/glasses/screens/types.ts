/**
 * Screen state discriminated union for the glasses display.
 *
 * Per WANDER_BUILD_SPEC §6, the G2 cycles through 8 screens. Each one
 * carries the data it needs to render — putting the data on the screen
 * variant (rather than a flat AppState bag) makes invalid combinations
 * unrepresentable. The reducer in `../state.ts` returns one of these
 * variants and the bridge layer (Phase 3) renders accordingly.
 */

import type { Poi, Route, WikiArticle } from '../api'

export type ScreenName =
  | 'LOADING'
  | 'POI_LIST'
  | 'POI_DETAIL'
  | 'POI_ACTIONS'
  | 'NAV_ACTIVE'
  | 'WIKI_READ'
  | 'ERROR_LOCATION'
  | 'ERROR_NETWORK'
  | 'ERROR_EMPTY'
  | 'CONFIRM_EXIT'

/** "What is the glasses display showing?" — the only screen-shaped state. */
export type Screen =
  | LoadingScreen
  | PoiListScreen
  | PoiDetailScreen
  | PoiActionsScreen
  | NavActiveScreen
  | WikiReadScreen
  | ErrorLocationScreen
  | ErrorNetworkScreen
  | ErrorEmptyScreen
  | ConfirmExitScreen

export interface LoadingScreen {
  name: 'LOADING'
  message: string
}

export interface PoiListScreen {
  name: 'POI_LIST'
  pois: Poi[]
  /**
   * True when at least one more page exists past `pois.length` on the
   * server. Drives whether "More results" can fetch additional items
   * once the local window has scrolled past everything we've cached.
   * The "Refresh nearby" sentinel is always rendered.
   */
  hasMore: boolean
  /**
   * Phase E (2026-04-26): the firmware can't paint a 20-row list reliably
   * (BLE rebuild payload limit). We cap the visible slice to
   * LIST_DISPLAY_LIMIT and use this offset to scroll a window through
   * the locally-cached `pois` first, only hitting the server for a fresh
   * page once the window is past the end. Always >= 0; aligned to LIMIT
   * boundaries so the cursor math stays simple.
   */
  displayOffset: number
  /** Highlight cursor — relative to the visible window (0..LIMIT-1 + sentinels). */
  cursorIndex?: number
}

/**
 * Read-only detail view for one POI: title + metadata in the header,
 * wiki summary in the body. Single-tap advances to POI_ACTIONS where the
 * cursor lives; double-tap raises CONFIRM_EXIT. The detail screen
 * intentionally has no cursor — splitting actions out frees the header
 * from cramming line 2 and removes the action-vs-wiki scroll conflict
 * reported on 2026-04-20.
 */
export interface PoiDetailScreen {
  name: 'POI_DETAIL'
  poi: Poi
}

/**
 * Action menu for a POI. Cursor indexes into `actions`, which is
 * computed from the POI at tap time (Navigate always; Open in Safari
 * iff `poi.websiteUrl`; Read More iff `poi.wikiTitle`; Back to List
 * always). The set is collapsed so cursor bounds reflect exactly what's
 * rendered — no invisible slots.
 */
export interface PoiActionsScreen {
  name: 'POI_ACTIONS'
  poi: Poi
  actions: PoiDetailAction[]
  cursorIndex: number
}

export type PoiDetailAction = 'navigate' | 'safari' | 'read-more' | 'back'

export interface NavActiveScreen {
  name: 'NAV_ACTIVE'
  destination: Poi
  route: Route
  /** Index into `route.steps`. */
  currentStepIndex: number
  /** Last known user position — the bridge will update this every 10s. */
  position: { lat: number; lng: number } | null
  /** True once user is within the arrival radius (20m per spec §8). */
  arrived: boolean
}

export interface WikiReadScreen {
  name: 'WIKI_READ'
  /** The POI we came from — used to return on tap/scroll-top-at-page-0. */
  fromPoi: Poi
  article: WikiArticle
  pageIndex: number
}

export interface ErrorLocationScreen {
  name: 'ERROR_LOCATION'
  message: string
}

export interface ErrorNetworkScreen {
  name: 'ERROR_NETWORK'
  message: string
  /** Where to retry to — affects what the reducer dispatches on retry. */
  retryAction: 'fetch-pois' | 'fetch-route' | 'fetch-wiki'
}

export interface ErrorEmptyScreen {
  name: 'ERROR_EMPTY'
  /** True if the user can widen radius / change categories from settings. */
  filtersAreNarrow: boolean
}

/** Two-button "exit Wander?" prompt shown before shutdown. */
export interface ConfirmExitScreen {
  name: 'CONFIRM_EXIT'
  /** The screen we'd return to if the user picks "No". */
  returnTo: Screen
  /** 0 = "No, keep exploring" (default, safer), 1 = "Yes, exit". */
  cursorIndex: number
}

// ─── Settings (kept on AppState, surfaced into POI fetches) ────────────

export interface Settings {
  radiusMiles: number
  categories: import('../api').Category[]
  /** Optional locale override; null means "use Accept-Language". */
  lang: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  radiusMiles: 0.75,
  // Default to all 8 categories until the Phone Settings UI ships
  // (Phase 5-UI). Field-test 2026-04-25 §7 confirmed Settings is still
  // a placeholder, so the on-glass result set should be as wide as
  // possible by default.
  categories: [
    'landmark',
    'park',
    'museum',
    'religion',
    'art',
    'library',
    'food',
    'nightlife',
  ],
  lang: null,
}

// ─── Transition map (documentation + runtime guard) ────────────────────

/**
 * Allowed screen-to-screen transitions per spec §6 / §10. Used by the
 * reducer to reject invalid jumps in dev (cheap insurance against bugs
 * where the bridge dispatches the wrong event for the current screen).
 */
export const ALLOWED_TRANSITIONS: Record<ScreenName, ReadonlySet<ScreenName>> = {
  LOADING: new Set([
    'POI_LIST',
    'ERROR_LOCATION',
    'ERROR_NETWORK',
    'ERROR_EMPTY',
    'CONFIRM_EXIT',
  ]),
  POI_LIST: new Set([
    'POI_DETAIL',
    'LOADING', // refresh
    'ERROR_NETWORK',
    'ERROR_EMPTY',
    'CONFIRM_EXIT',
  ]),
  POI_DETAIL: new Set([
    'POI_ACTIONS', // single-tap opens the action menu
    'POI_LIST', // back (pending-refresh applied here)
    'ERROR_NETWORK', // failure routed back through the detail screen
  ]),
  POI_ACTIONS: new Set([
    'POI_DETAIL', // cancelling actions returns to the detail view
    'POI_LIST', // "Back to List" action (applyPendingRefresh)
    'NAV_ACTIVE', // navigate action → route-loaded
    'WIKI_READ', // read-more action → wiki-loaded
    'ERROR_NETWORK', // route/wiki failures
    'ERROR_LOCATION', // navigate tapped without GPS
  ]),
  NAV_ACTIVE: new Set([
    'POI_DETAIL', // tap to stop
    'POI_LIST', // double-tap to stop
    'ERROR_LOCATION', // GPS lost
  ]),
  WIKI_READ: new Set([
    'POI_DETAIL', // tap or scroll-top from page 0
  ]),
  ERROR_LOCATION: new Set(['LOADING', 'POI_LIST', 'CONFIRM_EXIT']),
  ERROR_NETWORK: new Set(['LOADING', 'POI_LIST', 'POI_DETAIL']),
  ERROR_EMPTY: new Set(['LOADING', 'POI_LIST', 'CONFIRM_EXIT']),
  // CONFIRM_EXIT can return to any top-level screen (returnTo), or the
  // bridge intercepts "yes" and shuts down the page container before the
  // reducer ever runs.
  CONFIRM_EXIT: new Set([
    'POI_LIST',
    'LOADING',
    'ERROR_LOCATION',
    'ERROR_EMPTY',
  ]),
}

export function canTransition(from: ScreenName, to: ScreenName): boolean {
  return ALLOWED_TRANSITIONS[from].has(to)
}
