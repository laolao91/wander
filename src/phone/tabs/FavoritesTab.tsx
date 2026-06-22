import { ListItem, EmptyState } from 'even-toolkit/web'
import type { Poi } from '../../glasses/api'
import { haversine } from '../../glasses/geo'
import { formatDistance } from '../utils/formatDistance'

const CATEGORY_LABEL: Record<string, string> = {
  landmark:  'Historic & Landmarks',
  park:      'Parks & Nature',
  museum:    'Museums & Galleries',
  religion:  'Religious Sites',
  art:       'Public Art',
  library:   'Libraries & Education',
  food:      'Restaurants & Cafes',
  nightlife: 'Bars & Nightlife',
}

export interface FavoritesTabProps {
  favorites: Poi[]
  units: 'imperial' | 'metric'
  /** Current user location, when known — used to recompute live distance. */
  userLocation: { lat: number; lng: number } | null
}

export function FavoritesTab({ favorites, units, userLocation }: FavoritesTabProps) {
  if (favorites.length === 0) {
    return (
      <div className="px-4 pt-8 pb-8">
        <EmptyState
          icon={<span className="text-[32px] select-none">★</span>}
          title="No saved places"
          description="Tap ★ Save on a place in your glasses to bookmark it here."
        />
      </div>
    )
  }

  return (
    <div className="pb-8">
      <div className="px-4 pt-3 pb-1">
        <span className="text-[12px] text-text-dim">
          {favorites.length} saved place{favorites.length === 1 ? '' : 's'}
        </span>
      </div>
      {favorites.map((poi) => {
        // distanceMiles is frozen at save-time — recompute live whenever
        // the user's current location is known so the figure stays accurate
        // after the user (or the saved POI's relevance) has moved.
        const distanceMiles = userLocation
          ? haversine(userLocation.lat, userLocation.lng, poi.lat, poi.lng) / 1609.344
          : poi.distanceMiles

        return (
          <ListItem
            key={poi.id}
            title={poi.name}
            subtitle={formatDistance(distanceMiles, units)}
            leading={
              <span className="text-[18px] w-7 text-center select-none" aria-hidden>
                {poi.categoryIcon}
              </span>
            }
            trailing={
              <span className="text-[12px] text-text-dim">
                {CATEGORY_LABEL[poi.category] ?? poi.category}
              </span>
            }
          />
        )
      })}
    </div>
  )
}
