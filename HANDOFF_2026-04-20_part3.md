# Wander v1.0 — April 20 Handoff (Part 3)

**Repo:** `/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Wander_v1.0/`
**Session:** 2026-04-20 (Phase 2 landed back-to-back with Phase 3a in same window)
**Status:** 122/122 tests green · typecheck clean · build clean · production bundle mock-free
**Context:** Phase 3a finished with cache + time to spare. User said "continue this build" → went straight into Phase 2 (POI_DETAIL layout fix). Phase 2 scope executed without surprises.

---

## 1. Decision Record

**Question:** Which action-menu variant — 2a (separate POI_ACTIONS screen), 2b (long-touch), or 2c (compact icon row)?

**Chose:** **2a — POI_ACTIONS screen split.**

**Rationale:**
- No new gesture dependency (2b would have needed SDK long-press confirmation).
- Directly reclaims vertical real estate for the POI_DETAIL header (2c would've kept the cramming).
- Matches the mockup's mental model: detail shows info, actions are a follow-on.
- Unit-testable at the reducer boundary — no new bridge behavior required.

---

## 2. What Shipped This Session (Phase 2)

### 2.1 Screen type changes (`src/glasses/screens/types.ts`)
- New `PoiActionsScreen`: `{ name: 'POI_ACTIONS', poi, actions[], cursorIndex }`.
- `PoiDetailScreen` simplified to `{ name: 'POI_DETAIL', poi }` — no actions, no cursor.
- `ALLOWED_TRANSITIONS`:
  - `POI_DETAIL` → `{POI_ACTIONS, POI_LIST, ERROR_NETWORK}` (dropped NAV_ACTIVE/WIKI_READ/ERROR_LOCATION — those fire from POI_ACTIONS now).
  - New `POI_ACTIONS` → `{POI_DETAIL, POI_LIST, NAV_ACTIVE, WIKI_READ, ERROR_NETWORK, ERROR_LOCATION}`.

### 2.2 Reducer flow (`src/glasses/state.ts`)
- `POI_LIST` tap → `POI_DETAIL` (read-only view, no actions attached).
- `POI_DETAIL` tap → `POI_ACTIONS` with `actionsForPoi(poi)` collapsed action set + cursor 0.
- `POI_ACTIONS` tap → `executePoiDetailAction(...)` (moved the existing action execution logic, unchanged semantics).
- `POI_ACTIONS` `cursor-up`/`cursor-down` → clamp within `actions.length`.
- `POI_ACTIONS` `back` (defensive, bridge doesn't dispatch this today) → `POI_DETAIL` (not POI_LIST — sub-screen back).
- `onRouteLoaded` / `onWikiLoaded` now require `state.screen.name === 'POI_ACTIONS'` (was `POI_DETAIL`).
- `NAV_ACTIVE` tap-to-stop + `WIKI_READ` tap-to-exit both return to the new no-cursor `POI_DETAIL`.

### 2.3 Render (`src/glasses/render.ts`)
- **Fixes bug A (line-2 truncation):** new `POI_DETAIL_HEADER_HEIGHT = 72` constant for POI_DETAIL only (other screens stay at 48). Regression-locked by test `'header is 72px tall so line 2 (metadata row) does not clip'`.
- `renderPoiDetail(poi)`: header (title + metadata, 72px), body (wiki summary + `> Tap for options  ·  Double-tap to exit` hint, 216px). No action row, no cursor.
- `renderPoiActions(poi, actions, cursorIndex)` (new): header (title only, 48px), body (action list with cursor, 240px). `isEventCapture: 1` on body for scroll routing.
- `detailBodyText(poi)` summary truncate bumped 200→260 chars to use the extra body space.
- `renderInPlaceUpdate`: POI_DETAIL returns null now (static); POI_ACTIONS returns a `detail-body` upgrade (`containerName: 'actions-body'`) for cursor moves.
- Action labels (`ACTION_LABEL`) unchanged: Navigate / Open in Safari / Read More / Back to List.

### 2.4 Tests (`src/glasses/__tests__/`)
- `state.test.ts`:
  - Split `POI_DETAIL cursor` / `POI_DETAIL actions` describes into `POI_ACTIONS cursor` / `POI_ACTIONS actions`.
  - New `tap on POI_DETAIL` describe with 2 tests (full action set + OSM-only collapsed set).
  - New `POI_ACTIONS actions` test: `'back-event (not the action) returns POI_ACTIONS to POI_DETAIL'` — pins the sub-screen-back semantics.
  - Existing background-refresh + route-loaded fixtures updated to new POI_DETAIL/POI_ACTIONS shapes.
- `render.test.ts`:
  - Updated POI_DETAIL renderer tests: new `'header is 72px tall'` lock; body asserts `Tap for options` + no action labels leak through.
  - New `renderScreen POI_ACTIONS` describe with 5 tests (layout, title-only header, full action set, cursor prefix, OSM collapse).
  - `renderInPlaceUpdate`: new test confirming POI_DETAIL returns null; POI_ACTIONS test replaces the old POI_DETAIL one.
- `bridge.test.ts`:
  - `detailState()` helper simplified (no actions/cursorIndex).

### 2.5 Tests delta: 114 → 122 (+8)

---

## 3. Verification

```
npm test         → 122/122 passing
npx tsc --noEmit → clean
npm run build    → dist/assets/index-*.js 416.37 kB │ gzip 123.40 kB
grep VITE_MOCK_LAT | readDevMockCoords in dist → 0 (clean)
grep POI_ACTIONS  in dist → 10 refs  (wired through)
grep POI_DETAIL   in dist → 13 refs  (still wired)
```

Files touched:
- `src/glasses/screens/types.ts` (new screen, transition map)
- `src/glasses/state.ts` (reducer flow)
- `src/glasses/render.ts` (POI_DETAIL restructure + POI_ACTIONS renderer)
- `src/glasses/__tests__/state.test.ts` (describes moved + added)
- `src/glasses/__tests__/render.test.ts` (POI_DETAIL assertions + POI_ACTIONS describe)
- `src/glasses/__tests__/bridge.test.ts` (detailState fixture simplified)

No changes to `bridge.ts`, `effects.ts`, `api.ts`, `minimap.ts`, or any phone-side files.

---

## 4. What This Fixes (and What's Still Open)

| Bug (from part 1 §2)                                   | Status after Phase 2                                                                 |
|--------------------------------------------------------|--------------------------------------------------------------------------------------|
| A. POI_DETAIL line 2 truncation                        | **Fixed in render.** 72px header regression-locked. Real-HW confirm needed.          |
| B. Action menu cursor coupled to wiki body scroll      | **Fixed architecturally.** Actions live on POI_ACTIONS; POI_DETAIL has no cursor.    |
| C. Loading screen stuck (real HW)                      | Mitigated in Phase 3a (15s wall-clock + friendlier copy). Real-HW confirm needed.    |
| D. Auto-jump past POI list (Rego Park)                 | Regression-locked in Phase 3a. Root cause still requires real-HW logs.               |
| E. Double-tap exit flow                                | Already working post-Phase 1 + still working after Phase 2 (DOUBLE_CLICK_EVENT unchanged). |

---

## 5. Remaining Work — Phased for Fresh Sessions

### ~~Phase 2 — POI_DETAIL layout fix~~ ✅ DONE 2026-04-20
### ~~Phase 3a — Loading copy + POI_LIST investigation~~ ✅ DONE 2026-04-20

### Phase 3b — Real-HW verification of Phases 1 + 2 + 3a — **NEXT**
On-glasses pass:
- Confirm POI_DETAIL line 2 renders cleanly at 72px header.
- Confirm tap on POI_DETAIL advances to POI_ACTIONS (cursor on Navigate).
- Confirm scroll inside POI_ACTIONS moves cursor without touching wiki body.
- Confirm each action (Navigate / Safari / Read More / Back to List) fires its effect.
- Confirm `back` action returns to POI_LIST; wiki-exit returns to POI_DETAIL.
- Confirm 300ms scroll cooldown eliminates boundary bounce (Phase 1).
- Confirm double-tap CONFIRM_EXIT from every screen including POI_ACTIONS (Phase 1).
- Confirm geolocation wall-clock timeout fires cleanly on a GPS-denied real-HW scenario (Phase 3a).
- Confirm new loading copy reads right at 576×288 (Phase 3a).
- If Rego Park auto-jump reproduces: capture `[wander][evt]` logs via Safari Web Inspector (PHASE0_CAPTURE_LOGS.md).

**Session budget estimate:** 30–60 min. Requires physical G2 glasses + iPhone + outdoor walk.

### Phase 4 — Mockup parity (HANDOFF.md §1.5 C1–C4)
- Loading centered rule.
- POI list single-line right-align + legend.
- POI detail bearing label.
- NAV_ACTIVE 3-stat row + next-step preview.

Note: Phase 2 changed the POI_DETAIL layout; re-check the mockup against the new 72px header to see if C3 (bearing label) still lands naturally.

### Phase 5 — Phone Settings tab
Radius slider, 8 category toggles, display section, legend, sync card. Categories must functionally filter POIs.

### Phase 6 — Phone Nearby tab + "Send to Phone"
Relabel "Open in Safari" → "Send to Phone"; full wiki opens in Safari on companion phone.

### Phase 7 — Settings ↔ glasses sync
Dispatch bus, `bridge.setLocalStorage`, cache silently during NAV_ACTIVE / WIKI_READ / POI_DETAIL / POI_ACTIONS.

### Phase 8 — NAV_ACTIVE + WIKI_READ real-HW pass
Includes strip Phase 0 diagnostic log + `…` → `..` at `render.ts:458`.

### Phase 9 — Submission polish
Mock teardown, Tailwind-vs-spec resolution, final real-HW smoke test, `.ehpk` package.

---

## 6. Architectural Decisions Still Open

*(Two remaining, one closed.)*
1. ~~**Action menu design (2a/2b/2c)**~~ — **CLOSED:** 2a shipped.
2. **Dispatch bus pattern** (phone ↔ glasses reducer) — module singleton vs event emitter. Defer until Phase 5.
3. **Tailwind vs spec §9** — required call before Phase 5.

---

## 7. Submission Teardown Debt

*(Unchanged from parts 1 + 2. All items still open.)*
1. Delete `readDevMockCoords()` + call sites in `effects.ts`.
2. Remove `VITE_MOCK_LAT`/`VITE_MOCK_LNG` from `.env.local`.
3. Strip Phase 0 `[wander][evt]` diagnostic log from `bridge.ts`.
4. Fix `…` → `..` at `render.ts:458`.
5. Resolve Tailwind-vs-spec conflict.
6. Verify teardown greps return zero.
7. Revisit `GEOLOCATE_WALL_CLOCK_MS` (15s) value against Phase 3b real-HW data.

---

## 8. Fresh-Session Kickoff Checklist

1. Read this doc (part 3) + `HANDOFF_2026-04-20_part2.md` + `HANDOFF_2026-04-20.md` + `HANDOFF.md` + `WANDER_BUILD_SPEC.md` + `wander-mockup.html`.
2. Read `project_wander_dev_geo_mock.md` memory.
3. `cd Wander_v1.0 && npm test` → confirm 122/122 green.
4. `npm run dev` + EvenHub simulator → smoke-test the new flow: POI_LIST → POI_DETAIL (tap once, see wiki summary + hint) → POI_ACTIONS (tap again, action list with cursor).
5. **Phase 3b is the natural next task if real HW is available.** Otherwise pick up Phase 4 (mockup parity).
