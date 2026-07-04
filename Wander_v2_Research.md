# Wander v2 Research — Fresh Code Review, Backlog Audit, UI/UX Pass

_Date: 2026-07-03 | Base: v1.11.0 (submitted to EvenHub store 2026-06-27, live at `https://wander-six-phi.vercel.app`) | SDK: `@evenrealities/even_hub_sdk` ^0.0.11 | Verified this session: `tsc -b --noEmit` clean, `vitest run` 360/360 across 17 files_

This document is the planning input for the next build session(s). It contains three independent research passes merged into one prioritized roadmap:

1. **Code Health** — a fresh review of the *current* codebase (not a re-read of `Wander_Code_Review.md`, which reviewed v1.8; every claim there was re-verified against v1.11 source before being carried forward or dropped).
2. **Backlog Audit + New Use-Case Research** — the N1–N15 backlog from `Plugin_Research_v1.9.md` marked Shipped / Still-backlog with evidence, plus genuinely new research (post-2026-06-16) and new ideas N16–N21.
3. **UI/UX Review** — the dedicated design pass no prior doc did, grounded in the `Screenshots/` captures and the `everything-evenhub:design-guidelines` skill (invoked this session; treated as authoritative on hardware limits).

**Read this alongside** `HANDOFF_v1.10.md` (session log / quirks) and `Plugin_Research_v1.9.md` (competitive research + rejected-ideas table). Do not re-derive what those cover.

---

## Executive Summary

**Code health:** The v1.8 review's 21 findings are genuinely fixed — all re-verified (see §1.1). But this fresh pass found **three new High-severity bugs** that the old review missed because they live in boot/retry/production-URL paths rather than steady-state flows:

- **H1 — Persisted settings (including manual location) never reach the glasses at boot.** The glasses start every session on `DEFAULT_SETTINGS` and only learn the user's real settings if the user *changes* something on the phone afterwards. The B2/F1 "split experience" bug that v1.9 fixed for change-events is still fully present on the boot path.
- **H2 — Tapping "retry" after a failed route/wiki fetch strands the user on a LOADING screen forever.** The reducer emits no effect; nothing ever rescues the screen; the only escape is exiting the app.
- **H3 — Manual-location search and the reverse-geocode header label are broken in installed EHPK builds.** Both call `/api/geocode` with a *relative* URL — the exact bug class fixed for `/api/poi` back in v1.0.2, reintroduced when geocoding shipped in v1.8.

**Backlog:** Of N1–N15, exactly three shipped (N2, N3, N8 — all in v1.9); twelve remain open. New research found a **direct same-platform competitor**: `aleapc/storywalk-g2` ("Contextual tourism and running companion for Even Realities G2 — GPS-tracked POI storytelling", Wikipedia + Overpass, updated 2026-04-21). It is early-stage (0 stars) but it is building exactly N9 (proactive POI storytelling) on exactly this hardware — the strategic window for Wander's flagship differentiator is real but not infinite. Six new ideas (N16–N21) pass the hardware filter: offline cache-first boot, phone share sheet, multi-stop tours, accessibility pass, privacy/data-minimization, ETA-on-favorites. Nothing in the rejected-ideas table needs overturning — no new G2 hardware capabilities surfaced (SDK still 0.0.11; no speaker/camera/haptics news).

**UI/UX:** The glasses flow is structurally sound (container budgets far under limit, one `isEventCapture` per page, consistent error-screen pattern), but the screenshots expose three concrete rendering defects: the POI_DETAIL interaction hint clips off-screen on long summaries, the NAV body duplicates street names and wraps truncated lines (pushing its hint off-screen too), and the app-drawn `>` cursor visibly disagrees with the firmware's native selection border on POI_LIST. Phone-side, the biggest problems are light-theme contrast failures (yellow-on-white badges) and the Saved tab being a dead end (no remove, no navigate, no share).

**Single highest-priority action for the next session: fix H1** — it silently breaks the app's core promise (glasses show what you configured) on every single launch, and the fix is approximately two lines plus a test.

---

## 1. Code Health (Phase 1)

### 1.1 v1.8 review findings — re-verified against v1.11 source

Per project instruction, every `Wander_Code_Review.md` claim was treated as a hypothesis. Verification result: **all 21 findings are fixed in current source**, with two carrying residual caveats (Q1 server-side, B2/F1 boot path → H1).

| v1.8 finding | Status in v1.11 | Evidence (current file:line) |
|---|---|---|
| B1 phone drops sort/limit | **Fixed** | `src/phone/App.tsx:225-226` passes `sort`/`limit` |
| B2/P4/F1 glasses ignore manual location | **Fixed for change events; boot gap remains → see H1** | `src/glasses/effects.ts:121-123` short-circuit; `src/glasses/bridge.ts:276` forwards it — but only when the event fires |
| B3 favorites unvalidated | **Fixed** | `src/glasses/bridge.ts:192-201`, `src/phone/App.tsx:278-288` field guards |
| B4/B5 units/stale distance | **Fixed** | `src/phone/utils/formatDistance.ts`; `src/phone/tabs/FavoritesTab.tsx:48-50` live haversine |
| B6 unmount setState | **Fixed** | `LocationSearchForm.tsx:25-31` `mountedRef` guards all four callbacks |
| G1 '← Back' label | **Fixed** | `src/glasses/render.ts:463` `'← Close menu'` |
| G2 arrow to destination | **Fixed** | `render.ts:785-795` bears to step `endPoint` |
| G3 minimap always north | **Fixed** | heading threaded end-to-end; `screens/types.ts:119-125`, `bridge.ts:367` |
| G4 wiki page-0 dead gesture | **Fixed** | `render.ts:632-639` ◄/► markers |
| G5 no refresh age | **Fixed** | `render.ts:301-307` `refreshSentinelLabel` |
| P1 `text-text-secondary` | **Fixed** | grep across `src/` returns zero hits |
| P2 formatDistance ×3 | **Mostly fixed** — phone consolidated on `utils/formatDistance.ts`; glasses keeps its own `formatDistance`/`formatMeters` (`render.ts:723-749`) intentionally (different truncation/suffix needs) |
| Q1 haversine/bearing duplicated 4× | **Fixed client-side** — `src/glasses/geo.ts` is the single client copy (imported by `state.ts:26`, `render.ts:22`, `minimap.ts:30`, `FavoritesTab.tsx:3`). **Server copy remains**: `api/poi.ts:530-549` (see L-5) |
| Q2/Q5/R1 dead `resetNearby`/`withNearby` | **Fixed** — grep returns zero hits in `src/phone/state.ts` |
| Q3/R2 "unused" clsx/cva/tailwind-merge | **Resolved as documented, NOT removable** — they are devDependencies consumed by even-toolkit's bundled dist via the `vite.config.ts:24-35` alias block. Uninstalling breaks `vite build` (`HANDOFF_v1.10.md` Q3). Do not "clean" these. |
| R3 react-router in runtime deps | **Fixed** — `package.json:37` (devDependencies) |
| F2 NearbyTab display-only | **Fixed** — expandable rows with Maps/website links, `NearbyTab.tsx:284-338` |
| Q4 tick timer | Left as-is by explicit decision (review called it optional) — `NearbyTab.tsx:109-113` |

Also note: `HANDOFF_v1.10.md`'s "broken `.bin` shims" caveat **no longer applies to this folder** — `node_modules/.bin/tsc` and `.bin/vitest` are real symlinks (npm install 2026-06-26); `npm test`/`npm run typecheck` should work directly.

### 1.2 New findings — HIGH severity

**H1 — Persisted settings never reach the glasses at boot (correctness, both surfaces disagree every launch).**
- Glasses boot with `INITIAL_STATE` → `DEFAULT_SETTINGS` (`src/glasses/bridge.ts:145`, `src/glasses/screens/types.ts:173-194`: radius 0.75 mi, **all 8 categories**, imperial, 20 results, `manualLocation: null`) and fire the first POI fetch immediately (`bridge.ts:218`).
- The only way settings ever reach the glasses is the `wander-settings-changed` CustomEvent (`bridge.ts:255-282`) — and the phone only emits it from `withSettingsChange` / `manual-location-selected` / `manual-location-cleared` (`src/phone/state.ts:190-194, 208-212, 240-245`). The hydration event is a pure noop: `settings-hydrated` → `noop(...)` (`src/phone/state.ts:27-33`).
- Consequences, every session, until the user happens to touch a setting: glasses fetch with defaults while the phone fetches with persisted settings. A user with a persisted **manual location** gets the exact split-brain B2/F1 described: phone shows POIs near the pin, glasses show POIs near GPS. Even without manual location, defaults diverge — phone default is **5 categories** (`src/phone/types.ts:126-139`) vs glasses **8** (`screens/types.ts:179-188`), plus radius/units/sort/maxResults drift. The stale comment at `screens/types.ts:174-178` ("Default to all 8 until the Phone Settings UI ships") shows this default was never meant to be load-bearing post-Phase-5.
- **Fix (cheap):** make `settings-hydrated` also emit `{ type: 'broadcast-settings', settings: event.settings }` (`src/phone/state.ts:27-33`). The glasses' `settings-changed` handler already triggers a re-fetch (`src/glasses/state.ts:180-184`), so the stale first fetch self-corrects. Optional polish: have `initGlasses` delay its initial fetch ~1–2s waiting for the first settings event (fall back to defaults on timeout) to avoid the double fetch.
- **Existing test conflicts with this fix:** `src/phone/__tests__/app-wiring.test.ts:268-276`, `'is NOT emitted on settings-hydrated (boot is not a change)'`, currently asserts the *opposite* of the fix and will fail once `settings-hydrated` broadcasts. This test encodes today's bug as intended behavior — update/replace it (and its title) alongside the fix, don't just patch around it.

**H2 — ERROR_NETWORK "retry" for route/wiki failures dead-ends on LOADING forever.**
- `onRetry` (`src/glasses/state.ts:427-447`): for `retryAction: 'fetch-route' | 'fetch-wiki'` it calls `goLoading(state, null)` — LOADING screen, **zero effects**. The comment says "bridge handles that", but nothing in `bridge.ts`'s dispatch loop (`bridge.ts:299-316`) special-cases retries.
- Repro: any route fetch fails (flaky network) → `ERROR_NETWORK` ("Could not load directions", `state.ts:160-165`) → screen says "> Tap to retry" (`render.ts:162`) → tap → LOADING "Getting your location..." with no in-flight work. Background refresh can't rescue it: a background `pois-loaded` while not on POI_LIST is stashed to `pendingPoiRefresh` without a screen change (`state.ts:268-273`). Tapping again is a noop (`onRetry` default branch). Only escape: double-tap → exit-app.
- No test covers this path (grep of `state.test.ts` finds no ERROR_NETWORK-retry-for-route/wiki case).
- **Fix:** carry the retry context on the screen variant — e.g. `retryAction: { kind: 'fetch-route', from, to } | { kind: 'fetch-wiki', title, lang } | { kind: 'fetch-pois' }` in `screens/types.ts:141-146` — and have `onRetry` re-emit the matching effect. Alternatively (smaller): route/wiki failures return to `POI_DETAIL` (the poi is recoverable from the prior screen at failure time) instead of offering a retry that can't work.

**H3 — `/api/geocode` called with relative URLs → manual-location search and header label broken in installed EHPK builds.**
- `src/phone/lib/geocoding.ts:4` — `fetch('/api/geocode?q=...')` (drives `LocationSearchForm`, i.e. the entire manual-location feature and the GPS-failure recovery path on NearbyTab).
- `src/phone/App.tsx:174` — `fetch('/api/geocode?lat=...&lng=...')` (reverse-geocode header label).
- `src/glasses/api.ts:13-21` documents exactly why this fails: in production EHPK, the WebView base URL isn't the Vercel origin, and WebKit throws on relative fetch against a non-http(s) base — the reason `API_BASE` is absolute in production and the reason v1.0.2 exists ("Fix API calls failing in EvenHub WebView (absolute URL in production)", `CHANGELOG.md:132-134`). The geocode calls shipped in v1.8 without that fix. It works in dev and QR/prototype mode (same-origin), which is why testing never caught it.
- The v1.11 whitelist gate can't catch it either — `network-whitelist.test.ts:43-48` only regexes *absolute* `http(s)` URLs.
- **Fix:** export the `API_BASE` constant from `src/glasses/api.ts` (or a tiny shared module) and use it in both call sites. Verify on an installed build, since QR mode masks the bug.

### 1.3 New findings — MEDIUM severity

**M1 — Manual location teleports the NAV_ACTIVE position during background refresh.**
`runFetchPois` dispatches `position-updated` with whatever coords it used — including the manual pin (`src/glasses/effects.ts:121-133`). The 5-minute background timer (`bridge.ts:219-221`) therefore injects the *pin's* coordinates into an active navigation session: the minimap triangle jumps to the pin, `remainingDistanceMeters` recomputes from it, and — since POIs were searched *near the pin* — the pin is plausibly within the 20 m arrival radius of the destination, falsely triggering "You have arrived!" + `stop-nav-watch` (`state.ts:377-384`). Fix: skip the `position-updated` dispatch when `settings.manualLocation` supplied the coords (it isn't a real position), or make the reducer ignore non-watch position sources while on NAV_ACTIVE.

**M2 — Phone `request-location` lacks the wall-clock guard the glasses side needed.**
`requestLocationViaNavigatorOrBridge` (`src/phone/App.tsx:83-137`) trusts `getCurrentPosition`'s `timeout: 10_000` option — but `src/glasses/effects.ts:242-247` documents that on real G2 hardware the WebView's `getCurrentPosition` sometimes **never fires either callback**, which is why `defaultGeolocate` wraps it in a 15 s `Promise.race`. On the phone path there is no race: `nearby.fetchStatus` sticks at `'locating'`, NearbyTab shows "Finding your location…" forever (`NearbyTab.tsx:134-144`), and the manual-location rescue form is unreachable because it only renders on `error-location` (`NearbyTab.tsx:147-162`). Fix: mirror the wall-clock race and dispatch `location-failed` on expiry.

**M3 — Minimap re-encoded and re-pushed over BLE on every position tick, with no in-flight guard.**
Every `position-updated` in NAV_ACTIVE produces a new screen object → `pushMinimap` (`src/glasses/bridge.ts:304-313`) → `encodeMinimapPng` (canvas + PNG encode + up-to-4 tile fetches, `minimap.ts:686-710`) → `updateImageRawData`. Position sources are deliberately concurrent (SDK watch at 3 s interval, `sdkLocation.ts:17-19`, **plus** `navigator.geolocation.watchPosition` with no distance filter, `effects.ts:309-353`), so ticks can arrive faster than encodes complete. `pushMinimap` calls are `void`-ed with no serialization — overlapping `updateImageRawData` calls violate the design guidelines' "no concurrent image sends — wait for each to complete" rule, and most pushes redraw a visually identical map. Fix: a single in-flight flag + drop-if-busy, plus skip when position moved < ~5 m and heading changed < ~10°.

**M4 — POI_LIST has two competing cursors, and every scroll is a full BLE rebuild.**
Evidence: `Screenshots/List_View.png` shows the app-drawn `> ` prefix on row 1 (Central Park) while the firmware's native selection border highlights row 3 (Seneca Village) — two different "current item" indicators pointing at different rows. Mechanics: the app tracks `cursorIndex` in the reducer and re-renders the whole list per scroll (`render.ts:240-299`; `renderInPlaceUpdate` has no POI_LIST case, `render.ts:195-226`, so `pushScreen` falls through to `rebuildPageContainer`, `bridge.ts:330-345`) — while `isItemSelectBorderEn: 1` (`render.ts:292`) also enables the firmware's own selection border, which moves independently. The SDK offers no list-upgrade type (only `TextContainerUpgrade` exists in `@evenrealities/even_hub_sdk/dist/index.d.ts`), so rebuild-per-scroll is also the likely root of the historical "scrolling feels laggy / misinputs" reports (`bridge.ts:44-47`). Fix directions (needs an on-device session): (a) trust the native selection — drop the `> ` prefix and per-scroll rebuilds for POI rows, use `currentSelectItemIndex` from the CLICK event (already accepted: `state.ts` `tap.itemIndex`) and keep reducer cursor only for sentinel-row routing; or (b) keep the app cursor and set `isItemSelectBorderEn: 0`. Either way, one cursor, not two.

**M5 — Server logs full-precision user coordinates on every POI request (privacy).**
`api/poi.ts:188-198` logs raw `lat`/`lng` to Vercel function logs. For a location product this is unnecessary retention of precise location tied to timestamps — a data-minimization problem and a latent store-review/privacy-policy liability. Fix: round to 2–3 decimals (~1 km/100 m) in the log line, or gate full precision behind a `DEBUG_POI` env var. Pairs with N20 (§2.3).

**M6 — Un-debounced settings changes fire fetch storms on both surfaces.**
Each radius tick / category toggle emits persist + broadcast + `request-location` on the phone (`src/phone/state.ts:226-246`) *and* a full glasses re-fetch via `settings-changed` (`src/glasses/state.ts:180-184`). Toggling four categories quickly = 8 POI fetches (each fanning out to Wikipedia + 3 Overpass mirrors server-side, `api/poi.ts:434-453`). A units-only change also re-fetches on the glasses even though units affect formatting only. Fix: debounce the broadcast/fetch ~500 ms; on the glasses reducer, skip the `fetch-pois` effect when the changed keys are display-only (`units`).

### 1.4 New findings — LOW severity

| # | Finding | Location | Note |
|---|---|---|---|
| L-1 | `createBridgeKVStore` is production-dead code — only tests import it — while the phone persists settings via raw `window.localStorage`, contradicting the module's own header ("spec §17 mandates `bridge.setLocalStorage`… browser localStorage is unreliable in that host") | `src/phone/storage.ts:104-117` (unused), `storage.ts:3-9` (comment), `src/phone/App.tsx:50-73` (localStorage store) | Either wire the bridge store when `flutter_inappwebview` is present (same gate as `src/main.tsx:17-19`) or update the comment. If localStorage genuinely is flaky in the host, settings loss reports will trace here. |
| L-2 | DEV mock-coords logic duplicated | `src/glasses/effects.ts:233-240` vs `src/phone/App.tsx:195-202` | Extract one helper if either is touched again. |
| L-3 | `geocode-location` effect fires even for manual fixes, reverse-geocoding coords whose label the user just typed; result silently overwrites `nearby.location.label` (invisible — Manual badge takes precedence) | `src/phone/state.ts:113-124` | Skip when `source === 'manual'`. One wasted Nominatim call per manual selection. |
| L-4 | Whitelist gate scans source only, not the built bundle — bundle-only URLs from third-party deps (the reason `https://react.dev` sits in the whitelist) would not be caught pre-submission | `src/__tests__/network-whitelist.test.ts:21-26` | Add a post-build variant scanning `dist/assets/*.js`. |
| L-5 | `haversine`/`bearing` server-side copy | `api/poi.ts:530-549` | Move to `api/_lib/geo.ts` next time `api/` is touched; `api/` can't import from `src/`, so some duplication is structural. |
| L-6 | `/api/wiki` makes two upstream Wikipedia calls per request (REST summary + Action-API full extract); the summary call only contributes `title`/`summary`, which have fallbacks | `api/wiki.ts:42-63` | Dropping `fetchSummary` halves upstream latency/cost at trivial quality loss. |
| L-7 | `API.md` documents a stale base URL (`wander-laolao91s-projects.vercel.app`) | `API.md:5` | Production is `wander-six-phi.vercel.app` (`src/glasses/api.ts:21`). |
| L-8 | README oversells language switching ("Change the display language and all … localize automatically") — the server plumbing exists (`api/_lib/lang.ts`) and `Settings.lang` exists (`screens/types.ts:164-165`) but no UI sets it and `handleSettingsChanged` doesn't forward it (`bridge.ts:255-279`); `lang` is permanently `null` (Accept-Language fallback) | `README.md:40-41, 59-60` | Either ship a language picker (small phone-Settings addition) or soften the copy before it becomes a store-review complaint. |
| L-9 | `translateGlassesEvent` keeps an unused `_bridge` param purely for test compatibility | `src/glasses/bridge.ts:393-400` | Cosmetic. |

---

## 2. Use-Case Backlog Audit + New Recommendations (Phase 2)

### 2.1 N1–N15 status (from `Plugin_Research_v1.9.md`, cross-checked against v1.11 source + changelog)

| Item | Status | Evidence |
|---|---|---|
| N1 IMU head-tilt scroll | **Still backlog** | no `imuControl` anywhere in `src/` (grep, this session) |
| N2 reconnect auto-refresh | **Shipped v1.9** | `src/glasses/bridge.ts:118-124` (`isReconnectTransition`), `bridge.ts:244-248`; `CHANGELOG.md:96-99` |
| N3 battery-aware minimap | **Shipped v1.9 (core only)** — tile-fetch skip below 20%; the "⚡Low" nav-header marker was deliberately dropped (`HANDOFF_v1.10.md` N3 entry) | `bridge.ts:125-136`, `minimap.ts:366-373` (`skipTiles`), `minimap.ts:697-700` |
| N4 search-near-this-POI | **Still backlog** | `actionsForPoi` (`src/glasses/state.ts:668-679`) has no such action |
| N5 recent-history tab | **Still backlog** | no `wander_nav_history` key (grep) |
| N6 favorites quick-navigate | **Still backlog** | `FavoritesTab.tsx:44-68` renders static rows, no navigate affordance |
| N7 glasses quick-settings | **Still backlog** | no `QUICK_SETTINGS` screen (grep) |
| N8 route-distance ETA | **Shipped v1.9** | `src/glasses/render.ts:753-777` (`remainingDistanceMeters` sums live leg + later steps); `CHANGELOG.md:90-94` |
| N9 proactive nearby-landmark nudge | **Still backlog** (flagship) | no nudge/geofence code (grep) |
| N10 "Up Ahead" route POIs | **Still backlog** | `navBodyText` (`render.ts:523-579`) renders destination-only |
| N11 off-route alert | **Still backlog** | no divergence detection in `onPositionUpdated` (`state.ts:363-425`); reroute is manual-tap only (`state.ts:530-542`) |
| N12 single-glance nav + pre-turn alert | **Still backlog** | nav body still shows full stack (`render.ts:546-578`) |
| N13 voice POI search | **Still backlog** | no `audioControl` (grep) |
| N14 phone audio tour | **Still backlog** | no `SpeechSynthesis` (grep) |
| N15 "Around Me" zero-tap widget | **Still backlog** | no `AROUND_ME` screen (grep) |

Also shipped since that doc, outside the N-series: SDK native phone-location bridge (v1.10, `src/glasses/sdkLocation.ts`), APPS Bridge GPS fallback (v1.9, `src/glasses/appsBridge.ts`), and the network-whitelist pre-submission gate (v1.11, `src/__tests__/network-whitelist.test.ts`) after the v1.10 store rejection.

### 2.2 New research (post-2026-06-16 and previously-uncovered angles)

**Direct competitor on-platform.** `aleapc/storywalk-g2` — "Contextual tourism and running companion for Even Realities G2 — GPS-tracked POI storytelling", TypeScript/Vite, Wikipedia + Overpass, last updated 2026-04-21, with an Expo phone companion (`aleapc/storywalk-mobile`). Found via the `g2-glasses` GitHub topic. It is pre-release and unstarred, but its pitch is precisely N9 (walk past a POI → story triggers) plus a running mode. Implications: (1) N9's value thesis is independently validated by another G2 developer; (2) Wander should ship N9 before a polished competitor claims the "proactive discovery" identity in the store; (3) a "running/fitness pacing" mode is *not* Wander's fight — stay on discovery depth (favorites, wiki, navigation) where Wander is far ahead.

**Offline behavior is table stakes in adjacent products, absent in Wander.** 2026 navigation-wearable guidance consistently centers offline map/route pre-caching (Gaia GPS / AllTrails / Google Maps offline patterns). Wander today: the phone caches the last POI list (`wander_last_poi_cache`, `src/phone/storage.ts:256-284`) but the **glasses never read any cache** — a fetch failure on boot lands on ERROR_NETWORK with zero content, and wiki/route are always network-dependent. Travelers without data plans (a core Wander persona) get nothing. → N16.

**Wearable saved-places patterns.** Google Maps on Apple Watch/Wear OS leads with "travel time to saved locations without requesting directions" — i.e. the *saved list itself* shows actionable ETA. Wander's Saved tab already recomputes live distance (`FavoritesTab.tsx:48-50`) but shows no walk time and offers no action. → N21 (+ existing N6).

**Accessibility.** 2026 wearable-UX guidance: high contrast, never color-alone, comfortable tap targets. The glasses display is inherently high-contrast; the *phone* side currently fails contrast in several places (§3.2 P-1). Also relevant: Wikipedia pagination size and glasses truncation widths are all constants — a "larger text / fewer chars per page" preference is feasible without any font control (pagination is a server param, `api/wiki.ts:18`; truncation widths are client constants). → N19.

**Privacy.** No in-app privacy statement exists; server logs precise coordinates (M5). The README already makes a good privacy claim for APPS Bridge ("your location data never leaves your phone via this path", `README.md:79`) — extending that posture app-wide is cheap differentiation for a location product. → N20.

**Platform/SDK delta check:** npm shows no SDK release beyond the 0.0.11 already integrated; no new G2 hardware capabilities announced. The rejected-ideas table in `Plugin_Research_v1.9.md` **stands unchanged** — nothing found contradicts any row, and nothing below re-proposes a rejected item.

### 2.3 New recommendations (N16–N21, all hardware-filtered)

**N16 — Offline resilience: cache-first glasses boot + wiki pre-fetch.** Value: High · Effort: Low–Medium · Glasses-side feasible (storage + render only; no blocked hardware).
Persist the last POI list via `bridge.setLocalStorage` (same mechanism favorites already use, `bridge.ts:164-166`); on boot or fetch failure, hydrate from cache and render POI_LIST with the existing age-labeled refresh sentinel (`render.ts:301-307` already communicates staleness — zero new UI needed). Optionally pre-fetch wiki summaries for the top N POIs into the same cache so WIKI_READ survives dead zones. Touches: `bridge.ts` (load/save), `effects.ts` (failure fallback path), reuses `pois-loaded` with a stale `fetchedAt`.

**N17 — Share a place from the phone.** Value: Medium · Effort: Low · Phone-side only.
`navigator.share({ title: poi.name, url: mapsUrl(poi) })` on the NearbyTab expanded row (`NearbyTab.tsx:303-336`) and Saved rows. The Maps URL is already whitelisted (`app.json:16`); Web Share API needs no network permission. This is the correct "social" feature for camera-less hardware — the glasses discover, the phone shares.

**N18 — Multi-stop walking tour from Saved places.** Value: Medium–High · Effort: Medium–High · Phone plans, glasses guide.
Order selected favorites nearest-neighbor, then run the existing leg flow: `fetch-route` per leg, NAV_ACTIVE per leg, auto-advance on the already-implemented arrival detection (`state.ts:377-384`) instead of stopping. Requires a small tour state (ordered POI ids + current leg) and an "arrived → next stop?" prompt screen. No new hardware. Builds on N5/N6; natural companion to N14's phone narration.

**N19 — Accessibility pass.** Value: Medium · Effort: Low–Medium · Both surfaces.
(a) Fix phone contrast failures (§3.2 P-1); (b) enlarge small tap targets (`SettingsTab.tsx:130-145` 12px text links); (c) add a "Larger text" setting: request smaller `PAGE_SIZE_CHARS` from `/api/wiki` and reduce glasses chars-per-line constants so lines render bigger *visually*… **correction**: the G2 has a single fixed font size (design guidelines) — larger glyphs are impossible; the honest version of this item is *shorter lines + more white space + fewer items per screen* for readability, which is achievable. Frame it that way to avoid re-proposing rejected "rich typography".

**N20 — Privacy posture: statement + data minimization.** Value: Medium · Effort: Low · Both surfaces.
Round/gate coordinate logging (M5); add a Settings card: what leaves the device (coords → Wander API for POI/route/geocode; nothing stored server-side), what never does (favorites, settings, APPS Bridge loopback). Reuses the README's existing privacy language (`README.md:79`).

**N21 — Walk-time on Saved places.** Value: Low–Medium · Effort: Trivial · Phone-side only.
FavoritesTab already computes live miles; add `~N min` using the same 84 m/min constant as `etaMinutes` (`render.ts:588-590`). Precursor affordance for N6's Navigate button.

### 2.4 Rejected-ideas table — revalidation

Checked every N16–N21 and every Phase-3 recommendation against the `Plugin_Research_v1.9.md` rejected table: none involve camera, speaker, haptics, AR overlays, color, animation, BLE beacons, eye-tracking, or font styling. One near-miss documented above: N19's original "large text" framing would have collided with the *single fixed font* constraint — reframed as layout density, which is legal. **No table rows need updating**; the table remains authoritative.

---

## 3. UI/UX Review (Phase 3)

Method: walked every screen in `screens/types.ts` + `render.ts` against the `everything-evenhub:design-guidelines` skill (display constraints, container limits, patterns), grounded in `Screenshots/` (note: `List_View.png`, `Detail_View.png`, `navigation.png` match current rendering; `Error_navigation_UI.png` and `Wander_Settings.png` predate v1.2/current Settings and were used only for historical context).

### 3.1 Glasses side

**Compliance audit — clean.** Container counts: worst case is NAV_ACTIVE at 3 of 12 (2 text + 1 image, `render.ts:467-517`); every screen has exactly one `isEventCapture: 1`; all `containerName`s ≤ 16 chars; minimap image 240×120 within the 288×144 image-container ceiling; `..` used instead of the missing U+2026 glyph (`render.ts:713-721`); progress/rule glyphs from the supported set. No guideline violations found.

**Flow/depth assessment.** LOADING → POI_LIST → POI_DETAIL → POI_ACTIONS → {NAV_ACTIVE, WIKI_READ}: 3 taps from list to navigating (Navigate is always `actions[0]` with cursor pre-seated — good), 3 taps + scrolls to Save. Double-tap-back semantics are consistent (sub-screen → parent, top-level → native exit dialog). The POI_DETAIL → POI_ACTIONS split costs one tap but was a deliberate, field-tested decision (`screens/types.ts:73-80`) — keep. The real depth problem is the *absence of a zero-tap surface* (N15) and *zero push* (N9), *not* the drill-down itself — consistent with `Plugin_Research_v1.9.md`'s "several glances deep" critique, which still stands in v1.11.

**Defects found (all concrete, all screenshot- or code-evidenced):**

- **GX-1 (Medium) — POI_DETAIL interaction hint clips off-screen on long summaries.** `Detail_View.png`: 6 wrapped summary lines + blank + RULE fill the 216 px body; the final `'> Tap for options  ·  2× to go back'` line (built at `render.ts:389`) is not visible. `detailBodyText` allows a 260-char summary (`render.ts:386-388`) + 4 furniture lines ≈ 10 lines vs ~8 that fit. First-time users on a long-summary POI never learn the tap affordance. Fix: cut summary to ~190–200 chars on this screen (WIKI_READ exists for the full text), or drop the two blank spacer lines.
- **GX-2 (Medium) — NAV body duplicates the street name and its hint also clips.** `navigation.png`: "Head southeast on Stephanie and Fred.." followed by "  on Stephanie and Fred Shuman Reser.." — ORS instructions usually embed the street, and `render.ts:560-564` appends the `on <street>` line unconditionally, so the street prints twice, both truncated. Fix: `if (step.street && !step.instruction.includes(step.street)) …`.
- **GX-3 (Medium) — `NAV_BODY_CHARS_PER_LINE = 38` overestimates the 336 px column.** Same screenshot: strings pre-truncated to 38 chars still wrap to two rendered lines, so the layout runs ~2 lines longer than designed and `'> Tap re-route  ·  2×→detail'` (`render.ts:577`) falls off-screen — during navigation, the *reroute affordance* is the invisible line. Fix: recalibrate to ~28–30 (`render.ts:72`), or use the `everything-evenhub:font-measurement` skill for pixel-accurate widths instead of char counts.
- **GX-4 (High, = M4) — two cursors on POI_LIST.** See §1.3 M4. This is the single most disorienting visible defect: the screenshot shows the firmware border and the `>` glyph on *different rows*, meaning the user cannot know which row a tap will open.
- **GX-5 (Low) — ERROR_LOCATION gives no Android-specific guidance.** "Could not get your location" (`state.ts:710-712`) — the APPS Bridge remedy exists only on the phone Settings tab (`SettingsTab.tsx:161-176`). One added line ("Android? See phone Settings tab") fits the single-container screen easily.
- **GX-6 (Positive, keep)** — error screens share one visual grammar (title / RULE / message / "> Tap to retry" block, `render.ts:139-183`); the refresh sentinel's age label and WIKI_READ's `◄ 2/5 ►` markers are exactly the right minimal-display affordances.

### 3.2 Phone side

- **P-1 (High, accessibility) — light-theme contrast failures on every status badge.** The app imports only `even-toolkit/web/theme-light.css` (`src/styles.css:2` → `--color-bg: #FFFFFF`), but the badges were styled for dark backgrounds: `text-yellow-400` Manual badge (`App.tsx:369-373`), yellow manual banner (`NearbyTab.tsx:215-227`), yellow "ACTIVE"/pin text (`SettingsTab.tsx:121-126`), `text-yellow-500` disconnect banner (`App.tsx:415-420`), `text-blue-400` Bridge badge (`App.tsx:377-384`). Yellow-400 on white ≈ 1.6:1 and blue-400 ≈ 2.5:1 — far below the 3:1 minimum; the guidelines explicitly call for high contrast and never color-alone. Fix: amber-700-class foregrounds on tinted backgrounds, or fix P-2 and inherit proper tokens.
- **P-2 (Medium) — no dark theme.** `even-toolkit` ships `web/theme-dark.css` (verified in the installed package exports) and the Even app design system defines dark tokens, but Wander hardcodes light. Import dark tokens under `prefers-color-scheme: dark` (and re-audit the badge colors in both modes).
- **P-3 (Medium) — Saved tab is a dead end.** `FavoritesTab.tsx:44-68`: static rows — no remove, no navigate, no share, no expand. A user cannot unsave a place from the phone at all (removal only exists in the glasses action menu, `state.ts:449-465`); a favorite saved in another city sits there forever. Fix: expandable rows mirroring NearbyTab's pattern (`NearbyTab.tsx:284-338`) with Remove (dispatch a CustomEvent the glasses bridge translates to `favorite-toggled` — the reverse channel `wander-favorites-changed` already exists, `bridge.ts:166-172`), plus N21 walk-time and N17 Share. This one tab upgrade absorbs three roadmap items.
- **P-4 (Medium) — misleading sync copy while H1 exists.** SettingsTab's card says "Changes sync to glasses automatically" (`SettingsTab.tsx:89-94`) — currently false at boot (H1). Fix H1 first; then the copy is honest.
- **P-5 (Low) — Nearby filter text is wiped by any refresh.** `NearbyTab.tsx:119-124` clears `query` whenever fetchStatus enters locating/fetching — a settings sync mid-typing erases the user's filter. Scope the reset to manual refresh only.
- **P-6 (Low) — "Max results" control is a label row + disconnected slider** (`SettingsTab.tsx:265-295`); even-toolkit ships a `SegmentedControl` (package exports `./web/segmented-control`) that matches a 3-choice enum far better.
- **P-7 (Positive, keep)** — loading/error/empty/stale states on NearbyTab are genuinely complete (skeleton→spinner, error-with-retry, error-with-stale-data banner, empty-with-guidance, `NearbyTab.tsx:133-195, 262-276`); the disconnect banner and Manual/Bridge badges are honest status surfaces. This is above-average state coverage for a companion app.

---

## 4. Prioritized v2 Roadmap

Sequenced by (user harm avoided ÷ effort), then by strategic value. Phases are shippable releases.

**v1.12 — "Trust" (bug-fix release; all items small, no new features)**
1. **H1** boot settings broadcast (`src/phone/state.ts:27-33` + test) — the highest-leverage two-line fix in the codebase.
2. **H3** absolute `/api/geocode` URLs (`src/phone/lib/geocoding.ts:4`, `src/phone/App.tsx:174`) — restores manual location on installed builds.
3. **H2** retry context on ERROR_NETWORK (`screens/types.ts:141-146`, `state.ts:427-447`).
4. **M1** manual-location NAV teleport guard (`effects.ts:121-133`).
5. **M2** phone wall-clock geolocation guard (`App.tsx:83-137`).
6. **M5/N20-lite** round coords in server logs (`api/poi.ts:188-198`); **P-4** copy truthful post-H1; **L-3, L-7** trivial cleanups.
7. **P-1** contrast fixes (pure CSS class swaps).

**v1.13 — "Feel" (nav + list polish; needs one on-device session)**
8. **M4/GX-4** single-cursor POI_LIST (on-device verification of native selection behavior required).
9. **GX-1/GX-2/GX-3** detail-hint clipping, street-name dedupe, NAV line-width recalibration (use `font-measurement` skill).
10. **M3** minimap push serialization + movement threshold; **M6** settings debounce.
11. **N12** single-glance nav + pre-turn alert, then **N10** Up Ahead — the two build on the now-solid nav layout.
12. **P-3 + N21 + N17 + N6** the Saved-tab upgrade bundle (remove/navigate/share/walk-time) — one tab, four backlog items.

**v1.14 — "Push, not pull" (the strategic release; StoryWalk G2 is building toward this space)**
13. **N9** proactive nudge (flagship; spec in `Plugin_Research_v1.9.md` §N9 still fully valid — rate-limit, dedupe, quality-gate, default-off).
14. **N16** offline cache-first glasses boot (pairs naturally with N9's cached-POI dependency).
15. **N11** off-route alert (reuses N10's route-proximity math).
16. **N4** search-near-this-POI.

**v1.15+ — exploratory / lower certainty**
17. **N15** Around Me zero-tap widget; **N5** history tab; **N7** glasses quick-settings; **N18** multi-stop tours; **N14** phone audio tour; **N19** remaining accessibility items; **P-2** dark theme; **L-8** language picker or README fix; **N1** IMU scroll (opt-in, redesigned state machine per v1.9 doc); **N13** voice search (spike only).

Standing constraints for every session: no commit/push/EHPK without explicit go-ahead (project memory); re-run the whitelist gate before any pack; do not uninstall the four alias-pinned packages (`vite.config.ts:24-35`).

---

## 5. Sources

Repo ground truth (read in full this session): all of `src/glasses/`, `src/phone/`, `api/`, `app.json`, `package.json`, `vite.config.ts`, `CHANGELOG.md`, `STORE_CHANGELOG.md`, `HANDOFF_v1.10.md`, `Plugin_Research_v1.9.md`, `Wander_Code_Review.md`, `API.md`, `README.md`, `Screenshots/*`. Verification: `tsc -b --noEmit` (clean), `vitest run` (360/360, 17 files), targeted greps recorded inline above. Hardware/design authority: `everything-evenhub:design-guidelines` skill (invoked 2026-07-03).

External (new since `Plugin_Research_v1.9.md`'s 2026-06-16 research):
- [g2-glasses GitHub topic](https://github.com/topics/g2-glasses) — 26 community G2 repos surveyed
- [StoryWalk G2](https://github.com/aleapc/storywalk-g2) + [StoryWalk Mobile](https://github.com/aleapc/storywalk-mobile) — same-platform POI-storytelling competitor
- [Even Hub](https://hub.evenrealities.com/) · [@evenrealities/even_hub_sdk on npm](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) — SDK version check (no release beyond 0.0.11 integrated)
- [Even Support — Navigate](https://support.evenrealities.com/hc/en-us/articles/14273871101071-Navigate) — first-party nav app scope
- [RayNeo 2026 navigation smart-glasses guide](https://www.rayneo.com/blogs/news/best-smart-glasses-for-navigation-2026-guide) · [Meta AI glasses GPS/navigation](https://www.meta.com/ai-glasses/gps-navigation/) — offline pre-caching as table stakes
- [Use Google Maps on your Apple Watch](https://support.google.com/maps/answer/9773173) — saved-places ETA-at-a-glance pattern (N21)
- [Top 10 UX Challenges for Wearable Tech Apps in 2026](https://fixnhour.com/blog/ux-challenges-wearable-tech-apps) · [Wearable UX Design: Speed, Privacy & Context](https://www.influencers-time.com/designing-for-wearables-in-2025-ux-context-privacy-and-speed/) — contrast/color-alone/tap-target guidance (N19, P-1) and location-privacy expectations (N20)
