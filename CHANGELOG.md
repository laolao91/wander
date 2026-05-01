# Changelog

All notable changes to Wander will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-04-29

G2 status dot, geocoding, settings sync, nav tightened

### Added
- Phase 1 scaffold: Vite + React 19 + TypeScript + Tailwind v4
- even-toolkit web components + Even Hub SDK integration stub
- Vercel serverless function skeleton at `api/health.ts`
- `app.json` manifest and project structure per Wander build spec
- **Phase 2a** — `/api/wiki` endpoint: Wikipedia article fetch + 380-char
  pagination at word boundaries (uses Action API `extracts` instead of
  the spec's referenced REST `plain` endpoint — that path does not exist)
- **Phase 2a** — `/api/route` endpoint: OpenRouteService foot-walking
  proxy with simplified step + geometry output tuned for G2 NAV_ACTIVE
- **Phase 2b** — `/api/poi` endpoint: merges Wikipedia GeoSearch
  (via `generator=geosearch`) and Overpass (OSM) into a single,
  deduped, distance-sorted, category-filtered POI list. Dedupe uses
  a 25m radius + name similarity so nearby distinct businesses aren't
  collapsed (tightened from spec's 20m). Wikipedia preferred on ties.
- **Phase 2b** — Overpass mirror fallback: tries Kumi Systems → main →
  private.coffee, with HTML-at-200 detection for the common "server
  too busy" error that previously silently dropped all OSM results.
- **Phase 3 prep** — Glasses-side scaffolding, no SDK wiring yet:
  - `src/glasses/api.ts` — typed client wrappers around `/api/poi`,
    `/api/wiki`, `/api/route`. Pure functions, AbortSignal-aware,
    composable with caller cancellation. All errors normalize to
    `ApiError` with `endpoint`/`status`/`detail`.
  - `src/glasses/screens/types.ts` — discriminated union for the 8
    screens per spec §6 (LOADING, POI_LIST, POI_DETAIL, NAV_ACTIVE,
    WIKI_READ, ERROR_LOCATION, ERROR_NETWORK, ERROR_EMPTY). Data
    lives on the variant so invalid combinations are unrepresentable.
    Includes `ALLOWED_TRANSITIONS` map enforced by the reducer.
  - `src/glasses/state.ts` — pure reducer (`reduce(state, event)
    → { state, effects }`). 21 unit tests cover happy paths, GPS
    edge cases, OSM-only POI action menu collapse, background
    refresh stash + apply-on-back, and transition guard. Bridge
    layer (Phase 3 proper) executes the effects.
- **Phase 2c** — Localization across all three public endpoints:
  accept `?lang=` query param, fall back to `Accept-Language` header,
  default to `en`. `/api/wiki` and `/api/poi` route Wikipedia calls
  to the matching language subdomain; `/api/route` passes the locale
  through to ORS for localized walking instructions (falls back to
  English for languages ORS doesn't support). Regional subtags like
  `fr-CA` are stripped to the base code. All responses set
  `Vary: Accept-Language` so edge caches don't cross-contaminate.
- **Phase 3 (text-only)** — End-to-end glasses app, minimap deferred:
  - `src/glasses/render.ts` — pure transforms from `Screen` →
    `RebuildPageContainer` (full layout) and `TextContainerUpgrade`
    (in-place updates for cursor moves, wiki page flips, NAV_ACTIVE
    position ticks). Layout is 576×288, 48px header + 240px body, with
    stable container IDs (1=main, 2=body, 3=list) so upgrades target
    the same container across rebuilds. NAV_ACTIVE is text-only this
    iteration: 8-cardinal arrow + haversine remaining distance + the
    current step instruction. Canvas minimap deferred to a focused
    fresh session.
  - `src/glasses/effects.ts` — `EffectRunner` class executes the
    reducer's `Effect[]`. `navigator.geolocation`, `window.open`, and
    `watchPosition` are dependency-injected so the runner is testable
    without a DOM. ApiError 400 from `/api/poi` is reclassified as a
    location failure (the endpoint rejects missing/invalid lat/lng
    with that status). `backgroundRefresh()` is a separate entry
    point so the resulting `pois-loaded` event carries
    `isBackgroundRefresh: true`.
  - `src/glasses/bridge.ts` — replaces the splash-only Phase 1 stub
    with the full main loop: boot via `createStartUpPageContainer`,
    kick off the first POI fetch, start a 5-minute background refresh
    timer, subscribe to `onEvenHubEvent`. After every dispatch, push
    the new screen via `textContainerUpgrade` when the screen-kind is
    unchanged (cheap), else `rebuildPageContainer`. Glasses event
    translation factored into `translateGlassesEvent()` and exported
    for testing — list events carry an item index, text/sys events
    use the cursor; double-click is "exit" on top-level screens and
    "back" elsewhere.
  - 49 new tests added (88 total): 27 for render, 13 for effects,
    9 for bridge translation, on top of the existing 21 reducer +
    18 API tests. Build is clean; only the simulator smoke test
    remains for the user.
- **Phase 4** — NAV_ACTIVE minimap (canvas → PNG → SDK image container):
  - `src/glasses/minimap.ts` — pure geometry helpers (`fitBounds`,
    `projectPoint` with equirectangular cos(lat) correction,
    `dashSegments`, `trianglePath`, `bearingBetween`) plus the
    DOM-only `drawMinimap`/`encodeMinimapPng` that paint a 240×120
    canvas and return PNG bytes. Image format is PNG — the host owns
    the gray4 conversion (the SDK exposes the failure mode as
    `ImageRawDataUpdateResult.imageToGray4Failed`).
  - `src/glasses/render.ts` — NAV_ACTIVE expanded to a 3-container
    layout: header text on top, body text in the left column (336px),
    minimap image on the right (240×120, vertically centred). Body
    text wraps at the narrower 38-char width.
  - `src/glasses/bridge.ts` — after every NAV_ACTIVE rebuild or
    in-place update, encode the minimap to PNG and push it via
    `updateImageRawData`. Failures log a warning instead of derailing
    nav (the text body is still useful on its own).
  - 17 new tests (122 total): bbox sizing, projection direction
    (north=up, padding respected), dash math along straight lines and
    L-shapes, triangle orientation for all 4 cardinals, bearing math
    for due-N/E. Canvas drawing tested by the simulator, not in unit
    tests (skipped DOM environment to keep tests fast).
