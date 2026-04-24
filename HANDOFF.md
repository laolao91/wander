# Wander v1.0 — Handoff Document

**For:** Next chat session (or any contributor picking this up cold)
**From:** Steven Lao + prior Claude session
**Date:** 2026-04-19
**Status:** Code shipped to Vercel + GitHub. **Real-glasses testing exposed multiple P0 bugs.** Phone-side UI is entirely placeholder. Submission to EvenHub Early Developer Program is blocked until P0/P1 items below are fixed.

---

## 0. TL;DR — What you need to do

> **The mockups are the visual source of truth for everything you build — both glasses and phone.** Open `wander-mockup.html` in a browser before writing any UI code and keep it open. If what's on screen doesn't match the mockup, it's wrong. See §1.5 for the full mockup-to-implementation map.

1. **Fix the glasses input layer** (P0 §A) — single-tap on POI does nothing, CONFIRM_EXIT cursor/tap don't respond, double-tap routes incorrectly. Likely causes: `CLICK_EVENT === 0 → undefined` deserialization quirk, no 300ms scroll cooldown, no debug logging to diagnose what's actually arriving from real hardware vs the simulator.
2. **Match the glasses screens to the mockup** (P0 §C in §1.5) — current renders are functionally close but visually off (loading not centered, list not right-aligned, detail header layout differs, NAV_ACTIVE layout doesn't match).
3. **Build the phone companion UI to match the mockup** (P0 §B) — both tabs are empty placeholders. Mockup + spec are in `Point of Interest App/wander-mockup.html` and `WANDER_BUILD_SPEC.md`. Use `even-toolkit` only — no custom CSS.
4. **Wire settings sync** (P1) — once Settings tab exists, persist via `bridge.setLocalStorage` and trigger a glasses-side refresh on change.
5. **Submission polish** (P2) — verify SDK version, package as `.ehpk`, draft icon, capture screenshots, write 2,000-char description, fill privacy form.

---

## 1. Project context (read this first if you're cold)

- **App:** Wander — POI discovery + walking nav for EvenRealities G2 smart glasses with iPhone companion
- **Repo path:** `/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Wander_v1.0`
- **GitHub:** _(via the user's `laolao91` account — see project_vercel_github_flow.md in user memory)_
- **Vercel:** `https://wander-six-phi.vercel.app` — `/api/health`, `/api/poi`, `/api/route`, `/api/wiki` all live and verified
- **Vercel env vars:** `ORS_API_KEY` set in production
- **SDK:** `@evenrealities/even_hub_sdk@0.0.10` installed (submission checklist asks for 0.0.8 — check current npm `latest` and align)
- **Stack:** TypeScript + React 18 + Vite, `even-toolkit` for phone UI, Vercel serverless for API
- **Reference docs in this repo / sibling folder:**
  - `WANDER_BUILD_SPEC.md` (sibling folder `Point of Interest App/`) — canonical 982-line spec
  - `wander-mockup.html` (sibling folder) — visual reference for all glasses + phone screens
  - `README.md` (this repo) — store-listing-style overview + QR for testing on real glasses

### Architecture in 30 seconds

```
src/glasses/
  bridge.ts          ← SDK seam — translates physical events → reducer events; pushes screens to SDK
  state.ts           ← Pure reducer: reduce(state, event) → { state, effects }
  effects.ts         ← Side-effect runner — geolocation, fetch, window.open, GPS watch
  render.ts          ← Pure: Screen → SDK container payload (no SDK calls)
  screens/types.ts   ← Discriminated-union Screen type + ALLOWED_TRANSITIONS map
  api.ts             ← Typed fetch wrappers for /api/*
  minimap.ts         ← Canvas → PNG encoder for NAV_ACTIVE minimap
src/App.tsx          ← Phone shell — currently 100% placeholder (Phase-2 stubs)
api/                 ← Vercel serverless: poi.ts, route.ts, wiki.ts, health.ts
```

The reducer pattern is intentional and worth preserving: the bridge does I/O, the reducer is pure, render is pure. 105 unit tests on the pure modules. **Do not push business logic into bridge.ts.**

---

## 1.5. Mockups are the source of truth — build to match them

**Open `Point of Interest App/wander-mockup.html` in a browser right now.** It contains pixel-accurate mockups of all 5 glasses screens and both phone tabs. Every piece of UI you build or fix should be checked against this file. The build spec (`WANDER_BUILD_SPEC.md`) is the textual companion — read both.

### Glasses screens in the mockup (5)

| Mockup screen | Current code state | Gap to close |
|---|---|---|
| **Loading** — centered "WANDER" + horizontal bar + "Finding places near you…" | `render.ts` LOADING case — built but not centered correctly | See P1 §C — visual centering with non-monospace font |
| **POI Discovery List** — ▶ cursor + category icon + name on one line, distance on right; selected item has highlight bg + left border; legend at bottom | `render.ts` `renderPoiList` + `poiListLine` — built but I dropped distance to a second line and there's no bottom legend | See P1 §D — right-align distance; add bottom legend row |
| **POI Detail + Actions** — name, "★ Landmark · 0.3 mi NW · ~6 min walk" subtitle, 5-line summary, divider, then 4 actions: Navigate / Open in Safari / Read More / Back to List with `>` cursor | `render.ts` `renderPoiDetail` — matches structure; needs to compare cursor character (`>` vs `▶`), divider style, and bearing label (`NW`) | See P0 §C2 below |
| **Active Navigation** — large directional arrow + destination name, "★ Landmark · northeast" subtitle, current step instruction + next-step preview, 3-stat row (DISTANCE / ETA / BEARING) | `render.ts` `renderNavActive` + `navBodyText` — uses different layout (arrow + meters on top line, stop-nav hint at bottom); mockup uses larger arrow + 3-column stat row | See P0 §C3 below |
| **Read More (Wiki)** — header with title + "pg 2 / 4", body text, footer with `▲ prev / tap=back / ▼ next` | `render.ts` `renderWikiRead` — built; verify formatting matches mockup exactly | See P1 §E — visual pass on real hardware |

### Phone tabs in the mockup (2)

| Mockup tab | Current code state | Gap to close |
|---|---|---|
| **Nearby** — logo pill + title + G2-Connected indicator + location, conditional "Currently navigating" banner, refresh bar (count + ↺ button), section headers ("Landmarks & Parks" / "Food & Drink"), POI cards with icon + name + distance + category pill + 2-line wiki snippet + chevron, bottom tab bar | `App.tsx` placeholder text only | Build from scratch — see P0 §B1 |
| **Settings** — Search Radius slider (0.25 / 0.5 / 0.75 / 1.0 / 1.5 mi), 8 Categories toggles with icons (★ ■ ▲ † ○ ◉ ◆ ●), Display section (Sort by Proximity, Max results 20), sync info card | `App.tsx` placeholder text only | Build from scratch — see P0 §B2 |

**Implementation hints embedded in `wander-mockup.html`:**
- Phone Nearby tab → `even-toolkit`'s `AppShell` + `NavBar` + `ListItem` + `BottomSheet`
- Phone Settings tab → `Toggle` + `Slider` + `SegmentedControl` + `bridge.setLocalStorage` for persistence
- Glasses screens → `RebuildPageContainer` + `TextContainerProperty` / `ListContainerProperty` / `ImageContainerProperty`

### How to use the mockup as a reference

1. Open the HTML file in Chrome (the dedicated Cowork profile is fine)
2. For each screen you're building or fixing, open it side-by-side with your code
3. Match the **layout**, **labels**, **cursor characters**, **icons**, **section ordering** exactly — these aren't suggestions
4. If something in the mockup is impossible on the G2 (e.g. true right-alignment with non-monospace fonts), **document the deviation in code with a `// CLAUDE: deviates from mockup because …` comment** rather than silently changing it
5. When you're done with a screen, take a screenshot from the simulator and put it next to the mockup screenshot in the PR description

---

## 2. P0 — Blocking issues (must fix before any further submission work)

Severity-ranked. Each item: **what's broken**, **why I think so**, **suggested fix**, **files to touch**.

### A. Glasses input is broken on real hardware

#### A1. Single-tap on a POI does nothing
- **What's broken:** User taps a highlighted POI in the list; nothing happens. No detail screen opens. (Worked in simulator before MVP fixes.)
- **Why I think so:** Two compounding bugs:
  1. The SDK quirk documented in `WANDER_BUILD_SPEC.md` §17: `CLICK_EVENT = 0` deserializes to `undefined` over the real BLE bridge. Our switch in `bridge.ts:179` matches `OsEventTypeList.CLICK_EVENT` (the enum value `0`) but `e.eventType === undefined` does NOT === `0`, so the case never fires.
  2. Real hardware may route the tap as `textEvent`/`sysEvent` instead of `listEvent`. The list-event path returns early at line 195 without falling through to the text/sys handler, so a "list-screen tap that arrived as a textEvent" gets eaten silently.
- **Suggested fix:**
  - Normalize `eventType` at the top of `translateGlassesEvent`: `const t = e.eventType ?? OsEventTypeList.CLICK_EVENT` (treat undefined as CLICK).
  - When `evt.listEvent` is present but the event type doesn't match any list-screen case, fall through to the text/sys handler instead of returning early.
  - Add a single `console.log('[wander][evt]', JSON.stringify(evt))` at the top of `translateGlassesEvent` so the next round of glasses testing produces actionable evidence in the WebView inspector.
- **Files:** `src/glasses/bridge.ts` (lines 165–227)

#### A2. CONFIRM_EXIT cursor + tap unresponsive
- **What's broken:** Double-tap surfaces the exit prompt (good), but pressing tap or scrolling does nothing — user gets stuck on the screen.
- **Why I think so:** Same root cause as A1 — `CLICK_EVENT → undefined` and event-source confusion. The reducer paths for `cursor-up`/`cursor-down`/`tap` on CONFIRM_EXIT are correct (`state.ts:296–301, 352–356`); confirmed by unit tests. The events just aren't reaching them on real hardware.
- **Suggested fix:** Same as A1 — fixing the bridge's eventType normalization + falling-through-to-text/sys path will fix this in the same change.
- **Files:** `src/glasses/bridge.ts`. Validate by adding a CONFIRM_EXIT cursor-move + tap unit test in `src/glasses/__tests__/bridge.test.ts`.

#### A3. Double-tap goes back to list instead of prompting exit (or matching spec's "exit app")
- **What's broken:** On POI_DETAIL, double-tap returns to POI_LIST. User expected the exit-confirmation prompt.
- **Why I think so:** `bridge.ts:217–225` — for inner screens, double-tap dispatches `'back'`. The build spec says double-tap = exit from ALL screens; the user's stated preference is "double-tap → confirmation prompt → exit", from anywhere.
- **Suggested fix:** Replace the inner-vs-top-level branching with: **double-tap always dispatches `request-exit`**. The reducer already gates `request-exit` to avoid stacking confirms. Remove `isTopLevelScreen()` entirely. Update tests in `src/glasses/__tests__/bridge.test.ts` (the "DOUBLE_CLICK on POI_DETAIL dispatches back" assertion needs to flip to `request-exit`).
- **Files:** `src/glasses/bridge.ts` (lines 217–237), `src/glasses/__tests__/bridge.test.ts`

#### A4. No scroll cooldown — likely double-firing
- **What's broken:** On CONFIRM_EXIT (cursor 0/1 only) a single scroll could bounce both ways. Spec §17 requires 300ms cooldown.
- **Suggested fix:** Add a `lastScrollAt: number` field to a small bridge-local state and short-circuit `cursor-up`/`cursor-down` if `Date.now() - lastScrollAt < 300`.
- **Files:** `src/glasses/bridge.ts`

#### A5. We don't know what events real glasses actually send
- **Why this matters:** Until we have logs from real hardware showing the `evt` payload shape, A1–A3 fixes are educated guesses. The build spec explicitly warns: *"The simulator sends sysEvent for some interactions; real hardware uses textEvent or listEvent."*
- **Suggested fix:** Add `console.log('[wander][evt]', evt.listEvent && 'list', evt.textEvent && 'text', evt.sysEvent && 'sys', JSON.stringify(evt))` at the top of `translateGlassesEvent`. Ship it. Have Steven open the WebView inspector during real-glasses testing and copy 5–10 event lines into the next chat session.

---

### B. Phone companion UI is 100% placeholder

#### B1. Nearby tab shows "will appear once Phase 2 lands"
- **What's broken:** The phone Nearby tab is literally a placeholder text node.
- **Suggested fix:** Build per `wander-mockup.html` (section "Phone Screens — Nearby Tab"):
  - Logo pill + "Nearby" title + G2-connected indicator dot + reverse-geocoded location label
  - Conditional "Currently navigating to X" banner (visible only when glasses state is NAV_ACTIVE)
  - Refresh bar: "Updated X min ago · N places found" + ↺ button
  - Section headers ("Landmarks & Parks" / "Food & Drink" / etc.)
  - POI cards: icon + name + distance + category pill + 2-line wiki snippet + chevron → tap opens BottomSheet with full summary + Navigate / Open in Safari actions
  - Bottom tab bar (NavBar)
- **Components (even-toolkit only):** `AppShell`, `NavBar`, `ScreenHeader`, `Card`, `ListItem`, `BottomSheet`, `Button`
- **Files:** Create `src/phone/tabs/NearbyTab.tsx`, `src/phone/components/POICard.tsx`, `src/phone/components/POIBottomSheet.tsx`, `src/phone/components/NavBanner.tsx`. Refactor `src/App.tsx` into `src/phone/App.tsx` shell with `NavBar` + tab routing.

#### B2. Settings tab is empty
- **What's broken:** Settings screen says "would let you update search radius and categories" but renders nothing. **Therefore the user cannot opt out of restaurants or in for only museums/parks** — which they explicitly called out as MVP.
- **Suggested fix:** Build per `wander-mockup.html` (section "Phone Screens — Settings Tab") and spec §9:
  - **Search Radius slider** — 0.25 / 0.5 / 0.75 / 1.0 / 1.5 mi (step 0.25, default 0.75)
  - **Categories section** — 8 toggle rows with icon + label:
    - ★ Historic & Landmarks (default ON)
    - ■ Parks & Nature (default ON)
    - ▲ Museums & Galleries (default ON)
    - † Religious Sites (default ON)
    - ○ Public Art (default OFF)
    - ◉ Libraries & Education (default OFF)
    - ◆ Restaurants & Cafes (default ON)
    - ● Bars & Nightlife (default OFF)
  - **Display section** — "Sort by Proximity" (informational, only option in v1.0); "Max results 20" (informational)
  - **Legend card** — icon → category name reference
  - **Sync info card** — "Changes sync to glasses automatically"
- **Components:** `Toggle`, `Slider`, `SegmentedControl`, `SectionHeader`
- **Files:** Create `src/phone/tabs/SettingsTab.tsx`

#### B3. Settings → glasses sync is unwired
- **What's broken:** Even when Settings UI exists, no plumbing pushes changes to the reducer.
- **Suggested fix:** On every toggle/slider change:
  1. Persist via `bridge.setLocalStorage(key, value)` — **NOT** browser localStorage (unreliable in Flutter WebView, per spec §10/§17)
  2. Dispatch `{ type: 'settings-changed', settings: {...} }` into the reducer (it already triggers a `fetch-pois` effect — `state.ts:132–136`)
  3. Storage keys per spec §10: `wander_radius`, `wander_categories`, `wander_last_poi_cache`, `wander_last_fetch_ts`
- **Files:** New `src/utils/storage.ts` (typed wrappers), `src/phone/tabs/SettingsTab.tsx`, possibly a new bridge method to expose dispatch from the phone side. **Open question:** how does the phone-side React component reach into the glasses reducer's dispatch? Currently the bridge owns it as a closure inside `initGlasses`. Likely needs a small event-bus or expose `dispatch` via a module-level singleton.

---

### C. Glasses screens deviate from the mockups

Re-read §1.5 before opening these. **Each item: open the mockup, find the screen, match it.**

#### C1. POI list doesn't match the mockup
- **Mockup shows:** ▶ cursor + category icon + name on **one line** with **distance flush right**, selected item has highlight bg + left border (firmware handles selection styling), bottom-of-screen legend strip
- **Current code (`render.ts:202–210`):** `> ` cursor + icon + name on line 1, `     {distance}  ·  ~{walkMinutes} min` on line 2 (no legend strip)
- **Suggested fix:** Single-line items with `name.padEnd(48)` + distance suffix; add a final list item or footer text with the icon legend (`★ ■ ▲ † ○ ◉ ◆ ●`); accept that non-monospace font means right-edge will be slightly ragged (document with a `// CLAUDE:` comment)

#### C2. POI Detail header subtitle missing bearing
- **Mockup shows:** `★ Landmark · 0.3 mi NW · ~6 min walk` — bearing direction (`NW`) is part of the subtitle
- **Current code (`render.ts:252–256`):** `★ Landmark  ·  0.3 mi  ·  ~6 min` — no bearing
- **Suggested fix:** Use existing `bearingToArrow` logic but emit a cardinal label (`N`, `NE`, `E`, …) instead of an arrow glyph for the subtitle. Add a small helper `bearingToCardinal(deg) → 'NW' | 'NE' | …`

#### C3. NAV_ACTIVE layout doesn't match the mockup
- **Mockup shows:** Large directional arrow + destination name top section, "★ Landmark · northeast" subtitle, current step instruction with next-step preview underneath, **3-column stat row at bottom: DISTANCE / ETA / BEARING**
- **Current code (`render.ts:337–370`):** Arrow + meters on top line, current step instruction in middle, "Tap to stop nav / Double-tap → list" hints at bottom; no 3-column stat row, no next-step preview
- **Suggested fix:** Restructure `navBodyText` to render the 3-stat row (DISTANCE / ETA / BEARING) and add a next-step preview line. Note: the minimap (right column) is correct per the mockup's spirit even though the mockup itself doesn't show it explicitly — the mockup focuses on the text-only layout.

#### C4. Loading screen layout
- **Mockup shows:** Centered "WANDER", thin horizontal bar/rule beneath, "Finding places near you…" subtitle
- **Current code (`render.ts:56–58`):** Removed the rule line in the last MVP pass — but the mockup includes one
- **Suggested fix:** Restore a thin rule between WANDER and the subtitle: `centeredBlock(['', '', 'WANDER', '─────────', '', screen.message])` (use `─` not `━` to keep it thinner per the mockup's visual weight). Combined with the centering work in P1 §C below.

**Files for all of C1–C4:** `src/glasses/render.ts`. Add snapshot tests against the mockup's text layout in `src/glasses/__tests__/render.test.ts`.

---

## 3. P1 — MVP must-haves (after P0)

### D. Visual centering on LOADING (execution detail for §2 C4)
- **Why it's P1, not P0:** §2 C4 says "restore the rule below WANDER". This item covers the centering craft — `render.ts:446–454` centers using space-padding against `CHARS_PER_LINE = 65`. The G2 font is non-monospace, so visual centering by character count is approximate. Spec allows leading spaces only — there's no `textAlign` field on `TextContainerProperty` (verified against SDK 0.0.10's `index.d.ts`).
- **Options:**
  1. Tune `CHARS_PER_LINE` empirically until "WANDER" matches the mockup's centered position on real hardware (check 60, 55, 50)
  2. Use a single fixed leading-space prefix (e.g. `'                          WANDER'`) calibrated to the actual font
  3. Move the title into a TextContainer with explicit `xPosition`/`width` that geometrically centers the box (font still non-monospace inside, but the container itself can be positioned)
- **Mockup check:** Compare the final result side-by-side with the "Loading" mockup screen in `wander-mockup.html` before marking done.
- **Files:** `src/glasses/render.ts` (`renderScreen` LOADING case + `centeredBlock`/`center` helpers)

### E. Distance right-alignment craft (execution detail for §2 C1)
- **Why it's P1, not P0:** §2 C1 says "single-line items with distance flush right per mockup". This item is the fallback plan if right-alignment looks bad on hardware.
- **Why this is hard:** Non-monospace font means space-padding to a target column looks ragged. There's no per-column right-align in `ListItemContainerProperty`.
- **If mockup-accurate right-alignment looks too ragged:**
  1. Truncate names harder (max 32 chars) so distances cluster more consistently
  2. Fall back to the two-line layout and add a `// CLAUDE: deviates from mockup because G2 font is non-monospace` comment
- **Files:** `src/glasses/render.ts` (`poiListLine`, lines 202–210)

### F. NAV_ACTIVE / WIKI_READ untested on real glasses
- **Status:** Built and unit-tested, but Steven hasn't reached these screens on real hardware (blocked by A1).
- **After A is fixed:** Run through the UAT checklist in `WANDER_BUILD_SPEC.md` §18 **and** compare every screen side-by-side against `wander-mockup.html`. Log any deviations as new §2 C items.

---

## 4. P2 — Submission polish

Per `WANDER_BUILD_SPEC.md` §19. None of these are technically blocking the app from working — they're all gates for the EvenHub store submission.

| Item | Status | Action |
|---|---|---|
| SDK version | We're on 0.0.10; spec asks 0.0.8 but says "use latest on npm" | Run `npm view @evenrealities/even_hub_sdk version`, align if needed |
| CLI version | Not installed | `npm i -g @evenrealities/evenhub-cli@latest`, verify `evenhub --version` |
| Simulator | Not used recently | `npm view @evenrealities/evenhub-simulator version` |
| `.ehp`/`.ehpk` package | Never built | `evenhub pack app.json dist -o wander.ehpk` |
| `app.json` validation | Manifest exists, network URL fixed to `wander-six-phi.vercel.app` | Validate against npm package schema |
| Icon | Not designed | Design 2×2 px monochrome grid in EvenHub Dev Portal icon tool |
| Screenshots | Not captured | Capture from official simulator — **each screenshot must match its counterpart in `wander-mockup.html`** before submission |
| Description (≤2000 chars) | ~400-char draft in spec §19 | Expand to 2000 |
| Privacy form | Not started | Use spec §13 statement as basis |
| Phone UI polish | Blocked by P0 §B | After B1+B2. **Final visual pass: open mockup + built UI side-by-side and reconcile every delta.** |
| Mockup parity review | Not done | Before submitting: walk every glasses + phone screen against `wander-mockup.html`. Any `// CLAUDE: deviates from mockup` comments must be intentional and justified. |

---

## 5. Quick reference — every file touched recently

| File | What it does | Recent changes |
|---|---|---|
| `src/glasses/bridge.ts` | SDK seam — boots SDK, translates events, pushes screens | Added `request-exit` flow, removed `shutDownPageContainer` from translation |
| `src/glasses/state.ts` | Pure reducer | Added `request-exit` event, `exit-app` effect, CONFIRM_EXIT cursor+tap+back, POI_LIST `cursorIndex` fallback for tap |
| `src/glasses/render.ts` | Pure Screen → SDK container payload | LOADING simplified (removed extra rule line); POI list became two-line per item; CONFIRM_EXIT renderer added |
| `src/glasses/effects.ts` | Side-effect runner | Added `exit-app` effect with `exitApp` dep |
| `src/glasses/screens/types.ts` | Screen union + ALLOWED_TRANSITIONS | Added `ConfirmExitScreen`, `cursorIndex` on `PoiListScreen`, transitions |
| `src/glasses/__tests__/bridge.test.ts` | Bridge unit tests | Updated 2 double-click assertions to expect `request-exit` |
| `app.json` | EvenHub manifest | Network permission URL corrected to `wander-six-phi.vercel.app` |
| `README.md` | GitHub README | Created from scratch with QR code, use cases, store-listing copy, how-it-works flow |

**Files NOT yet touched but will be needed for P0 §B:**
- `src/App.tsx` — needs full phone shell rebuild
- `src/phone/tabs/NearbyTab.tsx` (new)
- `src/phone/tabs/SettingsTab.tsx` (new)
- `src/phone/components/POICard.tsx` (new)
- `src/phone/components/POIBottomSheet.tsx` (new)
- `src/phone/components/NavBanner.tsx` (new)
- `src/utils/storage.ts` (new) — `bridge.setLocalStorage` typed wrappers

---

## 6. Open questions for Steven (answer at start of next session)

These would unblock or sharpen the work above. Pick whichever you have answers for; everything else can proceed with educated guesses.

1. **Real-glasses event logs.** Can you connect the WebView inspector during real-glasses testing, single-tap a POI, double-tap to surface CONFIRM_EXIT, scroll the cursor, and tap to confirm — then paste the `[wander][evt] ...` console lines into the next chat? Without this, A1/A2 fixes are best guesses. (To set this up, the next session can ship the `console.log` first as a tiny standalone PR, you re-deploy, test, and copy the log.)
2. **"Send to phone" vs "Open in Safari".** The mockup labels it "Open in Safari", current code uses the same. You also mentioned "send to phone" as a desired action. Should the label change, or are these two different actions that both need to exist?
3. **Sort by Proximity / Max results 20.** Spec says these are informational-only in v1.0 (read-only). Are you OK with that, or do you want them functional (e.g. add Sort by Category)?
4. **Settings persistence behavior.** When user changes a setting on the phone while glasses are mid-NAV_ACTIVE, should the new settings (a) cache silently and apply on next return to POI_LIST, or (b) interrupt nav with a refresh? Spec says (a), I want to confirm.
5. **GitHub branch strategy.** Should P0 fixes go straight to `main` (current pattern) or via a `fix/glasses-input` branch + PR? Vercel auto-deploys from main, so PRs would give you preview deploys to test before promoting.
6. **EvenHub Discord access.** Spec §19 lists three contacts (@Eve for icon, @Carson for SDK/CLI, @David for privacy). Do you already have access, or should the submission work include "draft questions for Steven to send" rather than direct outreach?

---

## 7. How to verify your work as you go

```bash
cd /Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Wander_v1.0

# Unit tests — should stay at 105 passing (or grow as you add bridge tests)
npm test

# Type-check
npx tsc --noEmit

# Build
npm run build

# Local dev (phone UI in browser)
npm run dev

# Deploy is auto on push to main via Vercel
git push origin main
```

For real-glasses testing: scan the QR in `README.md`, or visit `https://wander-six-phi.vercel.app` directly from the EvenHub app on Steven's phone with the G2 paired.

**For every UI task (glasses or phone):** open `wander-mockup.html` in Chrome side-by-side with your work. Before marking a task done, screenshot your build and place it next to the mockup's corresponding screen — they should be visually indistinguishable modulo documented deviations.

---

## 8. Hard rules (don't break these)

- **Build to the mockups.** `wander-mockup.html` is the visual source of truth for every glasses screen and every phone tab. Open it before writing UI code; keep it open while you work; compare screenshots before marking a task done. Deviations are only acceptable when the G2 hardware genuinely can't match the mockup — document each with a `// CLAUDE: deviates from mockup because …` comment.
- **Reducer stays pure.** No fetches, no SDK calls, no `Date.now()`, no `Math.random()` inside `state.ts`. Effects come out as data via the `Effect[]` return.
- **Render stays pure.** `render.ts` returns SDK payload objects — never calls `bridge.*`.
- **All external API calls go through `/api/*` Vercel functions.** Never hit Wikipedia / Overpass / ORS directly from the client. Spec §3.
- **No browser `localStorage`.** Use `bridge.setLocalStorage`. Spec §17.
- **`borderRadius` is now spelled correctly in SDK 0.0.10** (was `borderRdaius` in 0.0.8 — see user memory `project_sdk_border_typo.md`). If you downgrade to 0.0.8 for submission, switch back.
- **No em dashes (`—`) or ellipsis (`…`) in glasses strings.** G2 font doesn't include them. Use `-` and `..`. Spec §17. (Note: I shipped `…` in `truncate()` in `render.ts:458` — that's a bug to fix in the same pass as the input fixes.)
- **One `isEventCapture: 1` per page.** Multiple capture containers break input routing.
- **Container names ≤ 16 chars.** Spec §17.

---

## 9. Where to find the source-of-truth references

- **Build spec:** `/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Point of Interest App/WANDER_BUILD_SPEC.md` (982 lines, canonical)
- **Mockup HTML:** `/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Point of Interest App/wander-mockup.html` (1249 lines, all 5 glasses screens + 2 phone tabs)
- **G2 SDK reference:** `/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Wander_v1.0/node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts`
- **EvenHub everything-evenhub plugin:** Use the Claude Code skills it ships for scaffolding/UI/input/deploy if available
- **even-toolkit:** https://github.com/fabioglimb/even-toolkit (community phone UI components)

---

## 10. Suggested order of operations for the next session

1. Read this doc + the user's first message in the new chat
2. **Open `wander-mockup.html` in Chrome and leave it open for the entire session** — every UI task below is a match-the-mockup exercise
3. Ship the diagnostic `console.log` to bridge.ts (tiny PR), have Steven re-deploy and capture event logs from real glasses
4. While waiting for logs: build the Settings tab (P0 §B2) against the mockup — self-contained and unblocked by anything
5. With logs in hand: fix bridge event translation (P0 §A1, A2, A3, A4)
6. Close the glasses-screen mockup gaps (P0 §C1–C4) alongside the input fixes — same `render.ts` surface
7. Build Nearby tab against the mockup + wire settings sync (P0 §B1, B3)
8. Real-glasses pass through the UAT checklist **and** a mockup-parity walkthrough (every screen, compare side-by-side)
9. P1 centering + right-alignment craft (§3 D, §3 E)
10. P2 submission gates — final mockup-parity review (§4 table) before the submission screenshots are captured

Estimate: 2–3 focused sessions to v1.0 submittable.
