import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchLocations } from '../components/LocationSearchForm'
import type { ManualLocation } from '../types'

const MOCK_RESULTS: ManualLocation[] = [
  { label: 'Times Square, Midtown Manhattan, Manhattan', lat: 40.758, lng: -73.9855 },
  { label: 'Times Square Arts, Manhattan, New York', lat: 40.759, lng: -73.984 },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchLocations', () => {
  it('calls /api/geocode?q= with encoded query', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ results: MOCK_RESULTS }),
    } as Response)

    await searchLocations('Times Square')

    expect(fetch).toHaveBeenCalledWith('/api/geocode?q=Times%20Square')
  })

  it('returns the results array from the response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ results: MOCK_RESULTS }),
    } as Response)

    const results = await searchLocations('Times Square')
    expect(results).toEqual(MOCK_RESULTS)
  })

  it('returns empty array when results is empty', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response)

    const results = await searchLocations('xyzzy nowhere')
    expect(results).toEqual([])
  })

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
    } as Response)

    await expect(searchLocations('Times Square')).rejects.toThrow()
  })
})
