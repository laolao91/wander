/**
 * Dev-only simulator mock coords, read from VITE_MOCK_LAT/LNG in
 * .env.local. Shared by both the glasses effect runner and the phone
 * App.tsx boot path — previously duplicated verbatim in both.
 */
export function readDevMockCoords(): { lat: number; lng: number } | null {
  if (!import.meta.env.DEV) return null
  const lat = parseFloat(import.meta.env.VITE_MOCK_LAT ?? '')
  const lng = parseFloat(import.meta.env.VITE_MOCK_LNG ?? '')
  if (isNaN(lat) || isNaN(lng)) return null
  console.log('[wander][geo] DEV mock coords', { lat, lng })
  return { lat, lng }
}
