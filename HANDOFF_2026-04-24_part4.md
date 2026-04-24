# Wander v1.0 — April 24 Handoff (Part 4)

**Repo:** `/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Wander_v1.0/`
**Status:** 204/204 tests green · typecheck clean · build clean · production bundle mock-free · **Phase 4d landed (POI_LIST pagination + Refresh sentinel)**
**Stack:** TypeScript + React 19 + Vite + Tailwind 4.2.2 · `@evenrealities/even_hub_sdk@0.0.10` · `@evenrealities/evenhub-simulator@0.7.2` · `even-toolkit@1.7.2`

Continues from `HANDOFF_2026-04-24_part3.md`. Earlier handoffs remain on disk for context; this part-4 supersedes them going forward.

---

## 0. What This Session (04-24 part 4) Did

Resumed from the part-3 kickoff and implemented **Phase 4d (POI_LIST pagination + refresh)** end-to-end against the §6.6 recommendation. New behaviour:

- `/api/poi` accepts `?offset=N` and now returns `{ items: Poi[], hasMore: boolean }` (envelope shape — wire change).
- POI_LIST appends a "▼ More results" sentinel when more is available, plus an always-on "↻ Refresh nearby" sentinel.
- Tapping More fires `load-more` → `fetch-pois { offset, mode: 'append' }`; the response is concatenated onto `poiList`.
- Tapping Refresh fires `refresh-pois` → LOADING screen + `fetch-pois { offset: 0, mode: 'replace' }`.
- Background refresh (5-min timer) still works — always replace, always page 0; resets any user-paginated tail.

Geographic-staleness gating (auto-refresh after walking ≥200m) is **deferred** — the manual Refresh sentinel covers the user-facing half of bug K, and the auto half wants real-HW data before designing.

---

## 1. Where We Are

**Phases complete:**
- **Phase 0** (04-19) — `[wander][evt]` diagnostic log.
- **Phase 1** (04-19) — Bridge input fixes.
- **Phase 2** (04-20) — POI_DETAIL/POI_ACTIONS split; POI_DETAIL 72px header.
- **Phase 3a** (04-20) — LOADING copy, 15s geolocation wall-clock, single-POI regression-lock.
- **Phase 3c** (04-24 session 1) — WIKI_READ pageIndex, NAV_ACTIVE 72px header, NAV_RULE.
- **Phase 4a-1/2/3** (04-24 session 2) — LOADING thin rule, POI_DETAIL cardinal bearing, NAV_ACTIVE 3-stat row + `Next:` preview.
- **Teardown §7-4** (04-24 session 2 tail) — `truncate()` emits `..` not U+2026.
- **Phase 4b** (04-24 part 2) — Minimap cardinal reference (4 ticks + top-right N triangle + label).
- **Phase 5 data layer** (04-24 part 3) — phone reducer, types, persistence adapter.
- **Phase 4d** (04-24 part 4, this session) — POI_LIST pagination + refresh. See §3 below.

**Dev-only shims still in place (see §7 teardown):**
- `VITE_MOCK_LAT`/`VITE_MOCK_LNG` in `.env.local` → gated on `import.meta.env.DEV`.
- Vite dev proxy `/api/*` → `https://wander-six-phi.vercel.app`.

**Phase 0 diagnostic log** still on in `bridge.ts` — strip in Phase 8.

---

## 2. Bug Board

| Bug                                                     | Origin            | Status                                                                                              |
|---------------------------------------------------------|-------------------|-----------------------------------------------------------------------------------------------------|
| A. POI_DETAIL line 2 truncation                         | 04-19 HW          | Fixed Phase 2. Real-HW confirm pending.                                                             |
| B. Action cursor coupled to wiki scroll                 | 04-20 sim         | Fixed Phase 2. Real-HW confirm pending.                                                             |
| C. Stuck on loading screen                              | 04-19 HW          | Mitigated Phase 3a. Real-HW confirm pending.                                                        |
| D. Auto-jump past POI list (Rego Park)                  | 04-19 HW          | Regression-locked. Needs real-HW `[wander][evt]` logs.                                              |
| E. Double-tap exit flow                                 | —                 | ✅ Sim-confirmed 04-20.                                                                              |
| F. NAV_ACTIVE ↓ category line clipping                  | 04-24 sim         | Fixed Phase 3c-2. Real-HW confirm pending.                                                          |
| G. Horizontal bars at bottom of NAV screen              | 04-24 sim         | Fixed Phase 3c-3. Real-HW confirm pending.                                                          |
| H. Minimap has no grid / no orientation reference       | 04-24 sim         | Fixed Phase 4b. Real-HW confirm pending.                                                            |
| I. WIKI_READ stuck on page 1 despite `1/N` header       | 04-24 sim         | Fixed Phase 3c-1. Real-HW confirm pending.                                                          |
| J. No POI image on detail screen                        | 04-24 user ask    | Open — Phase 4c. Blocked on §6.5 source decision.                                                   |
| **K. POI_LIST can't page past first 20 / no refresh**   | 04-24 user ask    | **Manual half closed Phase 4d.** Auto-refresh on geo-staleness still deferred — see §6.6 follow-up. |
| L. Wiki content feels thin                              | 04-24 user ask    | Re-evaluate after 3c-1 real-HW pass.                                                                |
| M. Phone companion app not built (blocks submission)    | 04-24 user ask    | Data layer landed Phase 5 (part 3). UI still blocked on §6.3 Tailwind call.                         |

---

## 3. What Shipped Today (Part 4) — Phase 4d Detail

### 3.1 Wire-shape change to `/api/poi`

**File:** `api/poi.ts`

- New `?offset=N` query param. Clamped 0..MAX_RESULTS_TOTAL=60 server-side.
- New constants: `PAGE_SIZE = 20` (items per response), `MAX_RESULTS_TOTAL = 60` (upstream cap; 3 pages of headroom).
- Response shape: **`{ items: Poi[], hasMore: boolean }`** (was: bare `Poi[]`).
- `hasMore = offset + PAGE_SIZE < allMerged.length` — true iff a strictly later page would have at least one item.
- Sort happens before slice (so sort order is stable across pages); upstream `dedupe` runs on the full merge.
- Empty-categories early return updated to envelope shape too.

**Caveat documented in the file header:** cursor stability isn't guaranteed across calls because Wikipedia/Overpass response sets shift between requests (different OSM mirror responses). Best-effort for v1; Phase 9 may revisit if pagination feels janky in real walks.

### 3.2 Glasses API wrapper (`src/glasses/api.ts`)

- `FetchPoisInput` gains optional `offset?: number`. Only emitted as a query param when `> 0` (avoids cache-key churn for the common page-0 path).
- New exported type **`PoiPage`** = `{ items: Poi[]; hasMore: boolean }`.
- `fetchPois(): Promise<Poi[]>` → **`Promise<PoiPage>`** (breaking change — only consumer is the glasses effect runner; phone Nearby tab not yet built).

### 3.3 Reducer (`src/glasses/state.ts`)

**New events:**
- `{ type: 'load-more' }` — emitted by `onTap POI_LIST` when the More-sentinel index is hit.
- `{ type: 'refresh-pois' }` — emitted by `onTap POI_LIST` when the Refresh-sentinel index is hit.
- `pois-loaded` payload extended: now carries `hasMore: boolean` and `mode: 'replace' | 'append'`.

**New effect:**
- `fetch-pois` now carries `{ offset: number; mode: 'replace' | 'append' }`. The runner threads both through to the API and back into the resulting `pois-loaded` event.

**State shape:**
- `AppState` gains `poiListHasMore: boolean`.
- `pendingPoiRefresh: Poi[] | null` → `{ pois: Poi[]; hasMore: boolean } | null`.

**Reducer behaviour:**
- `pois-loaded mode='append'`: concatenates onto `state.poiList`, updates `hasMore`. If user is on POI_LIST, screen updates with cursor at the first newly-appended POI (= old `pois.length`); otherwise just merges silently into `poiList` so back-navigation lands on the longer list.
- `pois-loaded mode='replace'`: existing behaviour (initial fetch / refresh / settings change), now also clears `poiListHasMore` on empty results.
- `load-more`: no-op when not on POI_LIST or `hasMore=false`; otherwise emits `fetch-pois { offset: poiList.length, mode: 'append' }`.
- `refresh-pois`: routes through `goLoading('fetch-pois')` so the user sees "Discovering interesting things near you..." while the replace fetch is in flight.

**Cursor + tap:**
- `onCursorMove` POI_LIST: max = `pois.length + sentinelCount - 1`, where `sentinelCount = (hasMore?1:0) + 1`. Cursor walks through POIs, then optional More, then always-on Refresh.
- `onTap` POI_LIST: index < `numPois` → POI_DETAIL (existing); idx === `numPois && hasMore` → reduce-into `load-more`; idx === final slot → reduce-into `refresh-pois`. Out-of-range tap is a no-op.

### 3.4 Render (`src/glasses/render.ts`)

- `renderPoiList(pois, hasMore, cursorIndex)` — appends two single-line sentinels after the POI rows:
  - `> ▼ More results` (only when `hasMore`)
  - `> ↻ Refresh nearby` (always)
- Cursor prefix `> ` flips on whichever item matches `cursorIndex` (POIs use existing two-line format; sentinels use a single line — the visual contrast helps the user understand they're a different kind of action).
- Item count grows from `pois.slice(0,20).length` → `pois.slice(0,20).length + (hasMore?1:0) + 1`.

### 3.5 Effects runner (`src/glasses/effects.ts`)

- `runFetchPois(offset, mode, isBackgroundRefresh)`: signature changed; threads `offset` into the API call and `mode` into the resulting `pois-loaded` event.
- `backgroundRefresh()`: hard-codes `(0, 'replace', true)` — background always resets to page 0.

### 3.6 Bridge (`src/glasses/bridge.ts`)

- Boot effect: `{ type: 'fetch-pois' }` → `{ type: 'fetch-pois', offset: 0, mode: 'replace' }`. One-line change.

### 3.7 Tests

**Updated to match new shape (no behaviour regression):**
- `state.test.ts` — `listState()` helper now sets `hasMore` on screen + `poiListHasMore` on AppState. All `pois-loaded` events updated with `hasMore` + `mode`. Pending-refresh assertions updated to envelope shape.
- `render.test.ts` — POI_LIST rendering tests now pass `hasMore` and assert sentinel count/labels.
- `effects.test.ts` — `fetchPois` mocks return `{ items, hasMore }`. `fetch-pois` effect calls now pass `offset` + `mode`.
- `bridge.test.ts` — boilerplate POI_LIST screen now includes `hasMore: false`.

**New Phase 4d tests** (15 new tests, all in `state.test.ts` + `render.test.ts` + `effects.test.ts`):
- `pois-loaded` flags `hasMore` correctly on POI_LIST screen.
- Tap on More-sentinel index emits `fetch-pois { offset, mode: 'append' }`.
- `load-more` is a no-op when `hasMore=false`.
- `pois-loaded mode='append'` concatenates onto `poiList`.
- `pois-loaded mode='append'` outside POI_LIST merges silently with no transition.
- Tap on Refresh-sentinel index goes LOADING + emits `fetch-pois { offset: 0, mode: 'replace' }`.
- Refresh-sentinel index shifts correctly when `hasMore=false` (only one sentinel).
- `refresh-pois` event always fires `replace 0`.
- `cursor-down` walks 0..1 (POIs) → 2 (More) → 3 (Refresh) → clamps when `hasMore=true`.
- `cursor-down` clamps at Refresh slot when `hasMore=false` (only one sentinel).
- Tap with no `itemIndex` (text/sys path) falls back to `cursorIndex` and routes to refresh-pois.
- `renderScreen POI_LIST` appends `Refresh` sentinel even when `hasMore=false`.
- `renderScreen POI_LIST` appends both `More` and `Refresh` when `hasMore=true`.
- `renderScreen POI_LIST` cursor highlight lands on the right sentinel when `cursorIndex` points past pois.
- `effects fetchPois` forwards `offset` + dispatches `pois-loaded` with the right `mode`.

### 3.8 Verification (end of session)

```
npm test                → 204/204 passing (was 189 → +15)
npx tsc --noEmit        → clean
npm run build           → dist/assets/index-DNbX0uwe.js 418.94 kB │ gzip 124.23 kB
                          (was 417.67 kB / 123.84 kB; +1.27 kB / +0.39 kB gzip
                           — sentinel rendering + pagination dispatch logic)
grep -rn "…" src/       → 0 matches (teardown §7-4 still passing)
```

---

## 4. Remaining Phases

| Phase | Scope                                                                                          | Blocker                               | Est. size |
|-------|------------------------------------------------------------------------------------------------|---------------------------------------|-----------|
| 3b    | Real-HW verification of Phases 1 + 2 + 3a + 3c + 4a-1/2/3 + 4b + 4d                            | Physical glasses + outdoor walk       | 30–60 min |
| 4a-4  | POI_LIST single-line right-align distance + legend (C1)                                        | Real-HW iteration recommended         | 1 focused session |
| 4c    | POI image on POI_DETAIL (bug J)                                                                | §6.5 source decision                  | 1–2 sessions |
| 4d-2  | **(Optional)** auto-refresh on geographic staleness (≥200m walked since last fetch)            | Real-HW data on whether manual is enough | 1 session |
| 5-UI  | Phone Settings tab UI (wire the new reducer to JSX)                                            | §6.3 Tailwind-vs-spec call            | 1 session (down from 1–2) |
| 6     | Phone Nearby tab (POI cache + connection indicator + list + BottomSheet)                       | Phase 5-UI lands first                | 1–2 sessions |
| 7     | Settings ↔ glasses sync transport (`broadcast-settings` effect hits the glasses reducer)       | §6.2 Dispatch bus pattern             | 1 session |
| 8     | NAV_ACTIVE + WIKI_READ real-HW pass; strip Phase 0 log                                         | Physical glasses                      | 30–60 min |
| 9     | Submission polish                                                                              | All prior phases                      | 1 session |

**Order-of-operations still applies:** 4a–4d + 5 + 6 must land before submission prep. Phase 4d-2 is optional and should be evaluated against real-HW behaviour first.

---

## 5. Next Session — Recommended Order

### Option A (glasses available): **Phase 3b — Real-HW verification** [30–60 min]

Carry forward the 8-item list from part 2 §5, plus add **two new Phase 4d items**:

9. POI_LIST rendering — verify the `▼ More results` sentinel appears at the bottom of a long list (look for ≥21 results in a dense city — Manhattan with all-categories enabled at 1.5 mi should hit MAX_RESULTS_TOTAL=60).
10. Tap More — verify the new POIs append below the original 20 and cursor moves to position 20. Tap Refresh — verify LOADING screen, then the list resets to page 0.

### Option B (no glasses):

**B1. Phase 5-UI (Settings tab)** — still the lowest-risk bounded phase if §6.3 gets a decision this session. Data layer (part 3) and now Phase 4d are both off the critical path.

**B2. Phase 4c (POI image)** — needs §6.5 decided first.

**B3. Phase 4a-4 (list right-align)** — still only worth doing paired with real-HW.

**Recommend B1** if you'll make the §6.3 call — it's the largest piece of work standing between us and submission, and the data layer makes it a UI-only lift.

### Avoid this session
- Any phase whose blocker is `open` in §6 below.
- Teardown §7 items 1/2/3 (would break simulator workflow).

### Hard rule
**Do not start a phase that cannot be finished within the session limit. When stopping, generate a new handoff doc.**

---

## 6. Open Architectural Decisions

### 6.1 ~~Action menu design~~ — **CLOSED 04-20**

### 6.2 Dispatch bus pattern (phone ↔ glasses reducer) — **open, due before Phase 7**
Module singleton vs event emitter. Recommendation unchanged: module singleton unless test-isolation pain shows up.

### 6.3 Tailwind vs spec §9 — **open, due before Phase 5-UI**
Rip out Tailwind vs amend spec. Phase 5 data layer (part 3) is unaffected; Phase 4d (this session) is glasses-only and unaffected.

### 6.4 ~~Minimap orientation model~~ — **CLOSED 04-24 part 2**

### 6.5 POI image source (Phase 4c) — **open**
Wikipedia `rest_v1/page/summary/<title>` thumb endpoint recommended for wiki-backed POIs; OSM-only POIs stay image-less.

### 6.6 ~~POI_LIST pagination UX~~ — **CLOSED 04-24 part 4 (manual half)**
"More" + "Refresh" sentinels shipped this session. Auto-refresh on geographic staleness (≥200m walked since last fetch) is deferred to Phase 4d-2 (optional, evaluate after Phase 3b real-HW data).

---

## 7. Submission Teardown Debt

Before packaging `.ehpk` (Phase 9):
1. Delete `readDevMockCoords()` + both call sites in `src/glasses/effects.ts`.
2. Remove `VITE_MOCK_LAT`/`VITE_MOCK_LNG` from `.env.local`.
3. Strip Phase 0 `[wander][evt]` diagnostic log from `src/glasses/bridge.ts`.
4. ~~Fix U+2026 → `..` in truncate helper.~~ ✅ **Closed 04-24 session 2.**
5. Resolve Tailwind-vs-spec conflict (§6.3).
6. Revisit `GEOLOCATE_WALL_CLOCK_MS` (15s) against real-HW data from Phase 3b.
7. Verify: `grep -r VITE_MOCK_LAT src/` → 0, `grep -r "\[wander\]\[evt\]" src/` → 0, `grep -rn "…" src/` → 0 *(last one already passing)*.
8. Push polished local branch to GitHub; mirror all file state.
9. Submission requirements checklist.

Persistent memory: `project_wander_dev_geo_mock.md`.

---

## 8. Kickoff Checklist

1. Read this doc. Skim `HANDOFF_2026-04-24_part3.md`, `HANDOFF.md`, `wander-mockup.html`.
2. `cd Wander_v1.0 && npm test` → confirm 204/204 green.
3. `npm run dev` + simulator → smoke flow:
   - LOADING (thin `─` rule visible)
   - POI_LIST (scroll past last POI → `▼ More results` → `↻ Refresh nearby` if dense area; otherwise just `↻ Refresh nearby` after the last POI)
   - Tap More → list grows
   - Tap Refresh → LOADING re-appears, list resets
   - POI_DETAIL (subtitle has cardinal, e.g. `0.3 mi NE`)
   - POI_ACTIONS
   - WIKI_READ (scroll down, confirm page advances)
   - NAV_ACTIVE (2-line header, DISTANCE / ETA·BEARING, `Next:` preview, single-bar separator, minimap 4-tick + N triangle)
4. **Vercel redeploy required before sim test of Phase 4d**: the `/api/poi` wire-shape change (`Poi[]` → `{ items, hasMore }`) is a breaking server-side change. Push to the repo connected to Vercel before running the simulator, or the dev proxy will return the old shape and the glasses will see `pois: undefined`.
5. Pick next task:
   - Glasses + walk → **Phase 3b** (10 checks: 8 from part 2 §5 + 2 new for Phase 4d).
   - Otherwise + §6.3 decided → **Phase 5-UI** (wire the part-3 reducer to JSX).
   - Otherwise + §6.5 decided → **Phase 4c** (POI image).
6. If considering Phase 5-UI → open `src/phone/types.ts` and `src/phone/state.ts` first — the data-layer contract is the source of truth.

---

## 9. Quick Reference — Files You'll Touch

**Glasses reducer/view (touched this session):**
- `src/glasses/state.ts` — pagination events, `AppState.poiListHasMore`, sentinel tap routing
- `src/glasses/render.ts` — `renderPoiList(pois, hasMore, cursorIndex)`, sentinel lines
- `src/glasses/effects.ts` — `runFetchPois(offset, mode, isBg)` signature + envelope unpacking
- `src/glasses/api.ts` — `PoiPage` envelope type, optional `offset` input
- `src/glasses/bridge.ts` — boot effect now passes `offset: 0, mode: 'replace'`
- `src/glasses/screens/types.ts` — `PoiListScreen.hasMore`

**Glasses tests (touched this session):**
- `src/glasses/__tests__/{state,render,effects,bridge}.test.ts`

**Phone data layer (NEW, landed in part 3):**
- `src/phone/{types,state,storage}.ts`
- `src/phone/__tests__/{state,storage}.test.ts`

**Phone UI (Phase 5-UI + Phase 6, still placeholder):**
- `src/phone/App.tsx` — current shell (uses Tailwind + even-toolkit, per §6.3)
- `src/phone/tabs/` — empty
- `src/phone/components/` — empty

**Serverless (touched this session):**
- `api/poi.ts` — `?offset=` query, `{ items, hasMore }` response, `PAGE_SIZE = 20`, `MAX_RESULTS_TOTAL = 60`

**Config:** `vite.config.ts`, `.env.local`, `src/vite-env.d.ts`

**Don't open:** `.git/`, `node_modules/`, `dist/`, `.vercel/`.

---

## 10. Session Summary (for continuity)

**04-24 part 4:** 7 source files touched (api/poi.ts, src/glasses/{api,state,render,effects,bridge}.ts, src/glasses/screens/types.ts), 4 test files updated, 15 new tests, 1 architectural decision closed (§6.6 manual half), 1 wire-shape change (`/api/poi` response envelope).

- Bug K manual half closed: users can now load past 20 results and trigger a fresh fetch from the list itself.
- Bug K auto half (geographic-staleness ≥200m) deferred to Phase 4d-2 — a real-HW question, not a design question.
- `/api/poi` wire-shape change requires a Vercel redeploy before sim test (see §8 step 4).

**04-24 running totals (4 sessions + part 4):** 10 bounded changes, 82 new tests across all four sessions, 1 teardown item closed, 2 architectural decisions closed (§6.4 + §6.6).

**Net forward progress on 04-24 (cumulative):**
- 4 bugs closed architecturally (F, G, H, I).
- 1 bug closed half (K — manual; auto deferred).
- 3 mockup-parity items shipped (4a-1/2/3).
- 1 teardown item closed early (§7-4).
- 2 architectural decisions closed (§6.4, §6.6 manual).
- 4 issues still specced as proper phases (J, L, M, 4a-4).
- Phase 5 partially unblocked: data layer done, UI still pending §6.3.

**Big outstanding non-bug work before submission:**
- 4a-4 (POI_LIST right-align).
- 4c (POI image).
- Phase 5-UI (Settings tab JSX) + Phase 6 (Nearby tab).
- Phase 7 (settings ↔ glasses transport).
- Teardown §7 items 1, 2, 3, 5, 6, 8, 9.

**End-of-day 04-24 part 4:** 204/204 tests, tc clean, build 418.94 kB / 124.23 kB gzip (+1.27 kB / +0.39 kB gzip vs part 3 — sentinels + pagination logic), `grep -rn "…" src/` → 0.
