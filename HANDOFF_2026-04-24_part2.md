# Wander v1.0 — April 24 Handoff (Part 2)

**Repo:** `/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Wander_v1.0/`
**Status:** 151/151 tests green · typecheck clean · build clean · production bundle mock-free · teardown item §7-4 closed · **Phase 4b (bug H) closed**
**Stack:** TypeScript + React 19 + Vite + Tailwind 4.2.2 · `@evenrealities/even_hub_sdk@0.0.10` · `@evenrealities/evenhub-simulator@0.7.2` · `even-toolkit@1.7.2`

Continues from `HANDOFF_2026-04-24.md`. That doc remains on disk and is still accurate for everything prior to this session; this part-2 file supersedes it going forward.

---

## 0. What This Session (04-24 part 2) Did

No glasses were available, so Option B was picked: **Phase 4b — minimap cardinal reference overlay** (bug H in the prior handoff's bug board; §6.4 design recommendation).

Phase 4d (POI_LIST pagination) was explicitly **not started** — closing it requires API changes (the serverless route has a hard-coded `MAX_RESULTS = 20` and no offset param), plus state/effect/render/test work, plus the §6.6 UX design call is still "open, recommendation only." That's too much surface for a partial land in a continuation session.

Phase 4a-4 (POI_LIST right-align) was **not started** — handoff §2 and §5 both flag it as wanting real-HW iteration on the G2 non-monospace font, which we don't have.

Phases 5 + 6 were **not started** — blocked on §6.3 Tailwind decision.

---

## 1. Where We Are

**Phases complete:**
- **Phase 0** (04-19) — `[wander][evt]` diagnostic log + Safari Web Inspector walkthrough.
- **Phase 1** (04-19) — Bridge input fixes.
- **Phase 2** (04-20) — POI_DETAIL/POI_ACTIONS screen split. POI_DETAIL header 48→72px.
- **Phase 3a** (04-20) — Friendlier LOADING copy, 15s geolocation wall-clock, single-POI regression-lock.
- **Phase 3c** (04-24 session 1) — WIKI_READ pageIndex, NAV_ACTIVE 72px header, NAV_RULE.
- **Phase 4a-1/2/3** (04-24 session 2) — LOADING thin rule, POI_DETAIL cardinal bearing, NAV_ACTIVE 3-stat row + `Next:` preview.
- **Teardown §7-4** (04-24 session 2 tail) — `truncate()` emits `..` not U+2026; regression-locked.
- **Phase 4b** (04-24 part 2, this session) — Minimap cardinal reference. Four edge-midpoint tick marks (N/S/E/W) drawn as short inward line segments in dim grey, plus a small upward triangle + "N" label in the top-right corner rendered in a brighter grey. Drawn once per minimap refresh, underneath the dashed route so the route stays visually dominant. Works on an empty-bounds state too (user sees orientation even before any geometry arrives).
  - Pure helpers `cardinalTicks(w, h, length)` and `northArrow(w)` are exported so the tick positions + arrow geometry can be asserted in tests without a canvas.
  - 11 new tests cover tick edge-midpoint placement, default tick length (4px), scaling with a custom canvas, N-arrow corner position, upward orientation (tip y < base ys), and horizontal base alignment.
  - No state, bridge, render, or API changes — contained entirely in `minimap.ts`.

**Dev-only shims still in place (teardown tracked — see §7):**
- `VITE_MOCK_LAT`/`VITE_MOCK_LNG` in `.env.local` → gated on `import.meta.env.DEV` in `effects.ts`.
- Vite dev proxy `/api/*` → `https://wander-six-phi.vercel.app` (dev only).

**Phase 0 diagnostic log still on** (`bridge.ts` top of `translateGlassesEvent`) — strip in Phase 8.

---

## 2. Bug Board

| Bug                                                     | Origin            | Status                                                                                              |
|---------------------------------------------------------|-------------------|-----------------------------------------------------------------------------------------------------|
| A. POI_DETAIL line 2 truncation                         | 04-19 HW          | Fixed Phase 2. **Real-HW confirm pending.**                                                         |
| B. Action cursor coupled to wiki scroll                 | 04-20 sim         | Fixed Phase 2. **Real-HW confirm pending.**                                                         |
| C. Stuck on loading screen                              | 04-19 HW          | Mitigated Phase 3a. **Real-HW confirm pending.**                                                    |
| D. Auto-jump past POI list (Rego Park)                  | 04-19 HW          | Regression-locked. Needs real-HW `[wander][evt]` logs.                                              |
| E. Double-tap exit flow                                 | —                 | ✅ Sim-confirmed 04-20.                                                                              |
| F. NAV_ACTIVE ↓ category line clipping                  | 04-24 sim         | Fixed Phase 3c-2. Real-HW confirm pending.                                                          |
| G. Horizontal bars at bottom of NAV screen              | 04-24 sim         | Fixed Phase 3c-3. Real-HW confirm pending.                                                          |
| **H. Minimap has no grid / no orientation reference**   | 04-24 sim         | **Fixed Phase 4b this session** (cardinal ticks + top-right N arrow + label). Real-HW confirm pending. |
| I. WIKI_READ stuck on page 1 despite `1/N` header       | 04-24 sim         | Fixed Phase 3c-1. Real-HW confirm pending.                                                          |
| **J. No POI image on detail screen**                    | 04-24 user ask    | **Open — Phase 4c.** New feature: render POI image so user knows what to look for.                  |
| **K. POI_LIST can't page past first 20 / no refresh**   | 04-24 user ask    | **Open — Phase 4d.** Needs API pagination support + UX decision (§6.6).                             |
| L. Wiki content feels thin                              | 04-24 user ask    | Re-evaluate after 3c-1 real-HW pass.                                                                |
| **M. Phone companion app not built (blocks submission)**| 04-24 user ask    | **Open — Phases 5–6 greatly expanded.** Phone directories empty; blocked on §6.3 Tailwind call.    |

---

## 3. What Shipped Today (Part 2)

### 3.1 Files touched — Phase 4b
- `src/glasses/minimap.ts`:
  - New exported pure helper `cardinalTicks(canvasWidth, canvasHeight, length)` → returns `{ N, S, E, W }` each as a `[edgePoint, innerPoint]` line-segment pair.
  - New exported pure helper `northArrow(canvasWidth)` → returns `{ triangle: [tip, baseLeft, baseRight], label: { x, y } }` anchored in the top-right corner.
  - New internal `drawCardinalReference(ctx, w, h)` which strokes the four ticks in `#666` and fills the N triangle + "N" text in `#888` using `bold 9px sans-serif`.
  - `drawMinimap` now calls `drawCardinalReference` immediately after the black background fill, *before* projecting route/dest/userPos. That ordering keeps the white route + markers visually above the reference layer.

- `src/glasses/__tests__/minimap.test.ts`:
  - Imports `cardinalTicks` and `northArrow`.
  - New `cardinalTicks` describe (6 tests): N/S/W/E placement + scaling + default length.
  - New `northArrow` describe (5 tests): top-right corner placement, upward tip, horizontal base, label anchor, scaling with canvas width.

No changes to `state.ts`, `bridge.ts`, `effects.ts`, `render.ts`, `api.ts`, phone UI, or serverless.

### 3.2 Verification (end of session)
```
npm test                → 151/151 passing (was 140 → +11)
npx tsc --noEmit        → clean
npm run build           → dist/assets/index-hb0g9Rpx.js 417.67 kB │ gzip 123.84 kB
grep -rn "…" src/       → 0 matches (teardown §7-4 still passing)
```

### 3.3 What to look for in the simulator
Fire up `npm run dev` + the EvenHub simulator → navigate into NAV_ACTIVE. The minimap should now show:
- Four short tick marks at the canvas edge midpoints (top, bottom, left, right).
- A small upward-pointing triangle in the top-right corner with an "N" label immediately next to it.
- The dashed route + destination ring + user-position triangle still draw on top; they should all still be legible.

The ticks + N glyph are rendered in mid-grey (`#666` / `#888`). After the host's gray4 quantization they should land on a distinct tier from both the black background and the white route.

---

## 4. Remaining Phases

| Phase | Scope                                                                                          | Blocker                               | Est. size |
|-------|------------------------------------------------------------------------------------------------|---------------------------------------|-----------|
| 3b    | Real-HW verification of Phases 1 + 2 + 3a + 3c + 4a-1/2/3 + **4b**                             | Physical glasses + outdoor walk       | 30–60 min |
| 4a-4  | POI_LIST single-line right-align distance + legend (C1)                                        | Real-HW iteration recommended         | 1 focused session |
| ~~4b~~ | ~~Minimap grid/compass overlay~~                                                              | —                                     | ✅ 04-24 part 2 |
| 4c    | POI image on POI_DETAIL (bug J)                                                                | API source decision (§6.5) + SDK ImageContainer layout | 1–2 sessions |
| 4d    | POI_LIST pagination + refresh (bug K)                                                          | **Needs API change** (hard-coded `MAX_RESULTS = 20`, no offset param) + §6.6 UX call | 1 session |
| 5     | Phone Settings tab                                                                             | §6.3 Tailwind-vs-spec call, empty component dirs | 1–2 sessions |
| 6     | Phone Nearby tab                                                                               | Phase 5 shell must land first         | 1–2 sessions |
| 7     | Settings ↔ glasses sync                                                                        | §6.2 Dispatch bus pattern             | 1 session |
| 8     | NAV_ACTIVE + WIKI_READ real-HW pass; strip Phase 0 log; teardown verify                       | Physical glasses                      | 30–60 min |
| 9     | Submission polish                                                                              | All prior phases                      | 1 session |

**Order-of-operations still applies:** Phases 4a–4d + 5 + 6 must all land before submission prep.

---

## 5. Next Session — Recommended Order

### Option A (glasses available): **Phase 3b — Real-HW verification** [30–60 min]
Walking loop. Seven checks from the prior handoff, plus one new 4b check:

1. **3c-1:** WIKI_READ scroll advances/retreats the `N/M` counter and swaps body text. Clamp both ends.
2. **3c-2:** NAV_ACTIVE second header line (`↓ landmark`) renders fully.
3. **3c-3:** Single horizontal separator in nav body, not stacked bars.
4. **4a-1:** LOADING shows a thin rule between WANDER and the message.
5. **4a-2:** POI_DETAIL subtitle reads `"<icon> <category>  ·  X.X mi <CARDINAL>  ·  ~N min"`.
6. **4a-3:** NAV_ACTIVE line 2 reads `"~N min · <CARDINAL>"` and `"Next:"` preview appears when a step follows.
7. **4b (new):** NAV_ACTIVE minimap shows four edge-midpoint ticks and a top-right N triangle + label. Confirm all four ticks survive gray4 quantization (not invisible, not indistinguishable from the route).
8. Rego Park auto-jump repro → `[wander][evt]` logs.

### Option B (no glasses): **Phase 4d** or **Phase 4c** or **Phase 4a-4**
Pick based on appetite for cross-layer work:

- **4d (list pagination + refresh)** is probably the most self-contained next step after 4b, **but** it requires a coordinated API change (add `?offset=` or raise `MAX_RESULTS`, then teach the client to paginate). Close §6.6 first ("More" sentinel vs infinite scroll vs auto-refresh). Plan before coding.

- **4c (POI image)** needs the §6.5 source decision (Wikipedia thumb endpoint recommended) + new `api/poi-image.ts` proxy + image-bytes plumbing through `effects.ts` → `bridge.ts` → `ImageRawDataUpdate` on POI_DETAIL + layout reflow in `render.ts`. Bigger than 4d; may straddle two sessions.

- **4a-4 (POI_LIST right-align)** — only worth starting if the next-next session will have glasses. The non-monospace font means visual iteration matters.

Recommend **4d** if §6.6 is being decided next session, otherwise **4a-4 only paired with a real-HW window**.

### Avoid this session
- Phases 5 + 6 until §6.3 Tailwind-vs-spec is resolved.
- Teardown §7 items 1/2/3 (would break simulator workflow).

### Hard rule
**Do not start a phase that cannot be finished within the session limit. When stopping, generate a new handoff doc.**

---

## 6. Open Architectural Decisions

### 6.1 ~~Action menu design~~ — **CLOSED 04-20**

### 6.2 Dispatch bus pattern (phone ↔ glasses reducer) — **open, due before Phase 5**
Module singleton vs event emitter. Recommendation: module singleton unless Phase 5 surfaces test-isolation pain.

### 6.3 Tailwind vs spec §9 — **open, due before Phase 5**
Rip out Tailwind vs amend spec. Call this before any phone UI work.

### 6.4 ~~Minimap orientation model~~ — **CLOSED 04-24 part 2** (Phase 4b shipped: cardinal ticks + top-right N triangle + "N" label, dim grey on black so they sit below the route)

### 6.5 POI image source (Phase 4c) — **open**
Wikipedia `rest_v1/page/summary/<title>` thumb endpoint recommended for wiki-backed POIs; OSM-only POIs stay image-less (spec §9 frowns on decorative placeholders).

### 6.6 POI_LIST pagination UX (Phase 4d) — **open, due before Phase 4d**
"More" sentinel item + `Refresh nearby` item when stale (≥200m) is the current recommendation. Explicit + debuggable. Infinite-scroll-on-past-last is the main alternative.

---

## 7. Submission Teardown Debt

Before packaging `.ehpk` (Phase 9):
1. Delete `readDevMockCoords()` + both call sites in `src/glasses/effects.ts`.
2. Remove `VITE_MOCK_LAT`/`VITE_MOCK_LNG` from `.env.local`.
3. Strip Phase 0 `[wander][evt]` diagnostic log from `src/glasses/bridge.ts`.
4. ~~Fix U+2026 → `..` in truncate helper.~~ ✅ **Closed 04-24 session 2.** Regression-locked.
5. Resolve Tailwind-vs-spec conflict (§6.3).
6. Revisit `GEOLOCATE_WALL_CLOCK_MS` (15s) against real-HW data from Phase 3b.
7. Verify: `grep -r VITE_MOCK_LAT src/` → 0, `grep -r "\[wander\]\[evt\]" src/` → 0, `grep -rn "…" src/` → 0 *(last one already passing)*.
8. Push polished local branch to GitHub; mirror all file state.
9. Submission requirements checklist.

Persistent memory: `project_wander_dev_geo_mock.md`.

---

## 8. Kickoff Checklist

1. Read this doc. Skim `HANDOFF_2026-04-24.md` + `WANDER_BUILD_SPEC.md` + `wander-mockup.html`.
2. Glance at `project_wander_dev_geo_mock.md` memory.
3. `cd Wander_v1.0 && npm test` → confirm 151/151 green.
4. `npm run dev` + simulator → smoke flow:
   - LOADING (thin `─` rule visible)
   - POI_LIST
   - POI_DETAIL (subtitle has cardinal, e.g. `0.3 mi NE`)
   - POI_ACTIONS
   - WIKI_READ (scroll down, confirm page advances)
   - NAV_ACTIVE (2-line header, DISTANCE / ETA·BEARING, `Next:` preview, single-bar separator, **minimap shows 4 tick marks + top-right N triangle**).
5. Pick next task:
   - Glasses + walk → **Phase 3b** (8 checks — see §5).
   - Otherwise → **Phase 4d (list pagination)** if §6.6 can be decided, else **Phase 4c (POI image)** if §6.5 can be decided.
6. If considering Phase 5+ → resolve §6.3 Tailwind decision first.

---

## 9. Quick Reference — Files You'll Touch

**Glasses reducer/view:** `src/glasses/{state,bridge,effects,render,minimap}.ts`, `src/glasses/screens/types.ts`
**Glasses tests:** `src/glasses/__tests__/{state,bridge,render,minimap,api}.test.ts`
**Phone UI (Phases 5–6):** `src/phone/App.tsx` (placeholder), `src/phone/tabs/` (empty), `src/phone/components/` (empty)
**Config:** `vite.config.ts`, `.env.local`, `src/vite-env.d.ts`
**Serverless:** `api/{poi,route,wiki,health}.ts`, `api/_lib/`

**For Phase 4d specifically:** `api/poi.ts` currently hard-codes `MAX_RESULTS = 20` at line 15 and has no `offset` query param. Either raise MAX_RESULTS (cheapest) or add real offset support (cleanest).

**Don't open:** `.git/`, `node_modules/`, `dist/`, `.vercel/`.

---

## 10. Session Summary (for continuity)

**04-24 part 2:** 1 bounded change (Phase 4b), 11 new tests, 0 architectural moves.
- Bug H closed architecturally via cardinal reference overlay (cardinal ticks + N arrow). Real-HW confirm pending.
- §6.4 decision closed and removed from the open-decisions list.
- No API, state, bridge, effects, or render changes — minimap-only.

**04-24 running totals (3 sessions):** 8 bounded changes, 29 new tests across all three sessions of 04-24.

**Net forward progress on 04-24 (cumulative):**
- 4 bugs closed architecturally (F, G, I, H).
- 3 mockup-parity items shipped (4a-1/2/3).
- 1 teardown item closed early (§7-4).
- 1 architectural decision closed (§6.4 minimap orientation).
- 5 issues specced as proper phases (J, K, L, M, 4a-4).

**Big outstanding non-bug work before submission:**
- 4a-4 (POI_LIST right-align).
- 4c (POI image) + 4d (list pagination).
- 5 + 6 (phone app — empty today).
- Teardown §7 items 1, 2, 3, 5, 6, 8, 9.

**End-of-day 04-24 part 2:** 151/151 tests, tc clean, build 417.67 kB / 123.84 kB gzip, `grep -rn "…" src/` → 0.
