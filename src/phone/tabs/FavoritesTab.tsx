import { ListItem, EmptyState } from 'even-toolkit/web'
import type { Poi } from '../../glasses/api'

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

function formatMiles(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  return `${miles.toFixed(1)} mi`
}

export interface FavoritesTabProps {
  favorites: Poi[]
}

export function FavoritesTab({ favorites }: FavoritesTabProps) {
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
      {favorites.map((poi) => (
        <ListItem
          key={poi.id}
          title={poi.name}
          subtitle={formatMiles(poi.distanceMiles)}
          leading={
            <span className="text-[18px] w-7 text-center select-none" aria-hidden>
              {poi.categoryIcon}
            </span>
          }
          trailing={
            <span className="text-[12px] text-text-secondary">
              {CATEGORY_LABEL[poi.category] ?? poi.category}
            </span>
          }
        />
      ))}
    </div>
  )
}
