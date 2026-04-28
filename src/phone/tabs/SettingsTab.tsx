/**
 * Settings tab — Search Radius, Categories, Display (read-only), sync info.
 *
 * Phase H (2026-04-26): first real Settings UI on top of the scaffolding
 * in types.ts / state.ts / storage.ts. Pure view: receives PhoneState +
 * dispatch, never calls storage or bridge directly.
 *
 * Mockup source: `Point of Interest App/wander-mockup.html` lines 1030-1138
 * ("PHONE SCREEN 2: Settings Tab").
 */

import { SettingsGroup, ListItem, Toggle, Slider, Card } from 'even-toolkit/web'
import type { PhoneState, PhoneEvent, CategoryId, RadiusMiles } from '../types'
import { ALL_CATEGORIES, RADIUS_CHOICES } from '../types'

// ─── Display metadata ────────────────────────────────────────────────────

const RADIUS_LABELS: Record<RadiusMiles, string> = {
  0.25: '¼ mi',
  0.5: '½ mi',
  0.75: '¾ mi',
  1.0: '1 mi',
  1.5: '1½ mi',
}

interface CategoryMeta {
  glyph: string
  label: string
}

// Glyphs + labels from mockup spec (HANDOFF_2026-04-26_part2.md §3.8).
const CATEGORY_META: Record<CategoryId, CategoryMeta> = {
  historic:    { glyph: '★', label: 'Historic & Landmarks' },
  parks:       { glyph: '■', label: 'Parks & Nature' },
  museums:     { glyph: '▲', label: 'Museums & Galleries' },
  religious:   { glyph: '†', label: 'Religious Sites' },
  publicArt:   { glyph: '○', label: 'Public Art' },
  libraries:   { glyph: '◉', label: 'Libraries & Education' },
  restaurants: { glyph: '◆', label: 'Restaurants & Cafes' },
  nightlife:   { glyph: '●', label: 'Bars & Nightlife' },
}

// ─── Component ───────────────────────────────────────────────────────────

export interface SettingsTabProps {
  state: PhoneState
  dispatch: (e: PhoneEvent) => void
}

export function SettingsTab({ state, dispatch }: SettingsTabProps) {
  const { settings, syncStatus, syncError } = state

  // ── Radius slider ────────────────────────────────────────────────────
  // Slider is index-based (0..4) because the 5 radius values aren't evenly
  // spaced — mapping by index is simpler than custom step math.
  const radiusIndex = RADIUS_CHOICES.indexOf(settings.radiusMiles)

  function handleRadiusChange(raw: number) {
    const idx = Math.round(raw) as 0 | 1 | 2 | 3 | 4
    const clamped = Math.max(0, Math.min(4, idx))
    const mi = RADIUS_CHOICES[clamped] as RadiusMiles
    dispatch({ type: 'radius-changed', radiusMiles: mi })
  }

  // ── Category toggles ─────────────────────────────────────────────────
  function handleCategoryToggle(category: CategoryId) {
    dispatch({ type: 'category-toggled', category })
  }

  // ── Sync status text ─────────────────────────────────────────────────
  const syncLabel: string =
    syncStatus === 'syncing'
      ? 'Syncing to glasses…'
      : syncStatus === 'error'
        ? (syncError ?? 'Sync failed — tap Refresh on the Nearby tab to retry.')
        : 'Changes sync to glasses automatically. Tap Refresh on the Nearby tab to reload results.'

  // ─────────────────────────────────────────────────────────────────────

  return (
    <div className="px-3 pt-4 pb-8 space-y-6">

      {/* ── Search Radius ── */}
      <SettingsGroup label="Search Radius">
        <div className="px-2 pt-3 pb-1">
          <Slider
            value={radiusIndex === -1 ? 2 : radiusIndex}
            onChange={handleRadiusChange}
            min={0}
            max={4}
            step={1}
          />
          {/* Tick labels below the track — 5 values, spaced evenly */}
          <div className="flex justify-between mt-2">
            {RADIUS_CHOICES.map((r) => (
              <span
                key={r}
                className={
                  r === settings.radiusMiles
                    ? 'text-[12px] font-semibold text-text'
                    : 'text-[12px] text-text-secondary'
                }
              >
                {RADIUS_LABELS[r]}
              </span>
            ))}
          </div>
        </div>
      </SettingsGroup>

      {/* ── Categories ── */}
      <SettingsGroup label="Categories">
        {ALL_CATEGORIES.map((cat) => {
          const { glyph, label } = CATEGORY_META[cat]
          const enabled = settings.enabledCategories.includes(cat)
          return (
            <ListItem
              key={cat}
              title={label}
              leading={
                <span className="text-[18px] w-7 text-center select-none" aria-hidden>
                  {glyph}
                </span>
              }
              trailing={
                <Toggle
                  checked={enabled}
                  onChange={() => handleCategoryToggle(cat)}
                />
              }
              onPress={() => handleCategoryToggle(cat)}
            />
          )
        })}
      </SettingsGroup>

      {/* ── Display (read-only) ── */}
      <SettingsGroup label="Display">
        <ListItem
          title="Sort by"
          trailing={
            <span className="text-[14px] text-text-secondary">Proximity</span>
          }
        />
        <ListItem
          title="Max results"
          trailing={
            <span className="text-[14px] text-text-secondary">20</span>
          }
        />
      </SettingsGroup>

      {/* ── Sync info card ── */}
      <Card>
        <p className="text-[13px] leading-snug tracking-[-0.1px] text-text-secondary">
          {syncLabel}
        </p>
      </Card>

    </div>
  )
}
