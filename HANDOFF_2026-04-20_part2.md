# Wander v1.0 — April 20 Handoff (Part 2)

**Repo:** `/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Wander_v1.0/`
**Session:** 2026-04-20 (Phase 3a landed, session budget spent)
**Status:** 114/114 tests green · typecheck clean · build clean · production bundle mock-free
**Context for session:** Steven had ~7% of weekly Opus budget + one fresh 5hr window. Scoped down to Phase 3a (code-only slice) to preserve higher floor — Phase 2 (POI_DETAIL layout) would have risked consuming the whole budget if it hit an unexpected SDK snag.

---

## 1. Decision Record

**Question:** Given the constrained budget, which phases from `HANDOFF_2026-04-20.md` §4 fit?

**Options weighed:**
- Phase 2 only (POI_DETAIL + POI_ACTIONS screen split — fixes the two most visible bugs but heavier: new screen in state machine, reducer changes, render split, new tests, plus real-HW validation burden).
- Phase 3a only (loading copy + POI_LIST bypass investigation — cheap, purely reducer/string/effects changes, no new screen).
- Phase 2 + Phase 3a (most value but real risk of Phase 2 overrunning and leaving Phase 3a undone).

**Chose:** Phase 3a only. Lower ceiling, higher floor. Phase 2 deferred to the next full session.

**Skipped explicitly:** Phase 3b (real-HW verification pass — sim-only this window), Phase 4 (mockup parity), Phases 5–9.

---

## 2. What Shipped This Session (Phase 3a)

### 2.1 Friendlier LOADING copy
`src/glasses/state.ts`:
- `INITIAL_STATE.screen.message`: `'Finding what is around you'` → `'Discovering interesting things near you...'`
- `goLoading()` retry path: `'Loading'` → `'Discovering interesting things near you...'`

Both initial boot + any retry (from ERROR_LOCATION / ERROR_NETWORK / ERROR_EMPTY) now share the same warmer copy. Uses `...` (three ASCII dots), not `…` — the LVGL fixed font doesn't carry the single-char ellipsis glyph (see submission teardown item 4 in part 1; `render.ts:458` still needs the separate `…` → `..` fix).

### 2.2 Geolocation wall-clock timeout (addresses bug C — "stuck on loading")
`src/glasses/effects.ts`, `defaultGeolocate()`:
- Added `GEOLOCATE_WALL_CLOCK_MS = 15000` module constant.
- Wrapped `navigator.geolocation.getCurrentPosition(...)` in a `Promise.race` against a 15s wall-clock timer.
- On timeout, resolves `null` — same as user-denial — which routes through the existing `pois-failed { reason: 'location' }` → `ERROR_LOCATION` → retry-affordance path.

**Why defense-in-depth:** `PositionOptions.timeout: 10000` already exists inside the getCurrentPosition call. The April 19 real-HW report described a permanent hang — that only happens if the G2 WebView's geolocation API fails to invoke *either* callback (not a spec-compliant failure path). The outer race guarantees the reducer always hears back within 15s even if the inner timeout is silently dropped.

**Left for Phase 3 proper (real-HW):** parallel wall-clock protection for `defaultWatchPosition` (NAV_ACTIVE GPS watch — same failure mode theoretically possible but not yet observed).

### 2.3 POI_LIST bypass investigation (bug D)
Reviewed the reducer end-to-end. `onPoisLoaded()` in `src/glasses/state.ts:166` unconditionally routes to POI_LIST on initial load regardless of `pois.length`. No short-circuit, no "single result auto-select" path. The transition map (`ALLOWED_TRANSITIONS.LOADING` in `screens/types.ts:136`) does not include POI_DETAIL — a direct LOADING → POI_DETAIL jump would throw in dev.

**Conclusion from code review:** the reducer cannot produce the auto-jump Steven saw in Rego Park. Three remaining hypotheses, all requiring real-HW logs to distinguish:
1. **User misread the screen** — POI_LIST rendered but the user double-tapped through it faster than perceived (post-Phase-1 double-tap now always surfaces CONFIRM_EXIT, so this is easier to rule out next pass).
2. **Stale screen push** — bridge's `pushScreen` upgrade-vs-rebuild heuristic (bridge.ts:128) left POI_DETAIL containers on-screen from a prior session's SDK state on cold boot.
3. **SDK boot race** — first `createStartUpPageContainer` call landed POI_DETAIL artifacts from a previous install's cache.

**Defensive regression lock shipped:** new test in `src/glasses/__tests__/state.test.ts` — `'routes a single-POI result through POI_LIST (never auto-selects)'` — pins the documented behavior at the reducer boundary. If anyone ever adds a `pois.length === 1` shortcut, the test fails.

**Next-session action:** re-run with Phase 0 diagnostic logs captured, look for `[wander][evt] screen=POI_DETAIL` *before* any user input fires — that would confirm a bridge/SDK-side issue rather than a reducer one.

---

## 3. Verification

```
npm test        → 114/114 passing (was 113, +1 single-POI lock test)
npx tsc --noEmit → clean
npm run build    → dist/assets/index-*.js 415.66 kB │ gzip 123.28 kB
grep -c "VITE_MOCK_LAT\|readDevMockCoords" dist/assets/*.js → 0  (still mock-free)
```

Files touched:
- `src/glasses/state.ts` (2 copy edits)
- `src/glasses/effects.ts` (GEOLOCATE_WALL_CLOCK_MS + Promise.race)
- `src/glasses/__tests__/state.test.ts` (1 new test)

No changes to bridge.ts, render.ts, screens/types.ts, or any phone-side files.

---

## 4. Remaining Work — Phased for Fresh Sessions

*(Same order as part 1 §4, re-numbered with Phase 3a crossed off. Each phase is sized for a single fresh session unless noted.)*

### ~~Phase 3a — Loading copy + POI_LIST investigation~~ ✅ DONE 2026-04-20

### Phase 2 — POI_DETAIL layout fix (bugs A + B) — **NEXT**
Split action menu out of POI_DETAIL into a new POI_ACTIONS screen so line 2 ("★ landmark · 0.2 mi · ~4 min") stops getting clipped and the action cursor stops fighting the wiki body scroll. Recommended option is **2a** from part 1 §4 (separate screen, single-tap POI_DETAIL → POI_ACTIONS). Full work items in part 1.

**Session budget estimate:** 1 fresh 5hr session. Real-HW verification should be a separate micro-session after.

### Phase 3b — Real-HW verification of Phases 1 + 3a
On-glasses pass:
- Confirm 300ms scroll cooldown eliminates boundary bounce.
- Confirm double-tap CONFIRM_EXIT works from every screen.
- Confirm geolocation wall-clock timeout fires cleanly (or isn't needed because the inner timeout now works on real HW).
- Capture `[wander][evt]` diagnostic logs if the Rego Park auto-jump reproduces.
- Confirm new loading copy reads right at 576×288.

**Session budget estimate:** 30–60 min, requires physical G2 glasses + iPhone + outdoor walk.

### Phase 4 — Mockup parity (HANDOFF.md §1.5 C1–C4)
- Loading centered rule
- POI list single-line right-align + legend
- POI detail bearing label
- NAV_ACTIVE 3-stat row + next-step preview

### Phase 5 — Phone Settings tab
Radius slider, 8 category toggles, display section, legend, sync card. **Categories must functionally filter POIs.**

### Phase 6 — Phone Nearby tab + "Send to Phone"
Relabel "Open in Safari" → "Send to Phone"; full wiki opens in Safari on companion phone.

### Phase 7 — Settings ↔ glasses sync
Dispatch bus (architecture decision still open), `bridge.setLocalStorage`, cache silently during NAV_ACTIVE / WIKI_READ / POI_DETAIL.

### Phase 8 — NAV_ACTIVE + WIKI_READ real-HW pass
Includes strip Phase 0 diagnostic log, `…` → `..` at `render.ts:458`.

### Phase 9 — Submission polish
Mock teardown, Tailwind-vs-spec resolution, final real-HW smoke test, `.ehpk` package.

---

## 5. Architectural Decisions Still Open

*(Unchanged from part 1 — none closed this session.)*
1. **Dispatch bus pattern** — module singleton vs event emitter. Defer until Phase 5.
2. **Tailwind vs spec §9** — required call before Phase 5.
3. **Action menu design (2a/2b/2c)** — pick at start of Phase 2.

---

## 6. Submission Teardown Debt

*(Unchanged from part 1 §3. Every item still open.)*
1. Delete `readDevMockCoords()` + call sites in `effects.ts`.
2. Remove `VITE_MOCK_LAT`/`VITE_MOCK_LNG` from `.env.local`.
3. Strip Phase 0 `[wander][evt]` diagnostic log from `bridge.ts`.
4. Fix `…` → `..` at `render.ts:458`.
5. Resolve Tailwind-vs-spec conflict.
6. Verify teardown greps return zero.

**New item (minor):** revisit whether `GEOLOCATE_WALL_CLOCK_MS` in `effects.ts` should stay at 15s for production — it's a safety net, not spoofing, so it can ship, but validate the value against real-HW data from Phase 3b.

---

## 7. Fresh-Session Kickoff Checklist

1. Read this doc (part 2) + `HANDOFF_2026-04-20.md` (part 1) + `HANDOFF.md` + `WANDER_BUILD_SPEC.md` + `wander-mockup.html`.
2. Read `project_wander_dev_geo_mock.md` memory.
3. `cd Wander_v1.0 && npm test` → confirm 114/114 green.
4. `npm run dev` + EvenHub simulator → confirm mock GPS + API proxy still work; new loading copy should read "Discovering interesting things near you...".
5. **Confirm Phase 2 action-menu design decision** (recommendation: 2a).
6. Execute Phase 2; ship; hand off to Steven for real-HW Phase 3b micro-session.
