import { describe, it, expect } from 'vitest'
import {
  renderScreen,
  renderInPlaceUpdate,
  bearingToArrow,
  bearingToCardinal,
  etaMinutes,
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
    {
      instruction: 'Turn left onto 86th St',
      distanceMeters: 280,
      durationSeconds: 210,
      maneuverType: 'turn-left',
      street: '86th St',
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

// ─── bearingToCardinal ─────────────────────────────────────────────────

describe('bearingToCardinal', () => {
  it('maps each of the 8 cardinals to its 2-letter label', () => {
    expect(bearingToCardinal(0)).toBe('N')
    expect(bearingToCardinal(45)).toBe('NE')
    expect(bearingToCardinal(90)).toBe('E')
    expect(bearingToCardinal(135)).toBe('SE')
    expect(bearingToCardinal(180)).toBe('S')
    expect(bearingToCardinal(225)).toBe('SW')
    expect(bearingToCardinal(270)).toBe('W')
    expect(bearingToCardinal(315)).toBe('NW')
  })

  it('centres each sector on the cardinal (±22.5° boundary)', () => {
    expect(bearingToCardinal(22)).toBe('N')
    expect(bearingToCardinal(23)).toBe('NE')
    expect(bearingToCardinal(359)).toBe('N')
  })

  it('normalizes negative and out-of-range degrees', () => {
    expect(bearingToCardinal(-90)).toBe('W')
    expect(bearingToCardinal(450)).toBe('E')
    expect(bearingToCardinal(720)).toBe('N')
  })
})

// ─── etaMinutes ────────────────────────────────────────────────────────

describe('etaMinutes', () => {
  it('converts remaining meters to walking minutes at ~84 m/min', () => {
    expect(etaMinutes(84)).toBe(1)
    expect(etaMinutes(420)).toBe(5)
    expect(etaMinutes(840)).toBe(10)
  })

  it('never returns less than 1 minute (avoids "~0 min" while still en route)', () => {
    expect(etaMinutes(0)).toBe(1)
    expect(etaMinutes(10)).toBe(1)
    expect(etaMinutes(41)).toBe(1) // rounds to 0, floored to 1
  })
})

// ─── renderScreen: LOADING ─────────────────────────────────────────────

describe('renderScreen LOADING', () => {
  it('returns a single text container with the message and WANDER title', () => {
    const out = renderScreen({ name: 'LOADING', message: 'Finding nearby spots..' })
    expect(out.containerTotalNum).toBe(1)
    expect(out.textObject).toHaveLength(1)
    expect(out.textObject?.[0].containerID).toBe(ID_MAIN)
    expect(out.textObject?.[0].content).toContain('WANDER')
    expect(out.textObject?.[0].content).toContain('Finding nearby spots..')
  })

  it('includes a thin rule between WANDER and the subtitle (mockup parity §2 C4)', () => {
    const out = renderScreen({ name: 'LOADING', message: 'x' })
    const content = out.textObject?.[0].content ?? ''
    // Thin rule is U+2500 (─), not U+2501 (━) — matches the mockup's
    // lighter visual weight.
    expect(content).toMatch(/─{4,}/)
    expect(content).not.toMatch(/━/)
  })
})

// ─── Truncation uses ASCII ".." (teardown §7-4) ────────────────────────

describe('truncate via renderer', () => {
  // The G2's LVGL fixed font has no glyph for U+2026 and renders it
  // as an empty box. Truncation must produce the ASCII equivalent ("..")
  // instead. This regression-locks the substitution at every surface
  // where the renderer truncates — POI list item names, detail header,
  // nav header, wiki header.
  it('POI_LIST item names use ".." not U+2026 when clipped', () => {
    const longName = 'A'.repeat(80)
    const out = renderScreen({
      name: 'POI_LIST',
      hasMore: false,
      pois: [
        {
          id: 'x',
          name: longName,
          category: 'park',
          categoryIcon: '★',
          lat: 0,
          lng: 0,
          distanceMeters: 100,
          distanceMiles: 0.1,
          bearingDegrees: 0,
          walkMinutes: 1,
          wikiTitle: null,
          wikiSummary: null,
          websiteUrl: null,
          source: 'osm',
        },
      ],
    })
    const rendered = JSON.stringify(out)
    expect(rendered).not.toContain('\u2026')
    // The truncated name ends with our ASCII replacement.
    expect(rendered).toContain('..')
  })
})

// ─── renderScreen: POI_LIST ────────────────────────────────────────────

describe('renderScreen POI_LIST', () => {
  it('returns a list container with POI rows + Refresh sentinel (no More when hasMore=false)', () => {
    const pois = Array.from({ length: 25 }, (_, i) =>
      makePoi({ id: `wiki_${i}`, name: `POI ${i}` }),
    )
    // Phase D 2026-04-25: POI rows are clipped to LIST_DISPLAY_LIMIT (8)
    // by the renderer to keep the BLE rebuild payload small. When local
    // state has more items than displayed, a "More results" sentinel
    // appears even if hasMore=false at the server level.
    const out = renderScreen({ name: 'POI_LIST', pois, hasMore: false })
    expect(out.containerTotalNum).toBe(1)
    expect(out.listObject).toHaveLength(1)
    const list = out.listObject?.[0]
    expect(list?.containerID).toBe(ID_LIST)
    // 8 displayed pois + More sentinel (local-overflow) + Refresh sentinel
    expect(list?.itemContainer?.itemCount).toBe(10)
    expect(list?.itemContainer?.itemName).toHaveLength(10)
    expect(list?.itemContainer?.itemName?.[8]).toContain('More')
    expect(list?.itemContainer?.itemName?.[9]).toContain('Refresh')
  })

  it('appends a "More results" sentinel when hasMore=true', () => {
    const pois = [makePoi(), makePoi({ id: 'wiki_2', name: 'POI 2' })]
    const out = renderScreen({ name: 'POI_LIST', pois, hasMore: true })
    const items = out.listObject?.[0].itemContainer?.itemName ?? []
    expect(items).toHaveLength(4) // 2 pois + More + Refresh
    expect(items[2]).toContain('More')
    expect(items[3]).toContain('Refresh')
  })

  it('omits the More sentinel when hasMore=false', () => {
    const pois = [makePoi()]
    const out = renderScreen({ name: 'POI_LIST', pois, hasMore: false })
    const items = out.listObject?.[0].itemContainer?.itemName ?? []
    expect(items).toHaveLength(2) // 1 poi + Refresh only
    expect(items.some((s: string) => s.includes('More'))).toBe(false)
    expect(items[1]).toContain('Refresh')
  })

  it('marks the cursor on a sentinel when cursorIndex points past the pois', () => {
    const pois = [makePoi()]
    const out = renderScreen({
      name: 'POI_LIST',
      pois,
      hasMore: true,
      cursorIndex: 1, // first sentinel ("More")
    })
    const items = out.listObject?.[0].itemContainer?.itemName ?? []
    // pois[0] not selected; More selected; Refresh not.
    expect(items[0].startsWith('> ')).toBe(false)
    expect(items[1].startsWith('> ')).toBe(true)
    expect(items[2].startsWith('> ')).toBe(false)
  })

  it('formats list lines as "icon name ... distance"', () => {
    const out = renderScreen({ name: 'POI_LIST', pois: [makePoi()], hasMore: false })
    const line = out.listObject?.[0].itemContainer?.itemName?.[0] ?? ''
    expect(line).toContain('★')
    expect(line).toContain('Central Park Reservoir')
    expect(line).toContain('0.3 mi')
  })

  it('formats <0.1 mi distances in feet', () => {
    const out = renderScreen({ name: 'POI_LIST', pois: [POI_OSM], hasMore: false })
    const line = out.listObject?.[0].itemContainer?.itemName?.[0] ?? ''
    expect(line).toContain('264 ft') // 0.05 * 5280 = 264
  })
})

// ─── renderScreen: POI_DETAIL ──────────────────────────────────────────

describe('renderScreen POI_DETAIL', () => {
  const screen: Screen = { name: 'POI_DETAIL', poi: makePoi() }

  it('returns a 2-container header+body layout', () => {
    const out = renderScreen(screen)
    expect(out.containerTotalNum).toBe(2)
    expect(out.textObject).toHaveLength(2)
    expect(out.textObject?.[0].containerID).toBe(ID_MAIN)
    expect(out.textObject?.[1].containerID).toBe(ID_BODY)
  })

  it('header is 72px tall so line 2 (metadata row) does not clip', () => {
    // Regression lock for the 2026-04-19 / 2026-04-20 line-2 truncation
    // bug — HEADER_HEIGHT=48 was too tight for 2 rendered lines on the
    // G2's non-monospace fixed font.
    const out = renderScreen(screen)
    expect(out.textObject?.[0].height).toBe(72)
  })

  it('header carries name + category + distance + walk time', () => {
    const header = renderScreen(screen).textObject?.[0].content ?? ''
    expect(header).toContain('Central Park Reservoir')
    expect(header).toContain('park')
    expect(header).toContain('0.3 mi')
    expect(header).toContain('~6 min')
  })

  it('header subtitle includes a cardinal bearing label (mockup parity §2 C2)', () => {
    // Mockup format: "★ Landmark · 0.3 mi NW · ~6 min walk" — bearing
    // sits next to the distance so the user has a quick compass hint.
    // Fixture bearing is 45° (NE).
    const header = renderScreen(screen).textObject?.[0].content ?? ''
    expect(header).toMatch(/0\.3 mi NE/)
  })

  it('bearing label tracks the POI bearing value', () => {
    const header = renderScreen({
      name: 'POI_DETAIL',
      poi: makePoi({ bearingDegrees: 270 }),
    }).textObject?.[0].content ?? ''
    expect(header).toMatch(/0\.3 mi W/)
  })

  it('body shows wiki summary and a "Tap for options" hint (no action menu)', () => {
    const body = renderScreen(screen).textObject?.[1].content ?? ''
    expect(body).toContain('106-acre body of water')
    expect(body).toContain('Tap for options')
    // Action labels moved to POI_ACTIONS — they must NOT appear here.
    expect(body).not.toContain('Navigate')
    expect(body).not.toContain('Open on Phone')
    expect(body).not.toContain('Read More')
    expect(body).not.toContain('Back to List')
  })

  it('shows "(No description available.)" for OSM-only POIs without a wiki summary', () => {
    const out = renderScreen({ name: 'POI_DETAIL', poi: POI_OSM })
    expect(out.textObject?.[1].content).toContain('(No description available.)')
  })
})

// ─── renderScreen: POI_ACTIONS ─────────────────────────────────────────

describe('renderScreen POI_ACTIONS', () => {
  const screen: Screen = {
    name: 'POI_ACTIONS',
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

  it('header is title-only (no metadata row competing for space)', () => {
    const out = renderScreen(screen)
    expect(out.textObject?.[0].height).toBe(48)
    const header = out.textObject?.[0].content ?? ''
    expect(header).toContain('Central Park Reservoir')
    // Metadata fields stay on the detail screen — don't duplicate here.
    expect(header).not.toContain('0.3 mi')
    expect(header).not.toContain('~6 min')
  })

  it('body lists all 4 actions with the cursor on the first by default', () => {
    const body = renderScreen(screen).textObject?.[1].content ?? ''
    expect(body).toMatch(/> Navigate/)
    expect(body).toContain('Open on Phone')
    expect(body).toContain('Read More')
    expect(body).toContain('Back to List')
  })

  it('places the cursor `>` prefix on the active action', () => {
    const body =
      renderScreen({ ...screen, cursorIndex: 2 }).textObject?.[1].content ?? ''
    expect(body).toMatch(/> Read More/)
    expect(body).toMatch(/ {2}Navigate/)
  })

  it('renders a collapsed 2-action set for OSM-only POIs', () => {
    const out = renderScreen({
      name: 'POI_ACTIONS',
      poi: POI_OSM,
      actions: ['navigate', 'back'],
      cursorIndex: 0,
    })
    const body = out.textObject?.[1].content ?? ''
    expect(body).toContain('Navigate')
    expect(body).toContain('Back to List')
    expect(body).not.toContain('Open on Phone')
    expect(body).not.toContain('Read More')
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

  it('returns header + body + minimap containers with destination in header', () => {
    const out = renderScreen(baseNav)
    expect(out.containerTotalNum).toBe(3)
    expect(out.textObject?.[0].content).toContain('Central Park Reservoir')
    // Image container (minimap) is the third container — bridge fills
    // it in via updateImageRawData after the rebuild lands.
    expect(out.imageObject).toHaveLength(1)
    expect(out.imageObject?.[0].containerName).toBe('nav-minimap')
  })

  it('header is 72px tall so line 2 (↓ category) does not clip', () => {
    // Mirrors the POI_DETAIL regression lock: a 48px header clips the
    // second rendered line on the G2's non-monospace fixed font (real-HW
    // regression 2026-04-24, sim confirmed same session). If you lower
    // this, line 2 clips again.
    const header = renderScreen(baseNav).textObject?.[0]
    expect(header?.height).toBe(72)
    // Body starts where the header ends.
    expect(renderScreen(baseNav).textObject?.[1].yPosition).toBe(72)
  })

  it('body separator is narrow enough to render as a single line in the nav column', () => {
    // NAV body content width = 328px; at 20px/glyph, max 16 bars fit.
    // Previously 24 bars (480px) wrapped to 2 lines — fixed 2026-04-28.
    const body = renderScreen(baseNav).textObject?.[1].content ?? ''
    // No 17+ run of the heavy-rule glyph (would exceed 328px).
    expect(body).not.toMatch(/━{17}/)
    // The separator is still present (16 runs is intentional).
    expect(body).toMatch(/━{16}/)
  })

  it('second line shows ETA + cardinal bearing (mockup parity §2 C3 — 3-stat row)', () => {
    // Line 1 is arrow + distance (DISTANCE stat). Line 2 completes the
    // 3-stat row: ETA + BEARING. Together: DISTANCE / ETA / BEARING.
    const body = renderScreen(baseNav).textObject?.[1].content ?? ''
    expect(body).toMatch(/~\d+ min\s+·\s+[NSEW]{1,2}/)
  })

  it('shows a "Next:" preview line when a next step exists', () => {
    const body = renderScreen(baseNav).textObject?.[1].content ?? ''
    // Fixture has 2 steps; current step index = 0, so the preview should
    // surface the second step's instruction.
    expect(body).toContain('Next: Turn left onto 86th St')
  })

  it('omits the "Next:" preview on the last step', () => {
    const body = renderScreen({
      ...baseNav,
      currentStepIndex: 1, // last step in the 2-step fixture
    }).textObject?.[1].content ?? ''
    expect(body).not.toMatch(/Next:/)
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
    // 480 m → 0.30 mi (imperial display per field-test 2026-04-24)
    expect(out.textObject?.[1].content).toMatch(/0\.30 mi/)
  })

  it('shows "You have arrived!" when arrived is true', () => {
    const body = renderScreen({ ...baseNav, arrived: true }).textObject?.[1].content ?? ''
    expect(body).toContain('You have arrived!')
    expect(body).toContain('Tap to return')
  })

  it('formats long distances in miles', () => {
    const farPoi = makePoi({ lat: 40.85, lng: -73.85 })
    const out = renderScreen({
      ...baseNav,
      destination: farPoi,
      position: { lat: 40.7700, lng: -73.9700 },
    })
    // Imperial display: anything ≥ 0.1 mi shows as "N.NN mi"
    expect(out.textObject?.[1].content).toMatch(/\d+\.\d{2} mi/)
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
    expect(
      renderInPlaceUpdate({ name: 'POI_LIST', pois: [], hasMore: false }),
    ).toBeNull()
    expect(
      renderInPlaceUpdate({ name: 'ERROR_LOCATION', message: 'x' }),
    ).toBeNull()
    expect(
      renderInPlaceUpdate({ name: 'ERROR_EMPTY', filtersAreNarrow: true }),
    ).toBeNull()
  })

  it('returns null for POI_DETAIL (now a static read-only view)', () => {
    expect(renderInPlaceUpdate({ name: 'POI_DETAIL', poi: makePoi() })).toBeNull()
  })

  it('returns a body-targeted upgrade for POI_ACTIONS cursor moves', () => {
    const u = renderInPlaceUpdate({
      name: 'POI_ACTIONS',
      poi: makePoi(),
      actions: ['navigate', 'safari', 'read-more', 'back'],
      cursorIndex: 1,
    })
    expect(u).not.toBeNull()
    expect(u?.containerID).toBe(ID_BODY)
    expect(u?.content).toMatch(/> Open on Phone/)
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
