# Wander v1.0 — April 24 Handoff (Part 3)

**Repo:** `/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Wander_v1.0/`
**Status:** 189/189 tests green · typecheck clean · build clean · production bundle mock-free · teardown item §7-4 closed · **Phase 5 data layer scaffolded (no UI)**
**Stack:** TypeScript + React 19 + Vite + Tailwind 4.2.2 · `@evenrealities/even_hub_sdk@0.0.10` · `@evenrealities/evenhub-simulator@0.7.2` · `even-toolkit@1.7.2`

Continues from `HANDOFF_2026-04-24_part2.md`. That doc and its predecessors remain on disk for context; this part-3 file supersedes them going forward.

---

## 0. What This Session (04-24 part 3) Did

No glasses, and §6.3 Tailwind-vs-spec still open — so the full Phase 5 UI can't start. But the **phone data layer is decision-free**: Settings shape, reducer, and persistence adapter don't care which CSS approach wins. This session landed that layer in isolation so the next Phase-5 session only has to wire JSX to an already-tested reducer.

Zero changes to `App.tsx`, `tabs/`, `components/`, or anything outside `src/phone/`. The production bundle size is unchanged (417.67 kB / 123.84 kB gzip) — the new modules aren't imported yet.

Phase 4c / 4d / 5-UI / 6 were **not started** — all still blocked on prior-handoff decisions (§6.3, §6.5, §6.6) or real-HW iteration.

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
- **Phase 5 data layer** (04-24 part 3, this session) — phone reducer, types, persistence adapter. UI still pending §6.3. See §3 below.

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
| K. POI_LIST can't page past first 20 / no refresh       | 04-24 user ask    | Open — Phase 4d. Blocked on §6.6 UX call + API change.                                              |
| L. Wiki content feels thin                              | 04-24 user ask    | Re-evaluate after 3c-1 real-HW pass.                                                                |
| **M. Phone companion app not built (blocks submission)**| 04-24 user ask    | **Partially unblocked this session.** Data layer (reducer + types + storage) built + tested; UI still blocked on §6.3 Tailwind call. |

---

## 3. What Shipped Today (Part 3)

### 3.1 New files
- **`src/phone/types.ts`** (~110 LOC) — canonical Settings shape, defaults, category list, reducer events + effects. Pinned to `HANDOFF.md` §B2.
  - `CategoryId` — 8-value string union (`historic | parks | museums | religious | publicArt | libraries | restaurants | nightlife`).
  - `ALL_CATEGORIES` — readonly array in mockup order.
  - `RadiusMiles` — `0.25 | 0.5 | 0.75 | 1.0 | 1.5` (union, not `number`, to kill invalid values at the type level).
  - `RADIUS_CHOICES` — readonly tuple used by both the slider and the parser.
  - `Settings` — `{ radiusMiles, enabledCategories }`.
  - `DEFAULT_SETTINGS` — radius 0.75 mi; 5 of 8 categories on (mockup defaults).
  - `SyncStatus` — `'idle' | 'syncing' | 'synced' | 'error'`.
  - `PhoneState` — `{ settings, syncStatus, syncError }` plus `INITIAL_PHONE_STATE`.
  - `PhoneEvent` — `settings-hydrated | radius-changed | category-toggled | sync-started | sync-completed | sync-failed`.
  - `PhoneEffect` — `persist-settings | broadcast-settings`.
  - `ReduceResult` — `{ state, effects }`.

- **`src/phone/state.ts`** (~65 LOC) — pure reducer. Pattern identical to `src/glasses/state.ts`: no fetches, no SDK calls, no `Date.now()`.
  - `radius-changed` and `category-toggled` both go through `withSettingsChange()` which marks `syncStatus: 'syncing'`, clears `syncError`, and emits `[persist-settings, broadcast-settings]`.
  - `radius-changed` short-circuits when the new value matches the old (same-reference return, no effects).
  - Sync lifecycle events (`sync-started`, `sync-completed`, `sync-failed`) never emit effects — they're pure status transitions.
  - `settings-hydrated` replaces settings without touching sync status (boot path, nothing to broadcast).

- **`src/phone/storage.ts`** (~130 LOC) — persistence behind a `KVStore` seam.
  - `KVStore` interface: `get(key): Promise<string | null>`, `set(key, value): Promise<void>`. No `remove` — SDK 0.0.10's `EvenAppBridge` doesn't expose one, and Settings only ever overwrites.
  - `STORAGE_KEYS`: `wander_radius`, `wander_categories` (from `WANDER_BUILD_SPEC.md` §10).
  - `createMemoryKVStore(seed?)` — in-memory implementation for tests / dev harnesses.
  - `createBridgeKVStore(bridge)` — SDK adapter. Takes a structural `BridgeStorageFacade` subset (`setLocalStorage`, `getLocalStorage`) so this module has no runtime dependency on the SDK.
    - Maps SDK's `Promise<string>` empty-string result for missing keys → `null`.
    - Throws when `setLocalStorage` returns `false` (host-side write failure) so the caller can surface it as `sync-failed`.
  - `loadSettings(kv)` — read both keys in parallel, default on missing / malformed.
  - `saveSettings(kv, settings)` — write both keys in parallel.
  - Parsers are tolerant: invalid radius → default; malformed JSON → default; array with unknown category ids → unknowns dropped, knowns kept. Forward/back-compat when the category list changes shape.

### 3.2 New tests
- **`src/phone/__tests__/state.test.ts`** (21 tests):
  - Boot state (`INITIAL_STATE`).
  - `settings-hydrated`: replaces settings, preserves sync status.
  - `radius-changed`: updates, transitions to syncing, emits effects, no-ops on unchanged, preserves categories.
  - `category-toggled`: default-on → off, default-off → on, double-toggle round-trip, effects, error-clearing, non-mutation.
  - Sync lifecycle (`sync-started` / `-completed` / `-failed`): status transitions, error preservation.
  - Reducer purity: input-state snapshot preserved across both no-op and real-change paths.

- **`src/phone/__tests__/storage.test.ts`** (17 tests):
  - Round-trip (non-default values, empty categories, canonical key names).
  - Defaults-on-missing (empty store, invalid number, out-of-range number, malformed JSON, non-array JSON, unknown ids dropped, fully unknown ids → empty list).
  - Partial stores (radius-only, categories-only).
  - `createMemoryKVStore`: get-null-on-missing, round-trip, seeded initial values.
  - `createBridgeKVStore`: empty-string → null mapping, passthrough on present, set forwards to bridge, throws on `setLocalStorage: false`, end-to-end `loadSettings` + `saveSettings`.

### 3.3 Verification (end of session)
```
npm test                → 189/189 passing (was 151 → +38)
npx tsc --noEmit        → clean
npm run build           → dist/assets/index-hb0g9Rpx.js 417.67 kB │ gzip 123.84 kB (unchanged)
grep -rn "…" src/       → 0 matches (teardown §7-4 still passing)
```

Bundle is byte-identical because `App.tsx` doesn't import any of the new phone modules yet. They'll land in the bundle as soon as the Phase-5 UI work wires them up.

---

## 4. Remaining Phases

| Phase | Scope                                                                                          | Blocker                               | Est. size |
|-------|------------------------------------------------------------------------------------------------|---------------------------------------|-----------|
| 3b    | Real-HW verification of Phases 1 + 2 + 3a + 3c + 4a-1/2/3 + 4b                                 | Physical glasses + outdoor walk       | 30–60 min |
| 4a-4  | POI_LIST single-line right-align distance + legend (C1)                                        | Real-HW iteration recommended         | 1 focused session |
| 4c    | POI image on POI_DETAIL (bug J)                                                                | §6.5 source decision                  | 1–2 sessions |
| 4d    | POI_LIST pagination + refresh (bug K)                                                          | §6.6 UX call + API change (hard-coded `MAX_RESULTS = 20`) | 1 session |
| 5-UI  | **Phone Settings tab UI** (wire the new reducer to JSX)                                        | §6.3 Tailwind-vs-spec call; data layer **now unblocked** | 1 session (down from 1–2) |
| 6     | Phone Nearby tab (POI cache + connection indicator + list + BottomSheet)                       | Phase 5-UI lands first; Phase 6 will extend the reducer / types from this session | 1–2 sessions |
| 7     | Settings ↔ glasses sync transport (`broadcast-settings` effect hits the glasses reducer)       | §6.2 Dispatch bus pattern             | 1 session |
| 8     | NAV_ACTIVE + WIKI_READ real-HW pass; strip Phase 0 log                                         | Physical glasses                      | 30–60 min |
| 9     | Submission polish                                                                              | All prior phases                      | 1 session |

**Order-of-operations still applies:** 4a–4d + 5 + 6 must land before submission prep.

**Phase 5-UI scope reduction:** the 04-24 part 2 handoff estimated Phase 5 at 1–2 sessions. With the data layer now in place and tested, the remaining UI-only work is tighter. Next session should just need to:
1. Build `SettingsTab.tsx` against the mockup with `even-toolkit` (or Tailwind, per §6.3).
2. Hydrate from storage once on mount, dispatch events on user interaction.
3. Wire a `useReducer` or Zustand-style hook around the reducer from this session.
4. Render the `SyncStatus` as the "Changes sync to glasses automatically" card visual.

---

## 5. Next Session — Recommended Order

### Option A (glasses available): **Phase 3b — Real-HW verification** [30–60 min]
Eight checks — carry forward the 8-item list from part 2 §5, unchanged. Nothing this session added needs HW verification (pure data layer, no UI).

### Option B (no glasses):

**B1. Phase 5-UI (Settings tab)** — now the lowest-risk bounded phase if §6.3 gets a decision this session. Everything the reducer needs to drive the UI is already built + tested.
  - Prerequisite: answer §6.3 (rip out Tailwind vs amend spec, see §6 below).
  - Scope: `src/phone/tabs/SettingsTab.tsx` + hook wiring in `App.tsx` + app-boot hydration.
  - Nothing in `src/phone/types.ts` / `state.ts` / `storage.ts` should change — if you find yourself editing them, reconsider the UI design.

**B2. Phase 4d (list pagination)** — needs §6.6 decided first, plus a coordinated API change (`api/poi.ts` hard-codes `MAX_RESULTS = 20` at line 15).

**B3. Phase 4c (POI image)** — needs §6.5 decided first. Bigger than 4d; may straddle two sessions.

**B4. Phase 4a-4 (list right-align)** — still only worth doing paired with real-HW.

**Recommend B1** if you'll make the §6.3 call. Otherwise B2 if you'll make the §6.6 call. Don't start any UI work without resolving §6.3 first — half the rework cost is later discovering a utility class broke something.

### Avoid this session
- Any phase whose blocker is still `open` in §6 below.
- Teardown §7 items 1/2/3 (would break simulator workflow).

### Hard rule
**Do not start a phase that cannot be finished within the session limit. When stopping, generate a new handoff doc.**

---

## 6. Open Architectural Decisions

### 6.1 ~~Action menu design~~ — **CLOSED 04-20**

### 6.2 Dispatch bus pattern (phone ↔ glasses reducer) — **open, due before Phase 7**
Module singleton vs event emitter.

**Note from this session:** the phone reducer now emits a `broadcast-settings` effect. The effect's runner (Phase 7) is what crosses the phone-glasses divide. The reducer itself is agnostic to the transport — it just says "these settings changed, tell the glasses side." Either dispatch-bus approach works against this contract; the decision is about ergonomics/testability, not the contract.

Recommendation unchanged: module singleton unless test-isolation pain shows up.

### 6.3 Tailwind vs spec §9 — **open, due before Phase 5-UI**
Rip out Tailwind vs amend spec.

**Note from this session:** `src/phone/App.tsx` currently mixes `even-toolkit` primitives with Tailwind utility classes. Whatever the decision, the data layer landed this session is unaffected — it's pure TypeScript, no JSX, no CSS.

### 6.4 ~~Minimap orientation model~~ — **CLOSED 04-24 part 2**

### 6.5 POI image source (Phase 4c) — **open**
Wikipedia `rest_v1/page/summary/<title>` thumb endpoint recommended for wiki-backed POIs; OSM-only POIs stay image-less.

### 6.6 POI_LIST pagination UX (Phase 4d) — **open, due before Phase 4d**
"More" sentinel + `Refresh nearby` when stale (≥200m) is the current recommendation.

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

1. Read this doc. Skim `HANDOFF_2026-04-24_part2.md`, `HANDOFF.md`, `wander-mockup.html`.
2. `cd Wander_v1.0 && npm test` → confirm 189/189 green.
3. `npm run dev` + simulator → smoke flow:
   - LOADING (thin `─` rule visible)
   - POI_LIST
   - POI_DETAIL (subtitle has cardinal, e.g. `0.3 mi NE`)
   - POI_ACTIONS
   - WIKI_READ (scroll down, confirm page advances)
   - NAV_ACTIVE (2-line header, DISTANCE / ETA·BEARING, `Next:` preview, single-bar separator, minimap 4-tick + N triangle)
4. Pick next task:
   - Glasses + walk → **Phase 3b** (8 checks from part 2 §5).
   - Otherwise + §6.3 decided → **Phase 5-UI** (wire the new reducer to JSX).
   - Otherwise + §6.6 decided → **Phase 4d**.
5. If considering Phase 5-UI → **open `src/phone/types.ts` and `src/phone/state.ts` first** — understand the contract before writing JSX. The reducer is the source of truth; don't duplicate state in components.

---

## 9. Quick Reference — Files You'll Touch

**Glasses reducer/view:** `src/glasses/{state,bridge,effects,render,minimap}.ts`, `src/glasses/screens/types.ts`
**Glasses tests:** `src/glasses/__tests__/{state,bridge,render,minimap,api}.test.ts`
**Phone data layer (NEW, landed this session):**
- `src/phone/types.ts` — Settings + events + state shapes (stable; Phase 6 will extend with Nearby-tab fields)
- `src/phone/state.ts` — pure reducer
- `src/phone/storage.ts` — `KVStore` + memory & bridge adapters + `loadSettings` / `saveSettings`
- `src/phone/__tests__/{state,storage}.test.ts`

**Phone UI (Phase 5-UI + Phase 6, still placeholder):**
- `src/phone/App.tsx` — current shell (uses Tailwind + even-toolkit, per §6.3)
- `src/phone/tabs/` — empty
- `src/phone/components/` — empty

**Config:** `vite.config.ts`, `.env.local`, `src/vite-env.d.ts`
**Serverless:** `api/{poi,route,wiki,health}.ts`, `api/_lib/`

**For Phase 4d specifically:** `api/poi.ts` hard-codes `MAX_RESULTS = 20` at line 15; no `offset` query param.

**Don't open:** `.git/`, `node_modules/`, `dist/`, `.vercel/`.

---

## 10. Session Summary (for continuity)

**04-24 part 3:** 5 new files (3 source + 2 test), 38 new tests, 0 architectural moves, 0 changes to existing files.

- Phase 5 data layer landed in isolation. Settings shape, reducer, and persistence now exist + are tested.
- SDK's `EvenAppBridge` localStorage methods wrapped behind a `KVStore` seam so tests don't need the SDK and the UI doesn't care how persistence works.
- §6.3 Tailwind decision still open; phone UI still blocked. But every byte of non-UI data-layer work that Phase 5 needed is done.

**04-24 running totals (3 sessions + part 3):** 9 bounded changes, 67 new tests across all four sessions of 04-24, 1 teardown item closed, 1 architectural decision closed (§6.4).

**Net forward progress on 04-24 (cumulative):**
- 4 bugs closed architecturally (F, G, H, I).
- 3 mockup-parity items shipped (4a-1/2/3).
- 1 teardown item closed early (§7-4).
- 1 architectural decision closed (§6.4).
- 5 issues specced as proper phases (J, K, L, M, 4a-4).
- Phase 5 partially unblocked: data layer done, UI still pending §6.3.

**Big outstanding non-bug work before submission:**
- 4a-4 (POI_LIST right-align).
- 4c (POI image) + 4d (list pagination).
- Phase 5-UI (Settings tab JSX) + Phase 6 (Nearby tab).
- Phase 7 (settings ↔ glasses transport).
- Teardown §7 items 1, 2, 3, 5, 6, 8, 9.

**End-of-day 04-24 part 3:** 189/189 tests, tc clean, build 417.67 kB / 123.84 kB gzip (unchanged — phone data layer not yet imported), `grep -rn "…" src/` → 0.
