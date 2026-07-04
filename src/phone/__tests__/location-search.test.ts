import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchLocations } from '../lib/geocoding'
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
  vi.unstubAllEnvs()
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

  // API_BASE (src/glasses/api.ts) is `import.meta.env.DEV ? '/api' : 'https://...'`,
  // evaluated once at module load. Vitest itself always runs with DEV=true, so
  // asserting against the *imported* API_BASE value is circular — it can't
  // distinguish "uses API_BASE" from "hardcodes the dev-mode string" (both
  // resolve to '/api' under test). To actually exercise the production
  // (installed EvenHub app) code path, stub DEV to false and force a fresh
  // module instance via resetModules() + dynamic import — a plain re-import
  // would still return the already-evaluated (DEV=true) cached module.
  it('calls /api/geocode with the absolute production URL when DEV is false', async () => {
    vi.stubEnv('DEV', false)
    vi.resetModules()
    const { searchLocations: searchLocationsUnderProdEnv } = await import('../lib/geocoding')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response)

    await searchLocationsUnderProdEnv('times square')

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://wander-six-phi.vercel.app/api/geocode?q='),
    )

    fetchSpy.mockRestore()
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
