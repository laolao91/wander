# Changelog

All notable changes to Wander will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.12.0] - 2026-07-04

Full fix pass from a fresh code review (`Wander_v2_Research.md`): fixed 3 High-severity
bugs — persisted settings (including manual location) never reached the glasses at boot
(`settings-hydrated` now broadcasts on hydration, not just on later changes); retrying
after a failed route or Wikipedia fetch dead-ended on a blank loading screen with nothing
in flight (added `RetryContext` so retry restores the exact originating screen and
re-fires the exact request); `/api/geocode` was called with relative URLs, breaking
manual-location search in installed builds (now uses the same absolute `API_BASE` fix
applied to `/api/poi` in v1.0.2). Fixed 6 Medium-severity bugs: a manual location set
during active navigation could teleport the nav position and falsely trigger arrival;
the POI list's native selection border and the app-drawn cursor could point at different
rows (native border now disabled); settings changes could fan out into redundant fetches
(units-only changes now skip the refetch, and the phone debounces location lookups);
overlapping minimap pushes during navigation could apply out of order (now serialized);
phone geolocation had no timeout guard against a hung native callback; server logs no
longer record full-precision coordinates. Cleaned up 9 low-severity items: deduplicated
haversine/bearing and DEV-mock-coordinate logic, dropped a redundant Wikipedia API call,
removed dead code, added a post-build bundle scan (catches unwhitelisted URLs baked into
dependencies, not just hand-written source), and migrated phone settings storage to
`bridge.setLocalStorage` per spec, with a safe fallback. Added a new Language setting in
Settings, threaded end-to-end from the phone UI to the glasses' POI/route/Wikipedia
requests (20 languages, matching what the routing engine supports). Also fixed a
user-reported bug: "Open in Maps"/"Website" links failing on Android with a WebView error
(Google's Android app-handoff link isn't understood by the embedded WebView; now opens
via the OS browser instead, reusing a fix already proven for the glasses' "Open in
Safari" action).

## [1.11.0] - 2026-06-26

Fixed two missing `network.whitelist` entries in `app.json` that caused the
v1.10.0 EvenHub store submission to be rejected: `https://www.google.com`
(Google Maps deep-link built in the Nearby tab) and `https://gitlab.com`
(APPS Bridge project link in the Settings tab). Added a vitest pre-submission
gate (`src/__tests__/network-whitelist.test.ts`) that scans all frontend source
files and fails if any `http`/`https` URL is not prefixed by a whitelist entry,
so this class of rejection is caught before packing.

## [1.10.0] - 2026-06-22

Added the Even Hub SDK's native phone-location bridge (`@evenrealities/even_hub_sdk`
0.0.11's `getAppLocation`/`startAppLocationUpdates`/`stopAppLocationUpdates`/
`onAppLocationChanged`) as a new shared module, `src/glasses/sdkLocation.ts`
(`sdkGeolocate()` one-shot, `sdkWatchPosition()` continuous — same defensive
"never throws, resolves null/no-ops on any failure" contract as the existing
APPS Bridge client). Wired in as an **additional** location source ahead of
the existing chain, not a replacement: source priority is now SDK bridge →
`navigator.geolocation` → APPS Bridge, i.e. anything Even-Realities-native
(the new SDK call and `navigator.geolocation` alike) is tried before the
third-party APPS Bridge fallback, which stays exactly where it was — last
resort. The new SDK call goes through the same native bridge channel as
`getUserInfo()`/`getDeviceInfo()` rather than `navigator.geolocation`'s
WebView permission plumbing, so it may sidestep the long-standing Android
permission-forwarding gap — but, like the APPS Bridge fallback before it,
this is **unconfirmed on real hardware**. Behavior is unchanged when the
host SDK doesn't support the new calls (older Even Hub versions): every new
call is wrapped so a missing/rejecting bridge method falls straight through
to the existing navigator/bridge logic, unchanged.

**Modified:**
- `src/glasses/effects.ts` — `defaultGeolocate()` now tries `sdkGeolocate()`
  first (full internal timeout) before its existing navigator/wall-clock/
  APPS-Bridge logic, untouched below that point. `defaultWatchPosition()`
  now starts `sdkWatchPosition()` unconditionally alongside whichever
  navigator/bridge watch starts below — consistent with this function's
  existing "concurrent redundant sources, duplicate updates are harmless"
  pattern — and the returned cancel function tears down every source that
  got started.
- `src/phone/App.tsx` — the `request-location` effect case tries
  `sdkGeolocate()` first (after the manual-location and DEV-mock checks,
  unchanged); on an empty result it falls through to the pre-existing
  navigator.geolocation → APPS Bridge logic, extracted verbatim into a new
  exported helper, `requestLocationViaNavigatorOrBridge()`, so it can run
  as a second-tier fallback and be tested directly.

**New files:**
- `src/glasses/sdkLocation.ts` + `src/glasses/__tests__/sdkLocation.test.ts`
  (11 tests against an injected fake bridge — success, null result,
  rejection, bridge-unavailable, non-finite/missing coordinates, watch
  subscribe/start/cancel ordering, and the cancel-before-bridge-resolves
  race).
- `src/phone/__tests__/runEffect.test.ts` (6 tests covering the
  `request-location` effect's new source ordering and the extracted
  `requestLocationViaNavigatorOrBridge` helper in isolation).

Also extended `src/glasses/__tests__/effects.test.ts` with 5 new tests
covering `defaultGeolocate`/`defaultWatchPosition`'s new ordering (both
functions are now exported from `effects.ts` for this purpose — purely
additive, no existing behavior changed). Test suite: 358 tests across 16
files (was 336/14 before this change). `min_sdk_version` in `app.json` is
intentionally left at `0.0.10` — the new calls degrade gracefully on older
hosts, so this isn't a hard requirement, just an opportunistic additional
source.

## [1.9.0] - 2026-06-21

Added an APPS Bridge fallback for GPS on Android (`src/glasses/appsBridge.ts`).
When `navigator.geolocation` fails, times out, or is unavailable, Wander now
tries the optional third-party "APPS Bridge" Android companion app
(`ws://127.0.0.1:7071`) before giving up — this routes around the long-standing
host-WebView permission-forwarding bug independently of Even Realities fixing
it. Native geolocation remains the primary path everywhere; the bridge is
purely a fallback, and behavior is unchanged when it isn't installed/running.
Added `"ws://127.0.0.1:7071"` to `app.json`'s `network` permission whitelist
as a defensive measure (unconfirmed whether Even Hub enforces this for
WebSocket at runtime — see HANDOFF_v1.9.md for the open on-device test). Also
extended the `network` permission's `desc` to explain the loopback entry to
reviewers, and added a phone-side transparency badge ("🌐 Bridge") plus a
Settings hint pointing Android users at APPS Bridge when native GPS fails.

Route-aware nav ETA (`remainingDistanceMeters` in `src/glasses/render.ts`):
remaining distance now sums the live leg to the current route step's
end-point plus every later step's own distance, instead of a straight-line
haversine to the destination — fixes the ETA visibly jumping when rounding a
corner.

Device-status reactions in `src/glasses/bridge.ts`: POIs now auto-refresh on
a glasses reconnect (`isReconnectTransition`), and the NAV_ACTIVE minimap
skips its street-tile fetch entirely below 20% battery (`isLowBattery`),
falling back to the existing plain-black + fitBounds rendering.

## [1.2.0] - 2026-05-02

Navigation and UX overhaul. Double-tap now goes back to the previous screen
on every screen; at the top level (POI list, errors) it calls EvenHub's native
exit dialog (shutDownPageContainer(1)) instead of the custom confirm screen.
Tap in NAV_ACTIVE re-routes from your current GPS position instead of
stopping navigation. NAV_ACTIVE double-tap returns to POI_DETAIL (not the
list), preserving context. POI_ACTIONS gains a "← Back" option to dismiss
the menu and return to detail without navigating or going back to the list.
Settings category/radius changes now auto-refresh the Nearby tab on the phone.

## [1.1.2] - 2026-05-02

Fix API calls failing when app is installed via EvenHub (CORS). All four
API endpoints now return Access-Control-Allow-Origin: * and handle OPTIONS
preflight. Root cause: prototype/QR mode is same-origin so no CORS needed;
installed EHPK is cross-origin so headers are required.

## [1.1.1] - 2026-05-02

Phone companion now shows version number (v1.1.1) above the tab bar.
Dev simulator geo mock added to phone companion (reads VITE_MOCK_LAT/LNG
from .env.local, tree-shaken in production builds).

## [1.1.0] - 2026-05-01

Street tile minimap: NAV_ACTIVE minimap now renders CARTO dark street
tiles via new `/api/map` proxy. Route markers projected in Web Mercator
tile-pixel space so position triangle lands on the correct street.
Silent fallback to plain-black canvas if tiles fail.

## [1.0.2] - 2026-04-29

Fix API calls failing in EvenHub WebView (absolute URL in production)

## [1.0.1] - 2026-04-29

G2 status dot, geocoding, settings sync, nav tightened

## [1.0.0] - 2026-04-29

Initial release

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
