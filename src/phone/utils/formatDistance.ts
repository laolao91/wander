export function formatDistance(
  distanceMiles: number,
  units: 'imperial' | 'metric',
): string {
  if (units === 'metric') {
    const meters = distanceMiles * 1609.344
    if (meters < 1000) return `${Math.round(meters)}m away`
    return `${(meters / 1000).toFixed(1)}km away`
  }
  if (distanceMiles < 0.1) return `${Math.round(distanceMiles * 5280)} ft away`
  return `${distanceMiles.toFixed(1)} mi away`
}
