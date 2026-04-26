# Wander v1.0 — Handoff 2026-04-26 (part 2)

**Status:** Phase G shipped — adds "▲ Previous" sentinel for bidirectional
list navigation, and one more attempt at routing "Open on Phone" through
the OS browser instead of EvenHub's input-capturing in-app overlay.

**Latest commit:** `55224ec` — Phase G
**Tests:** 204/204 passing
**Vercel:** auto-redeploys on push (last green: `d0765d9` confirmed
building before this commit)

**Companion docs:**
- Prior session: `HANDOFF_2026-04-26.md` (Phase E + F)
- Field notes: `/Users/stevenlao/CoworkSandbox/outbox/HARDWARE_TEST_NOTES_2026-04-25.md`

---

## 1. What landed this session

### `55224ec` — Phase G

**Previous-page sentinel on POI_LIST**
- New "▲ Previous" sentinel appears above POI rows whenever
  `displayOffset > 0`
- Cursor walks across `(Previous?) + POI rows + (More?) + Refresh`
- Tap on Previous → `displayOffset -= LIST_DISPLAY_LIMIT`, cursor
  back to top of the new earlier window
- Combined with Phase E's "▼ More results", users can now scroll
  bidirectionally through cached pages without losing their place

**Open on Phone — third attempt**
- Tried `_blank` (Phase A baseline) — opened in-app browser, captured input
- Tried `_system` (Phase F) — same result, EvenHub WebView ignores it
- Phase G now tries **`bridge.callEvenApp('openExternalUrl', { url })`
  first**, then falls through to `_system` then `_blank`
- The SDK's published `EvenAppMethod` enum doesn't include this method,
  but `callEvenApp(method: string, params?: any)` accepts any string.
  If EvenHub's host implements a handler (even an undocumented one),
  this routes through the OS browser and Wander stays foregrounded
  with glasses input intact
- Each path logs which strategy was accepted, so the next field test
  shows the host's actual capability:
  - `[wander][openUrl] routed via host openExternalUrl` — fix worked
  - `[wander][openUrl] _system accepted` — partial improvement
  - `[wander][openUrl] falling back to _blank (input lock expected)` —
    no host support, behavior unchanged

---

## 2. Verification needed next session

Before taking on new work, confirm the current build behaves as
expected on real hardware. Cache-bust per usual: force-quit
EvenRealities → rescan QR.

### 2.1 Previous sentinel
- Tap "▼ More results" to advance to page 2
- Confirm "▲ Previous" appears at the top of the list
- Cursor on "▲ Previous" → tap → returns to page 1
- Cursor walks naturally between Previous, POI rows, More, Refresh

### 2.2 Open on Phone — capture which path took
Whatever it takes to view the WebView console (Chrome remote
debugging, or whatever you've worked out for log capture), watch for
`[wander][openUrl]` lines after tapping "Open on Phone":
- **`routed via host openExternalUrl`** — best case, EvenHub had
  the method. Glasses cursor should stay free.
- **`_system accepted`** — alternate path worked. Glasses cursor
  should stay free.
- **`falling back to _blank`** — host doesn't expose either escape
  hatch. Glasses cursor still locked. We've exhausted the in-WebView
  options; see §3.1 for the remaining moves.

### 2.3 Phase F double-tap detector (carried over from part 1)
- Double-tap on POI_DETAIL → CONFIRM_EXIT prompt should appear
- May see brief flash of POI_ACTIONS before the prompt — acceptable
- If still unresponsive, the second CLICK_EVENT isn't reaching us
  either; we'd need a different approach (see §3.2)

---

## 3. Open issues to tackle next session

### 3.1 [HIGH] Open on Phone if all three paths fail
**If the field test of `55224ec` shows the `_blank` fallback path
("input lock expected" log), we've hit the platform wall.** Remaining
options:

- **(a) Reach out to EvenRealities support** — ask if there's a
  documented or undocumented method to open a URL in the OS browser,
  or to background the in-app overlay. They may expose this in a
  future SDK version.
- **(b) Replace WebView nav (`window.location.href = url`)** — opens
  the URL in the same WebView. Glasses go blank for the duration
  (no `createStartUpPageContainer` call has happened for the URL),
  user navigates back via OS gesture, Wander reloads. Trade-off: lose
  reducer state for the duration of the visit.
- **(c) Show URL on glasses for manual entry** — replace "Open on
  Phone" with a screen that *displays* the URL as text + "Type this
  on your phone." Worse UX but glasses stay free.
- **(d) Drop the action from v1** — rely on Read More + Navigate.
  Document the omission as a known platform limitation.

**Recommendation:** Try (a) before shipping any of (b)-(d). The
ergonomics of all the alternatives are noticeably worse than a fixed
in-place behavior.

### 3.2 [HIGH] Double-tap if Phase F also fails
If `[wander][evt]` logs show only ONE click event arriving for a real
double-tap (instead of two), the SDK is debouncing at a layer below
us. Workarounds:

- **Long-press** instead of double-tap as the exit gesture (if the
  SDK delivers a long-press event distinctly)
- **Triple-tap** detector — if doubles are debounced but triples
  aren't, three quick clicks could trigger exit
- **Scroll-up + scroll-up** combo — uses the well-tested scroll path
- **Always-visible "Exit" sentinel** at the bottom of the list and
  similar trailing positions — eliminates the gesture entirely

The triple-tap idea is the smallest change. Worth trying first.

### 3.3 [MEDIUM] Title screen layout polish
Carried from part 1 (§3.3). WANDER text not centered, excessive top
padding. Needs a font-calibration pass — `CHARS_PER_LINE = 65`
constant assumes monospace but the G2 font isn't. Options:
- Empirically tune CHARS_PER_LINE
- Switch LOADING to dedicated render with pixel-position alignment
  via container properties

Low-priority cosmetic. Doesn't block submission.

### 3.4 [LOW] Minimap street/map overlay
Steven's question from 2026-04-26: can the minimap show street view?
Today it's just route geometry + position arrow. v1.x feature — see
part 1 §3.4 for the options (Mapbox Static / OSM tiles / custom
render). Estimate: 1-2 sessions to do well.

### 3.8 [PROPOSED] Phase H — Settings tab UI (1 session)
**Status:** Scaffolding done, UI not built. Steven greenlit this as
the next major phase 2026-04-26.

**What exists today:**
- `src/phone/types.ts` — `Settings`, `CategoryId`, `RadiusMiles`,
  `PhoneState`, full event/effect types, `DEFAULT_SETTINGS`
- `src/phone/state.ts` — pure reducer with `radius-changed`,
  `category-toggled`, sync events
- `src/phone/storage.ts` — `bridge.setLocalStorage` adapter, JSON
  persistence, default-tolerant parsers
- Tests for both modules

**What's missing:**
- `src/phone/App.tsx` is a 30-line placeholder card. Need to wire
  `reduce()` + `loadSettings()` / `saveSettings()` into actual UI.

**Mockup spec** (`Point of Interest App/wander-mockup.html`,
section "PHONE SCREEN 2: Settings Tab", lines 1030-1138):
- **Search Radius** — slider with 5 ticks (0.25 / 0.5 / 0.75 / 1.0 /
  1.5 mi), default 0.75
- **Categories** — 8 toggle rows with icon glyphs:
  - ★ Historic & Landmarks (default ON)
  - ■ Parks & Nature (ON)
  - ▲ Museums & Galleries (ON)
  - † Religious Sites (ON)
  - ○ Public Art (OFF)
  - ◉ Libraries & Education (OFF)
  - ◆ Restaurants & Cafes (ON)
  - ● Bars & Nightlife (OFF)
- **Display** — Sort by Proximity (read-only), Max results 20
  (read-only)
- **Info card** — "Changes sync to glasses automatically. Tap Refresh
  on the Nearby tab to reload results."

**Spec reference:** `WANDER_BUILD_SPEC.md` §9 ("Phone Companion UI").

**Components:** `even-toolkit/web` only. Use `AppShell`, `NavBar`
(already wired), plus add `SectionHeader`, `Toggle`, `Slider`. No
custom CSS wrappers per `HANDOFF.md` ground rules.

**Wiring loop:** Settings change → reducer emits `persist-settings`
+ `broadcast-settings` effects → run `saveSettings(kv, settings)` →
glasses-side `/api/poi` already reads `categories` + `radiusMiles`
on the next call, so tapping "Refresh nearby" on glasses immediately
respects the new settings. **No new glasses code required.**

**Side decision needed:** category-id alignment. Phone-side type uses
`historic|parks|museums|religious|publicArt|libraries|restaurants|nightlife`
(plural). Glasses-side `Category` type uses
`landmark|park|museum|religion|art|library|food|nightlife` (singular).
The wire format the API accepts is the glasses-side names. The
broadcast effect needs to map between them, OR we unify on one set
(probably the glasses set, since the API already speaks it).

**Estimate:** 1 session (UI assembly + wire-up + tests). All-or-
nothing — don't start if you can't finish; the scaffolding works as
a placeholder indefinitely.

### 3.9 [PROPOSED] Phase I — Nearby tab UI (2 sessions)
**Status:** Bigger architectural lift, deferred to its own session
arc once Phase H lands.

**What's missing:**
- Phone-side POI fetch + cache (today only the glasses fetch)
- Reverse geocoding for the "Upper West Side, NYC" header subtitle
- G2 connection status pill (some bridge state — `bridge.ready`
  exists, plus `BridgeEvent.deviceStatusChanged`)
- Nav banner that mirrors the **glasses** NAV_ACTIVE state — needs
  a glasses→phone bridge channel that doesn't exist today
- Bottom-sheet POI detail with Navigate / Open in Safari actions
- POI cards grouped by category section header

**Mockup spec** (`wander-mockup.html`, lines 925-1029):
- App header — Wander logo pill + "Nearby" title + G2 status dot +
  reverse-geocoded location
- Conditional nav banner ("→ destination · ETA · current step · End")
- Refresh bar — "Updated X min ago · N places found · ↺ Refresh"
- Section headers ("Landmarks & Parks", "Food & Drink") with POI
  cards beneath

**Hard part:** the glasses→phone state mirror. The current SDK
exposes `BridgeEvent` from glasses→phone for hardware status, but
not for app state. Three approaches:
- **(a)** Phone polls `bridge.getLocalStorage('wander_glasses_state')`
  and the glasses writes its current state on every transition. Simple
  but introduces write traffic on every screen change.
- **(b)** Add a custom channel via `bridge.callEvenApp` with a
  matching listener on the other side. Cleaner but requires host
  cooperation.
- **(c)** Skip the mirror for v1.0 — show the nav banner only when
  the phone itself initiated nav (it can't, today). Drop that piece
  of the mockup, document deviation.

**Recommendation:** ship Phase H first, then revisit (a)/(b)/(c)
with a fresh design pass before starting Phase I. Don't begin Phase
I in the same session as H.

### 3.5 [DEFERRED] Scroll cooldown 150ms still feels slow
Drop to 0 or 100 and re-test. Small constant change in `bridge.ts`.

### 3.6 [DEFERRED] Phase 5-UI Settings tab on phone
Phone-side scaffolding exists at `src/phone/`. UI not wired. ~2-3
sessions estimated.

### 3.7 [DEFERRED] Strip dev geo mock pre-submission
`effects.ts` `VITE_MOCK_LAT/LNG` block. See memory
`project_wander_dev_geo_mock.md`.

---

## 4. Files changed across this session (parts 1 + 2)

```
src/glasses/screens/types.ts   — PoiListScreen.displayOffset (optional)
src/glasses/render.ts          — windowed slice + Previous sentinel + RULE 40→28
src/glasses/state.ts           — windowed routing + Previous tap + LOADING_MSG_FETCH_MORE
src/glasses/bridge.ts          — manual double-tap detector + openExternalUrl helper + SDK error logging
src/glasses/effects.ts         — runFetchPois logging
src/glasses/__tests__/state.test.ts — listState + append assertions
HANDOFF_2026-04-26.md          — part 1
HANDOFF_2026-04-26_part2.md    — this file
```

---

## 5. Reminders carried forward

- **Memory `project_wander_dev_geo_mock.md`** — strip
  `VITE_MOCK_LAT/LNG` from `effects.ts` before EvenHub submission
- **CLAUDE.md** — show diffs before applying; don't refactor adjacent
  code; don't start phases that can't finish in-session
- **Vercel auto-deploys on `main` push**; auto-build runs `tsc -b &&
  vite build` so the project tsconfig is the gate, not just `vitest`
  (a stricter checker)
- **Force-quit + rescan QR** to bust WebView cache between hardware
  tests

---

## 6. Files to read first in next session

1. This file (`HANDOFF_2026-04-26_part2.md`)
2. Part 1 (`HANDOFF_2026-04-26.md`) — Phase D/E/F summary
3. `src/glasses/bridge.ts:openExternalUrl` — the URL-opening fallback
   chain, in case it needs further iteration
4. `src/glasses/render.ts:renderPoiList` — the Previous + More + Refresh
   sentinel layout, in case the cursor walk feels off

**Repo:** https://github.com/laolao91/wander — branch `main` —
latest commit `55224ec`.
