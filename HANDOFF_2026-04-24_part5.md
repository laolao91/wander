# Wander v1.0 — Handoff 2026-04-24 (part 5)

**Status:** Phase 4d shipped to GitHub + Vercel. Hardware test session
opened but blocked at simulator boot ("Network unavailable") before any
hardware validation could occur. This handoff is the launch point for
the hardware test pass.

**Latest commit:** `f9399f1` — Phase 4d: POI_LIST pagination + manual refresh
**Tests:** 204/204 passing
**Build:** clean (418.94 kB / 124.23 kB gzip)

---

## 1. Where the session ended

Steven has the G2 hardware in hand for the first time since Phase 4d
landed. He started the simulator and got a "Network unavailable" error
right after the title screen. Before any hardware testing began, we:

1. Identified the likely cause: **`/api/poi` wire-shape changed in Phase 4d**
   (now returns `{items, hasMore}` instead of bare `Poi[]`), and the
   deployed Vercel endpoint was still serving the old shape.
2. Committed all Phase 4d work (had been local-only) and pushed to
   `main` → triggered Vercel auto-deploy.
3. Drafted the hardware test checklist:
   `/Users/stevenlao/CoworkSandbox/outbox/2026-04-24_wander-hardware-test-checklist.md`

**Steven has NOT yet retried the simulator after the deploy.** Start
the next session by confirming the deploy went green and the simulator
boots past the title screen.

---

## 2. First actions for the next session

### 2.1 Confirm deploy + unblock simulator
1. Hit `https://<vercel-url>/api/poi?lat=40.78&lng=-73.97` in a browser.
   - Expected: `{"items":[...],"hasMore":...}`
   - If bare array → deploy is stale, check Vercel dashboard for the
     `f9399f1` build status.
   - If 4xx/5xx → check Vercel function logs for the error.
2. Once endpoint is good, retry simulator boot. Should reach POI_LIST.
3. If simulator still fails: check the simulator's configured API base
   URL matches the live Vercel URL (look in `vite.config.ts` /
   `src/glasses/api.ts` for the base URL constant).

### 2.2 Run the hardware test checklist
File: `/Users/stevenlao/CoworkSandbox/outbox/2026-04-24_wander-hardware-test-checklist.md`

Priority order (do not skip §1 — it's the whole reason we're on hardware):
- **§1 Input quirks** — undefined eventType, double-tap exit, scroll cooldown, list/text routing
- **§2 Phase 4d** — More/Refresh sentinels, append cursor placement, background refresh
- **§3 Core nav** — boot → list → detail → wiki → nav-active
- **§4 Error paths**
- **§5 Visual rendering**

For each failure, capture:
- Screen name from console (`screen=POI_LIST`)
- Last `[wander][evt]` log line
- Expected vs actual
- Reproducibility

Recommend appending findings to `HARDWARE_TEST_NOTES_2026-04-24.md` (file
doesn't exist yet — create on first issue).

---

## 3. What changed in Phase 4d (context for fixing field issues)

If hardware testing surfaces bugs, here's what's new since Phase 1:

| Area | Change | File |
|---|---|---|
| API | `?offset=N`, returns `{items, hasMore}`, `PAGE_SIZE=20`, `MAX_RESULTS_TOTAL=60` | `api/poi.ts` |
| Client | `fetchPois` returns `PoiPage`, accepts `offset` | `src/glasses/api.ts` |
| State | New events `load-more`, `refresh-pois`; `pois-loaded` carries `hasMore` + `mode` | `src/glasses/state.ts` |
| Render | `renderPoiList(pois, hasMore, cursorIndex)` appends "▼ More results" + "↻ Refresh nearby" sentinels | `src/glasses/render.ts` |
| Effects | `runFetchPois(offset, mode, isBackgroundRefresh)`; background hardcodes `(0, 'replace', true)` | `src/glasses/effects.ts` |
| Routing | POI_LIST tap routes by sentinel index (magic-index pattern, not typed list items) | `src/glasses/state.ts` `onTap` |

**Sentinel indices** (POI_LIST):
- `0..pois.length-1` → tap opens POI_DETAIL
- `pois.length` (only if `hasMore`) → "▼ More results"
- `pois.length + (hasMore ? 1 : 0)` → "↻ Refresh nearby"

**Background refresh interaction:** always page-0 replace. If user has
loaded a tail via "More results", background refresh blows it away.
Acceptable for v1.

---

## 4. Known unknowns / things to watch on hardware

These are guesses that need real-BLE data to confirm or refute:

1. **`eventType=undefined` rate** — Phase 1 fix treats undefined as CLICK.
   Watch console: how often does it actually fire vs `eventType=0`?
2. **Scroll bounce window (300ms)** — calibrated blind. May be too long
   (laggy intentional scrolls) or too short (still bouncing). Tune in
   `src/glasses/bridge.ts:45` `SCROLL_COOLDOWN_MS`.
3. **listEvent fall-through** — when listEvent has unknown type AND
   textEvent is present, we use textEvent. Real hardware may not send
   that combo at all; the test exists to be safe.
4. **Sentinel cursor walking** — `onCursorMove` math:
   `sentinels = (hasMore ? 1 : 0) + 1` — verify cursor never lands
   off-end and never skips the Refresh sentinel.
5. **Minimap PNG → gray4 conversion** — host-side. If minimap looks
   wrong on glasses, check `[wander] minimap push failed` warnings.

---

## 5. After hardware testing — next options

Pick based on findings:

- **A. Hardware-issue fixes** — whatever real-BLE testing surfaces.
  Highest priority if §1/§2 of checklist failed.
- **B1. Phase 5-UI Settings tab** (phone-side) — phone scaffolding
  exists at `src/phone/` (state, storage, types + tests). UI wiring
  hasn't been built. ~2-3 sessions.
- **B2. Phase 4c POI image** — show POI thumbnail in detail view.
- **B3. Phase 4a-4 right-align** — distance/walk-time visual polish.
- **C. Submission prep** — strip `VITE_MOCK_LAT/LNG` dev override from
  `effects.ts` (memory: `project_wander_dev_geo_mock.md`); audit any
  remaining dev-only branches; cut v1.0 release notes.

---

## 6. Repo / deploy state

- **Repo:** https://github.com/laolao91/wander
- **Branch:** `main` (clean tracking, up to date)
- **Latest commit:** `f9399f1`
- **Vercel:** auto-deploys on `main` push
- **Untracked at session start:** none — all Phase 4d work is now
  committed including phone-side scaffolding and prior handoff docs.

---

## 7. Files to read first in next session

1. This file
2. `HANDOFF_2026-04-24_part4.md` — Phase 4d implementation details
3. `outbox/2026-04-24_wander-hardware-test-checklist.md` — the test plan
4. `src/glasses/bridge.ts` — event translation (the thing being tested)
5. `src/glasses/state.ts` — reducer (sentinel routing logic)

---

## 8. Reminders

- **Memory `project_wander_dev_geo_mock.md`**: `effects.ts` has
  `VITE_MOCK_LAT/LNG` override for simulator — STRIP before v1.0
  store submission.
- **Per CLAUDE.md**: this codebase is "handle carefully"; show diffs
  before applying changes; don't refactor adjacent code unless asked.
- **Session limits**: don't start a new phase mid-session if it can't
  finish; draft a part-N handoff doc when stopping.
