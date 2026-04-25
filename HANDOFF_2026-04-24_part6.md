# Wander v1.0 — Handoff 2026-04-24 (part 6)

**Status:** First real-hardware field test of Phase 4d run by Steven on
the EvenRealities G2 (2026-04-24). Surfaced multiple high-priority
issues. Three small fixes deployed this session; the rest are documented
below for the next session — none of them block reading this doc.

**Latest commit:** `50feacd` — field-test label/units/cooldown fixes
**Tests:** 204/204 passing
**Vercel:** auto-redeployed on push

**Companion docs:**
- Field notes (raw): `/Users/stevenlao/CoworkSandbox/outbox/HARDWARE_TEST_NOTES_2026-04-24.md`
- Prior session: `HANDOFF_2026-04-24_part5.md`

---

## 1. What was fixed this session (commit 50feacd)

### 1.1 "Open in Safari" → "Open on Phone"
**Why:** EvenHub WebView opens external URLs in its own in-app browser,
not in Safari and not in the phone's default browser. The label was
misleading.

**Where:** `src/glasses/render.ts` `ACTION_LABEL.safari`. Internal
discriminant (`'safari'`) kept as-is to avoid touching state, types,
and routing — only the user-visible label changed.

### 1.2 NAV_ACTIVE imperial units
**Why:** Steven (US user) reported "Does 79 m mean meters?" — the NAV
body was metric while POI_DETAIL was already imperial.

**Where:** `src/glasses/render.ts` `formatMeters`. Now:
- `< 0.1 mi` → feet rounded to 5 ft (visual stability while updating)
- otherwise → `N.NN mi`

### 1.3 Scroll cooldown 300ms → 150ms
**Why:** Steven reported "scrolling feels laggy resulting in misinputs"
on real BLE.

**Where:** `src/glasses/bridge.ts` `SCROLL_COOLDOWN_MS`. Halved to give
intentional scrolls more headroom while still absorbing the worst
double-fires. Tune from here based on next session's feel.

---

## 2. Open issues — investigate next session

Ordered by impact. **None of these were fixed in this session** — they
need real hardware + logs to diagnose.

### 2.1 [BLOCKER] Boot stuck at title screen
**Symptom:** App opened to a title screen. Steven could only proceed
by long-pressing and *declining* an OS-level "End this Feature" prompt.

**Hypotheses:**
- Our LOADING screen renders, but the SDK's container handoff misfires
  on real BLE — the bridge thinks it's still booting.
- `createStartUpPageContainer` succeeded but the first `pois-loaded`
  dispatch never reached the bridge (geolocation hung past wall-clock?).
- The "title screen" Steven describes might be the EvenHub app's pre-app
  launcher, not Wander's LOADING screen — would explain why long-press
  was the only escape.

**Steven Response:**
- Yes I should have said the app gets stuck on Wander's LOADING screen.

**Where to look:**
- `src/glasses/bridge.ts:64` `initGlasses` — the boot sequence
- `src/glasses/effects.ts:213` `defaultGeolocate` — 15s wall-clock race
  exists; verify it actually fires on hardware

**Recommended diagnostic:**
- Add a `console.log('[wander][boot]', step)` at each step of
  `initGlasses` so the next field test shows exactly where it hangs.
- Log the result of the first `geolocate()` call.

### 2.2 [HIGH] Only 1 POI returned ("Starbucks")
**Symptom:** From a presumably Vegas location, the list contained only
one item — a Starbucks. Expected: many.

**Hypotheses:**
- Wikipedia GeoSearch returned 0 (Vegas residential area) — only OSM
  contributed
- OSM Overpass query may have timed out and returned partial
- Category filter excluded everything else (settings.categories empty?)
- `MAX_RESULTS_TOTAL` clipping after distance sort
- New page-shape envelope on `/api/poi` may be returning `items: []`
  occasionally if Vercel function logs show errors

**Steven Response:**
- No I think it was in New York because I know the starbucks it
  was referencing and it is nearby. 

**Where to look:**
- `api/poi.ts` — server-side merge + filter logic
- Vercel function logs for the deployment around the test time
- `src/glasses/state.ts` `INITIAL_STATE.settings.categories` — should
  default to all 8

**Recommended diagnostic:**
- Add server-side logging in `api/poi.ts`: count of wiki items, OSM
  items, post-filter, post-slice. Visible in Vercel function logs.
- Log the `?categories=` query string to confirm the client is sending
  all categories.

### 2.3 [HIGH] Double-tap unresponsive on POI_DETAIL / NAV_ACTIVE
**Symptom:** Phase 1 fix (treat undefined eventType as CLICK) was meant
to fix this. On real BLE, double-tap still doesn't surface CONFIRM_EXIT.

**Hypotheses:**
- DOUBLE_CLICK_EVENT might also deserialize to undefined (not just
  CLICK_EVENT). Currently we only normalize undefined → CLICK.
- The SDK might never deliver DOUBLE_CLICK_EVENT and instead delivers
  two separate CLICK_EVENTs that the host app's debouncer collapses.
- The OS-level long-press is intercepting before our handler.

**Where to look:**
- `src/glasses/bridge.ts:58` `normalizeEventType` — currently only maps
  undefined → CLICK
- `src/glasses/bridge.ts:189` `translateGlassesEvent` — DOUBLE_CLICK
  case
- Phase 0 diagnostic at `bridge.ts:201-220` already logs `eventType` —
  next field test must capture these logs to see what's actually
  arriving.

**Recommended diagnostic:**
- Get logs working first (§2.7), then re-run hardware test and capture
  what eventType comes through on a deliberate double-tap.
- Consider adding a manual double-tap detector: track CLICK_EVENT
  timestamps and treat two within 350ms as DOUBLE_CLICK regardless of
  the SDK's reported type.

### 2.4 [HIGH] "Back to List" doesn't return to POI_LIST
**Symptom:** Tapping "Back to List" from POI_ACTIONS only returned to
POI_DETAIL of the same Starbucks.

**Hypotheses:**
- `executePoiDetailAction` `case 'back'` calls `applyPendingRefresh`
  which uses `pendingPoiRefresh ?? state.poiList`. If `poiList` only
  has the Starbucks (because §2.2), back-nav lands on a 1-item list —
  which Steven may be misreading as "the same Starbucks detail."
- This is likely a *symptom* of §2.2, not a separate bug. Confirm by
  fixing §2.2 first.

**Where to look:** `src/glasses/state.ts:513` `case 'back'` →
`applyPendingRefresh` → `next(state, { name: 'POI_LIST', pois, ... })`.

### 2.5 [MEDIUM] "Open on Phone" locks glasses cursor
**Symptom:** After tapping "Open on Phone", the in-app browser opens
on the phone and the glasses cursor can no longer move off that menu
item.

**Diagnosis (high confidence):** EvenHub's in-app browser overlay
captures input. While it's foregrounded, scroll/tap events go to the
browser, not Wander. Glasses still display POI_ACTIONS but inputs
aren't reaching us.

**Options:**
- (a) Accept the platform behavior; add a hint on the action like
  "Open on Phone (return via phone)".
- (b) Investigate whether the EvenHub SDK exposes a method to open
  URLs in the system browser (Safari proper) instead of the in-app
  one — that would background EvenHub and avoid the input capture.
- (c) Drop the action entirely and rely on Read More + Navigate.

**Recommendation:** (a) for v1, (b) for a follow-up if SDK supports it.

**Steven Response:**
- Yes A is fine, I just don't want the user to see, open in Safari
  and it doesn't actually open in safari.

### 2.6 [MEDIUM] Scrolling still feels laggy
**Symptom:** Field test reported lag at 300ms. We dropped to 150ms
this session — untested on hardware yet.

**Plan:** Re-run scroll test next session. If still laggy, drop to
0 (disabled) and rely on the SDK to debounce. If bounces leak through,
go back to 150–200ms.

### 2.7 [HIGH — DIAGNOSTIC] Console logs not visible
**Symptom:** Steven couldn't see any `[wander][evt]` or `[wander]` logs
on phone or glasses. Without logs, all the above issues are blind.

**Question to answer first thing next session:** *How does Steven view
console output during a real-hardware run?*

**Steven Response:**
- I'm personally not interested in seeing the logs, I only care that
  you have access to them.  So resolve that however helps you.  I'm
  not able to see anything on my phone or glasses and I'd rather not
  use screen real estate to see logging info so any logs need to be
  somewhere other than the phone or glasses.

**Possibilities:**
- Chrome DevTools remote debugging on the EvenHub app's WebView
- EvenHub's developer console / log viewer
- Adding an on-screen debug overlay (last 5 log lines as a screen-
  bottom strip in DEV builds only)

If remote debugging isn't accessible, add an on-screen debug overlay
gated on `import.meta.env.DEV` so the next field test can see what's
happening without DevTools. This is the highest-ROI single change for
diagnosing everything else.

---

## 3. Recommended order of attack next session

1. **Get logs visible** (§2.7) — without this, every other
   investigation is guesswork. Either find the EvenHub debug console
   or add an on-screen overlay.
2. **Re-run field test** with logs now flowing. Capture `[wander][evt]`
   for every double-tap and scroll, and the boot sequence logs.
3. **Investigate §2.1 boot stuck** — should be obvious from boot logs.
4. **Investigate §2.2 1-POI** — server logs from Vercel + the
   client-side categories query string should explain it.
5. **Fix §2.3 double-tap** based on what eventType actually arrives.
6. **Verify §2.4** is just a symptom of §2.2 (likely).
7. **Decide §2.5** policy (label hint, alternate URL opener, or drop).
8. **Steven Note** the phone side app still doesn't look any different.
   This needs to be looked at, at some point as its basically a placeholder
   at the moment.  

---

## 4. What NOT to touch

These are working per the field test:

- **POI_DETAIL → NAV_ACTIVE flow** — Navigate works
- **Minimap PNG render** — user-position triangle visible on glasses
- **POI_DETAIL header layout** — fits the screen, distance/walk-time/
  bearing display correctly
- **Cursor highlight visibility** — `>` prefix is clearly visible
- **Category icons** — render correctly
- **Text fits 576×288** — no overflow

---

## 5. Files modified this session

```
src/glasses/render.ts       — label rename + imperial NAV distance
src/glasses/bridge.ts       — scroll cooldown 300→150ms
src/glasses/__tests__/render.test.ts — updated assertions
HANDOFF_2026-04-24_part5.md — created last session
HANDOFF_2026-04-24_part6.md — this file
```

---

## 6. Reminders carried forward

- **`project_wander_dev_geo_mock.md`** — strip `VITE_MOCK_LAT/LNG`
  override from `effects.ts` before v1.0 store submission
- **CLAUDE.md** — show diffs before applying; don't refactor adjacent
  code; don't start a new phase that can't finish in-session
- **Vercel auto-deploys on `main` push** — no manual deploy step

---

## 7. Files to read first in next session

1. This file
2. `outbox/HARDWARE_TEST_NOTES_2026-04-24.md` — Steven's raw field notes
3. `HANDOFF_2026-04-24_part5.md` — prior session's setup context
4. `src/glasses/bridge.ts` — boot + event translation (the suspected
   home of §2.1 + §2.3)
5. `api/poi.ts` — for §2.2 diagnosis

**Repo:** https://github.com/laolao91/wander — branch `main` —
latest commit `50feacd`.
