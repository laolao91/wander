import { API_BASE } from '../../glasses/api'
import type { ManualLocation } from '../types'

export async function searchLocations(query: string): Promise<ManualLocation[]> {
  const res = await fetch(`${API_BASE}/geocode?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`geocode failed: ${res.status}`)
  const data = await res.json() as { results: ManualLocation[] }
  return data.results
}
