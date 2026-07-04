import { describe, it, expect } from 'vitest'
import { roundCoord } from '../poi'

describe('roundCoord', () => {
  it('rounds to 2 decimal places (~1km precision)', () => {
    expect(roundCoord(40.712776)).toBe(40.71)
    expect(roundCoord(-73.935242)).toBe(-73.94)
  })
  it('handles already-short values', () => {
    expect(roundCoord(0)).toBe(0)
    expect(roundCoord(40.7)).toBe(40.7)
  })
})
