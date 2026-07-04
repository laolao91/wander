import { describe, it, expect, vi, afterEach } from 'vitest'
import { readDevMockCoords } from '../devMock'

describe('readDevMockCoords', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns null when not in DEV', () => {
    vi.stubEnv('DEV', false)
    expect(readDevMockCoords()).toBeNull()
  })

  it('returns coords when DEV and both env vars are valid numbers', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_MOCK_LAT', '40.7')
    vi.stubEnv('VITE_MOCK_LNG', '-74.0')
    expect(readDevMockCoords()).toEqual({ lat: 40.7, lng: -74.0 })
  })

  it('returns null when env vars are missing or invalid', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_MOCK_LAT', '')
    vi.stubEnv('VITE_MOCK_LNG', '')
    expect(readDevMockCoords()).toBeNull()
  })
})
