# Wander v1.8 — Code Review
_Date: 2026-06-16 | SDK: @evenrealities/even_hub_sdk v0.0.10_

---

## Executive Summary

Wander v1.8 is in good structural shape — the reducer/effect/render split is clean, the SDK is used correctly at the critical points, and the glasses display layout is well-reasoned. The highest-severity issues are a persistent phone-side bug where sort and maxResults settings are silently dropped on NearbyTab fetches, the fact that the glasses bridge always uses GPS regardless of the manual location the user set on the phone, and stale-distance data on the Saved tab. Several code-quality items from the last review are still open.

---

## Previous Review Items — Status

| Item | Status |
|------|--------|
| Phone fetch omits `sort`/`maxResults` to glasses | **Still present** — fixed for glasses-side in `effects.ts`, but the phone's `fetch-nearby-pois` in `App.tsx:174` still calls `fetchPois` without these params |
| Favorites parsed without schema validation | **Still present** — `bridge.ts:161` and `App.tsx:229` both do a raw `JSON.parse(raw) as Poi[]` cast with no field guards |
| `haversine` duplicated 3× | **Still present** (now 4×) — `state.ts:724`, `render.ts:790`, `api/poi.ts:530`, and `minimap.ts:bearingBetween` all contain a private copy |
| `bearing` duplicated 2× | **Still present** (now 3×) — `render.ts:801`, `api/poi.ts:541`, `minimap.ts:bearingBetween` |
| Dead `resetNearby` / `withNearby` | **Still present** — `phone/state.ts:222` exports `resetNearby` (no callers); `withNearby` at line 227 is suppressed with `void withNearby` |
| Unused deps `clsx`, `cva`, `tailwind-merge` | **Still present** — all three in `package.json` dependencies; none imported anywhere in the source |

---

## SDK / Platform Compliance

### 1. `react-router` in runtime dependencies (Low)

`package.json` lists `react-router: ^7.9.0` under `dependencies`, not `devDependencies`. The package is only present to satisfy `even-toolkit`'s optional peer dep (worked around via `vite.config.ts` resolve alias). Keeping it in runtime dependencies means it gets bundled into the EHPK and loaded at startup — unnecessary weight for something that's never called.

**Fix:** Move to `devDependencies` or add it to `optimizeDeps.exclude` and verify the alias trick still works.

### 2. containerName lengths — all safe

Verified: longest name is `'actions-header'` (14 chars). SDK limit is 16. No violation.

### 3. ImageRawDataUpdate serial call requirement — correctly handled

`bridge.ts:pushMinimap` uses `await` before the `updateImageRawData` call and the outer `pushScreen` doesn't call minimap concurrently. Compliant.

---

## Correctness Bugs

### Bug 1 — Phone NearbyTab drops user's sort and maxResults settings (High)

**File:** `src/phone/App.tsx:174–184`

The `fetch-nearby-pois` effect handler calls:

```ts
fetchPois({
  lat: effect.lat,
  lng: effect.lng,
  radiusMiles: effect.settings.radiusMiles,
  categories: categoryIdsToCategories(effect.settings.enabledCategories),
})
```

`sort` and `limit` are never passed. The server defaults to proximity sort and 20 results, so a user who set "Sort by name" or "Max results: 10" in Settings will see those settings applied on the glasses but never in the phone's Nearby tab. The fix is one line — the glasses-side version in `effects.ts:128–137` shows the correct call pattern.

### Bug 2 — Manual location doesn't affect the glasses (High)

**File:** `src/glasses/effects.ts:234–261` (`defaultGeolocate`)

When a user pins a manual location on the phone, the phone-side Nearby tab correctly uses it (`phone/state.ts:97`). But the glasses-side `EffectRunner` calls `navigator.geolocation.getCurrentPosition()` directly in `defaultGeolocate` and never reads the `wander_manual_location` storage key. The glasses will always geolocate from the device's GPS position, showing different POIs than the phone when manual override is active.

The fix is to read `bridge.getLocalStorage('wander_manual_location')` at the start of `runFetchPois` and skip `geolocate()` if a valid manual location is found.

### Bug 3 — Favorites cast without field validation (Medium)

**File:** `src/glasses/bridge.ts:161–165`, `src/phone/App.tsx:229–233`

Both locations do `JSON.parse(raw) as Poi[]` with only an `Array.isArray` guard. A corrupt or stale storage entry (e.g., from a schema change in a future version) will silently inject objects missing required `Poi` fields (`id`, `name`, `lat`, `lng`, `distanceMiles`, etc.) into state. The glasses renderer and NearbyTab will see partially-formed POIs and could throw or display garbage.

**Fix:** After the `Array.isArray` check, filter items to those with at minimum `typeof id === 'string' && typeof name === 'string'` — the same guard already used in `storage.ts:275–282` for the nearby cache.

### Bug 4 — NearbyTab ignores metric units setting (Medium)

**File:** `src/phone/tabs/NearbyTab.tsx:294–297`

The local `formatDistance` function always outputs `ft`/`mi`. It does not read `state.settings.units`. Users who toggle "Metric units" in Settings will see meters/kilometers on the glasses but feet/miles in the phone's Nearby tab.

### Bug 5 — FavoritesTab ignores metric units and shows stale distances (Medium)

**File:** `src/phone/tabs/FavoritesTab.tsx:15–18`

`formatMiles` always uses imperial. Additionally, the `distanceMiles` stored on each favorite is frozen at the time the user saved it — someone who saved "Central Park" while standing in it will see "0.0 mi" when they view their Saved tab from another city. The distance shown is factually wrong after any significant movement.

### Bug 6 — LocationSearchForm calls setState after potential unmount (Low)

**File:** `src/phone/components/LocationSearchForm.tsx:36–49`

The debounce `useEffect` correctly cancels the timeout in its cleanup, but if the component unmounts after the 300ms debounce fires but before `searchLocations()` resolves, the `.then()` callback will call `setResults` and `setStatus` on an unmounted component. In React 18 this is a no-op warning rather than a crash, but it indicates the async path doesn't track mount state.

---

## Glasses UX

### G1 — ACTION_LABEL 'close' is labelled '← Back' (Medium)

**File:** `src/glasses/render.ts:449`

The action menu has two back-like actions:
- `close: '← Back'` — actually returns to POI_DETAIL (the read view)
- `back: 'Back to List'` — returns to POI_LIST

`'← Back'` is the wrong label. A user on POI_ACTIONS tapping `← Back` will land on POI_DETAIL, not POI_LIST, which is the natural expectation for a "back" action in a drill-down list. The correct label would be `'← Close menu'` or `'← View Details'` to signal this returns to the detail view.

### G2 — Heading arrow in NAV_ACTIVE is always destination-pointing, not route-following (Medium)

**File:** `src/glasses/render.ts:536`

`headingToNextPoint` computes a straight-line bearing from the user's position to the destination — not to the next route waypoint. On a winding street, the displayed arrow may point through a building while the actual next turn is 90° different. The arrow should use the next route geometry point (the step's `endPoint`) as its target, not the final destination.

### G3 — Position triangle in minimap always points north (Low)

**File:** `src/glasses/bridge.ts:312`

`headingDegrees: null` is always passed to `pushMinimap`. The triangle marker therefore points straight up regardless of actual travel direction. `navigator.geolocation.watchPosition` delivers `coords.heading` when the device is moving — this should be captured in `defaultWatchPosition` and forwarded into `MinimapInput`.

### G4 — WIKI_READ scroll-up on page 0 is a dead gesture (Low)

**File:** `src/glasses/state.ts:592–600`

`onCursorMove` for WIKI_READ clamps `pageIndex` to `[0, max]`. Scrolling up on page 0 does nothing (clamped to 0, no dispatch). This is the correct behavior, but the user has no way to know they're on the first page except by counting their scroll-ups. The wiki header already shows `1/N` pagination — consider showing `◄` and `►` markers in the header when prev/next pages exist.

### G5 — "↻ Refresh nearby" on POI_LIST does not show stale-data age (Low)

**File:** `src/glasses/render.ts:268`

The sentinel is always labelled `'↻ Refresh nearby'` with no indication of how old the current data is. On the phone, the RefreshBar shows "Updated 5 min ago". On glasses there's no equivalent. After the 5-minute background refresh the list updates silently — the user never knows the last time it happened.

---

## Phone UX

### P1 — SettingsTab uses `text-text-secondary` — may be undefined (High)

**File:** `src/phone/tabs/SettingsTab.tsx:106, 130, 179, 186, 251, 253, 285`

The design tokens (from `even-toolkit` and the Even Hub design guidelines) define `--color-text` and `--color-text-dim`. `text-text-secondary` is not in the design token set — if this class resolves to nothing, all secondary text in the Settings tab is invisible. The correct class is `text-text-dim`. This is a consistent pattern throughout the file.

### P2 — `formatDistance` duplicated with inconsistent output across phone tabs (Medium)

**Files:** `NearbyTab.tsx:294`, `FavoritesTab.tsx:15`, `render.ts:704`

Three separate implementations of the same miles→display-string conversion, with slight differences:
- NearbyTab appends `" away"` (`"0.3 mi away"`)
- FavoritesTab omits `" away"` (`"0.3 mi"`)
- Glasses render doesn't suffix anything

These should be consolidated into a shared utility. The inconsistency makes the phone feel disjointed between tabs.

### P3 — Nearby tab auto-refresh runs on every mount, not just first session (Low)

**File:** `src/phone/tabs/NearbyTab.tsx:93–97`

```ts
useEffect(() => {
  if (nearby.fetchStatus === 'idle') {
    dispatch({ type: 'nearby-refresh-requested' })
  }
}, [])
```

`fetchStatus` starts as `'idle'` each session. This is correct on first load, but if the component unmounts and remounts (e.g., tab switch), the fetch status will already be `'success'` from the cached data, so no double-fetch occurs. The existing guard handles this correctly — but it only triggers once because of the empty dependency array and the `'idle'` check. Document that the intent is "fire on first mount only if never fetched."

### P4 — Manual location change doesn't give glasses an updated position (Medium)

**File:** `src/phone/state.ts:182–197`

When `manual-location-selected` fires, `broadcast-settings` is dispatched which sends the new settings (including `manualLocation`) to the glasses bridge. The bridge's `handleSettingsChanged` listener picks this up and dispatches `settings-changed` to the glasses reducer, which then triggers `fetch-pois`. The glasses `EffectRunner.runFetchPois` then calls `defaultGeolocate()` which ignores the manual location. This is the same root cause as Bug 2 — the broadcast is correct but the glasses don't act on the manual location field.

### P5 — No visual feedback when glasses go offline during navigation (Low)

The `wander-g2-status` CustomEvent drives a small dot in the header (amber = disconnected). If the glasses disconnect during active navigation, the user has no indication beyond the small header dot that GPS updates have stopped and reroute is impossible. A toast or inline banner on the Nearby/Settings tabs would be more prominent.

---

## Code Quality & Inefficiencies

### Q1 — `haversine` and `bearing` each exist in 3–4 files (Medium)

Current duplication map:
| Function | Files |
|---|---|
| `haversine(lat1, lng1, lat2, lng2)` | `state.ts:724`, `render.ts:790`, `api/poi.ts:530` |
| `bearing(lat1, lng1, lat2, lng2)` | `render.ts:801`, `api/poi.ts:541`, `minimap.ts:bearingBetween` |

All three `haversine` implementations are bit-for-bit identical. Consolidate into `src/glasses/geo.ts` (client) and `api/_lib/geo.ts` (server). `render.ts` and `state.ts` can both import from the client module.

### Q2 — `resetNearby` exported but unused; `withNearby` suppressed with `void` (Low)

**File:** `src/phone/state.ts:222–231`

`resetNearby` is exported but has no callers. `withNearby` has a `void withNearby` line to suppress TypeScript's unused-variable error — this pattern is non-standard and confusing. Both should be deleted.

### Q3 — Unused npm dependencies (Low)

`clsx`, `class-variance-authority`, and `tailwind-merge` appear in `dependencies` and are never imported anywhere in the source. These inflate the bundle and create a false impression of utility usage. Run `npm uninstall clsx class-variance-authority tailwind-merge` and verify the build passes.

### Q4 — `NearbyTab` timer tick state is redundant (Low)

**File:** `src/phone/tabs/NearbyTab.tsx:101–105`

```ts
const [, setTick] = useState(0)
useEffect(() => {
  const id = setInterval(() => setTick((t) => t + 1), 60_000)
  return () => clearInterval(id)
}, [])
```

The tick value forces a re-render every 60s to refresh "Updated X min ago". A simpler approach: compute the label inside the render function directly from `Date.now()` and the stored `lastFetchTs`, then pass a key to `RefreshBar` that changes on the minute boundary. Alternatively, the current pattern is fine — it's minor.

### Q5 — `void withNearby` pattern should not be used to suppress TS errors (Low)

**File:** `src/phone/state.ts:231`

The comment says "Mark as used — withNearby is intentionally available for future callers." If it has no current callers, delete it. The `void` trick defeats TypeScript's intent (catching dead code) and implies the function is needed when it isn't.

---

## Features — Incomplete or Spec'd but Missing

### F1 — Manual location not bridged to glasses (Critical gap)

The v1.8 spec introduced manual location override. The phone side is fully implemented. The glasses side was explicitly noted as "phone-side only; glasses still geolocate independently" (memory record). This means using manual override produces a split experience: the phone NearbyTab shows POIs near, say, Tokyo, while the glasses show POIs near the user's actual GPS location. Users will be confused when they set a location on their phone and see completely different results on their glasses.

### F2 — NearbyTab POI list is display-only (Medium gap)

The phone's Nearby tab groups POIs by category and shows distance/name. But tapping a POI does nothing — there's no detail view, no "navigate to this" flow, no way to act on a POI from the phone. The glasses are the only action surface. This is intentional by design but worth deciding: should phone-side POI items ever be tappable (to navigate, open in Maps, etc.)?

### F3 — Sort and maxResults silently ignored in phone NearbyTab (see Bug 1)

The settings are saved and broadcast to glasses, but the phone NearbyTab fetch in `App.tsx` ignores them.

---

## Features — Remove

### R1 — `resetNearby` and `withNearby` in `phone/state.ts`

Dead code. Delete both functions.

### R2 — `clsx`, `class-variance-authority`, `tailwind-merge` in `package.json`

Not used. Remove from dependencies.

### R3 — `react-router` from runtime `dependencies`

Only needed for the `even-toolkit` optional peer dep alias workaround. Move to `devDependencies` or document why it must remain in runtime deps.

---

## Net New Feature Ideas

### N1 — IMU head-tilt to scroll POI list (High value, achievable)

The G2 supports IMU data via `bridge.imuControl(true)`. A gentle head-tilt (positive Y-axis delta above a threshold) could scroll the POI list up or down without requiring the temple tap/swipe gesture. This is especially useful when the user's hands are full. The SDK's `IMU_Report_Data` (`x`, `y`, `z`) would need threshold tuning (field-test suggested: fire at `|y| > 0.8` sustained for 100ms).

### N2 — Auto-refresh when glasses reconnect (Medium value, easy)

`bridge.onDeviceStatusChanged` fires when the glasses connect or disconnect. Currently the app only updates the header dot. When transitioning from disconnected → connected, fire a `refresh-pois` effect automatically — the user likely put on the glasses and wants fresh data.

### N3 — Battery-aware minimap degradation (Medium value, easy)

`DeviceStatus.batteryLevel` is available via `onDeviceStatusChanged`. When battery drops below 20%, skip tile fetching in `encodeMinimapPng` (the most compute-heavy operation) and fall back to the black-canvas fitBounds path. Add a "⚡Low" badge in the nav header.

### N4 — "Search near this POI" pivot (Medium value, medium effort)

When on POI_DETAIL or POI_ACTIONS, add a "Search Nearby" action that fetches POIs centered on that POI's lat/lng rather than the user's position. Useful for trip planning: "find restaurants near the museum I'm visiting." The API already supports arbitrary lat/lng — no server changes needed.

### N5 — Recent history tab on phone (Medium value, medium effort)

A "Recent" tab alongside Nearby/Settings/Saved that shows the last 10–15 POIs the user navigated to (stored in `wander_nav_history` localStorage). Saves having to re-search for somewhere the user visited last week.

### N6 — Favorites quick-navigate from phone (Low value, easy)

The Saved tab shows favorites but tapping does nothing. Add a `→ Navigate` button per row that deep-links into the glasses navigation flow — dispatch a `broadcast-navigate` CustomEvent that `bridge.ts` can intercept to dispatch `fetch-route` for that POI. This gives the phone a role as a saved-places navigator launcher.

### N7 — POI filtering shortcut on glasses (Low value, medium effort)

Users currently must go to the phone to change categories or radius. A long-press (double-tap) from POI_LIST could show a mini-settings screen on the glasses with just the most-used toggles: radius up/down and a quick category shortcut (e.g., "food only"). Implemented as a new `QUICK_SETTINGS` screen state.

### N8 — Walking ETA improvement with actual route distance (Low value, easy)

`navBodyText` in `render.ts:536` uses `remainingDistanceMeters` which computes straight-line distance to the destination. The route itself may be significantly longer due to turns. Use `screen.route.totalDistanceMeters` as the base ETA source rather than the haversine to destination, then reduce it proportionally as steps are completed. This avoids the case where the ETA jumps up when the user turns a corner and the straight-line distance momentarily increases.

---

## Severity Summary

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| B1 | Phone NearbyTab drops sort/maxResults from settings | High | Correctness |
| B2 | Glasses bridge ignores manual location override | High | Correctness |
| P1 | SettingsTab uses `text-text-secondary` (undefined class) | High | Phone UX |
| B3 | Favorites loaded with no field validation | Medium | Correctness |
| B4 | NearbyTab ignores metric units setting | Medium | Correctness |
| B5 | FavoritesTab shows stale distances and ignores metric | Medium | Correctness |
| G1 | ACTION_LABEL 'close' says '← Back' (misleading) | Medium | Glasses UX |
| G2 | NAV heading arrow points to destination, not next waypoint | Medium | Glasses UX |
| P2 | `formatDistance` inconsistent across 3 phone locations | Medium | Phone UX |
| P4 | Manual location change doesn't update glasses position | Medium | Phone UX |
| Q1 | `haversine`/`bearing` duplicated 3–4× across files | Medium | Code quality |
| B6 | LocationSearchForm calls setState after unmount | Low | Correctness |
| G3 | Minimap position triangle always points north | Low | Glasses UX |
| G4 | WIKI_READ scroll-up on page 0 is silent no-op | Low | Glasses UX |
| G5 | POI_LIST has no data freshness indicator on glasses | Low | Glasses UX |
| P3 | Nearby auto-refresh intent not documented | Low | Phone UX |
| P5 | No feedback when glasses go offline during navigation | Low | Phone UX |
| Q2 | `resetNearby`/`withNearby` dead code | Low | Code quality |
| Q3 | `clsx`, `cva`, `tailwind-merge` unused in dependencies | Low | Code quality |
| Q4 | Tick timer pattern in NearbyTab is minor smell | Low | Code quality |
| R3 | `react-router` in runtime deps unnecessarily | Low | Dependencies |
