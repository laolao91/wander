/**
 * Phone companion app — state shapes.
 *
 * Scaffolding for Phases 5 + 6 (phone Settings + Nearby tabs). The UI layer
 * is still blocked on the Tailwind-vs-spec decision (HANDOFF part 2 §6.3),
 * but the data layer is decision-free: Settings shape, persistence keys,
 * and reducer events don't depend on which CSS approach wins.
 *
 * Settings shape is pinned by `HANDOFF.md` §B2 (the canonical per-field
 * list from `WANDER_BUILD_SPEC.md` §9). Defaults are from the same place.
 */

/**
 * The 8 POI categories the user can opt in/out of. Icon glyphs are
 * mockup-prescribed and come through later in the render layer — the
 * category id is the stable identifier the API + reducer operate on.
 *
 * Source: HANDOFF.md §B2 (Categories section, 8 toggles with defaults).
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
 * Search-radius choices in miles. The mockup exposes exactly these 5 as a
 * slider (no arbitrary values) — keeping them as a union avoids a
 * free-number that later code would have to validate.
 */
export type RadiusMiles = 0.25 | 0.5 | 0.75 | 1.0 | 1.5

export const RADIUS_CHOICES: readonly RadiusMiles[] = [0.25, 0.5, 0.75, 1.0, 1.5] as const

/**
 * User-configurable settings persisted across app launches. Anything
 * the Settings tab writes ends up here.
 *
 * Note: `Display` section fields ("Sort by Proximity", "Max results 20")
 * are informational-only in v1.0 per HANDOFF.md §B2 — they don't appear
 * on this shape until they're wired to something.
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

/**
 * Sync status for the "Changes sync to glasses automatically" card in
 * the Settings tab. Drives the idle/spinner/check/error visual.
 */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

/**
 * Top-level phone state. Grows as Phases 5 + 6 land; the fields here
 * are what the Settings tab needs in isolation.
 */
export interface PhoneState {
  settings: Settings
  syncStatus: SyncStatus
  /** Last sync error message (only meaningful when syncStatus === 'error'). */
  syncError: string | null
}

export const INITIAL_PHONE_STATE: PhoneState = {
  settings: DEFAULT_SETTINGS,
  syncStatus: 'idle',
  syncError: null,
}

/**
 * Reducer events. Keep this list tight — anything that doesn't directly
 * mutate PhoneState belongs in an effect or the UI layer, not here.
 */
export type PhoneEvent =
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

/**
 * Side-effects the reducer emits. The phone UI (or a test harness) runs
 * them — the reducer stays pure. Mirrors the glasses-side pattern in
 * `src/glasses/state.ts`.
 */
export type PhoneEffect =
  /** Persist the given settings to storage. */
  | { type: 'persist-settings'; settings: Settings }
  /** Notify the glasses reducer that settings changed (via dispatch bus). */
  | { type: 'broadcast-settings'; settings: Settings }

/** Reducer return shape. */
export interface ReduceResult {
  state: PhoneState
  effects: readonly PhoneEffect[]
}
