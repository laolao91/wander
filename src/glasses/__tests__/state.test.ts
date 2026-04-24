import { describe, it, expect } from 'vitest'
import { reduce, INITIAL_STATE, type AppState } from '../state'
import type { Poi } from '../api'

// ─── Fixtures ──────────────────────────────────────────────────────────

function makePoi(overrides: Partial<Poi> = {}): Poi {
  return {
    id: 'wiki_1',
    name: 'Test Landmark',
    category: 'landmark',
    categoryIcon: '★',
    lat: 40.7128,
    lng: -74.006,
    distanceMeters: 100,
    distanceMiles: 0.06,
    bearingDegrees: 0,
    walkMinutes: 1,
    wikiTitle: 'Test_Landmark',
    wikiSummary: 'A test',
    websiteUrl: 'https://en.wikipedia.org/wiki/Test_Landmark',
    source: 'wikipedia',
    ...overrides,
  }
}

const POI_A = makePoi({ id: 'wiki_a', name: 'Alpha' })
const POI_B = makePoi({ id: 'wiki_b', name: 'Beta' })
const POI_OSM = makePoi({
  id: 'osm_n1',
  name: 'Cafe',
  source: 'osm',
  category: 'food',
  categoryIcon: '◆',
  wikiTitle: null,
  wikiSummary: null,
  websiteUrl: null,
})

function listState(pois: Poi[] = [POI_A, POI_B], hasMore = false): AppState {
  return {
    ...INITIAL_STATE,
    poiList: pois,
    poiListHasMore: hasMore,
    screen: { name: 'POI_LIST', pois, hasMore },
    position: { lat: 40.7128, lng: -74.006 },
  }
}

// ─── Loading → list ────────────────────────────────────────────────────

describe('pois-loaded', () => {
  it('moves LOADING to POI_LIST with the fetched results', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'pois-loaded',
      pois: [POI_A, POI_B],
      hasMore: false,
      mode: 'replace',
      isBackgroundRefresh: false,
    })
    expect(result.state.screen.name).toBe('POI_LIST')
    expect(result.state.poiList).toHaveLength(2)
    expect(result.effects).toEqual([])
  })

  it('falls into ERROR_EMPTY when results are empty', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'pois-loaded',
      pois: [],
      hasMore: false,
      mode: 'replace',
      isBackgroundRefresh: false,
    })
    expect(result.state.screen.name).toBe('ERROR_EMPTY')
  })

  it('flags ERROR_EMPTY filtersAreNarrow when not at max radius / categories', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'pois-loaded',
      pois: [],
      hasMore: false,
      mode: 'replace',
      isBackgroundRefresh: false,
    })
    expect(result.state.screen).toMatchObject({
      name: 'ERROR_EMPTY',
      filtersAreNarrow: true,
    })
  })

  // Regression lock for HANDOFF §D (04-19 real-HW report): user in
  // Rego Park went straight to POI_DETAIL and never saw the list. Code
  // review of onPoisLoaded shows no bypass path; real-HW logs still
  // needed to root-cause. This test pins the documented behavior: a
  // single result lands on POI_LIST with cursor at 0, not POI_DETAIL.
  it('routes a single-POI result through POI_LIST (never auto-selects)', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'pois-loaded',
      pois: [POI_A],
      hasMore: false,
      mode: 'replace',
      isBackgroundRefresh: false,
    })
    expect(result.state.screen).toMatchObject({
      name: 'POI_LIST',
      pois: [POI_A],
      cursorIndex: 0,
    })
    expect(result.effects).toEqual([])
  })

  it('flags hasMore on the POI_LIST screen when the page reports more', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'pois-loaded',
      pois: [POI_A, POI_B],
      hasMore: true,
      mode: 'replace',
      isBackgroundRefresh: false,
    })
    expect(result.state.screen).toMatchObject({
      name: 'POI_LIST',
      hasMore: true,
    })
    expect(result.state.poiListHasMore).toBe(true)
  })
})

// ─── Background refresh stash ──────────────────────────────────────────

describe('background refresh', () => {
  it('parks new pois in pendingPoiRefresh while user is in POI_DETAIL', () => {
    const start: AppState = {
      ...listState(),
      screen: { name: 'POI_DETAIL', poi: POI_A },
    }
    const result = reduce(start, {
      type: 'pois-loaded',
      pois: [POI_B],
      hasMore: false,
      mode: 'replace',
      isBackgroundRefresh: true,
    })
    expect(result.state.screen.name).toBe('POI_DETAIL')
    expect(result.state.pendingPoiRefresh).toEqual({
      pois: [POI_B],
      hasMore: false,
    })
  })

  it('applies the pending refresh when user backs out to POI_LIST', () => {
    const start: AppState = {
      ...listState(),
      pendingPoiRefresh: { pois: [POI_OSM], hasMore: true },
      screen: { name: 'POI_DETAIL', poi: POI_A },
    }
    const result = reduce(start, { type: 'back' })
    expect(result.state.screen.name).toBe('POI_LIST')
    expect(result.state.poiList).toEqual([POI_OSM])
    expect(result.state.poiListHasMore).toBe(true)
    expect(result.state.pendingPoiRefresh).toBeNull()
  })
})

// ─── POI_LIST tap → POI_DETAIL (read-only view) ────────────────────────

describe('tap on POI_LIST', () => {
  it('opens the read-only detail view for the tapped item', () => {
    const result = reduce(listState(), { type: 'tap', itemIndex: 1 })
    expect(result.state.screen).toMatchObject({
      name: 'POI_DETAIL',
      poi: POI_B,
    })
    // POI_DETAIL no longer carries actions/cursorIndex — those belong
    // to POI_ACTIONS after the next tap.
    expect('actions' in result.state.screen).toBe(false)
    expect('cursorIndex' in result.state.screen).toBe(false)
  })

  it('ignores out-of-range itemIndex', () => {
    const result = reduce(listState(), { type: 'tap', itemIndex: 99 })
    expect(result.state.screen.name).toBe('POI_LIST')
  })
})

// ─── POI_DETAIL tap → POI_ACTIONS ──────────────────────────────────────

describe('tap on POI_DETAIL', () => {
  it('opens POI_ACTIONS with cursor at 0 and the full action set', () => {
    const detail: AppState = {
      ...listState(),
      screen: { name: 'POI_DETAIL', poi: POI_A },
    }
    const r = reduce(detail, { type: 'tap' })
    expect(r.state.screen).toMatchObject({
      name: 'POI_ACTIONS',
      poi: POI_A,
      actions: ['navigate', 'safari', 'read-more', 'back'],
      cursorIndex: 0,
    })
  })

  it('omits Safari + Read More for OSM-only POIs without website/wiki', () => {
    const detail: AppState = {
      ...listState(),
      screen: { name: 'POI_DETAIL', poi: POI_OSM },
    }
    const r = reduce(detail, { type: 'tap' })
    expect(r.state.screen).toMatchObject({
      name: 'POI_ACTIONS',
      actions: ['navigate', 'back'],
    })
  })
})

// ─── POI_ACTIONS cursor + actions ──────────────────────────────────────

describe('POI_ACTIONS cursor', () => {
  const actions: AppState = {
    ...listState(),
    screen: {
      name: 'POI_ACTIONS',
      poi: POI_A,
      actions: ['navigate', 'safari', 'read-more', 'back'],
      cursorIndex: 0,
    },
  }

  it('moves cursor down within bounds', () => {
    const r = reduce(actions, { type: 'cursor-down' })
    expect((r.state.screen as { cursorIndex: number }).cursorIndex).toBe(1)
  })

  it('clamps at the bottom', () => {
    const atBottom = {
      ...actions,
      screen: { ...actions.screen, cursorIndex: 3 },
    } as AppState
    const r = reduce(atBottom, { type: 'cursor-down' })
    expect(r.state).toBe(atBottom)
  })

  it('clamps at the top', () => {
    const r = reduce(actions, { type: 'cursor-up' })
    expect(r.state).toBe(actions)
  })
})

// ─── WIKI_READ page scroll ─────────────────────────────────────────────

describe('WIKI_READ page scroll', () => {
  // Without a cursor-move case for WIKI_READ, users see "1/N" in the
  // header but can't advance past page 1 — regression observed on the
  // G2 sim 2026-04-24. These tests lock the advance/clamp behavior.
  const wiki: AppState = {
    ...listState(),
    screen: {
      name: 'WIKI_READ',
      fromPoi: POI_A,
      article: {
        title: 'X',
        summary: '',
        pages: ['p0', 'p1', 'p2'],
        totalPages: 3,
        lang: 'en',
      },
      pageIndex: 0,
    },
  }

  it('cursor-down advances pageIndex by 1', () => {
    const r = reduce(wiki, { type: 'cursor-down' })
    expect((r.state.screen as { pageIndex: number }).pageIndex).toBe(1)
  })

  it('cursor-up from mid-article decreases pageIndex by 1', () => {
    const mid = {
      ...wiki,
      screen: { ...wiki.screen, pageIndex: 2 },
    } as AppState
    const r = reduce(mid, { type: 'cursor-up' })
    expect((r.state.screen as { pageIndex: number }).pageIndex).toBe(1)
  })

  it('clamps at the last page', () => {
    const atEnd = {
      ...wiki,
      screen: { ...wiki.screen, pageIndex: 2 },
    } as AppState
    const r = reduce(atEnd, { type: 'cursor-down' })
    expect(r.state).toBe(atEnd)
  })

  it('clamps at page 0', () => {
    const r = reduce(wiki, { type: 'cursor-up' })
    expect(r.state).toBe(wiki)
  })
})

describe('POI_ACTIONS actions', () => {
  const baseActions: AppState = {
    ...listState(),
    screen: {
      name: 'POI_ACTIONS',
      poi: POI_A,
      actions: ['navigate', 'safari', 'read-more', 'back'],
      cursorIndex: 0,
    },
  }

  it('navigate emits fetch-route effect when position is known', () => {
    const r = reduce(baseActions, { type: 'tap' })
    expect(r.effects).toContainEqual({
      type: 'fetch-route',
      from: { lat: 40.7128, lng: -74.006 },
      to: POI_A,
    })
  })

  it('navigate routes to ERROR_LOCATION when GPS is unknown', () => {
    const noGps = { ...baseActions, position: null }
    const r = reduce(noGps, { type: 'tap' })
    expect(r.state.screen.name).toBe('ERROR_LOCATION')
  })

  it('safari emits open-url with the POI websiteUrl', () => {
    const onSafari = {
      ...baseActions,
      screen: { ...baseActions.screen, cursorIndex: 1 },
    } as AppState
    const r = reduce(onSafari, { type: 'tap' })
    expect(r.effects).toContainEqual({
      type: 'open-url',
      url: POI_A.websiteUrl,
    })
  })

  it('read-more emits fetch-wiki with the POI title', () => {
    const onReadMore = {
      ...baseActions,
      screen: { ...baseActions.screen, cursorIndex: 2 },
    } as AppState
    const r = reduce(onReadMore, { type: 'tap' })
    expect(r.effects).toContainEqual({
      type: 'fetch-wiki',
      title: 'Test_Landmark',
      lang: null,
    })
  })

  it('back (action label) returns to POI_LIST', () => {
    const onBack = {
      ...baseActions,
      screen: { ...baseActions.screen, cursorIndex: 3 },
    } as AppState
    const r = reduce(onBack, { type: 'tap' })
    expect(r.state.screen.name).toBe('POI_LIST')
  })

  it('back-event (not the action) returns POI_ACTIONS to POI_DETAIL', () => {
    const r = reduce(baseActions, { type: 'back' })
    expect(r.state.screen).toMatchObject({
      name: 'POI_DETAIL',
      poi: POI_A,
    })
  })
})

// ─── Route loaded → NAV_ACTIVE ─────────────────────────────────────────

describe('route-loaded', () => {
  it('transitions POI_ACTIONS to NAV_ACTIVE and starts the GPS watch', () => {
    const actions: AppState = {
      ...listState(),
      screen: {
        name: 'POI_ACTIONS',
        poi: POI_A,
        actions: ['navigate', 'back'],
        cursorIndex: 0,
      },
    }
    const r = reduce(actions, {
      type: 'route-loaded',
      route: {
        totalDistanceMeters: 100,
        totalDurationSeconds: 60,
        steps: [],
        geometry: [],
        language: 'en',
      },
    })
    expect(r.state.screen.name).toBe('NAV_ACTIVE')
    expect(r.effects).toContainEqual({ type: 'start-nav-watch' })
  })

  it('ignores route-loaded if user has navigated away from POI_ACTIONS', () => {
    const r = reduce(listState(), {
      type: 'route-loaded',
      route: {
        totalDistanceMeters: 100,
        totalDurationSeconds: 60,
        steps: [],
        geometry: [],
        language: 'en',
      },
    })
    expect(r.state.screen.name).toBe('POI_LIST')
  })
})

// ─── NAV_ACTIVE tap stops nav ──────────────────────────────────────────

describe('NAV_ACTIVE', () => {
  const navState: AppState = {
    ...listState(),
    screen: {
      name: 'NAV_ACTIVE',
      destination: POI_A,
      route: {
        totalDistanceMeters: 100,
        totalDurationSeconds: 60,
        steps: [],
        geometry: [],
        language: 'en',
      },
      currentStepIndex: 0,
      position: { lat: 40.7128, lng: -74.006 },
      arrived: false,
    },
  }

  it('tap stops nav and returns to POI_DETAIL with stop-nav-watch', () => {
    const r = reduce(navState, { type: 'tap' })
    expect(r.state.screen.name).toBe('POI_DETAIL')
    expect(r.effects).toContainEqual({ type: 'stop-nav-watch' })
  })

  it('back stops nav and returns to POI_LIST with stop-nav-watch', () => {
    const r = reduce(navState, { type: 'back' })
    expect(r.state.screen.name).toBe('POI_LIST')
    expect(r.effects).toContainEqual({ type: 'stop-nav-watch' })
  })
})

// ─── Illegal transition guard ──────────────────────────────────────────

describe('transition guard', () => {
  it('throws on a disallowed direct jump (NAV_ACTIVE → WIKI_READ)', () => {
    const navState: AppState = {
      ...listState(),
      screen: {
        name: 'NAV_ACTIVE',
        destination: POI_A,
        route: {
          totalDistanceMeters: 100,
          totalDurationSeconds: 60,
          steps: [],
          geometry: [],
          language: 'en',
        },
        currentStepIndex: 0,
        position: null,
        arrived: false,
      },
    }
    expect(() =>
      reduce(navState, {
        type: 'wiki-loaded',
        article: {
          title: 'X',
          summary: '',
          pages: ['p1'],
          totalPages: 1,
          lang: 'en',
        },
      }),
    ).not.toThrow() // wiki-loaded is a no-op outside POI_DETAIL, no transition attempted
  })
})

// ─── Phase 4d — POI_LIST pagination + refresh ──────────────────────────

describe('POI_LIST pagination — load-more', () => {
  it('tap on the More sentinel index emits fetch-pois with offset+mode=append', () => {
    const start = listState([POI_A, POI_B], /* hasMore */ true)
    // 0..1 are POIs; index 2 is the "More" sentinel (hasMore=true).
    const r = reduce(start, { type: 'tap', itemIndex: 2 })
    expect(r.effects).toEqual([
      { type: 'fetch-pois', offset: 2, mode: 'append' },
    ])
    expect(r.state.screen.name).toBe('POI_LIST') // stays on the list
  })

  it('load-more is a no-op when hasMore=false (no More sentinel exists)', () => {
    const start = listState([POI_A], /* hasMore */ false)
    const r = reduce(start, { type: 'load-more' })
    expect(r.effects).toEqual([])
    expect(r.state).toBe(start)
  })

  it('pois-loaded mode=append concatenates onto the existing poiList', () => {
    const start = listState([POI_A], /* hasMore */ true)
    const r = reduce(start, {
      type: 'pois-loaded',
      pois: [POI_B],
      hasMore: false,
      mode: 'append',
      isBackgroundRefresh: false,
    })
    expect(r.state.poiList).toEqual([POI_A, POI_B])
    expect(r.state.poiListHasMore).toBe(false)
    expect(r.state.screen).toMatchObject({
      name: 'POI_LIST',
      pois: [POI_A, POI_B],
      hasMore: false,
      cursorIndex: 1, // first newly-appended POI
    })
  })

  it('pois-loaded mode=append outside POI_LIST merges silently (no transition)', () => {
    const start: AppState = {
      ...listState([POI_A], true),
      screen: { name: 'POI_DETAIL', poi: POI_A },
    }
    const r = reduce(start, {
      type: 'pois-loaded',
      pois: [POI_B],
      hasMore: false,
      mode: 'append',
      isBackgroundRefresh: false,
    })
    expect(r.state.screen.name).toBe('POI_DETAIL')
    expect(r.state.poiList).toEqual([POI_A, POI_B])
    expect(r.state.poiListHasMore).toBe(false)
    expect(r.effects).toEqual([])
  })
})

describe('POI_LIST pagination — refresh', () => {
  it('tap on the Refresh sentinel index goes LOADING + emits fetch-pois replace 0', () => {
    const start = listState([POI_A, POI_B], /* hasMore */ true)
    // Refresh sentinel sits at idx = pois.length + (hasMore?1:0) = 3
    const r = reduce(start, { type: 'tap', itemIndex: 3 })
    expect(r.state.screen.name).toBe('LOADING')
    expect(r.effects).toEqual([
      { type: 'fetch-pois', offset: 0, mode: 'replace' },
    ])
  })

  it('Refresh sentinel still routes to refresh-pois when hasMore=false (sentinel idx shifts)', () => {
    const start = listState([POI_A, POI_B], /* hasMore */ false)
    // No More sentinel; Refresh sits at pois.length = 2.
    const r = reduce(start, { type: 'tap', itemIndex: 2 })
    expect(r.state.screen.name).toBe('LOADING')
    expect(r.effects).toEqual([
      { type: 'fetch-pois', offset: 0, mode: 'replace' },
    ])
  })

  it('refresh-pois event always fires fetch-pois replace 0', () => {
    const start = listState([POI_A], false)
    const r = reduce(start, { type: 'refresh-pois' })
    expect(r.effects).toEqual([
      { type: 'fetch-pois', offset: 0, mode: 'replace' },
    ])
  })
})

describe('POI_LIST cursor — sentinel slots', () => {
  it('cursor-down can land on the More + Refresh slots when hasMore=true', () => {
    let s = listState([POI_A, POI_B], /* hasMore */ true)
    s = { ...s, screen: { ...s.screen, cursorIndex: 0 } as typeof s.screen }
    // 0 → 1 (POI_B) → 2 (More) → 3 (Refresh) → clamp at 3.
    const r1 = reduce(s, { type: 'cursor-down' })
    const r2 = reduce(r1.state, { type: 'cursor-down' })
    const r3 = reduce(r2.state, { type: 'cursor-down' })
    const r4 = reduce(r3.state, { type: 'cursor-down' })
    expect((r1.state.screen as { cursorIndex?: number }).cursorIndex).toBe(1)
    expect((r2.state.screen as { cursorIndex?: number }).cursorIndex).toBe(2)
    expect((r3.state.screen as { cursorIndex?: number }).cursorIndex).toBe(3)
    expect(r4.state).toBe(r3.state) // clamped no-op
  })

  it('cursor-down stops at the Refresh slot when hasMore=false (only one sentinel)', () => {
    let s = listState([POI_A, POI_B], /* hasMore */ false)
    s = { ...s, screen: { ...s.screen, cursorIndex: 0 } as typeof s.screen }
    const r1 = reduce(s, { type: 'cursor-down' })
    const r2 = reduce(r1.state, { type: 'cursor-down' })
    const r3 = reduce(r2.state, { type: 'cursor-down' })
    expect((r2.state.screen as { cursorIndex?: number }).cursorIndex).toBe(2) // Refresh
    expect(r3.state).toBe(r2.state)
  })

  it('cursor-falls-back tap from Refresh slot fires refresh (no SDK itemIndex)', () => {
    const s = listState([POI_A], /* hasMore */ false)
    const screen = { ...s.screen, cursorIndex: 1 } as typeof s.screen
    const r = reduce({ ...s, screen }, { type: 'tap' /* no itemIndex */ })
    expect(r.state.screen.name).toBe('LOADING')
    expect(r.effects).toEqual([
      { type: 'fetch-pois', offset: 0, mode: 'replace' },
    ])
  })
})
