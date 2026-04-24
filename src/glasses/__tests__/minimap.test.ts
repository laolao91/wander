import { describe, it, expect } from 'vitest'
import {
  bearingBetween,
  cardinalTicks,
  dashSegments,
  fitBounds,
  geometryAsLatLng,
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  northArrow,
  projectPoint,
  trianglePath,
} from '../minimap'

// ─── fitBounds ─────────────────────────────────────────────────────────

describe('fitBounds', () => {
  it('returns null for an empty array', () => {
    expect(fitBounds([])).toBeNull()
  })

  it('expands a single point into a workable bbox', () => {
    const b = fitBounds([{ lat: 40.7128, lng: -74.006 }])!
    expect(b.maxLat - b.minLat).toBeGreaterThan(0.001)
    expect(b.maxLng - b.minLng).toBeGreaterThan(0.001)
    // Centred on the input point.
    expect((b.minLat + b.maxLat) / 2).toBeCloseTo(40.7128, 4)
    expect((b.minLng + b.maxLng) / 2).toBeCloseTo(-74.006, 4)
  })

  it('covers all points with a 10% margin', () => {
    const b = fitBounds([
      { lat: 40.0, lng: -74.0 },
      { lat: 40.1, lng: -73.9 },
    ])!
    // Span 0.1° plus 10% on each side.
    expect(b.maxLat - b.minLat).toBeCloseTo(0.12, 5)
    expect(b.maxLng - b.minLng).toBeCloseTo(0.12, 5)
    expect(b.minLat).toBeLessThan(40.0)
    expect(b.maxLat).toBeGreaterThan(40.1)
  })
})

// ─── projectPoint ──────────────────────────────────────────────────────

describe('projectPoint', () => {
  const bounds = {
    minLat: 40.0,
    maxLat: 40.1,
    minLng: -74.1,
    maxLng: -74.0,
  }

  it('projects the SW corner to the bottom-left of the inner box', () => {
    // After aspect-fit letterboxing, the SW corner sits at the inner
    // edge along whichever axis was the tighter fit. Just sanity-check
    // it's inside the canvas and on the lower/left side.
    const p = projectPoint({ lat: 40.0, lng: -74.1 }, bounds)
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeLessThanOrEqual(MINIMAP_HEIGHT)
    expect(p.y).toBeGreaterThan(MINIMAP_HEIGHT / 2) // lower half
    expect(p.x).toBeLessThan(MINIMAP_WIDTH / 2) // left half
  })

  it('projects the NE corner to the upper-right of the inner box', () => {
    const p = projectPoint({ lat: 40.1, lng: -74.0 }, bounds)
    expect(p.y).toBeLessThan(MINIMAP_HEIGHT / 2) // upper half
    expect(p.x).toBeGreaterThan(MINIMAP_WIDTH / 2) // right half
  })

  it('respects canvas padding', () => {
    const p = projectPoint({ lat: 40.0, lng: -74.1 }, bounds, MINIMAP_WIDTH, MINIMAP_HEIGHT, 8)
    expect(p.x).toBeGreaterThanOrEqual(8)
    expect(p.y).toBeLessThanOrEqual(MINIMAP_HEIGHT - 8)
  })

  it('north on the map is up (smaller y for higher lat)', () => {
    const south = projectPoint({ lat: 40.0, lng: -74.05 }, bounds)
    const north = projectPoint({ lat: 40.1, lng: -74.05 }, bounds)
    expect(north.y).toBeLessThan(south.y)
  })
})

// ─── dashSegments ──────────────────────────────────────────────────────

describe('dashSegments', () => {
  it('returns no segments for fewer than 2 points', () => {
    expect(dashSegments([{ x: 0, y: 0 }])).toEqual([])
    expect(dashSegments([])).toEqual([])
  })

  it('emits alternating on/off chunks along a single straight segment', () => {
    // A 50px line, dash=6 + gap=4 = 10px cycle. Expect 5 dashes.
    const segs = dashSegments(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      6,
      4,
    )
    expect(segs.length).toBe(5)
    expect(segs[0][0].x).toBe(0)
    expect(segs[0][1].x).toBeCloseTo(6, 5)
    expect(segs[1][0].x).toBeCloseTo(10, 5) // after the first 4px gap
  })

  it('handles polylines that change direction mid-dash', () => {
    // L-shape, 10px right then 10px down — total 20px, dash 6 + gap 4
    // produces 2 dashes spread across the corner.
    const segs = dashSegments(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      6,
      4,
    )
    expect(segs.length).toBeGreaterThanOrEqual(2)
    // No segment should escape the polyline path's footprint.
    for (const [a, b] of segs) {
      expect(a.x).toBeGreaterThanOrEqual(0)
      expect(a.x).toBeLessThanOrEqual(10)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x).toBeLessThanOrEqual(10)
    }
  })
})

// ─── trianglePath ──────────────────────────────────────────────────────

describe('trianglePath', () => {
  const center = { x: 100, y: 100 }

  it('points up (-y) for heading 0° (North)', () => {
    const [tip] = trianglePath(center, 0, 10)
    expect(tip.x).toBeCloseTo(100, 5)
    expect(tip.y).toBeCloseTo(90, 5) // 10px above
  })

  it('points right (+x) for heading 90° (East)', () => {
    const [tip] = trianglePath(center, 90, 10)
    expect(tip.x).toBeCloseTo(110, 5)
    expect(tip.y).toBeCloseTo(100, 5)
  })

  it('points down (+y) for heading 180° (South)', () => {
    const [tip] = trianglePath(center, 180, 10)
    expect(tip.y).toBeCloseTo(110, 5)
  })

  it('all three vertices are distinct', () => {
    const [a, b, c] = trianglePath(center, 45, 10)
    expect(a).not.toEqual(b)
    expect(b).not.toEqual(c)
    expect(a).not.toEqual(c)
  })
})

// ─── bearingBetween ────────────────────────────────────────────────────

describe('bearingBetween', () => {
  it('returns ~0° for due-north travel', () => {
    const b = bearingBetween({ lat: 40, lng: -74 }, { lat: 40.01, lng: -74 })
    expect(b).toBeLessThan(1)
  })

  it('returns ~90° for due-east travel', () => {
    const b = bearingBetween({ lat: 40, lng: -74 }, { lat: 40, lng: -73.99 })
    expect(b).toBeGreaterThan(89)
    expect(b).toBeLessThan(91)
  })
})

// ─── cardinalTicks (Phase 4b) ──────────────────────────────────────────

describe('cardinalTicks', () => {
  it('places N at the top-center edge, pointing inward', () => {
    const t = cardinalTicks()
    expect(t.N[0].x).toBeCloseTo(MINIMAP_WIDTH / 2, 5)
    expect(t.N[0].y).toBe(0)
    expect(t.N[1].x).toBeCloseTo(MINIMAP_WIDTH / 2, 5)
    expect(t.N[1].y).toBeGreaterThan(0)
  })

  it('places S at the bottom-center edge, pointing inward', () => {
    const t = cardinalTicks()
    expect(t.S[0].x).toBeCloseTo(MINIMAP_WIDTH / 2, 5)
    expect(t.S[1].y).toBe(MINIMAP_HEIGHT)
    // Second endpoint is the canvas edge; first is inside.
    expect(t.S[0].y).toBeLessThan(t.S[1].y)
  })

  it('places W at the left-center edge, pointing inward', () => {
    const t = cardinalTicks()
    expect(t.W[0].x).toBe(0)
    expect(t.W[0].y).toBeCloseTo(MINIMAP_HEIGHT / 2, 5)
    expect(t.W[1].x).toBeGreaterThan(0)
  })

  it('places E at the right-center edge, pointing inward', () => {
    const t = cardinalTicks()
    expect(t.E[1].x).toBe(MINIMAP_WIDTH)
    expect(t.E[0].y).toBeCloseTo(MINIMAP_HEIGHT / 2, 5)
    expect(t.E[0].x).toBeLessThan(t.E[1].x)
  })

  it('scales with a custom canvas size', () => {
    const t = cardinalTicks(100, 50, 2)
    expect(t.N[0].x).toBe(50)
    expect(t.N[1].y).toBe(2)
    expect(t.S[1].y).toBe(50)
    expect(t.E[1].x).toBe(100)
    expect(t.W[0].x).toBe(0)
  })

  it('has the default tick length of 4 pixels', () => {
    const t = cardinalTicks()
    expect(t.N[1].y).toBe(4)
    expect(t.W[1].x).toBe(4)
  })
})

// ─── northArrow (Phase 4b) ─────────────────────────────────────────────

describe('northArrow', () => {
  it('sits in the top-right corner of the canvas', () => {
    const a = northArrow()
    // Tip near the right edge.
    expect(a.triangle[0].x).toBeGreaterThan(MINIMAP_WIDTH - 20)
    expect(a.triangle[0].x).toBeLessThan(MINIMAP_WIDTH)
    // Tip near the top edge.
    expect(a.triangle[0].y).toBeLessThan(10)
  })

  it('points upward — tip is above the two base corners', () => {
    const a = northArrow()
    expect(a.triangle[0].y).toBeLessThan(a.triangle[1].y)
    expect(a.triangle[0].y).toBeLessThan(a.triangle[2].y)
  })

  it('has a horizontal base — two base corners share y', () => {
    const a = northArrow()
    expect(a.triangle[1].y).toBeCloseTo(a.triangle[2].y, 5)
  })

  it('label anchor is to the right of the triangle and below its tip', () => {
    const a = northArrow()
    expect(a.label.x).toBeGreaterThanOrEqual(a.triangle[0].x)
    expect(a.label.y).toBeGreaterThanOrEqual(a.triangle[0].y)
  })

  it('scales with a custom canvas width', () => {
    const wide = northArrow(400)
    const narrow = northArrow(200)
    // Arrow tracks the right edge of the canvas it's drawn on.
    expect(wide.triangle[0].x).toBeGreaterThan(narrow.triangle[0].x)
    expect(wide.triangle[0].x - narrow.triangle[0].x).toBeCloseTo(200, 5)
  })
})

// ─── geometryAsLatLng ──────────────────────────────────────────────────

describe('geometryAsLatLng', () => {
  it('flips [lat, lng] tuples into objects', () => {
    expect(
      geometryAsLatLng([
        [40, -74],
        [40.1, -73.9],
      ]),
    ).toEqual([
      { lat: 40, lng: -74 },
      { lat: 40.1, lng: -73.9 },
    ])
  })
})
