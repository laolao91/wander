/**
 * Phone companion app — state shapes.
 *
 * Phase H (2026-04-27): Settings tab wired. Added CategoryId→Category
 * mapping and Nearby data-layer scaffolding (NearbyState, events,
 * effects, storage keys) for Phase I. UI build is deferred; pure
 * functions here are testable and decision-free.
 */

import type { Category, Poi } from '../glasses/api'

// Re-export so callers only need to import from this module.
export type { Category, Poi }

// ─── Category mapping (phone ↔ API) ──────────────────────────────────────

/**
 * The 8 POI categories the user can opt in/out of. Icon glyphs are
 * mockup-prescribed and come through later in the render layer — the
 * category id is the stable identifier the phone reducer operates on.
 *
 * These ids are phone-side only (plural / descriptive). The API and
 * glasses side use the singular `Category` type from `glasses/api.ts`.
 * Use `categoryIdsToCategories()` to convert before passing to the API.
 */
export type CategoryId =
  | 'historic'
  | 'parks'
  | 'museums'
  | 'religious'
  | 'publicArt'
  | 'libraries'
  | 'restaurants'
  | 'nightlife'

/** All valid category ids, in mockup order. */
export const ALL_CATEGORIES: readonly CategoryId[] = [
  'historic',
  'parks',
  'museums',
  'religious',
  'publicArt',
  'libraries',
  'restaurants',
  'nightlife',
] as const

/**
 * Maps a single phone-side CategoryId to the API-facing Category string.
 *
 * This is the canonical translation point — phone UI uses descriptive
 * plural ids; the glasses API and wire format use singular names.
 */
export function categoryIdToCategory(id: CategoryId): Category {
  const MAP: Record<CategoryId, Category> = {
    historic:    'landmark',
    parks:       'park',
    museums:     'museum',
    religious:   'religion',
    publicArt:   'art',
    libraries:   'library',
    restaurants: 'food',
    nightlife:   'nightlife',
  }
  return MAP[id]
}

/** Map an array of CategoryIds to API-facing Category strings. */
export function categoryIdsToCategories(ids: readonly CategoryId[]): Category[] {
  return ids.map(categoryIdToCategory)
}

// ─── Search radius ────────────────────────────────────────────────────────

/**
 * Search-radius choices in miles. The mockup exposes exactly these 5 as a
 * slider (no arbitrary values) — keeping them as a union avoids a
 * free-number that later code would have to validate.
 */
export type RadiusMiles = 0.25 | 0.5 | 0.75 | 1.0 | 1.5

export const RADIUS_CHOICES: readonly RadiusMiles[] = [0.25, 0.5, 0.75, 1.0, 1.5] as const

// ─── Settings ─────────────────────────────────────────────────────────────

/**
 * User-configurable settings persisted across app launches.
 *
 * Note: `Display` section fields ("Sort by Proximity", "Max results 20")
 * are informational-only in v1.0 — they don't appear on this shape until
 * they're wired to something.
 */
export interface Settings {
  radiusMiles: RadiusMiles
  /**
   * The set of enabled category ids. Stored as an array rather than a
   * Set so it round-trips through JSON cleanly.
   */
  enabledCategories: readonly CategoryId[]
}

/**
 * Default settings per the mockup: radius 0.75 mi, 5 of 8 categories
 * enabled (Historic, Parks, Museums, Religious, Restaurants ON;
 * Public Art, Libraries, Nightlife OFF).
 */
export const DEFAULT_SETTINGS: Settings = {
  radiusMiles: 0.75,
  enabledCategories: [
    'historic',
    'parks',
    'museums',
    'religious',
    'restaurants',
  ],
}

// ─── Sync status (Settings tab) ────────────────────────────────────────────

/**
 * Sync status for the "Changes sync to glasses automatically" card.
 * Drives the idle/spinner/check/error visual in SettingsTab.tsx.
 */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

// ─── Nearby state (Phase I data layer) ────────────────────────────────────

/**
 * Lifecycle for the Nearby tab's fetch cycle:
 *   idle → locating → fetching → success
 *                  ↘ error-location
 *                              ↘ error-network
 * Any state can return to `locating` when the user taps ↺ Refresh.
 */
export type NearbyFetchStatus =
  | 'idle'           // never fetched this session
  | 'locating'       // waiting for GPS coordinates
  | 'fetching'       // have location, API call in flight
  | 'success'        // pois list is current
  | 'error-location' // GPS unavailable or denied
  | 'error-network'  // API call failed

/**
 * The user's current location, paired with an optional reverse-geocoded
 * neighbourhood label ("Upper West Side, NYC"). The label is null until
 * Phase I session 2 wires the reverse-geocode call — the UI falls back to
 * showing lat/lng or "Near you" in the meantime.
 */
export interface NearbyLocation {
  lat: number
  lng: number
  /** Human-readable neighbourhood label, null until geocoding is wired. */
  label: string | null
}

/**
 * State slice for the Nearby tab. Kept separate from Settings so the two
 * tabs can evolve independently. Stored on PhoneState so both tabs share
 * one dispatcher.
 */
export interface NearbyState {
  fetchStatus: NearbyFetchStatus
  location: NearbyLocation | null
  pois: readonly Poi[]
  /** Date.now() at the last successful POI fetch — drives "Updated X min ago". */
  lastFetchTs: number | null
  /** Non-null when fetchStatus is error-location or error-network. */
  errorMessage: string | null
}

export const INITIAL_NEARBY_STATE: NearbyState = {
  fetchStatus: 'idle',
  location: null,
  pois: [],
  lastFetchTs: null,
  errorMessage: null,
}

// ─── Top-level phone state ─────────────────────────────────────────────────

/** Top-level phone state — Settings + Nearby live here together. */
export interface PhoneState {
  settings: Settings
  syncStatus: SyncStatus
  /** Last sync error message (only meaningful when syncStatus === 'error'). */
  syncError: string | null
  nearby: NearbyState
}

export const INITIAL_PHONE_STATE: PhoneState = {
  settings: DEFAULT_SETTINGS,
  syncStatus: 'idle',
  syncError: null,
  nearby: INITIAL_NEARBY_STATE,
}

// ─── Events ───────────────────────────────────────────────────────────────

/**
 * Reducer events — both Settings and Nearby tabs.
 * Keep this list tight: anything that doesn't directly mutate PhoneState
 * belongs in an effect or the UI layer.
 */
export type PhoneEvent =
  // ── Settings ──
  /** Hydrate settings from storage on app boot. */
  | { type: 'settings-hydrated'; settings: Settings }
  /** User moved the radius slider. */
  | { type: 'radius-changed'; radiusMiles: RadiusMiles }
  /** User toggled a category row. */
  | { type: 'category-toggled'; category: CategoryId }
  /** Sync to glasses started (kicked off by a settings change). */
  | { type: 'sync-started' }
  /** Sync completed successfully. */
  | { type: 'sync-completed' }
  /** Sync failed with a user-facing message. */
  | { type: 'sync-failed'; message: string }
  // ── Nearby ──
  /** User tapped ↺ Refresh or the tab became visible for the first time. */
  | { type: 'nearby-refresh-requested' }
  /** Geolocation succeeded — triggers the POI fetch. */
  | { type: 'location-acquired'; lat: number; lng: number }
  /** Geolocation failed (permission denied, timeout, etc.). */
  | { type: 'location-failed'; message: string }
  /** Reverse-geocode label arrived (Phase I session 2). */
  | { type: 'location-label-resolved'; label: string }
  /** POI fetch completed with results. */
  | { type: 'nearby-pois-loaded'; pois: readonly Poi[]; fetchedAt: number }
  /** POI fetch failed with a user-facing message. */
  | { type: 'nearby-fetch-failed'; message: string }

// ─── Effects ──────────────────────────────────────────────────────────────

/**
 * Side-effects emitted by the reducer. The phone UI (App.tsx) runs them;
 * tests use a fake runner.
 */
export type PhoneEffect =
  // ── Settings ──
  /** Persist the given settings to storage. */
  | { type: 'persist-settings'; settings: Settings }
  /** Notify the glasses that settings changed (phone→glasses channel). */
  | { type: 'broadcast-settings'; settings: Settings }
  // ── Nearby ──
  /** Request the device's current GPS coordinates (one-shot). */
  | { type: 'request-location' }
  /**
   * Fetch POIs from /api/poi for the given location + current settings.
   * Settings are baked in at emit time so the effect is self-contained.
   */
  | { type: 'fetch-nearby-pois'; lat: number; lng: number; settings: Settings }
  /** Persist the POI list + timestamp to the Nearby cache keys. */
  | { type: 'cache-nearby-pois'; pois: readonly Poi[]; fetchedAt: number }

// ─── Reducer return shape ─────────────────────────────────────────────────

/** Reducer return shape — mirrors the glasses-side pattern. */
export interface ReduceResult {
  state: PhoneState
  effects: readonly PhoneEffect[]
}
