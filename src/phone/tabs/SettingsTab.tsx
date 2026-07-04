/**
 * Settings tab — Search Radius, Categories, Display (read-only), sync info.
 *
 * Phase H (2026-04-26): first real Settings UI on top of the scaffolding
 * in types.ts / state.ts / storage.ts. Pure view: receives PhoneState +
 * dispatch, never calls storage or bridge directly.
 *
 * 2026-04-27 fixes:
 *   - w-full on outer wrapper + SettingsGroup — content now fills screen
 *   - Removed onPress from category ListItem — Toggle pill is the sole tap
 *     target (onPress + Toggle.onChange both called handleCategoryToggle,
 *     causing a double-toggle that appeared as a no-op)
 *
 * Mockup source: `Point of Interest App/wander-mockup.html` lines 1030-1138
 * ("PHONE SCREEN 2: Settings Tab").
 */

import { useState } from 'react'
import { SettingsGroup, ListItem, Toggle, Slider, Card, Select } from 'even-toolkit/web'
import type { PhoneState, PhoneEvent, CategoryId, RadiusMiles, MaxResults, ManualLocation } from '../types'
import { ALL_CATEGORIES, RADIUS_CHOICES, MAX_RESULTS_CHOICES } from '../types'
import { LocationSearchForm } from '../components/LocationSearchForm'
import { SUPPORTED_LANGUAGES } from '../lib/languages'

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
  const [isEditingLocation, setIsEditingLocation] = useState(false)

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

  // ── Max results slider ───────────────────────────────────────────────
  const maxResultsIndex = MAX_RESULTS_CHOICES.indexOf(settings.maxResults as MaxResults)

  function handleMaxResultsChange(raw: number) {
    const idx = Math.round(raw) as 0 | 1 | 2
    const clamped = Math.max(0, Math.min(2, idx))
    dispatch({ type: 'max-results-changed', maxResults: MAX_RESULTS_CHOICES[clamped] })
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
    <div className="w-full px-4 pt-4 pb-8 space-y-6">

      {/* ── Manual Location ── */}
      <SettingsGroup label="Location" className="w-full">
        {!settings.manualLocation && !isEditingLocation && (
          <div className="px-3 py-2">
            <p className="text-[13px] text-text-dim mb-2">
              Pin a specific place instead of using GPS.
            </p>
            <button
              type="button"
              onClick={() => setIsEditingLocation(true)}
              className="text-[13px] text-accent font-medium"
            >
              Set location…
            </button>
          </div>
        )}

        {settings.manualLocation && !isEditingLocation && (
          <div className="px-3 py-2">
            <div className="flex items-start justify-between mb-1">
              <span className="text-[13px] font-semibold text-text">Manual Location</span>
              <span className="text-[10px] font-bold bg-yellow-400 text-black px-1.5 py-0.5 rounded ml-2 shrink-0">
                ACTIVE
              </span>
            </div>
            <p className="text-[12px] text-yellow-400 mb-1">📍 {settings.manualLocation.label}</p>
            <p className="text-[11px] text-text-dim mb-2">
              GPS is overridden. POIs are based on this location.
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setIsEditingLocation(true)}
                className="text-[12px] text-accent"
              >
                Change…
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'manual-location-cleared' })}
                className="text-[12px] text-red-400"
              >
                Clear (use GPS)
              </button>
            </div>
          </div>
        )}

        {isEditingLocation && (
          <div className="px-3 py-2">
            <LocationSearchForm
              onSelect={(loc: ManualLocation) => {
                dispatch({ type: 'manual-location-selected', location: loc })
                setIsEditingLocation(false)
              }}
              onCancel={() => setIsEditingLocation(false)}
            />
          </div>
        )}

        {/* Android GPS troubleshooting hint — independent of manual-location
            state, since this is about the GPS path itself. */}
        <div className="px-3 py-2 border-t border-border">
          <p className="text-[11px] text-text-dim">
            Android location not working? Wander automatically falls back to{' '}
            <a
              href="https://gitlab.com/homeauto.cc/appsbridge"
              target="_blank"
              rel="noreferrer"
              className="text-accent"
            >
              APPS Bridge
            </a>
            {' '}— a free companion app — when the phone's own GPS isn't reachable.
          </p>
        </div>
      </SettingsGroup>

      {/* ── Search Radius ── */}
      <SettingsGroup label="Search Radius" className="w-full">
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
                    : 'text-[12px] text-text-dim'
                }
              >
                {RADIUS_LABELS[r]}
              </span>
            ))}
          </div>
        </div>
      </SettingsGroup>

      {/* ── Categories ── */}
      {/* onPress intentionally omitted: Toggle.onChange is the sole tap
          target. Previously both fired handleCategoryToggle, causing a
          double-toggle that appeared as a no-op. */}
      <SettingsGroup label="Categories" className="w-full">
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
            />
          )
        })}
      </SettingsGroup>

      {/* ── Display (read-only) ── */}
      <SettingsGroup label="Display" className="w-full">
        <ListItem
          title="Metric units"
          trailing={
            <Toggle
              checked={settings.units === 'metric'}
              onChange={() =>
                dispatch({
                  type: 'units-changed',
                  units: settings.units === 'metric' ? 'imperial' : 'metric',
                })
              }
            />
          }
        />
        <ListItem
          title="Sort by name"
          trailing={
            <Toggle
              checked={settings.sort === 'name'}
              onChange={() =>
                dispatch({
                  type: 'sort-changed',
                  sort: settings.sort === 'name' ? 'proximity' : 'name',
                })
              }
            />
          }
        />
        <ListItem
          title="Max results"
          trailing={
            <span className="text-[14px] text-text-dim">
              {settings.maxResults}
            </span>
          }
        />
        <div className="px-2 pt-1 pb-3">
          <Slider
            value={maxResultsIndex === -1 ? 2 : maxResultsIndex}
            onChange={handleMaxResultsChange}
            min={0}
            max={2}
            step={1}
          />
          <div className="flex justify-between mt-1">
            {MAX_RESULTS_CHOICES.map((r) => (
              <span
                key={r}
                className={
                  r === settings.maxResults
                    ? 'text-[12px] font-semibold text-text'
                    : 'text-[12px] text-text-dim'
                }
              >
                {r}
              </span>
            ))}
          </div>
        </div>
        <ListItem
          title="Language"
          trailing={
            <Select
              value={settings.lang ?? 'en'}
              options={SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
              onValueChange={(value) =>
                dispatch({ type: 'lang-changed', lang: value === 'en' ? null : value })
              }
            />
          }
        />
      </SettingsGroup>

      {/* ── Sync info card ── */}
      <Card className="w-full">
        <p className="text-[13px] leading-snug tracking-[-0.1px] text-text-dim">
          {syncLabel}
        </p>
      </Card>

    </div>
  )
}
