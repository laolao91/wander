/**
 * Pure render helpers — turn a `Screen` value from the reducer into
 * SDK container payloads (RebuildPageContainer / TextContainerUpgrade).
 *
 * No SDK side-effects here — the bridge invokes the SDK with whatever
 * these functions return. Keeping render pure makes it unit-testable
 * (snapshot the resulting container shape) and means a future swap
 * to a different display protocol just touches one file.
 */

import {
  ImageContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import type { Poi } from './api'
import type { Screen, PoiDetailAction } from './screens/types'
import { MINIMAP_HEIGHT, MINIMAP_WIDTH } from './minimap'

// ─── Display constants (G2 hardware) ───────────────────────────────────

export const DISPLAY_WIDTH = 576
export const DISPLAY_HEIGHT = 288
const HEADER_HEIGHT = 48
const BODY_Y = HEADER_HEIGHT
const BODY_HEIGHT = DISPLAY_HEIGHT - HEADER_HEIGHT
// Two-line headers (POI_DETAIL + NAV_ACTIVE) need a taller strip so
// line 2 — the "★ landmark · 0.2 mi · ~4 min" metadata row on detail,
// or the "↓ category" row under the destination name on nav — doesn't
// clip on the G2's non-monospace fixed font. Clipping confirmed at
// HEADER_HEIGHT=48 in real-HW (2026-04-19 POI_DETAIL, 2026-04-24
// NAV_ACTIVE) and simulator (2026-04-20 + 2026-04-24) testing.
const TWO_LINE_HEADER_HEIGHT = 72
const POI_DETAIL_HEADER_HEIGHT = TWO_LINE_HEADER_HEIGHT
const POI_DETAIL_BODY_Y = POI_DETAIL_HEADER_HEIGHT
const POI_DETAIL_BODY_HEIGHT = DISPLAY_HEIGHT - POI_DETAIL_HEADER_HEIGHT
const NAV_HEADER_HEIGHT = TWO_LINE_HEADER_HEIGHT
const NAV_BODY_Y = NAV_HEADER_HEIGHT
const NAV_BODY_HEIGHT = DISPLAY_HEIGHT - NAV_HEADER_HEIGHT

/** Approx char width at the G2's standard font; used for centering math. */
const CHARS_PER_LINE = 65
/** NAV_ACTIVE body is the narrower left column (≈58% of full width). */
const NAV_BODY_CHARS_PER_LINE = 38

// Container IDs — stable across rebuilds so textContainerUpgrade can target.
export const ID_MAIN = 1
export const ID_BODY = 2
export const ID_LIST = 3
/** NAV_ACTIVE only — the minimap image container. */
export const ID_MAP = 4

// NAV_ACTIVE two-column layout: text on the left, minimap on the right.
const NAV_TEXT_WIDTH = DISPLAY_WIDTH - MINIMAP_WIDTH // 336
const NAV_MAP_X = NAV_TEXT_WIDTH // 336
// Vertically centre the map inside the body area (8px above the rule
// the simulator screenshots show, 8px below the bottom hint).
const NAV_MAP_Y = NAV_BODY_Y + Math.floor((NAV_BODY_HEIGHT - MINIMAP_HEIGHT) / 2)

const RULE = '━'.repeat(40)
// NAV_ACTIVE's body column is only ≈38 chars wide — a 40-char RULE wraps
// into 2-3 stacked bars at the bottom of the screen (confirmed
// 2026-04-24 sim screenshot). Use a narrower rule in the nav body so
// the separator renders as a single line.
const NAV_RULE = '━'.repeat(24)
// LOADING uses a thinner rule between WANDER and the subtitle per the
// mockup's visual weight — `─` (U+2500) rather than `━` (U+2501).
// See HANDOFF.md §2 C4.
const LOADING_RULE = '─'.repeat(9)

// ─── Public: Screen → SDK payload ──────────────────────────────────────

export function renderScreen(screen: Screen): RebuildPageContainer {
  switch (screen.name) {
    case 'LOADING':
      return singleText(
        centeredBlock(['', '', 'WANDER', LOADING_RULE, '', screen.message]),
      )

    case 'POI_LIST':
      return renderPoiList(screen.pois, screen.hasMore, screen.cursorIndex ?? 0)

    case 'CONFIRM_EXIT':
      return singleText(
        centeredBlock([
          '',
          'Exit Wander?',
          '',
          '',
          screen.cursorIndex === 1 ? '  No, keep exploring' : '> No, keep exploring',
          screen.cursorIndex === 1 ? '> Yes, exit' : '  Yes, exit',
          '',
          '',
          'Tap to confirm  ·  scroll to switch',
        ]),
      )

    case 'POI_DETAIL':
      return renderPoiDetail(screen.poi)

    case 'POI_ACTIONS':
      return renderPoiActions(screen.poi, screen.actions, screen.cursorIndex)

    case 'NAV_ACTIVE':
      return renderNavActive(screen)

    case 'WIKI_READ':
      return renderWikiRead(screen.article.title, screen.article.pages, screen.pageIndex)

    case 'ERROR_LOCATION':
      return singleText(
        centeredBlock([
          '',
          'Need location access',
          RULE,
          '',
          screen.message,
          '',
          '> Tap to retry',
          '  Double-tap to exit',
        ]),
      )

    case 'ERROR_NETWORK':
      return singleText(
        centeredBlock([
          '',
          'Network error',
          RULE,
          '',
          screen.message,
          '',
          '> Tap to retry',
          '  Double-tap to exit',
        ]),
      )

    case 'ERROR_EMPTY':
      return singleText(
        centeredBlock([
          '',
          'Nothing nearby',
          RULE,
          '',
          screen.filtersAreNarrow
            ? 'Try widening your radius or'
            : 'No POIs in range.',
          screen.filtersAreNarrow ? 'enabling more categories.' : 'Try moving and refresh.',
          '',
          '> Tap to retry',
          '  Double-tap to exit',
        ]),
      )
  }
}

/**
 * Build a TextContainerUpgrade for in-place updates that don't change
 * the screen layout. Used for:
 *   - POI_DETAIL cursor moves (just rewriting the body's action menu)
 *   - WIKI_READ page flips (just rewriting the body's page text)
 *   - NAV_ACTIVE position updates (just rewriting the body's heading/distance)
 *
 * Returns null when the screen has no in-place-updatable container.
 */
export function renderInPlaceUpdate(screen: Screen): TextContainerUpgrade | null {
  switch (screen.name) {
    case 'POI_ACTIONS':
      // In-place upgrade for cursor moves on the action menu — cheaper
      // than a full rebuild since only the body text changes.
      return new TextContainerUpgrade({
        containerID: ID_BODY,
        containerName: 'actions-body',
        content: actionsBodyText(screen.actions, screen.cursorIndex),
      })

    case 'WIKI_READ':
      return new TextContainerUpgrade({
        containerID: ID_BODY,
        containerName: 'wiki-body',
        content: wikiBodyText(screen.article.pages, screen.pageIndex),
      })

    case 'NAV_ACTIVE':
      return new TextContainerUpgrade({
        containerID: ID_BODY,
        containerName: 'nav-body',
        content: navBodyText(screen),
      })

    default:
      return null
  }
}

// ─── Per-screen renderers ──────────────────────────────────────────────

function renderPoiList(
  pois: Poi[],
  hasMore: boolean,
  cursorIndex: number,
): RebuildPageContainer {
  // POI rows + optional "More" sentinel + always-on "Refresh" sentinel.
  // Sentinel indices are pinned to (pois.length, pois.length+hasMore?1:0)
  // so the reducer's tap routing matches; see onTap POI_LIST in state.ts.
  const items: string[] = pois.slice(0, 20).map((p, i) =>
    poiListLine(p, i === cursorIndex),
  )
  if (hasMore) {
    const idx = pois.length
    items.push(sentinelLine('▼ More results', idx === cursorIndex))
  }
  const refreshIdx = pois.length + (hasMore ? 1 : 0)
  items.push(sentinelLine('↻ Refresh nearby', refreshIdx === cursorIndex))
  return new RebuildPageContainer({
    containerTotalNum: 1,
    listObject: [
      new ListContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: ID_LIST,
        containerName: 'poi-list',
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: items.length,
          itemWidth: 560,
          isItemSelectBorderEn: 1,
          itemName: items,
        }),
      }),
    ],
  })
}

function sentinelLine(label: string, isCursor: boolean): string {
  // Single-line sentinel — POI rows are two-line (name + metadata),
  // so the sentinel sits visually flush after the last item.
  const cursor = isCursor ? '> ' : '  '
  return `${cursor}${label}`
}

function poiListLine(p: Poi, isCursor: boolean): string {
  // Two lines per item — name on top, distance + walk time below (left-
  // aligned). G2 fonts aren't monospace so true right-alignment via space
  // padding looks ragged; stacking is cleaner and easier to read.
  const cursor = isCursor ? '> ' : '  '
  const name = truncate(p.name, 50)
  const distance = formatDistance(p.distanceMiles)
  return `${cursor}${p.categoryIcon} ${name}\n     ${distance}  ·  ~${p.walkMinutes} min`
}

function renderPoiDetail(poi: Poi): RebuildPageContainer {
  return new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: POI_DETAIL_HEADER_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: ID_MAIN,
        containerName: 'detail-header',
        isEventCapture: 0,
        content: detailHeaderText(poi),
      }),
      new TextContainerProperty({
        xPosition: 0,
        yPosition: POI_DETAIL_BODY_Y,
        width: DISPLAY_WIDTH,
        height: POI_DETAIL_BODY_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: ID_BODY,
        containerName: 'detail-body',
        isEventCapture: 1,
        content: detailBodyText(poi),
      }),
    ],
  })
}

function detailHeaderText(poi: Poi): string {
  // Mockup subtitle format: "★ Landmark · 0.3 mi NW · ~6 min walk"
  // (HANDOFF.md §2 C2). The bearing label sits next to the distance so
  // the user has a quick compass hint before they even open nav.
  const dist = `${formatDistance(poi.distanceMiles)} ${bearingToCardinal(poi.bearingDegrees)}`
  const min = `~${poi.walkMinutes} min`
  return `${truncate(poi.name, CHARS_PER_LINE)}\n${poi.categoryIcon} ${poi.category}  ·  ${dist}  ·  ${min}`
}

function detailBodyText(poi: Poi): string {
  const summary = poi.wikiSummary
    ? truncate(poi.wikiSummary.replace(/\s+/g, ' '), 260)
    : '(No description available.)'
  // Hint lives at the bottom of the body so the summary isn't interrupted.
  return [summary, '', RULE, '', '> Tap for options  ·  Double-tap to exit'].join('\n')
}

// ─── POI_ACTIONS ───────────────────────────────────────────────────────

function renderPoiActions(
  poi: Poi,
  actions: PoiDetailAction[],
  cursorIndex: number,
): RebuildPageContainer {
  return new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: HEADER_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: ID_MAIN,
        containerName: 'actions-header',
        isEventCapture: 0,
        // Header is title-only here — no metadata row fighting for space,
        // so 48px is plenty.
        content: truncate(poi.name, CHARS_PER_LINE),
      }),
      new TextContainerProperty({
        xPosition: 0,
        yPosition: BODY_Y,
        width: DISPLAY_WIDTH,
        height: BODY_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: ID_BODY,
        containerName: 'actions-body',
        isEventCapture: 1,
        content: actionsBodyText(actions, cursorIndex),
      }),
    ],
  })
}

function actionsBodyText(
  actions: PoiDetailAction[],
  cursorIndex: number,
): string {
  const lines: string[] = ['']
  actions.forEach((a, i) => {
    const prefix = i === cursorIndex ? '> ' : '  '
    lines.push(prefix + ACTION_LABEL[a])
  })
  return lines.join('\n')
}

const ACTION_LABEL: Record<PoiDetailAction, string> = {
  navigate: 'Navigate',
  // The EvenHub WebView opens external URLs inside its own in-app
  // browser — not in Safari and not in the phone's default browser.
  // "Open on Phone" is the closest accurate label for what the user
  // actually sees. Field-test 2026-04-24 confirmed the in-app browser
  // also captures input, so the glasses cursor is "locked" while the
  // browser overlay is up. (Tracked for next session.)
  safari: 'Open on Phone',
  'read-more': 'Read More',
  back: 'Back to List',
}

function renderNavActive(
  screen: Extract<Screen, { name: 'NAV_ACTIVE' }>,
): RebuildPageContainer {
  // 3 containers: header text + (left-column) body text + (right-column)
  // minimap image. The image starts as a placeholder — the bridge fills
  // it in via `updateImageRawData` right after the rebuild lands.
  return new RebuildPageContainer({
    containerTotalNum: 3,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: NAV_HEADER_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: ID_MAIN,
        containerName: 'nav-header',
        isEventCapture: 0,
        content: navHeaderText(screen.destination),
      }),
      new TextContainerProperty({
        xPosition: 0,
        yPosition: NAV_BODY_Y,
        width: NAV_TEXT_WIDTH,
        height: NAV_BODY_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: ID_BODY,
        containerName: 'nav-body',
        isEventCapture: 1,
        content: navBodyText(screen),
      }),
    ],
    imageObject: [
      new ImageContainerProperty({
        xPosition: NAV_MAP_X,
        yPosition: NAV_MAP_Y,
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        containerID: ID_MAP,
        containerName: 'nav-minimap',
      }),
    ],
  })
}

function navHeaderText(destination: Poi): string {
  return `→ ${truncate(destination.name, CHARS_PER_LINE - 2)}\n${destination.categoryIcon} ${destination.category}`
}

function navBodyText(screen: Extract<Screen, { name: 'NAV_ACTIVE' }>): string {
  if (screen.arrived) {
    return [
      '',
      'You have arrived!',
      NAV_RULE,
      '',
      truncate(screen.destination.name, NAV_BODY_CHARS_PER_LINE),
      '',
      '> Tap to return',
    ].join('\n')
  }

  // NAV body layout per mockup (HANDOFF.md §2 C3):
  //   Line 1: heading arrow + distance (prominent)
  //   Line 2: ETA · BEARING (the "3-stat" completion — DISTANCE above)
  //   Blank
  //   Current step instruction (+ optional street line)
  //   Blank
  //   "Next: <preview>" when a next step exists
  //   NAV_RULE + tap hints.
  const step = screen.route.steps[screen.currentStepIndex]
  const nextStep = screen.route.steps[screen.currentStepIndex + 1]
  const remainingMeters = remainingDistanceMeters(screen)
  const headingToDest = headingToNextPoint(screen) ?? screen.destination.bearingDegrees
  const arrow = bearingToArrow(headingToDest)
  const cardinal = bearingToCardinal(headingToDest)

  const lines = [
    `${arrow}  ${formatMeters(remainingMeters)}`,
    `~${etaMinutes(remainingMeters)} min  ·  ${cardinal}`,
    '',
  ]

  if (step) {
    lines.push(truncate(step.instruction, NAV_BODY_CHARS_PER_LINE))
    if (step.street) {
      lines.push(`  on ${truncate(step.street, NAV_BODY_CHARS_PER_LINE - 5)}`)
    }
  }

  if (nextStep) {
    lines.push('', `Next: ${truncate(nextStep.instruction, NAV_BODY_CHARS_PER_LINE - 6)}`)
  }

  lines.push('', NAV_RULE, '', '> Tap to stop nav', '  Double-tap → list')
  return lines.join('\n')
}

/**
 * Convert remaining route distance into a rough walking ETA in minutes.
 * ~84 m/min ≈ 1.4 m/s — the "casual walking" pace used across most
 * pedestrian routing engines (OSRM, ORS defaults). Clamped to a floor
 * of 1 minute so the UI never shows "~0 min" while the user is still
 * some distance away.
 */
export function etaMinutes(remainingMeters: number): number {
  return Math.max(1, Math.round(remainingMeters / 84))
}

function renderWikiRead(
  title: string,
  pages: string[],
  pageIndex: number,
): RebuildPageContainer {
  return new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: HEADER_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: ID_MAIN,
        containerName: 'wiki-header',
        isEventCapture: 0,
        content: wikiHeaderText(title, pageIndex, pages.length),
      }),
      new TextContainerProperty({
        xPosition: 0,
        yPosition: BODY_Y,
        width: DISPLAY_WIDTH,
        height: BODY_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: ID_BODY,
        containerName: 'wiki-body',
        isEventCapture: 1,
        content: wikiBodyText(pages, pageIndex),
      }),
    ],
  })
}

function wikiHeaderText(title: string, pageIndex: number, total: number): string {
  return `${truncate(title, CHARS_PER_LINE - 8)}  ${pageIndex + 1}/${total}`
}

function wikiBodyText(pages: string[], pageIndex: number): string {
  return pages[pageIndex] ?? ''
}

// ─── Single-container screens ──────────────────────────────────────────

function singleText(content: string): RebuildPageContainer {
  return new RebuildPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 8,
        containerID: ID_MAIN,
        containerName: 'main',
        isEventCapture: 1,
        content,
      }),
    ],
  })
}

// ─── Text utilities ────────────────────────────────────────────────────

function centeredBlock(lines: string[]): string {
  return lines.map((l) => center(l, CHARS_PER_LINE)).join('\n')
}

function center(line: string, width: number): string {
  if (line.length >= width) return line
  const pad = Math.floor((width - line.length) / 2)
  return ' '.repeat(pad) + line
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  // Use ".." rather than the single U+2026 ellipsis glyph — the G2's
  // LVGL fixed font has no glyph for U+2026 and renders it as an empty
  // box. Teardown item §7-4 in HANDOFF_2026-04-24. Mirrors the
  // server-side cleanText in api/wiki.ts which applies the same
  // substitution on incoming Wikipedia text.
  return s.slice(0, max - 2) + '..'
}

function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  return `${miles.toFixed(1)} mi`
}

function formatMeters(m: number): string {
  // Imperial-first display per field-test 2026-04-24: US users found
  // "79 m" non-intuitive on the NAV body. POI_DETAIL header already
  // uses formatDistance(miles), so this brings NAV in line.
  // Threshold: under 0.1 mi → feet (rounded to 5 ft for visual stability
  // as the position updates), otherwise miles to 2 decimals.
  const miles = m / 1609.344
  if (miles < 0.1) {
    const feet = Math.round((m * 3.28084) / 5) * 5
    return `${feet} ft`
  }
  return `${miles.toFixed(2)} mi`
}

// ─── Navigation math (text-only NAV_ACTIVE) ────────────────────────────

/**
 * Distance from current position to destination via the great-circle
 * formula (haversine). Used for the "X m / X km" display.
 */
function remainingDistanceMeters(
  screen: Extract<Screen, { name: 'NAV_ACTIVE' }>,
): number {
  if (!screen.position) return screen.route.totalDistanceMeters
  return haversine(
    screen.position.lat,
    screen.position.lng,
    screen.destination.lat,
    screen.destination.lng,
  )
}

/**
 * Bearing from current position to destination. The minimap (Phase 3
 * final) will use the next route waypoint instead; for the text-only
 * version this gives the user a usable "you're heading roughly →".
 */
function headingToNextPoint(
  screen: Extract<Screen, { name: 'NAV_ACTIVE' }>,
): number | null {
  if (!screen.position) return null
  return bearing(
    screen.position.lat,
    screen.position.lng,
    screen.destination.lat,
    screen.destination.lng,
  )
}

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

/** Map a bearing (0–360°) to one of 8 cardinal arrows. */
export function bearingToArrow(deg: number): string {
  const norm = ((deg % 360) + 360) % 360
  // 8 sectors of 45°, centred on each arrow direction (offset by 22.5°).
  const sector = Math.floor(((norm + 22.5) % 360) / 45)
  return ARROWS[sector]
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/**
 * Map a bearing (0–360°) to a 2-letter cardinal string. Used in the
 * POI_DETAIL subtitle (HANDOFF.md §2 C2 — mockup parity) so users see
 * "0.3 mi NW" rather than a raw degree value.
 */
export function bearingToCardinal(deg: number): string {
  const norm = ((deg % 360) + 360) % 360
  const sector = Math.floor(((norm + 22.5) % 360) / 45)
  return CARDINALS[sector]
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
