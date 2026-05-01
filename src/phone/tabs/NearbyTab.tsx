/**
 * Nearby tab — location bar, refresh bar, POI list grouped by category.
 *
 * Phase I session 1 (2026-04-28): full UI + auto-refresh on first open.
 * Data layer (reducer, storage, category mapping) was scaffolded in Phase I
 * data layer session. Geolocation + fetch are wired in App.tsx.
 *
 * Mockup source: `Point of Interest App/wander-mockup.html` lines 925–1029
 * ("PHONE SCREEN 1: Nearby Tab").
 */

import { SectionHeader, ListItem, Loading, EmptyState } from 'even-toolkit/web'
import { useEffect, useState } from 'react'
import type { PhoneState, PhoneEvent } from '../types'
import type { Poi } from '../../glasses/api'

// ─── Category display names (API → human label) ───────────────────────────

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

// Preserve API-defined display order.
const CATEGORY_ORDER = ['landmark', 'park', 'museum', 'religion', 'art', 'library', 'food', 'nightlife']

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatMinsAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return 'Updated just now'
  if (mins === 1) return 'Updated 1 min ago'
  return `Updated ${mins} min ago`
}

function groupByCategory(pois: readonly Poi[]): Map<string, Poi[]> {
  const map = new Map<string, Poi[]>()
  for (const p of pois) {
    const bucket = map.get(p.category) ?? []
    bucket.push(p)
    map.set(p.category, bucket)
  }
  return map
}

// ─── Sub-components ───────────────────────────────────────────────────────

interface RefreshBarProps {
  count: number
  lastFetchTs: number | null
  onRefresh: () => void
  isLoading: boolean
}

function RefreshBar({ count, lastFetchTs, onRefresh, isLoading }: RefreshBarProps) {
  const timeLabel = lastFetchTs ? formatMinsAgo(lastFetchTs) : null
  const countLabel = `${count} place${count === 1 ? '' : 's'} found`
  const label = timeLabel ? `${timeLabel} · ${countLabel}` : countLabel

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-border">
      <span className="text-[13px] text-text-dim">{label}</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={isLoading}
        className="text-[13px] text-accent disabled:opacity-50 cursor-pointer disabled:cursor-default"
      >
        ↺ Refresh
      </button>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────

export interface NearbyTabProps {
  state: PhoneState
  dispatch: (e: PhoneEvent) => void
}

export function NearbyTab({ state, dispatch }: NearbyTabProps) {
  const { nearby } = state

  // Auto-refresh when tab first mounts and no data exists yet.
  useEffect(() => {
    if (nearby.fetchStatus === 'idle') {
      dispatch({ type: 'nearby-refresh-requested' })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Force a re-render every 60 s so "Updated X min ago" stays accurate.
  // The tick value is intentionally unused — it just drives the re-render.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const isLoading = nearby.fetchStatus === 'locating' || nearby.fetchStatus === 'fetching'
  const hasPois = nearby.pois.length > 0

  function handleRefresh() {
    dispatch({ type: 'nearby-refresh-requested' })
  }

  // ── Full-screen loading (no stale data) ──────────────────────────────
  if (isLoading && !hasPois) {
    const msg = nearby.fetchStatus === 'locating'
      ? 'Finding your location…'
      : 'Loading nearby places…'
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <Loading size={28} className="text-text-dim" />
        <p className="text-[14px] text-text-dim">{msg}</p>
      </div>
    )
  }

  // ── Error — no stale data to show ─────────────────────────────────────
  if (nearby.fetchStatus === 'error-location' && !hasPois) {
    return (
      <div className="px-4 pt-4 pb-8">
        <EmptyState
          icon={<span className="text-[32px]">📍</span>}
          title="Location unavailable"
          description={nearby.errorMessage ?? 'Allow location access to discover nearby places.'}
          action={{ label: 'Try again', onClick: handleRefresh }}
        />
      </div>
    )
  }

  if (nearby.fetchStatus === 'error-network' && !hasPois) {
    return (
      <div className="px-4 pt-4 pb-8">
        <EmptyState
          icon={<span className="text-[32px]">📡</span>}
          title="Couldn't load places"
          description={nearby.errorMessage ?? 'Check your connection and try again.'}
          action={{ label: 'Retry', onClick: handleRefresh }}
        />
      </div>
    )
  }

  // ── Success — no results found ────────────────────────────────────────
  if (nearby.fetchStatus === 'success' && !hasPois) {
    return (
      <div className="px-4 pt-4 pb-8">
        <RefreshBar
          count={0}
          lastFetchTs={nearby.lastFetchTs}
          onRefresh={handleRefresh}
          isLoading={isLoading}
        />
        <EmptyState
          icon={<span className="text-[32px]">🗺️</span>}
          title="Nothing nearby"
          description="No places found within your search radius. Try increasing the radius in Settings."
          className="mt-4"
        />
      </div>
    )
  }

  // ── POI list ──────────────────────────────────────────────────────────
  const grouped = groupByCategory(nearby.pois)
  const categories = CATEGORY_ORDER.filter((c) => grouped.has(c))

  return (
    <div className="pb-8">
      <RefreshBar
        count={nearby.pois.length}
        lastFetchTs={nearby.lastFetchTs}
        onRefresh={handleRefresh}
        isLoading={isLoading}
      />

      {/* Inline loading indicator when refreshing stale data */}
      {isLoading && (
        <div className="flex items-center gap-2 px-4 py-2">
          <Loading size={14} className="text-text-dim" />
          <span className="text-[12px] text-text-dim">Refreshing…</span>
        </div>
      )}

      {/* Error banner when refresh fails but we still have stale data */}
      {nearby.fetchStatus === 'error-network' && hasPois && (
        <div className="mx-4 mt-3 px-3 py-2 bg-surface rounded-[6px]">
          <p className="text-[12px] text-text-dim">
            Refresh failed — showing previous results.
          </p>
        </div>
      )}

      {categories.map((cat) => {
        const pois = grouped.get(cat)!
        const label = CATEGORY_LABEL[cat] ?? cat
        return (
          <div key={cat} className="px-4">
            <SectionHeader title={label} />
            {pois.map((poi) => (
              <ListItem
                key={poi.id}
                title={poi.name}
                subtitle={formatDistance(poi.distanceMiles)}
                leading={
                  <span className="text-[18px] w-7 text-center select-none" aria-hidden>
                    {poi.categoryIcon}
                  </span>
                }
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft away`
  return `${miles.toFixed(1)} mi away`
}
