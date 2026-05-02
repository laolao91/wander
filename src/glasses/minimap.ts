/**
 * NAV_ACTIVE minimap — projects the route geometry into a small canvas,
 * draws a dashed walking path, the destination, and a triangle for the
 * user's current position + heading, then encodes the result as a PNG
 * for `bridge.updateImageRawData`.
 *
 * Two layers, separated for testability:
 *
 *   - **Pure math** (`fitBounds`, `projectPoint`, `dashSegments`,
 *     `trianglePath`, `latLngToTilePx`, `projectInTileSpace`): no DOM,
 *     fully unit-tested in Node.
 *
 *   - **Canvas drawing** (`drawMinimap`, `encodeMinimapPng`): touches
 *     `OffscreenCanvas` / `HTMLCanvasElement` and `Blob`, so it only
 *     runs in the browser. The bridge calls it; tests don't.
 *
 * Image format is PNG bytes — the host (or simulator) decodes the PNG
 * and converts to 4-bit greyscale (the SDK exposes the failure mode as
 * `ImageRawDataUpdateResult.imageToGray4Failed`, which confirms the
 * host owns the gray4 conversion).
 *
 * Phase 5 — street tile background:
 *   `encodeMinimapPng` now attempts to load CARTO dark_nolabels tiles
 *   through `/api/map` before drawing. When tiles load, the route
 *   overlay is projected using Web Mercator tile pixel math so markers
 *   land on the correct streets. If tiles fail (offline, timeout, etc.)
 *   the existing black-background + fitBounds fallback is used unchanged.
 */

// In production (EHPK or Vercel-hosted), use the absolute URL just like
// api.ts does (same WebKit relative-URL restriction applies here).
const TILE_API_BASE = import.meta.env.DEV
  ? '/api/map'
  : 'https://wander-six-phi.vercel.app/api/map'

// ─── Public dimensions (matches render.ts NAV_ACTIVE layout) ───────────

export const MINIMAP_WIDTH = 240
export const MINIMAP_HEIGHT = 120
/** Inset from canvas edges so route + position triangle don't clip. */
const MINIMAP_PADDING = 8

// ─── Geometry types ────────────────────────────────────────────────────

export interface LatLng {
  lat: number
  lng: number
}

export interface Bounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface CanvasPoint {
  x: number
  y: number
}

// ─── Pure projection math ──────────────────────────────────────────────

/**
 * Compute a lat/lng bounding box covering all input points, with a small
 * relative margin so points don't sit right on the canvas edges.
 *
 * Returns `null` when there are no points (caller should fall back to a
 * "no-route" placeholder). A single point returns a small fixed-size
 * box centered on it so projection still has a non-zero range.
 */
export function fitBounds(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null

  let minLat = Infinity, maxLat = -Infinity
  let minLng = Infinity, maxLng = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }

  // Single-point case (or a degenerate vertical/horizontal line) — give
  // the box a ~150m radius so projection has something to work with.
  // 150m ≈ 0.00135° lat, lng varies by latitude but at typical urban
  // latitudes ~0.0018° is fine.
  const MIN_SPAN = 0.003
  if (maxLat - minLat < MIN_SPAN) {
    const mid = (minLat + maxLat) / 2
    minLat = mid - MIN_SPAN / 2
    maxLat = mid + MIN_SPAN / 2
  }
  if (maxLng - minLng < MIN_SPAN) {
    const mid = (minLng + maxLng) / 2
    minLng = mid - MIN_SPAN / 2
    maxLng = mid + MIN_SPAN / 2
  }

  // 10% margin so the route doesn't hug the edges.
  const latMargin = (maxLat - minLat) * 0.1
  const lngMargin = (maxLng - minLng) * 0.1
  return {
    minLat: minLat - latMargin,
    maxLat: maxLat + latMargin,
    minLng: minLng - lngMargin,
    maxLng: maxLng + lngMargin,
  }
}

/**
 * Project a lat/lng into canvas pixel space, preserving aspect ratio
 * (the bbox is letterboxed inside the canvas so geometry isn't squished).
 *
 * North = up (canvas Y increases downward, so we flip).
 */
export function projectPoint(
  point: LatLng,
  bounds: Bounds,
  canvasWidth = MINIMAP_WIDTH,
  canvasHeight = MINIMAP_HEIGHT,
  padding = MINIMAP_PADDING,
): CanvasPoint {
  const innerW = canvasWidth - padding * 2
  const innerH = canvasHeight - padding * 2

  const latRange = bounds.maxLat - bounds.minLat
  const lngRange = bounds.maxLng - bounds.minLng

  // Equirectangular: at small scales, scale lng by cos(lat) so a
  // walking-distance bbox stays roughly true to shape.
  const meanLat = (bounds.minLat + bounds.maxLat) / 2
  const lngScale = Math.cos((meanLat * Math.PI) / 180)
  const effectiveLngRange = lngRange * lngScale

  // Pick the tighter scale (fit-inside, preserve aspect).
  const scaleX = innerW / effectiveLngRange
  const scaleY = innerH / latRange
  const scale = Math.min(scaleX, scaleY)

  const projectedW = effectiveLngRange * scale
  const projectedH = latRange * scale
  const offsetX = padding + (innerW - projectedW) / 2
  const offsetY = padding + (innerH - projectedH) / 2

  const x = offsetX + (point.lng - bounds.minLng) * lngScale * scale
  // Flip Y: higher lat → smaller canvas y.
  const y = offsetY + (bounds.maxLat - point.lat) * scale

  return { x, y }
}

/**
 * Cut a polyline into alternating "on/off" segments for a dashed line.
 * Returns the list of "on" sub-segments (each as a pair of canvas
 * points). The drawing code strokes each pair as a single line.
 *
 * This is a pure helper so the dash math is testable; it also means
 * the canvas code stays trivial (`moveTo`/`lineTo` per segment).
 */
export function dashSegments(
  points: CanvasPoint[],
  dashLength = 6,
  gapLength = 4,
): Array<[CanvasPoint, CanvasPoint]> {
  if (points.length < 2) return []

  const out: Array<[CanvasPoint, CanvasPoint]> = []
  // We walk the polyline measured by total length; pen alternates
  // between dash (drawing) and gap (skipping) every `dashLength` /
  // `gapLength` pixels.
  let drawing = true
  let remaining = dashLength
  let cur: CanvasPoint = points[0]

  for (let i = 1; i < points.length; i++) {
    const target = points[i]
    let segDx = target.x - cur.x
    let segDy = target.y - cur.y
    let segLen = Math.hypot(segDx, segDy)

    while (segLen > remaining) {
      const t = remaining / segLen
      const next: CanvasPoint = {
        x: cur.x + segDx * t,
        y: cur.y + segDy * t,
      }
      if (drawing) out.push([cur, next])
      cur = next
      segDx = target.x - cur.x
      segDy = target.y - cur.y
      segLen = Math.hypot(segDx, segDy)
      drawing = !drawing
      remaining = drawing ? dashLength : gapLength
    }

    if (drawing && segLen > 0) out.push([cur, target])
    remaining -= segLen
    cur = target
  }

  return out
}

/**
 * Build the three vertices of a position triangle pointing along the
 * given heading (0=North, 90=East). Centered at `center` with the given
 * pixel `size` (tip-to-base distance).
 *
 * Used for the user's current-location marker. Pure math so we can
 * verify the orientation in tests without rendering.
 */
export function trianglePath(
  center: CanvasPoint,
  headingDegrees: number,
  size = 8,
): [CanvasPoint, CanvasPoint, CanvasPoint] {
  // Convert compass bearing (0=N, 90=E) → standard math angle from +x
  // axis (0=E, 90=N), in radians, with screen-y inverted.
  // North on canvas = -y direction.
  const headingRad = (headingDegrees * Math.PI) / 180

  // Tip of triangle, `size` pixels in the heading direction.
  const tipDx = Math.sin(headingRad) * size
  const tipDy = -Math.cos(headingRad) * size
  const tip = { x: center.x + tipDx, y: center.y + tipDy }

  // Two base corners, perpendicular to heading, half-size on each side.
  const halfBase = size * 0.6
  const perpDx = Math.cos(headingRad) * halfBase
  const perpDy = Math.sin(headingRad) * halfBase
  const baseCenter = { x: center.x - tipDx * 0.5, y: center.y - tipDy * 0.5 }
  return [
    tip,
    { x: baseCenter.x + perpDx, y: baseCenter.y + perpDy },
    { x: baseCenter.x - perpDx, y: baseCenter.y - perpDy },
  ]
}

// ─── Cardinal reference overlay ────────────────────────────────────────

/**
 * Edge-midpoint tick marks for N/S/E/W. Each tick is a short line segment
 * pointing inward from the canvas edge, returned as a pair of canvas
 * points (edge → inward). Pure so we can assert positions in tests
 * without a canvas.
 *
 * Why ticks instead of a full grid: on a 240×120 canvas quantized to
 * gray4, faint grid lines either vanish or look like noise next to the
 * dashed route. Four tick marks at the edge midpoints give the user an
 * unambiguous orientation reference while leaving the interior clean.
 * Phase 4b / §6.4 design note.
 */
export function cardinalTicks(
  canvasWidth = MINIMAP_WIDTH,
  canvasHeight = MINIMAP_HEIGHT,
  length = 4,
): {
  N: [CanvasPoint, CanvasPoint]
  S: [CanvasPoint, CanvasPoint]
  E: [CanvasPoint, CanvasPoint]
  W: [CanvasPoint, CanvasPoint]
} {
  const midX = canvasWidth / 2
  const midY = canvasHeight / 2
  return {
    N: [
      { x: midX, y: 0 },
      { x: midX, y: length },
    ],
    S: [
      { x: midX, y: canvasHeight - length },
      { x: midX, y: canvasHeight },
    ],
    W: [
      { x: 0, y: midY },
      { x: length, y: midY },
    ],
    E: [
      { x: canvasWidth - length, y: midY },
      { x: canvasWidth, y: midY },
    ],
  }
}

/**
 * North-arrow glyph anchored in the top-right corner: an upward-pointing
 * triangle with a text "N" label beside it. Returns the triangle vertices
 * and the label anchor point so we can test placement without touching a
 * canvas.
 *
 * The triangle sits roughly 12px from the right edge and 4px from the top
 * so the glyph doesn't visually fight the E tick at the right-center edge
 * (which is ~56px away at canvas midpoint).
 */
export function northArrow(
  canvasWidth = MINIMAP_WIDTH,
): {
  triangle: [CanvasPoint, CanvasPoint, CanvasPoint]
  label: CanvasPoint
} {
  const tipX = canvasWidth - 14
  const tipY = 3
  const size = 5
  return {
    triangle: [
      { x: tipX, y: tipY },
      { x: tipX - size, y: tipY + size * 1.4 },
      { x: tipX + size, y: tipY + size * 1.4 },
    ],
    label: { x: canvasWidth - 5, y: tipY + size * 1.4 },
  }
}

/**
 * Paint the cardinal reference layer — four edge tick marks + the N
 * arrow + label in the top-right. Drawn in a dim grey so the route
 * (white) sits clearly above it after gray4 quantization.
 */
function drawCardinalReference(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const DIM = '#666'
  const BRIGHT = '#888'

  // Ticks.
  ctx.strokeStyle = DIM
  ctx.lineWidth = 1
  const ticks = cardinalTicks(canvasWidth, canvasHeight)
  for (const pair of [ticks.N, ticks.S, ticks.W, ticks.E]) {
    ctx.beginPath()
    ctx.moveTo(pair[0].x, pair[0].y)
    ctx.lineTo(pair[1].x, pair[1].y)
    ctx.stroke()
  }

  // North arrow glyph (triangle + "N" label).
  const arrow = northArrow(canvasWidth)
  ctx.fillStyle = BRIGHT
  ctx.beginPath()
  ctx.moveTo(arrow.triangle[0].x, arrow.triangle[0].y)
  ctx.lineTo(arrow.triangle[1].x, arrow.triangle[1].y)
  ctx.lineTo(arrow.triangle[2].x, arrow.triangle[2].y)
  ctx.closePath()
  ctx.fill()

  ctx.font = 'bold 9px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText('N', arrow.label.x, arrow.label.y)
}

// ─── Drawing inputs ────────────────────────────────────────────────────

export interface MinimapInput {
  /** Route geometry from the API ([lat, lng] pairs). */
  geometry: [number, number][]
  destination: LatLng
  /** May be null on first paint before GPS settles. */
  position: LatLng | null
  /** Direction of travel (0–360°). When null, triangle points up (0°). */
  headingDegrees: number | null
}

/** Convert API `[lat, lng]` tuples into structured `LatLng` values. */
export function geometryAsLatLng(geometry: [number, number][]): LatLng[] {
  return geometry.map(([lat, lng]) => ({ lat, lng }))
}

/**
 * Pull a heading from consecutive route geometry points. Used as the
 * fallback orientation for the user-position triangle when we don't
 * have GPS-derived heading yet (the geolocation API delivers it
 * sporadically, especially indoors).
 */
export function bearingBetween(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat))
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// ─── Web Mercator tile math (pure, testable) ───────────────────────────

/**
 * Convert lat/lng to global Web Mercator pixel coordinates at the given
 * zoom level. Pixel (0, 0) is the top-left corner of tile (0, 0).
 *
 * Standard slippy-map formula: tile size = 256 px, 2^z tiles per axis.
 * Exported for unit tests — pure math, no DOM.
 */
export function latLngToTilePx(
  lat: number,
  lng: number,
  zoom: number,
): { px: number; py: number } {
  const n = Math.pow(2, zoom)
  const tileX = ((lng + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const tileY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { px: tileX * 256, py: tileY * 256 }
}

/**
 * Project a lat/lng to canvas pixel coordinates using the same Web
 * Mercator origin as the loaded tile layer. When tiles are present, all
 * route markers use this instead of `projectPoint` so they land on the
 * correct streets.
 *
 * Exported for unit tests — pure math, no DOM.
 */
export function projectInTileSpace(
  lat: number,
  lng: number,
  zoom: number,
  originPxX: number,
  originPxY: number,
): CanvasPoint {
  const { px, py } = latLngToTilePx(lat, lng, zoom)
  return { x: px - originPxX, y: py - originPxY }
}

// ─── Tile layer (browser only) ─────────────────────────────────────────

/**
 * A set of pre-loaded map tile images positioned so they tile correctly
 * across the canvas. Returned by `loadTileLayer` and consumed by
 * `drawMinimap`.
 */
export interface TileLayer {
  /** Pre-loaded images with their canvas draw coordinates (top-left). */
  tiles: Array<{ img: HTMLImageElement; drawX: number; drawY: number }>
  /** Zoom level — needed to project lat/lng into canvas coords. */
  zoom: number
  /** Canvas top-left corner in global Web Mercator pixel space. */
  originPxX: number
  originPxY: number
}

/**
 * Load a single tile through the Wander tile proxy (`/api/map`).
 * Returns an HTMLImageElement ready to draw. Rejects on timeout (5 s)
 * or HTTP error.
 *
 * Uses `crossOrigin = 'anonymous'` so the receiving canvas stays
 * untainted and `toBlob()` keeps working after `drawImage()`.
 */
async function loadTileImage(
  z: number,
  x: number,
  y: number,
): Promise<HTMLImageElement> {
  const n = Math.pow(2, z)
  // Wrap x for tiles that cross the antimeridian.
  x = ((x % n) + n) % n
  const url = `${TILE_API_BASE}?z=${z}&x=${x}&y=${y}`
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`tile load failed: ${z}/${x}/${y}`))
    img.src = url
    // Belt-and-braces: Image.onload can hang forever if the network
    // stalls after headers arrive. Five seconds is generous for a tile
    // that's ≤ 30 KB on a local/LAN connection.
    setTimeout(() => reject(new Error('tile load timeout')), 5000)
  })
}

/**
 * Determine which tiles cover the minimap canvas, fetch them in
 * parallel through the proxy, and return a `TileLayer` ready for
 * `drawMinimap`.
 *
 * Center strategy:
 *   - User's current GPS position when available (shows the immediate
 *     surroundings the user is standing in — best for navigation).
 *   - First route geometry point as fallback (shows the departure area
 *     before GPS settles).
 *   - Destination as last resort.
 *
 * Zoom strategy:
 *   - Zoom 17 when the user is very close to the destination (≤ 60 %
 *     of canvas width in tile-pixel space at z17 ≈ < 670 m) — high
 *     street detail for the final approach.
 *   - Zoom 16 otherwise — shows ~1 km of context, good for mid-route
 *     walking.
 *
 * Returns `null` on any failure so callers can fall back to the
 * plain-black background path.
 */
async function loadTileLayer(
  input: MinimapInput,
  canvasW: number,
  canvasH: number,
): Promise<TileLayer | null> {
  // Center point.
  const centerLat =
    input.position?.lat ?? input.geometry[0]?.[0] ?? input.destination.lat
  const centerLng =
    input.position?.lng ?? input.geometry[0]?.[1] ?? input.destination.lng

  // Zoom selection: z17 when destination is very close, z16 otherwise.
  let zoom = 16
  if (input.position) {
    const p = latLngToTilePx(input.position.lat, input.position.lng, 17)
    const d = latLngToTilePx(input.destination.lat, input.destination.lng, 17)
    const distPx = Math.hypot(d.px - p.px, d.py - p.py)
    if (distPx < canvasW * 0.6) zoom = 17
  }

  // Canvas origin in global tile-pixel space.
  const center = latLngToTilePx(centerLat, centerLng, zoom)
  const originPxX = center.px - canvasW / 2
  const originPxY = center.py - canvasH / 2

  // Which tiles are needed to fill the canvas?
  const tx0 = Math.floor(originPxX / 256)
  const tx1 = Math.floor((originPxX + canvasW - 1) / 256)
  const ty0 = Math.floor(originPxY / 256)
  const ty1 = Math.floor((originPxY + canvasH - 1) / 256)

  // Sanity cap — should be at most 2×2=4 tiles for a 240×120 canvas.
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 9) return null

  const fetches: Promise<{
    img: HTMLImageElement
    drawX: number
    drawY: number
  } | null>[] = []

  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const drawX = Math.round(tx * 256 - originPxX)
      const drawY = Math.round(ty * 256 - originPxY)
      fetches.push(
        loadTileImage(zoom, tx, ty)
          .then((img) => ({ img, drawX, drawY }))
          .catch(() => null),
      )
    }
  }

  const results = await Promise.all(fetches)
  const tiles = results.filter(
    (t): t is { img: HTMLImageElement; drawX: number; drawY: number } =>
      t !== null,
  )

  return tiles.length > 0 ? { tiles, zoom, originPxX, originPxY } : null
}

// ─── Canvas drawing (browser only) ─────────────────────────────────────

/**
 * Draw the minimap onto a canvas context.
 *
 * When `tileLayer` is supplied (Phase 5):
 *   - Draws the CARTO dark tile images as the background (dark bg,
 *     grey streets — converts well to gray4).
 *   - Projects route markers using Web Mercator pixel math so they
 *     land on the correct streets.
 *   - Cardinal reference drawn on top of tiles.
 *
 * When `tileLayer` is absent or null (fallback / tests):
 *   - Black background + fitBounds projection — same behaviour as
 *     Phase 4. All existing tests use this path unchanged.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  input: MinimapInput,
  canvasWidth = MINIMAP_WIDTH,
  canvasHeight = MINIMAP_HEIGHT,
  tileLayer?: TileLayer | null,
): void {
  const geom = geometryAsLatLng(input.geometry)

  let projectedRoute: CanvasPoint[]
  let dest: CanvasPoint
  let userPos: CanvasPoint | null

  if (tileLayer && tileLayer.tiles.length > 0) {
    // ── Tile background path ──────────────────────────────────────────
    // Draw tile images first (they form the background).
    for (const { img, drawX, drawY } of tileLayer.tiles) {
      ctx.drawImage(img, drawX, drawY)
    }

    // Cardinal reference on top of tiles (dim so it doesn't compete
    // with the street network, but still orients the user).
    drawCardinalReference(ctx, canvasWidth, canvasHeight)

    // Project all markers using tile pixel math for street accuracy.
    const { zoom, originPxX, originPxY } = tileLayer
    const projectTile = (p: LatLng): CanvasPoint =>
      projectInTileSpace(p.lat, p.lng, zoom, originPxX, originPxY)

    projectedRoute = geom.map(projectTile)
    dest = projectTile(input.destination)
    userPos = input.position ? projectTile(input.position) : null
  } else {
    // ── Fallback: black canvas + fitBounds (Phase 4 behaviour) ───────
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)

    drawCardinalReference(ctx, canvasWidth, canvasHeight)

    const allPoints: LatLng[] = [...geom, input.destination]
    if (input.position) allPoints.push(input.position)

    const bounds = fitBounds(allPoints)
    if (!bounds) return

    const projectFit = (p: LatLng) =>
      projectPoint(p, bounds, canvasWidth, canvasHeight)
    projectedRoute = geom.map(projectFit)
    dest = projectFit(input.destination)
    userPos = input.position ? projectFit(input.position) : null
  }

  // ── Route dashed polyline ─────────────────────────────────────────────
  // White against the dark tile background stands out strongly after
  // gray4 conversion (tile streets ≈ gray4 6–9, route ≈ gray4 15).
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  for (const [a, b] of dashSegments(projectedRoute)) {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  // ── Destination marker — filled circle with a ring ────────────────────
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(dest.x, dest.y, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.beginPath()
  ctx.arc(dest.x, dest.y, 6, 0, Math.PI * 2)
  ctx.lineWidth = 1
  ctx.stroke()

  // ── User position triangle ────────────────────────────────────────────
  if (userPos) {
    const heading =
      input.headingDegrees ??
      // Fall back to the direction of the next route point if we have
      // one; otherwise just point north.
      (geom.length > 1
        ? bearingBetween(input.position!, geom[Math.min(1, geom.length - 1)])
        : 0)
    const tri = trianglePath(userPos, heading, 8)
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.moveTo(tri[0].x, tri[0].y)
    ctx.lineTo(tri[1].x, tri[1].y)
    ctx.lineTo(tri[2].x, tri[2].y)
    ctx.closePath()
    ctx.fill()
  }
}

/**
 * Draw + encode the minimap as PNG bytes, ready for
 * `bridge.updateImageRawData({ imageData })`. Resolves to `null` if the
 * canvas API isn't available (SSR, jsdom-less tests).
 *
 * Phase 5: attempts to load CARTO dark tiles before drawing so the
 * minimap shows actual street context. Falls back silently to the
 * plain-black + fitBounds path on any tile failure (offline, timeout,
 * CORS issue on unusual WebView builds).
 */
export async function encodeMinimapPng(
  input: MinimapInput,
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = MINIMAP_WIDTH
  canvas.height = MINIMAP_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Attempt to load tile background — non-fatal if it fails.
  const tileLayer = await loadTileLayer(input, MINIMAP_WIDTH, MINIMAP_HEIGHT).catch(
    () => null,
  )

  drawMinimap(ctx, input, MINIMAP_WIDTH, MINIMAP_HEIGHT, tileLayer)

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  )
  if (!blob) return null
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}
