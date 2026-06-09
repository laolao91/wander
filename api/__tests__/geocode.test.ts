import { describe, it, expect } from 'vitest'
import { buildForwardLabel } from '../geocode'

describe('buildForwardLabel', () => {
  it('returns first 3 parts of display_name', () => {
    const item = {
      display_name: 'Times Square, Midtown Manhattan, Manhattan, New York County, New York, United States',
    }
    expect(buildForwardLabel(item)).toBe('Times Square, Midtown Manhattan, Manhattan')
  })

  it('handles a short display_name gracefully', () => {
    const item = { display_name: 'Central Park' }
    expect(buildForwardLabel(item)).toBe('Central Park')
  })

  it('uses at most 3 parts', () => {
    const item = { display_name: 'A, B, C, D, E' }
    expect(buildForwardLabel(item)).toBe('A, B, C')
  })
})
