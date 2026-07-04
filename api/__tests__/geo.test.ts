import { describe, it, expect } from 'vitest'
import { haversine, bearing } from '../_lib/geo'

describe('haversine', () => {
  it('returns ~0 for identical points', () => {
    expect(haversine(40.7128, -74.006, 40.7128, -74.006)).toBeCloseTo(0, 5)
  })
  it('returns a plausible distance for two NYC landmarks (~5.5km, Central Park to Times Square is ~2.5km — use a wider known pair)', () => {
    // Statue of Liberty to Empire State Building, ~8.3 km
    const d = haversine(40.6892, -74.0445, 40.7484, -73.9857)
    expect(d).toBeGreaterThan(7500)
    expect(d).toBeLessThan(9000)
  })
})

describe('bearing', () => {
  it('returns 90 for due east', () => {
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(90, 0)
  })
  it('returns 0 for due north', () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(0, 0)
  })
})
