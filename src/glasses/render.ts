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
const NAV_MAP_Y = BODY_Y + Math.floor((BODY_HEIGHT - MINIMAP_HEIGHT) / 2)

const RULE = '━'.repeat(40)

// ─── Public: Screen → SDK payload ──────────────────────────────────────

export function renderScreen(screen: Screen): RebuildPageContainer {
  switch (screen.name) {
    case 'LOADING':
      return singleText(
        centeredBlock(['', '', 'WANDER', '', '', screen.message]),
      )

    case 'POI_LIST':
      return renderPoiList(screen.pois, screen.cursorIndex ?? 0)

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
      return renderPoiDetail(screen.poi, screen.actions, screen.cursorIndex)

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
    case 'POI_DETAIL':
      return new TextContainerUpgrade({
        containerID: ID_BODY,
        containerName: 'detail-body',
        content: detailBodyText(screen.poi, screen.actions, screen.cursorIndex),
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

function renderPoiList(pois: Poi[], cursorIndex: number): RebuildPageContainer {
  const items = pois.slice(0, 20).map((p, i) => poiListLine(p, i === cursorIndex))
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

function poiListLine(p: Poi, isCursor: boolean): string {
  // Two lines per item — name on top, distance + walk time below (left-
  // aligned). G2 fonts aren't monospace so true right-alignment via space
  // padding looks ragged; stacking is cleaner and easier to read.
  const cursor = isCursor ? '> ' : '  '
  const name = truncate(p.name, 50)
  const distance = formatDistance(p.distanceMiles)
  return `${cursor}${p.categoryIcon} ${name}\n     ${distance}  ·  ~${p.walkMinutes} min`
}

function renderPoiDetail(
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
        containerName: 'detail-header',
        isEventCapture: 0,
        content: detailHeaderText(poi),
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
        containerName: 'detail-body',
        isEventCapture: 1,
        content: detailBodyText(poi, actions, cursorIndex),
      }),
    ],
  })
}

function detailHeaderText(poi: Poi): string {
  const dist = formatDistance(poi.distanceMiles)
  const min = `~${poi.walkMinutes} min`
  return `${truncate(poi.name, CHARS_PER_LINE)}\n${poi.categoryIcon} ${poi.category}  ·  ${dist}  ·  ${min}`
}

function detailBodyText(
  poi: Poi,
  actions: PoiDetailAction[],
  cursorIndex: number,
): string {
  const summary = poi.wikiSummary
    ? truncate(poi.wikiSummary.replace(/\s+/g, ' '), 200)
    : '(No description available.)'

  const lines = [summary, '', RULE, '']
  actions.forEach((a, i) => {
    const prefix = i === cursorIndex ? '> ' : '  '
    lines.push(prefix + ACTION_LABEL[a])
  })
  return lines.join('\n')
}

const ACTION_LABEL: Record<PoiDetailAction, string> = {
  navigate: 'Navigate',
  safari: 'Open in Safari',
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
        height: HEADER_HEIGHT,
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
        yPosition: BODY_Y,
        width: NAV_TEXT_WIDTH,
        height: BODY_HEIGHT,
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
      RULE,
      '',
      truncate(screen.destination.name, NAV_BODY_CHARS_PER_LINE),
      '',
      '> Tap to return',
    ].join('\n')
  }

  const step = screen.route.steps[screen.currentStepIndex]
  const remainingMeters = remainingDistanceMeters(screen)
  const arrow = bearingToArrow(
    headingToNextPoint(screen) ?? screen.destination.bearingDegrees,
  )

  const lines = [
    `${arrow}  ${formatMeters(remainingMeters)}`,
    '',
  ]

  if (step) {
    lines.push(truncate(step.instruction, NAV_BODY_CHARS_PER_LINE))
    if (step.street) {
      lines.push(`  on ${truncate(step.street, NAV_BODY_CHARS_PER_LINE - 5)}`)
    }
  }

  lines.push('', RULE, '', '> Tap to stop nav', '  Double-tap → list')
  return lines.join('\n')
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
  return s.slice(0, max - 1) + '…'
}

function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  return `${miles.toFixed(1)} mi`
}

function formatMeters(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(2)} km`
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
