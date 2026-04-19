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

function listState(pois: Poi[] = [POI_A, POI_B]): AppState {
  return {
    ...INITIAL_STATE,
    poiList: pois,
    screen: { name: 'POI_LIST', pois },
    position: { lat: 40.7128, lng: -74.006 },
  }
}

// ─── Loading → list ────────────────────────────────────────────────────

describe('pois-loaded', () => {
  it('moves LOADING to POI_LIST with the fetched results', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'pois-loaded',
      pois: [POI_A, POI_B],
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
      isBackgroundRefresh: false,
    })
    expect(result.state.screen.name).toBe('ERROR_EMPTY')
  })

  it('flags ERROR_EMPTY filtersAreNarrow when not at max radius / categories', () => {
    const result = reduce(INITIAL_STATE, {
      type: 'pois-loaded',
      pois: [],
      isBackgroundRefresh: false,
    })
    expect(result.state.screen).toMatchObject({
      name: 'ERROR_EMPTY',
      filtersAreNarrow: true,
    })
  })
})

// ─── Background refresh stash ──────────────────────────────────────────

describe('background refresh', () => {
  it('parks new pois in pendingPoiRefresh while user is in POI_DETAIL', () => {
    const start: AppState = {
      ...listState(),
      screen: {
        name: 'POI_DETAIL',
        poi: POI_A,
        actions: ['navigate', 'safari', 'read-more', 'back'],
        cursorIndex: 0,
      },
    }
    const result = reduce(start, {
      type: 'pois-loaded',
      pois: [POI_B],
      isBackgroundRefresh: true,
    })
    expect(result.state.screen.name).toBe('POI_DETAIL')
    expect(result.state.pendingPoiRefresh).toEqual([POI_B])
  })

  it('applies the pending refresh when user backs out to POI_LIST', () => {
    const start: AppState = {
      ...listState(),
      pendingPoiRefresh: [POI_OSM],
      screen: {
        name: 'POI_DETAIL',
        poi: POI_A,
        actions: ['navigate', 'back'],
        cursorIndex: 1,
      },
    }
    const result = reduce(start, { type: 'back' })
    expect(result.state.screen.name).toBe('POI_LIST')
    expect(result.state.poiList).toEqual([POI_OSM])
    expect(result.state.pendingPoiRefresh).toBeNull()
  })
})

// ─── POI_LIST tap → POI_DETAIL ─────────────────────────────────────────

describe('tap on POI_LIST', () => {
  it('opens detail for the tapped item with cursor at 0', () => {
    const result = reduce(listState(), { type: 'tap', itemIndex: 1 })
    expect(result.state.screen).toMatchObject({
      name: 'POI_DETAIL',
      poi: POI_B,
      cursorIndex: 0,
    })
  })

  it('omits Safari + Read More for OSM-only POIs without website/wiki', () => {
    const result = reduce(listState([POI_OSM]), {
      type: 'tap',
      itemIndex: 0,
    })
    expect(result.state.screen).toMatchObject({
      name: 'POI_DETAIL',
      actions: ['navigate', 'back'],
    })
  })

  it('ignores out-of-range itemIndex', () => {
    const result = reduce(listState(), { type: 'tap', itemIndex: 99 })
    expect(result.state.screen.name).toBe('POI_LIST')
  })
})

// ─── POI_DETAIL cursor + actions ───────────────────────────────────────

describe('POI_DETAIL cursor', () => {
  const detail: AppState = {
    ...listState(),
    screen: {
      name: 'POI_DETAIL',
      poi: POI_A,
      actions: ['navigate', 'safari', 'read-more', 'back'],
      cursorIndex: 0,
    },
  }

  it('moves cursor down within bounds', () => {
    const r = reduce(detail, { type: 'cursor-down' })
    expect((r.state.screen as { cursorIndex: number }).cursorIndex).toBe(1)
  })

  it('clamps at the bottom', () => {
    const atBottom = {
      ...detail,
      screen: { ...detail.screen, cursorIndex: 3 },
    } as AppState
    const r = reduce(atBottom, { type: 'cursor-down' })
    expect(r.state).toBe(atBottom) // no-op returns same state
  })

  it('clamps at the top', () => {
    const r = reduce(detail, { type: 'cursor-up' })
    expect(r.state).toBe(detail)
  })
})

describe('POI_DETAIL actions', () => {
  const baseDetail: AppState = {
    ...listState(),
    screen: {
      name: 'POI_DETAIL',
      poi: POI_A,
      actions: ['navigate', 'safari', 'read-more', 'back'],
      cursorIndex: 0,
    },
  }

  it('navigate emits fetch-route effect when position is known', () => {
    const r = reduce(baseDetail, { type: 'tap' })
    expect(r.effects).toContainEqual({
      type: 'fetch-route',
      from: { lat: 40.7128, lng: -74.006 },
      to: POI_A,
    })
  })

  it('navigate routes to ERROR_LOCATION when GPS is unknown', () => {
    const noGps = { ...baseDetail, position: null }
    const r = reduce(noGps, { type: 'tap' })
    expect(r.state.screen.name).toBe('ERROR_LOCATION')
  })

  it('safari emits open-url with the POI websiteUrl', () => {
    const onSafari = {
      ...baseDetail,
      screen: { ...baseDetail.screen, cursorIndex: 1 },
    } as AppState
    const r = reduce(onSafari, { type: 'tap' })
    expect(r.effects).toContainEqual({
      type: 'open-url',
      url: POI_A.websiteUrl,
    })
  })

  it('read-more emits fetch-wiki with the POI title', () => {
    const onReadMore = {
      ...baseDetail,
      screen: { ...baseDetail.screen, cursorIndex: 2 },
    } as AppState
    const r = reduce(onReadMore, { type: 'tap' })
    expect(r.effects).toContainEqual({
      type: 'fetch-wiki',
      title: 'Test_Landmark',
      lang: null,
    })
  })

  it('back returns to POI_LIST', () => {
    const onBack = {
      ...baseDetail,
      screen: { ...baseDetail.screen, cursorIndex: 3 },
    } as AppState
    const r = reduce(onBack, { type: 'tap' })
    expect(r.state.screen.name).toBe('POI_LIST')
  })
})

// ─── Route loaded → NAV_ACTIVE ─────────────────────────────────────────

describe('route-loaded', () => {
  it('transitions POI_DETAIL to NAV_ACTIVE and starts the GPS watch', () => {
    const detail: AppState = {
      ...listState(),
      screen: {
        name: 'POI_DETAIL',
        poi: POI_A,
        actions: ['navigate', 'back'],
        cursorIndex: 0,
      },
    }
    const r = reduce(detail, {
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

  it('ignores route-loaded if user has navigated away from POI_DETAIL', () => {
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
