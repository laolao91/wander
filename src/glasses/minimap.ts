/**
 * NAV_ACTIVE minimap — projects the route geometry into a small canvas,
 * draws a dashed walking path, the destination, and a triangle for the
 * user's current position + heading, then encodes the result as a PNG
 * for `bridge.updateImageRawData`.
 *
 * Two layers, separated for testability:
 *
 *   - **Pure math** (`fitBounds`, `projectPoint`, `dashSegments`,
 *     `trianglePath`): no DOM, fully unit-tested in Node.
 *
 *   - **Canvas drawing** (`drawMinimap`, `encodeMinimapPng`): touches
 *     `OffscreenCanvas` / `HTMLCanvasElement` and `Blob`, so it only
 *     runs in the browser. The bridge calls it; tests don't.
 *
 * Image format is PNG bytes — the host (or simulator) decodes the PNG
 * and converts to 4-bit greyscale (the SDK exposes the failure mode as
 * `ImageRawDataUpdateResult.imageToGray4Failed`, which confirms the
 * host owns the gray4 conversion).
 */

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

// ─── Canvas drawing (browser only) ─────────────────────────────────────

/**
 * Draw the minimap onto a canvas context. Caller owns the canvas (and
 * its lifecycle); this function just paints. Black background, white
 * route + markers — the host converts to gray4 either way, but the
 * monochrome+high-contrast input gives the cleanest result.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  input: MinimapInput,
  canvasWidth = MINIMAP_WIDTH,
  canvasHeight = MINIMAP_HEIGHT,
): void {
  // Background.
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  const geom = geometryAsLatLng(input.geometry)
  // Always include destination + position in the bbox so they're visible.
  const allPoints: LatLng[] = [...geom, input.destination]
  if (input.position) allPoints.push(input.position)

  const bounds = fitBounds(allPoints)
  if (!bounds) {
    // No data yet — leave the black canvas. The text body still tells
    // the user what's happening.
    return
  }

  // Project everything in one pass.
  const project = (p: LatLng) =>
    projectPoint(p, bounds, canvasWidth, canvasHeight)
  const projectedRoute = geom.map(project)
  const dest = project(input.destination)
  const userPos = input.position ? project(input.position) : null

  // Route as dashed polyline.
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  for (const [a, b] of dashSegments(projectedRoute)) {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  // Destination marker — filled circle with a ring, easy to spot.
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(dest.x, dest.y, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(dest.x, dest.y, 6, 0, Math.PI * 2)
  ctx.lineWidth = 1
  ctx.stroke()

  // User position triangle.
  if (userPos) {
    const heading =
      input.headingDegrees ??
      // Fall back to the direction of the next route point if we have
      // one; otherwise just point north.
      (projectedRoute.length > 1
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
  drawMinimap(ctx, input)

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  )
  if (!blob) return null
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}
