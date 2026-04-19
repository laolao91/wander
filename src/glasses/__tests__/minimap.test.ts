import { describe, it, expect } from 'vitest'
import {
  bearingBetween,
  dashSegments,
  fitBounds,
  geometryAsLatLng,
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
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
