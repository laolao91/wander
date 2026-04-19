import { describe, it, expect } from 'vitest'
import {
  renderScreen,
  renderInPlaceUpdate,
  bearingToArrow,
  ID_MAIN,
  ID_BODY,
  ID_LIST,
} from '../render'
import type { Poi, Route } from '../api'
import type { Screen } from '../screens/types'

// ─── Fixtures ──────────────────────────────────────────────────────────

function makePoi(overrides: Partial<Poi> = {}): Poi {
  return {
    id: 'wiki_1',
    name: 'Central Park Reservoir',
    category: 'park',
    categoryIcon: '★',
    lat: 40.7851,
    lng: -73.9683,
    distanceMeters: 480,
    distanceMiles: 0.3,
    bearingDegrees: 45,
    walkMinutes: 6,
    wikiTitle: 'Central_Park_Reservoir',
    wikiSummary: 'A 106-acre body of water in the middle of Central Park.',
    websiteUrl: 'https://en.wikipedia.org/wiki/Central_Park_Reservoir',
    source: 'wikipedia',
    ...overrides,
  }
}

const POI_OSM = makePoi({
  id: 'osm_n1',
  name: 'Cafe',
  category: 'food',
  categoryIcon: '◆',
  wikiTitle: null,
  wikiSummary: null,
  websiteUrl: null,
  source: 'osm',
  distanceMiles: 0.05,
})

const ROUTE: Route = {
  totalDistanceMeters: 480,
  totalDurationSeconds: 360,
  steps: [
    {
      instruction: 'Head north on 5th Ave',
      distanceMeters: 200,
      durationSeconds: 150,
      maneuverType: 'depart',
      street: '5th Ave',
    },
  ],
  geometry: [
    [40.7700, -73.9700],
    [40.7851, -73.9683],
  ],
  language: 'en',
}

// ─── bearingToArrow ────────────────────────────────────────────────────

describe('bearingToArrow', () => {
  it('maps the 8 cardinals to the matching arrow', () => {
    expect(bearingToArrow(0)).toBe('↑')
    expect(bearingToArrow(45)).toBe('↗')
    expect(bearingToArrow(90)).toBe('→')
    expect(bearingToArrow(135)).toBe('↘')
    expect(bearingToArrow(180)).toBe('↓')
    expect(bearingToArrow(225)).toBe('↙')
    expect(bearingToArrow(270)).toBe('←')
    expect(bearingToArrow(315)).toBe('↖')
  })

  it('snaps near-cardinal values into the right sector', () => {
    expect(bearingToArrow(22)).toBe('↑') // just under the NE boundary
    expect(bearingToArrow(23)).toBe('↗') // just over
    expect(bearingToArrow(359)).toBe('↑') // wraps back to N
  })

  it('normalizes negative and out-of-range degrees', () => {
    expect(bearingToArrow(-90)).toBe('←')
    expect(bearingToArrow(450)).toBe('→') // 450 mod 360 = 90
    expect(bearingToArrow(720)).toBe('↑') // exact 0
  })
})

// ─── renderScreen: LOADING ─────────────────────────────────────────────

describe('renderScreen LOADING', () => {
  it('returns a single text container with the message and WANDER title', () => {
    const out = renderScreen({ name: 'LOADING', message: 'Finding nearby spots…' })
    expect(out.containerTotalNum).toBe(1)
    expect(out.textObject).toHaveLength(1)
    expect(out.textObject?.[0].containerID).toBe(ID_MAIN)
    expect(out.textObject?.[0].content).toContain('WANDER')
    expect(out.textObject?.[0].content).toContain('Finding nearby spots…')
  })
})

// ─── renderScreen: POI_LIST ────────────────────────────────────────────

describe('renderScreen POI_LIST', () => {
  it('returns a list container with one item per POI (capped at 20)', () => {
    const pois = Array.from({ length: 25 }, (_, i) =>
      makePoi({ id: `wiki_${i}`, name: `POI ${i}` }),
    )
    const out = renderScreen({ name: 'POI_LIST', pois })
    expect(out.containerTotalNum).toBe(1)
    expect(out.listObject).toHaveLength(1)
    const list = out.listObject?.[0]
    expect(list?.containerID).toBe(ID_LIST)
    expect(list?.itemContainer?.itemCount).toBe(20)
    expect(list?.itemContainer?.itemName).toHaveLength(20)
  })

  it('formats list lines as "icon name ... distance"', () => {
    const out = renderScreen({ name: 'POI_LIST', pois: [makePoi()] })
    const line = out.listObject?.[0].itemContainer?.itemName?.[0] ?? ''
    expect(line).toContain('★')
    expect(line).toContain('Central Park Reservoir')
    expect(line).toContain('0.3 mi')
  })

  it('formats <0.1 mi distances in feet', () => {
    const out = renderScreen({ name: 'POI_LIST', pois: [POI_OSM] })
    const line = out.listObject?.[0].itemContainer?.itemName?.[0] ?? ''
    expect(line).toContain('264 ft') // 0.05 * 5280 = 264
  })
})

// ─── renderScreen: POI_DETAIL ──────────────────────────────────────────

describe('renderScreen POI_DETAIL', () => {
  const screen: Screen = {
    name: 'POI_DETAIL',
    poi: makePoi(),
    actions: ['navigate', 'safari', 'read-more', 'back'],
    cursorIndex: 0,
  }

  it('returns a 2-container header+body layout', () => {
    const out = renderScreen(screen)
    expect(out.containerTotalNum).toBe(2)
    expect(out.textObject).toHaveLength(2)
    expect(out.textObject?.[0].containerID).toBe(ID_MAIN)
    expect(out.textObject?.[1].containerID).toBe(ID_BODY)
  })

  it('header carries name + category + distance + walk time', () => {
    const header = renderScreen(screen).textObject?.[0].content ?? ''
    expect(header).toContain('Central Park Reservoir')
    expect(header).toContain('park')
    expect(header).toContain('0.3 mi')
    expect(header).toContain('~6 min')
  })

  it('body shows wiki summary and all 4 actions', () => {
    const body = renderScreen(screen).textObject?.[1].content ?? ''
    expect(body).toContain('106-acre body of water')
    expect(body).toContain('Navigate')
    expect(body).toContain('Open in Safari')
    expect(body).toContain('Read More')
    expect(body).toContain('Back to List')
  })

  it('places the cursor `>` prefix on the active action', () => {
    const body =
      renderScreen({ ...screen, cursorIndex: 2 }).textObject?.[1].content ?? ''
    expect(body).toMatch(/> Read More/)
    expect(body).toMatch(/ {2}Navigate/)
  })

  it('shows "(No description available.)" for OSM-only POIs without a wiki summary', () => {
    const out = renderScreen({
      name: 'POI_DETAIL',
      poi: POI_OSM,
      actions: ['navigate', 'back'],
      cursorIndex: 0,
    })
    expect(out.textObject?.[1].content).toContain('(No description available.)')
  })
})

// ─── renderScreen: NAV_ACTIVE ──────────────────────────────────────────

describe('renderScreen NAV_ACTIVE', () => {
  const baseNav: Extract<Screen, { name: 'NAV_ACTIVE' }> = {
    name: 'NAV_ACTIVE',
    destination: makePoi(),
    route: ROUTE,
    currentStepIndex: 0,
    position: { lat: 40.7700, lng: -73.9700 },
    arrived: false,
  }

  it('returns header + body containers with destination in header', () => {
    const out = renderScreen(baseNav)
    expect(out.containerTotalNum).toBe(2)
    expect(out.textObject?.[0].content).toContain('Central Park Reservoir')
  })

  it('body shows arrow, distance, and current step instruction', () => {
    const body = renderScreen(baseNav).textObject?.[1].content ?? ''
    // Should contain one of the 8 arrows
    expect(body).toMatch(/[↑↗→↘↓↙←↖]/)
    expect(body).toContain('Head north on 5th Ave')
    expect(body).toContain('on 5th Ave')
  })

  it('falls back to total route distance when position is null', () => {
    const out = renderScreen({ ...baseNav, position: null })
    expect(out.textObject?.[1].content).toContain('480 m')
  })

  it('shows "You have arrived!" when arrived is true', () => {
    const body = renderScreen({ ...baseNav, arrived: true }).textObject?.[1].content ?? ''
    expect(body).toContain('You have arrived!')
    expect(body).toContain('Tap to return')
  })

  it('formats distance in km when over 1000m', () => {
    const farPoi = makePoi({ lat: 40.85, lng: -73.85 })
    const out = renderScreen({
      ...baseNav,
      destination: farPoi,
      position: { lat: 40.7700, lng: -73.9700 },
    })
    expect(out.textObject?.[1].content).toMatch(/\d+\.\d{2} km/)
  })
})

// ─── renderScreen: WIKI_READ ───────────────────────────────────────────

describe('renderScreen WIKI_READ', () => {
  const wikiScreen: Screen = {
    name: 'WIKI_READ',
    fromPoi: makePoi(),
    article: {
      title: 'Central Park Reservoir',
      summary: 'short summary',
      pages: ['First page text.', 'Second page text.', 'Third page text.'],
      totalPages: 3,
      lang: 'en',
    },
    pageIndex: 1,
  }

  it('header includes title and "page/total" indicator', () => {
    const header = renderScreen(wikiScreen).textObject?.[0].content ?? ''
    expect(header).toContain('Central Park Reservoir')
    expect(header).toContain('2/3')
  })

  it('body renders the current page text', () => {
    const body = renderScreen(wikiScreen).textObject?.[1].content ?? ''
    expect(body).toBe('Second page text.')
  })
})

// ─── renderScreen: ERROR_* ─────────────────────────────────────────────

describe('renderScreen ERROR screens', () => {
  it('ERROR_LOCATION shows the message and retry/exit hints', () => {
    const out = renderScreen({ name: 'ERROR_LOCATION', message: 'GPS unavailable' })
    expect(out.containerTotalNum).toBe(1)
    const c = out.textObject?.[0].content ?? ''
    expect(c).toContain('Need location access')
    expect(c).toContain('GPS unavailable')
    expect(c).toContain('Tap to retry')
  })

  it('ERROR_NETWORK shows the message and retry hint', () => {
    const out = renderScreen({
      name: 'ERROR_NETWORK',
      message: 'Lost connection',
      retryAction: 'fetch-pois',
    })
    expect(out.textObject?.[0].content).toContain('Network error')
    expect(out.textObject?.[0].content).toContain('Lost connection')
  })

  it('ERROR_EMPTY filtersAreNarrow=true suggests widening', () => {
    const out = renderScreen({ name: 'ERROR_EMPTY', filtersAreNarrow: true })
    expect(out.textObject?.[0].content).toContain('widening your radius')
  })

  it('ERROR_EMPTY filtersAreNarrow=false suggests moving instead', () => {
    const out = renderScreen({ name: 'ERROR_EMPTY', filtersAreNarrow: false })
    expect(out.textObject?.[0].content).toContain('Try moving and refresh.')
  })
})

// ─── renderInPlaceUpdate ───────────────────────────────────────────────

describe('renderInPlaceUpdate', () => {
  it('returns null for screens without an in-place update path', () => {
    expect(renderInPlaceUpdate({ name: 'LOADING', message: 'x' })).toBeNull()
    expect(renderInPlaceUpdate({ name: 'POI_LIST', pois: [] })).toBeNull()
    expect(
      renderInPlaceUpdate({ name: 'ERROR_LOCATION', message: 'x' }),
    ).toBeNull()
    expect(
      renderInPlaceUpdate({ name: 'ERROR_EMPTY', filtersAreNarrow: true }),
    ).toBeNull()
  })

  it('returns a body-targeted upgrade for POI_DETAIL', () => {
    const u = renderInPlaceUpdate({
      name: 'POI_DETAIL',
      poi: makePoi(),
      actions: ['navigate', 'safari', 'read-more', 'back'],
      cursorIndex: 1,
    })
    expect(u).not.toBeNull()
    expect(u?.containerID).toBe(ID_BODY)
    expect(u?.content).toMatch(/> Open in Safari/)
  })

  it('returns the new page text for WIKI_READ', () => {
    const u = renderInPlaceUpdate({
      name: 'WIKI_READ',
      fromPoi: makePoi(),
      article: {
        title: 'X',
        summary: '',
        pages: ['p0', 'p1'],
        totalPages: 2,
        lang: 'en',
      },
      pageIndex: 1,
    })
    expect(u?.containerID).toBe(ID_BODY)
    expect(u?.content).toBe('p1')
  })

  it('returns the new nav body for NAV_ACTIVE position updates', () => {
    const u = renderInPlaceUpdate({
      name: 'NAV_ACTIVE',
      destination: makePoi(),
      route: ROUTE,
      currentStepIndex: 0,
      position: { lat: 40.7700, lng: -73.9700 },
      arrived: false,
    })
    expect(u?.containerID).toBe(ID_BODY)
    expect(u?.content).toMatch(/[↑↗→↘↓↙←↖]/)
  })
})
