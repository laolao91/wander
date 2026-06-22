# Wander v1.9 — Session Handoff
_Updated: 2026-06-21 | Status: Local only — not yet pushed to GitHub or submitted to EvenHub_

---

## 2026-06-21 — APPS Bridge GPS fallback

Added an Android-side GPS fallback using "APPS Bridge"
(https://gitlab.com/homeauto.cc/appsbridge), a free third-party Android
companion app that runs a local WebSocket server (`ws://127.0.0.1:7071`) and
streams GPS independent of the Even Hub host WebView's
`navigator.geolocation` permission forwarding — the root cause of Wander's
long-standing Android location bug (see `project-android-permissions-bug`
memory / the `err.code === 1` comment in `src/phone/App.tsx`'s
`request-location` case). Even Realities still hasn't reliably fixed this on
their end, so this routes around it instead of waiting.

**Scope, per explicit decision:** GPS only (no media/nav/sensor bridge
components), and native-first with the bridge strictly as a fallback —
`navigator.geolocation` is tried first everywhere it already was; the bridge
is only attempted after native fails, times out, or is unavailable. No
behavior change for users where native already works (iOS, desktop preview,
production installs where GPS is fine).

**New files:**
- `src/glasses/appsBridge.ts` — the bridge client. `bridgeGeolocate()` (one-shot,
  mirrors `defaultGeolocate`'s `{lat,lng}|null` shape) and `bridgeWatchPosition()`
  (continuous, mirrors `defaultWatchPosition`'s `(onPosition) => cancel` shape).
  Handles the full `client_hello` → `gps` frames → `client_heartbeat` (15s) →
  `client_goodbye` lifecycle per `APPSBRIDGE_GUIDE.md`. Defensively validates
  incoming frames (same discipline as the B3 favorites-JSON fix) since this is
  now an external, unauthenticated local process feeding the app. Resolves
  null / never calls back — never throws — when the bridge isn't
  installed/running, so existing "no position" handling downstream is
  unchanged.
- `src/glasses/__tests__/appsBridge.test.ts` — unit tests against an injected
  fake socket (connection refused, timeout, malformed frames, null-fix
  frames, heartbeat cadence, cancel-before-open).
- `APPSBRIDGE_GUIDE.md` — the bridge's own protocol spec, pulled from its
  GitLab repo (more authoritative than the Slack announcement that prompted
  this work). Reference this before touching the bridge integration again.

**Modified:**
- `src/glasses/effects.ts` — `defaultGeolocate()` and `defaultWatchPosition()`
  now fall through to the bridge on native failure.
- `src/phone/App.tsx` — the `request-location` effect case does the same
  fallback before dispatching `location-failed`.
- `app.json` — added `"ws://127.0.0.1:7071"` to the `network` permission's
  `whitelist` array (see open risk below), and extended that permission's
  `desc` to explain the loopback connection — added after the user
  specifically asked whether this would risk a submission rejection;
  un-explained `127.0.0.1` in a whitelist next to a generic `desc` is exactly
  what gets a manual review kicked back for clarification.
- `CHANGELOG.md` — `[Unreleased]` entry.

**Submission-readiness note (2026-06-21):** checked `app.json` by hand against
the `everything-evenhub:cli-reference`/`build-and-deploy` skill docs —
`package_id`, `edition`, `name`, `version`, `min_app_version`,
`min_sdk_version`, `entrypoint`, `permissions` (only `network` + `location`,
correct for GPS-only scope), `supported_languages` all match the documented
validation rules. **Have NOT run the actual `evenhub pack` command** — that's
the authoritative validator and still needs to happen before real submission,
but the user explicitly said not to run it yet ("No, not yet" when offered).
Also worth noting: the project's own skill docs state the network `whitelist`
**is** an enforced Even-level permission check (not just store-review
metadata) — this updates/supersedes the more hedged "no evidence of runtime
enforcement" conclusion from the Opus research below; it's still unconfirmed
whether that enforcement extends to WebSocket specifically (vs. just
fetch/XHR), so the on-device test remains the real confirmation either way.

**Open risk — needs an on-device test, not resolved by this session:**
Whether Even Hub's `app.json` `network.whitelist` is enforced at runtime
against WebSocket connections is unconfirmed — research (Opus-assisted, this
session) found no evidence of runtime enforcement in the shipped
`@evenrealities/evenhub-cli`/SDK (the whitelist looks like pack-time-only
validation), but couldn't rule out a native interceptor in the closed-source
Even Hub host app. Separately, standard Android WebView mixed-content
blocking of `ws://` from an `https://`-served page is a real, WebView
version-dependent risk — `127.0.0.1`/loopback is often exempted in modern
Chromium but this isn't guaranteed across all WebView builds, and is
overridable by the host's `setMixedContentMode` config, which Wander doesn't
control. **Net: this has not been empirically verified.** Before relying on
it, test on a real Android phone: install APPS Bridge, open it once and turn
the bridge on, install the Wander EHPK (or a production-equivalent install —
sideload may behave differently), then either revoke location permission for
the Even Hub host app or otherwise force `navigator.geolocation` to fail, and
confirm the Nearby tab / NAV_ACTIVE still acquires a position. If the
WebSocket is blocked outright, the fallback silently resolves null and
Wander behaves exactly as it did before this change (no regression either
way) — but the fix won't actually be fixing anything until this is verified.

**Deliberately not done:**
- No on-glasses indicator of which source (native vs. bridge) supplied the
  current position — a phone-side badge was added later the same day (see
  below), but the glasses display itself stays untouched; container budget
  there is precious and this is debug-level info, not core to the feature.
- No media/nav-notification/sensor bridge components — explicitly GPS-only
  for this pass; see `Plugin_Research_v1.9.md` N1 (IMU head-tilt) and N13
  (voice) for where bridge sensor/audio components could matter later if
  revisited.
- No direct test coverage of the `defaultGeolocate`/`defaultWatchPosition`
  glue itself (the native-try-then-bridge branching inside `effects.ts` and
  `App.tsx`) — consistent with this codebase's existing convention of only
  unit-testing through DI seams (`EffectRunner`'s injected `geolocate`/
  `watchPosition`), not the un-exported browser-API defaults that wire real
  `navigator`/`WebSocket` globals. The bridge module itself has full
  coverage; the glue calling it is a few lines per call site.

Verification re-run: `tsc -b --noEmit` zero errors, `vitest run` 323/323
passing (13 → 14 test files), `vite build` succeeds. Per standing
instruction, **nothing committed/pushed/EHPK-built** — added to the same
uncommitted working tree as the rest of this session's v1.9 work.

---

## 2026-06-21 (same day, continued) — F1/F3 verification, N8/N2/N3 polish, bridge visibility, EHPK

Picked up right after the APPS Bridge work above, in the same session. Did a
verification pass plus the two "near-free" items `Plugin_Research_v1.9.md`
flagged for v1.10, pulled forward into v1.9 instead, plus closing the loop
on bridge discoverability.

**F1/F3 — manual location re-verification: confirmed resolved, no change
needed.** Audited every geolocation call site (`grep` for `geolocate\|
watchPosition\|manualLocation` across `effects.ts`/`state.ts`/`bridge.ts`/
`App.tsx`/`state.ts` on the phone side). `runFetchPois` short-circuits on
`settings.manualLocation` before calling `geolocate()`; every `request-location`
dispatch (initial load, manual-location selected/cleared, settings changes)
passes `manualLocation` through and `App.tsx`'s handler short-circuits on it
before touching native/bridge GPS. The one path that does NOT check manual
location — the glasses `watchPosition` live-tracking during `NAV_ACTIVE` — is
correct by design: once actually navigating, you need real GPS regardless of
where you searched *from*. No code change; B1/B2 from earlier in the v1.9
cycle already fully closed this gap.

**N8 — route-aware nav ETA distance** (`src/glasses/render.ts`).
`remainingDistanceMeters` (now exported) no longer does a straight-line
haversine to the destination. It sums the live leg to the *current step's*
`endPoint` plus every later step's own `distanceMeters` — tracks the actual
route instead of cutting through buildings, fixing the "ETA jumps when you
round a corner" symptom. Falls back to the destination only for the final
step (its `endPoint` is null by construction in `api/route.ts`, same
fallback `headingToNextPoint` already used), which collapses to the old
behavior exactly when it's the only leg left — so no behavior change right
at arrival. New tests in `render.test.ts` use a *realistic* fixture (real
`endPoint` on the non-final step) rather than the existing `ROUTE` fixture
(which has `endPoint: null` on both steps — fine for the existing
pattern-based assertions, but would have silently double-counted distance
under the new formula, so it would have been the wrong fixture to validate
N8 against).

**N2 + N3 — device-status reactions** (`src/glasses/bridge.ts`,
`src/glasses/minimap.ts`). Turned out both fit entirely inside `bridge.ts`'s
existing `onDeviceStatusChanged` closure — no reducer/state.ts changes
needed, since neither is really "app state," they're transient device-status
reactions the bridge layer already owns:
- **N2:** new pure `isReconnectTransition(prevConnected, connected)` helper;
  on a `false → true` transition, `bridge.ts` now calls
  `runner.backgroundRefresh()` so a POI list left stale by a connection drop
  doesn't linger silently.
- **N3 (core only — no header marker):** new pure `isLowBattery(level)` +
  `LOW_BATTERY_THRESHOLD = 20` helper. `pushMinimap` now takes a `skipTiles`
  flag (sourced from the latest `DeviceStatus.batteryLevel`), threaded into
  `MinimapInput.skipTiles` in `minimap.ts` — when true, `encodeMinimapPng`
  skips the `/api/map` tile fetch outright (not just its failure path) and
  falls straight to the existing plain-black + fitBounds rendering.
  Deliberately dropped the "⚡Low" nav-header marker the research doc also
  proposed — it would have required threading battery level through the
  pure `screens/types.ts`/`state.ts` (same pattern as the `heading`/G3
  threading), turning a "Low effort" item into a multi-file state-shape
  change for a cosmetic addition; the tile-fetch skip is the actual battery
  savings and didn't need any of that.
- Both helpers are exported and unit-tested directly in `bridge.test.ts`
  (pure functions — no DOM/SDK mocking needed). The `skipTiles` *effect*
  inside `encodeMinimapPng` itself isn't unit-tested, consistent with this
  module's existing documented split ("Canvas drawing... only runs in the
  browser... tests don't").

**Bridge visibility** (`src/phone/types.ts`, `src/phone/state.ts`,
`src/phone/App.tsx`, `src/phone/tabs/SettingsTab.tsx`). Closing the loop on
the "deliberately not done" item above:
- `location-acquired` gained an optional `source?: 'native' | 'bridge' |
  'manual'`; `NearbyState.locationSource` records it (defaults to `'native'`
  when omitted, so every existing call/test stays backward-compatible).
- Phone header shows a small **"🌐 Bridge"** badge when
  `locationSource === 'bridge'` (mutually exclusive with the existing
  "📍 Manual" badge, but can show alongside the GPS location label).
- `SettingsTab`'s Location group gained a persistent hint: "Android location
  not working? Wander automatically falls back to APPS Bridge..." with a
  link to the GitLab repo — visible regardless of manual-location state,
  since it's about the GPS path itself.
- Reducer coverage added in `nearby.test.ts` (`locationSource` defaults to
  `'native'`; records `'bridge'` when the event says so). The badge JSX
  itself isn't unit-tested — this codebase has no DOM/React-rendering test
  harness anywhere (`vitest.config.ts` runs `environment: 'node'`); UI is
  verified by reading the code + `vite build` succeeding, same as every
  other `.tsx` change in this project's history.

**Docs:** `CHANGELOG.md` `[Unreleased]` extended; `STORE_CHANGELOG.md`
replaced with a fresh v1.9 entry (424 chars, under the requested 500) — this
file holds only the *next* release's "what's new" copy, not a history, so
the stale v1.7 entry was replaced rather than appended above; `README.md`
gained an end-user-facing "Android Users: Fixing 'Getting your
location...'" section (APPS Bridge install/setup steps, the 🌐 Bridge badge,
a privacy note that location never leaves the device via this path) plus
fixed two pre-existing stale test-count references (267 and 122 — already
inconsistent with each other before this session) to the current 336.

**Verification:** `tsc -b --noEmit` zero errors throughout every step above;
`vitest run` 336/336 passing (up from 323 after the APPS Bridge work, 334
after N8/N2/N3, 336 after the bridge-visibility reducer tests); `vite build`
succeeds.

**EHPK: built this session**, per explicit user request ("finish with the
ehpk"). `node node_modules/@evenrealities/evenhub-cli/main.js pack app.json
dist -o wander-v1.9.0.ehpk` → `Successfully packed wander-v1.9.0.ehpk (146153
bytes)` — the app.json schema (including the `ws://127.0.0.1:7071` whitelist
entry and its updated `desc`) packs cleanly with no validator errors, which
is the first concrete confirmation that nothing about this session's changes
breaks `evenhub pack` itself. `*.ehpk` is gitignored (only the historical
`wander-v1.7.0.ehpk` is tracked, from before that gitignore rule existed), so
this file doesn't show up in `git status` and won't get swept into a commit.
**Still NOT done:** committing, pushing to GitHub, or submitting this EHPK to
the Even Hub developer portal — those remain separate, explicit asks.

---

## What was done this session

### Starting point
- v1.8 folder copied to `Wander_v1.9/`
- Full code review written to `Wander_Code_Review.md` (21 findings, High/Medium/Low + feature gaps)
- All High, Medium, and Low severity findings are now fixed, plus F2 (see below). **High severity is committed (`bd7813e`); everything else is uncommitted in the working tree** — per standing instruction, no further commits/pushes/EHPK builds happen until the user explicitly says to do the "one big update."

### High severity (committed: `bd7813e`)

**B1 — Phone NearbyTab dropped sort and maxResults** (`src/phone/App.tsx:177`)
The `fetch-nearby-pois` effect now passes `sort` and `limit` to `fetchPois`, matching what the glasses-side `EffectRunner` already did.

**B2 — Glasses ignored manual location** (4 files)
- `src/glasses/screens/types.ts` — added `ManualLocation` interface and `manualLocation: ManualLocation | null` field to `Settings`
- `src/phone/App.tsx` — `broadcast-settings` CustomEvent now includes `manualLocation`
- `src/glasses/bridge.ts` — `handleSettingsChanged` reads and forwards `manualLocation`
- `src/glasses/effects.ts` — `runFetchPois` short-circuits GPS when `settings.manualLocation` is set

**P1 — SettingsTab secondary text was invisible** (`src/phone/tabs/SettingsTab.tsx`)
Replaced all 5 occurrences of `text-text-secondary` (undefined Tailwind token) with `text-text-dim`.

### Medium severity (uncommitted)

**B3 — Favorites loaded without field validation** (`src/phone/App.tsx`)
`JSON.parse(raw)` result is now filtered to objects with string `id` + `name` fields, not just `Array.isArray`.

**B4 — NearbyTab ignored metric units** (`src/phone/tabs/NearbyTab.tsx`, new `src/phone/utils/formatDistance.ts`)
Extracted a shared `formatDistance(miles, units)` helper that branches ft/mi vs m/km; NearbyTab and FavoritesTab both use it now.

**B5 — FavoritesTab showed stale distances + always imperial** (`src/phone/tabs/FavoritesTab.tsx`)
Distance is now recomputed live from `haversine(userLocation, poi)` whenever the current location is known (manual location or last GPS fix), falling back to the frozen `poi.distanceMiles` only when location is unknown. Uses the new shared `formatDistance` for units.

**G1 — ACTION_LABEL `'close'` mislabelled `'← Back'`** (`src/glasses/render.ts`)
Changed to `'← Close menu'`.

**G2 — NAV heading arrow pointed straight-line to destination** (`src/glasses/render.ts`)
`headingToNextPoint` now bearings to the current route step's `endPoint`, falling back to the destination only on the final step.

**Q1 — Duplicated `haversine`/`bearing` math** (new `src/glasses/geo.ts`)
Consolidated into one module; `render.ts`, `minimap.ts`, and `FavoritesTab.tsx` all import from it now instead of each having their own copy.

### Low severity (uncommitted)

**B6 — LocationSearchForm unmount race** (`src/phone/components/LocationSearchForm.tsx`)
Added a `mountedRef` guarded by an unmount effect; all four async `.then()/.catch()` callbacks (debounced search + address submit) bail out early if the component has unmounted, preventing `setState` calls after unmount.

**G3 — Minimap heading arrow always pointed north** (`src/glasses/effects.ts`, `state.ts`, `bridge.ts`, `screens/types.ts`)
GPS `heading` (from `GeolocationCoordinates.heading`) is now threaded end-to-end: `watchPosition` callback gained an optional 3rd param → `position-updated` event → `AppState`/`NAV_ACTIVE` screen → `pushMinimap`'s `headingDegrees`. Falls back to the last-known heading when GPS reports null (e.g. user stationary), and to `null` (no arrow) if never set.

**G4 — WIKI_READ scroll-up on page 0 was a dead gesture** (`src/glasses/render.ts`)
`wikiHeaderText` now shows `◄`/`►` markers indicating whether there's a previous/next page to scroll to.

**G5 — "↻ Refresh nearby" didn't show data age** (`src/glasses/effects.ts`, `state.ts`, `render.ts`, `screens/types.ts`)
POI fetch timestamp (`fetchedAt`) is threaded from `effects.ts` through state into `PoiListScreen.lastFetchTs`, and the refresh sentinel now reads "↻ Refresh (5 min ago)" etc. instead of a static label.

**P3 — Auto-refresh effect comment was unclear about its guard** (`src/phone/tabs/NearbyTab.tsx`)
Tightened the comment explaining why the empty dep array + `fetchStatus === 'idle'` check must not be changed.

**P5 — No visual feedback when glasses go offline during navigation** (`src/phone/App.tsx`)
Added a prominent yellow banner ("⚠ Glasses disconnected — navigation paused") above the scrollable content when `g2Connected === false`.

**Q2 — Dead `resetNearby`/`withNearby` code** (`src/phone/state.ts`)
Deleted both (zero callers); removed the now-unused `void withNearby` suppression and unused type imports.

**Q3 — Unused npm dependencies — ⚠️ deviated from the review's literal instruction**
The review said to `npm uninstall clsx class-variance-authority tailwind-merge`. Doing that **broke the production build**: `even-toolkit`'s bundled `dist/` code does real `import { cva } from 'class-variance-authority'`-style imports (it marks these as "optional peer deps," and Vite/Rolldown stubs missing optional peer deps as empty modules, which then fails at build time with `MISSING_EXPORT`). These packages are not actually unused — they're transitive runtime needs of even-toolkit, exactly like the pre-existing `react-router` situation.
**What was actually done instead:** reinstalled all three as `devDependencies` (not `dependencies` — nothing in *our* source imports them directly), and extended the existing `vite.config.ts` `resolve.alias` workaround (previously only covering `react-router`) to also alias `class-variance-authority`, `clsx`, and `tailwind-merge` to their real `node_modules` paths. Verified the production build succeeds after this change. **Do not attempt a clean uninstall of these three packages — it will break `vite build`.**

**Q4 — NearbyTab timer-tick state** — reviewed, no change made. The review itself called this one optional ("the current pattern is fine — it's minor"); the `setTick`/`setInterval` pattern was left as-is.

**R3 — `react-router` in runtime `dependencies`** (`package.json`)
Moved to `devDependencies` — it's only needed for the even-toolkit optional-peer-dep alias workaround, not imported by our own source.

### F2 — NearbyTab POI rows are now tappable (`src/phone/tabs/NearbyTab.tsx`)
Resolved the review's open design question in favor of making rows actionable. Tapping a row expands it in place (one row open at a time, via `expandedId` state) to reveal: the Wikipedia summary (if any), walk time + open/closed status, and links to "Open in Maps" (Google Maps universal deep link: `https://www.google.com/maps/search/?api=1&query=lat,lng`) and the POI's website (if it has one).

### Verification (re-run after every fix above)
- `tsc -b --noEmit` → zero errors (`node node_modules/typescript/bin/tsc -b --noEmit` — see note below on broken `.bin` shims)
- `vitest run` → **313/313 tests pass**, 13/13 test files (`node node_modules/vitest/vitest.mjs run`)
- `vite build` → succeeds (`node node_modules/vite/bin/vite.js build` — `node_modules/.bin/vite` is also broken in this copy, see below)

---

## Next session checklist

### Must do before GitHub push + EvenHub submission
- [ ] Decide whether to commit everything above as one commit (per the standing instruction: "once all the issues are fixed, we'll do one big update to github and upload to EvenHub" — all review findings are now fixed, so this may be ready)
- [ ] Push to GitHub (`git push origin main`). PAT was regenerated by user on 2026-06-16; if it's expired by next session, user will need to regenerate again.
- [ ] Verify Vercel auto-deploys from the push (production at `https://wander-six-phi.vercel.app`)
- [x] Build the EHPK: done 2026-06-21 (continued session) — `wander-v1.9.0.ehpk` built via `evenhub-cli`'s `main.js` directly (the `npm run pack` script itself still goes through the broken `.bin` shims in this folder, same as build/test/typecheck — see "Known state / quirks" below). **Not yet tested on simulator or real glasses.**
- [ ] Test on simulator or real glasses — especially manual location, heading arrow (G3), refresh-age label (G5), the new route-aware ETA (N8), and reconnect auto-refresh (N2) end-to-end
- [ ] **On a real Android phone**, install/open APPS Bridge, force `navigator.geolocation` to fail (e.g. revoke location for the Even Hub host app), and confirm Wander still gets a position via the bridge — see "2026-06-21 — APPS Bridge GPS fallback" above for why this is unverified

### Remaining open items from the code review (not yet acted on — feature gaps, not bugs)
- **F1** — Manual location still not fully bridged for every glasses code path; re-verify after B2 changes settle (B2 fixed the main gap — `runFetchPois` — but the review flagged this as a broader "Critical gap," worth a final pass)
- **F3** — Same root cause as B1; B1 fix should have resolved this, but worth confirming during the next test pass
- **Q5** — Same underlying dead code as Q2/R1; already resolved by the Q2 deletion
- Net-new feature ideas section of `Wander_Code_Review.md` — not evaluated this session, still open for product discussion

---

## Known state / quirks

### npm run typecheck / npm test / npx vite build all broken via their `.bin` shims in this v1.9 folder
The `cp -r` that created v1.9 from v1.8 converted symlinks in `node_modules/.bin/` to flat files, so the standard wrapper scripts resolve paths incorrectly. After `npm install`, invoke the real entry points directly instead:
- TypeScript: `node node_modules/typescript/bin/tsc -b --noEmit` instead of `npm run typecheck`
- Vitest: `node node_modules/vitest/vitest.mjs run` instead of `npm test`
- Vite build: `node node_modules/vite/bin/vite.js build` instead of `npm run build` / `npx vite build` (fails with `ERR_MODULE_NOT_FOUND`)

This does NOT mean the build itself is broken — once invoked correctly, Vite builds fine. Only the CLI shims are affected.

**Fix (optional):** `rm -rf node_modules && npm install` may restore proper symlinks if npm creates them fresh.

### Manual location — glasses limitation now fixed
v1.9 closes the gap: when the user sets a manual location on the phone, the glasses bridge now receives and applies it on the next POI fetch. The `wander-settings-changed` CustomEvent (phone → glasses, same WebView) carries `manualLocation: { lat, lng } | null`. Clearing the location (user taps "Clear (use GPS)") sends `null`, restoring normal GPS behaviour.

### ESM / opening_hours
`api/poi.ts` uses `createRequire(import.meta.url)` to load the CJS `opening_hours` package. Do **not** change this to bare `require()` — it fails in the ESM module context Vercel uses.

### Vite optional peer dep alias
`vite.config.ts` has a `resolve.alias` block redirecting four `__vite-optional-peer-dep:<pkg>:even-toolkit` virtual modules to the real installed packages: `react-router`, `class-variance-authority`, `clsx`, `tailwind-merge`. even-toolkit marks all four as optional peer deps, but its bundled `dist/` code imports them directly — without this alias, Vite/Rolldown stubs them as empty modules and the production build fails with `MISSING_EXPORT`. This is load-bearing. Do not remove any of the four entries, and do not uninstall any of those four packages (see Q3 above).

### Storage keys (unchanged from v1.8)
```
wander_radius         settings: search radius
wander_categories     settings: enabled category ids
wander_units          settings: imperial/metric
wander_sort           settings: proximity/name
wander_max_results    settings: 10/15/20
wander_manual_location settings: { label, lat, lng } | null
wander_favorites      bridge: Poi[] (set/read by glasses bridge)
wander_last_poi_cache phone: Poi[] (NearbyTab cache)
wander_last_fetch_ts  phone: timestamp of last cache write
```

### GitHub
Repo: `https://github.com/laolao91/wander` (branch: `main`)
PAT regenerated 2026-06-16 — pass via env when pushing: `GITHUB_TOKEN=<token> git push`

---

## File map (what changed in v1.9)

### Committed (`bd7813e` — High severity)
| File | Change |
|---|---|
| `package.json` / `app.json` | version `1.8.0` → `1.9.0` |
| `src/phone/App.tsx` | B1: add `sort`/`limit` to fetch-nearby-pois; B2: add `manualLocation` to broadcast-settings event |
| `src/phone/tabs/SettingsTab.tsx` | P1: `text-text-secondary` → `text-text-dim` (×5) |
| `src/glasses/screens/types.ts` | B2: add `ManualLocation` interface + `manualLocation` field to `Settings` + `DEFAULT_SETTINGS` |
| `src/glasses/bridge.ts` | B2: `handleSettingsChanged` reads and forwards `manualLocation` |
| `src/glasses/effects.ts` | B2: `runFetchPois` short-circuits GPS when `settings.manualLocation` is set |
| `Wander_Code_Review.md` | Full code review from previous session (21 findings) |

### Uncommitted (Medium + Low severity + F2 — this segment)
| File | Change |
|---|---|
| `src/phone/App.tsx` | B3: validate favorites JSON shape; P5: disconnect banner; wire `units`/`userLocation` into `FavoritesTab` |
| `src/phone/tabs/NearbyTab.tsx` | B4: use shared `formatDistance`; P3: tighten auto-refresh comment; F2: tappable/expandable POI rows with Maps/website links |
| `src/phone/tabs/FavoritesTab.tsx` | B5: live distance recompute via `haversine` + shared `formatDistance` |
| `src/phone/utils/formatDistance.ts` | **new** — shared imperial/metric distance formatter (B4/B5) |
| `src/phone/components/LocationSearchForm.tsx` | B6: `mountedRef` guards on all async callbacks |
| `src/phone/state.ts` | Q2: deleted dead `resetNearby`/`withNearby` + unused imports |
| `src/glasses/render.ts` | G1: fixed `'close'` label; G2: `headingToNextPoint` uses route step's `endPoint`; G4: wiki page prev/next markers; G5: refresh sentinel shows fetch age; uses shared `geo.ts` |
| `src/glasses/minimap.ts` | Q1: `bearingBetween` now delegates to shared `geo.ts` |
| `src/glasses/geo.ts` | **new** — shared `haversine`/`bearing` (Q1) |
| `src/glasses/state.ts` | G3: thread `heading` through `position-updated`/`NAV_ACTIVE`; G5: thread `fetchedAt`/`lastFetchTs` through `pois-loaded`/`POI_LIST` |
| `src/glasses/effects.ts` | G3: `watchPosition` callback gains optional `heading` param; G5: `runFetchPois` dispatches `fetchedAt: Date.now()` |
| `src/glasses/bridge.ts` | G3: `pushMinimap` forwards real `screen.heading` instead of hardcoded `null` |
| `package.json` | Q3: `clsx`/`class-variance-authority`/`tailwind-merge` moved to `devDependencies` (not removed — see Q3 note above); R3: `react-router` moved to `devDependencies` |
| `vite.config.ts` | Q3: extended `resolve.alias` optional-peer-dep workaround to all 4 packages (was just `react-router`) |
| `src/glasses/__tests__/state.test.ts`, `src/glasses/__tests__/effects.test.ts` | Updated literals/assertions for the new `fetchedAt`/`heading` fields (compile + runtime fixes, no behavior change) |
