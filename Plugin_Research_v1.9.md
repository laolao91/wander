# Wander v1.9 — Plugin / Feature Research

_Date: 2026-06-16 | Target: v1.10+ product roadmap | SDK: @evenrealities/even_hub_sdk v0.0.10_

This is a **research and product-strategy document**, not a code change. It surveys the smart-glasses, audio/text-wearable, POI-discovery, and navigation-app landscapes; filters every candidate idea against the Even Realities G2's specific hardware constraints; validates/supersedes the existing N1–N8 backlog from `Wander_Code_Review.md`; and proposes new ideas (continuing the N-numbering from N9). It closes with a roadmap and an explicit list of common-but-infeasible ideas so they aren't re-proposed later.

---

## Executive Summary

Wander already nails the hard parts of a glanceable POI/navigation experience (category search, manual-location override now honored on both surfaces, minimap with real heading, wiki reading, favorites sync). The competitive landscape points to a clear strategic gap: **Wander is a "search then act" app, while every successful minimal-display navigation product is built around "the one thing relevant to you right now."** Citymapper Go, Apple Watch Maps, and Garmin's "Up Ahead" all win by surfacing a single next-step or single nearby-thing without the user asking.

Top recommendations (full detail and N-numbers below):

1. **N9 — Proactive "nearby landmark" nudge** (Field Trip / VoiceMap pattern, reframed as text since the G2 has no speaker): when the user passes within ~80 m of a high-quality POI while walking, surface a one-line glanceable card. This is the single highest-leverage idea — it converts Wander from pull to push, which is the entire reason minimal wearables exist.
2. **N10 — "Up Ahead" POIs along the active route** (Garmin Fenix pattern): during navigation, show the next POI you'll pass, not just the destination. Reuses the existing route geometry and POI data; almost no new infrastructure.
3. **N1 (revalidated) — IMU head-tilt list scroll**: confirmed as a real text-wearable pattern; keep it, but supersede the proposed flat `|y| > 0.8` threshold with a debounced/gated state machine (details below) so passive head motion while walking doesn't scroll.
4. **N8 (re-prioritized up) — route-distance ETA**: small effort, and accurate ETA is table stakes in every nav competitor (Apple Watch, Citymapper). Promote from "Low value" to "Medium."
5. **N2 + N3 (merge)** — reconnect-refresh and battery-aware degradation are both `onDeviceStatusChanged` consumers; build them together as one "device-status reactions" effect.

Two ideas common in the space are **explicitly rejected**: camera-based "what am I looking at?" landmark ID (Meta Ray-Ban's flagship feature — the G2 has no camera) and on-glasses audio tours (VoiceMap/Detour model — the G2 has no speaker). Both are great patterns and both are impossible on this hardware; the phone companion can host a lightweight audio version of the latter.

---

## Methodology / Sources Consulted

**Ground-truth (read in full from the repo):** `Wander_Code_Review.md` (21 findings + N1–N8 backlog), `HANDOFF_v1.9.md` (what shipped this session), and the live source under `src/glasses/` and `src/phone/` (screen state machine in `screens/types.ts`, reducer in `state.ts`, I/O in `effects.ts`, draw calls in `render.ts`, SDK wiring in `bridge.ts`). Confirmed the current screen set is `LOADING / POI_LIST / POI_DETAIL / POI_ACTIONS / NAV_ACTIVE / WIKI_READ` plus error screens, and that `onDeviceStatusChanged` is currently consumed only to drive the phone header dot (`bridge.ts:201`).

**SDK / hardware capability check:** the `everything-evenhub:device-features` skill (authoritative). Key confirmations used as hard filters throughout: IMU available via `imuControl(true, ImuReportPace.Pxxx)` delivering `{x,y,z}` through `onEvenHubEvent` / `OsEventTypeList.IMU_DATA_REPORT`; microphone available via `audioControl(true)` delivering 16 kHz mono PCM; `DeviceStatus` exposes `batteryLevel`, `isWearing`, `isCharging`, `isInCase`. **Explicitly NOT exposed: no audio output (no speaker), no camera, no programmatic scroll position, no animations, no background colors, no font/alignment control.** These three negatives (no speaker, no camera, no scroll-position API) each kill specific competitor features.

**Competitive web research (WebSearch / WebFetch, June 2026):**
- Smart glasses: Even Realities Even Hub launch + built-in app set; Meta Ray-Ban Display pedestrian navigation & "Look and Ask"; the community `even-g2-notes` repo and `even-toolkit`/`evenhub-templates` for what people actually build.
- Audio/text wearables: VoiceMap, GPSmyCity, Detour (GPS-triggered audio tours); Apple Watch Maps haptic turn-by-turn; Citymapper "Go" on Apple Watch; Garmin Fenix "Up Ahead."
- POI discovery: Google Field Trip (proactive geo-cards), museum proximity-beacon guides (Locatify/STQRY), AllTrails + Gaia GPS waypoint/POI patterns.

Sources are linked at the bottom.

---

## Competitive Landscape Findings

### A. Smart-glasses-specific patterns

**Even Realities G2 / Even Hub (the platform Wander ships on).** The built-in app set is `Conversate, Teleprompt, Health, Even AI, Translate, Navigate, Dashboard, Notification, QuickList`. Two implications for Wander: (1) there is already a first-party **Navigate** app, so Wander's differentiation is *discovery* (what's around me / what's interesting), not raw turn-by-turn — lean into POI curation, not competing as a generic maps app; (2) the platform's stated design thesis is "treat a two-second glance as the complete interaction." Wander's current flow (open → list → detail → actions → navigate) is several glances deep. The landscape says: add shallow, zero-tap surfaces (a Dashboard-style "what's around me" widget, a proactive nudge) on top of the existing deep flow.

The community ecosystem (`even-g2-notes`, `even-toolkit` with 191 pixel-art icons, `evenhub-templates`' minimal/asr/image/text-heavy scaffolds, plus reference apps like Chess, a Reddit client, Weather, Tesla, Pong/Snake) confirms the practical container budget and that **image-based "canvas" rendering is a proven pattern** — relevant precedent for Wander's minimap and for any new icon-driven compass/heading view.

**Meta Ray-Ban Display (the aspirational comparison, but a different hardware class).** Its pedestrian navigation: pick a destination by voice or by swiping category chips (Cafes, Restaurants, Parks, Attractions), then get turn-by-turn with a visual map — this is essentially what Wander already does, validating the core product. Its headline discovery feature, **"Look and Ask" / "what am I looking at?"** (camera scans the scene, AI returns landmark facts, "create your own walking tour hands-free"), is **camera-dependent and therefore impossible on the G2** — see Rejected Ideas. The relevant takeaway that *is* portable: the **category-chip swipe** for fast filtering maps directly onto N7 (glasses quick-settings) and the input is gesture-only, no phone trip.

### B. Audio / text / haptic minimal-wearable patterns

**Citymapper "Go" on Apple Watch** is the single most instructive precedent. Its design philosophy, in their own words: a wearable is perfect for the step-by-step nature of navigation because the user "just want[s] the piece of info that's relevant to you at that point in time." It shows one instruction at a time and **taps your wrist when your stop is coming up.** Wander's `NAV_ACTIVE` screen should be ruthlessly reduced to the single most relevant element (next instruction + distance to next turn), with everything else demoted. This directly motivates N10 (Up Ahead) and N12 (single-glance nav reduction).

**Apple Watch Maps haptic turn-by-turn** — distinct tap patterns for left vs. right turns, a buzz on the final leg and on arrival; lets you pocket the phone. The G2 has **no haptics and no speaker**, so the *modality* doesn't port — but the *principle* (a pre-turn alert so you don't have to stare at the screen) ports to a visual "turn in 50 ft →" pre-alert state in `NAV_ACTIVE`.

**VoiceMap / GPSmyCity / Detour (GPS-triggered audio tours).** The core mechanic — as you physically walk past a landmark, content auto-triggers without you asking — is exactly the proactive model Wander lacks (N9). But the *delivery* (narrated audio) is impossible on the G2 (no speaker). The reframe: trigger a **text "did-you-know" card** on the glasses, and optionally a **real audio narration on the phone companion** (full-color WebView, has a speaker, can use the device's TTS or a Wikipedia summary read-aloud).

### C. POI-discovery-app patterns

**Google Field Trip (Niantic, 2012–2019)** is the canonical proactive-discovery app and the clearest blueprint for N9: it ran in the background and pushed a notification card with a local fact when you approached a point of interest, with **user-tunable notification frequency and categories.** Its failure mode is the design constraint: Google killed Android Nearby Notifications for spam. Lesson for Wander — proactivity must be rate-limited, deduplicated (don't re-nudge the same POI), quality-gated (only POIs with a real Wikipedia article), and easy to mute. The frequency/category controls already exist in Wander's Settings; N9 mostly needs a throttle + a "seen" set.

**Museum proximity guides (Locatify, STQRY)** geofence content so a card appears when a visitor enters a beacon's range. Wander can't use BLE beacons (no direct Bluetooth in the SDK), but **outdoor GPS geofencing** is the documented alternative and is exactly what `watchPosition` already provides. This is the same primitive N9 needs.

**AllTrails / Gaia GPS** — waypoint marking, "alerts for wrong turns," "find trails a specific distance from your location," and a phone↔watch hands-free split (phone in pocket, glanceable device leads). Two portable ideas: an **off-route alert** during navigation (Wander has the route geometry and live position to detect divergence — N11), and Gaia's **POI-as-search-origin** (tap a POI on the map to find things near *it*), which is precisely backlog item N4.

### D. Navigation-app patterns

**Garmin Fenix "Up Ahead"** shows upcoming course points (water, summits, campsites) with distances on a tiny watch face so you can pace and decide without digging out a phone. This is the best precedent for **N10**: during Wander navigation, show the next 1–3 POIs you'll physically pass along the route, with distance-ahead. Wander already has both the route polyline and a POI list — this is mostly a geometric "which POIs are within X meters of the remaining route" filter plus a compact render.

**Apple Watch Maps / Citymapper Go** both converge on: minimize on-screen elements, pre-alert the next action, confirm arrival. Wander's `NAV_ACTIVE` currently renders instruction + ETA + minimap + heading arrow simultaneously; the landscape says that's information-dense for a glance and a "pre-turn alert" + "arrival confirmation" state would match user expectation set by these incumbents.

---

## Recommendations

Numbering continues the `Wander_Code_Review.md` "Net New Feature Ideas" series. **N1–N8 are revalidated/re-annotated below (not silently dropped); N9–N15 are new.** Feasibility tags use the user's three buckets: **Glasses-side feasible**, **Phone-side only**, **Needs hardware Wander doesn't have — rejected**.

Architecture shorthand used in the sketches: pure reducer = `src/glasses/state.ts`; I/O = `src/glasses/effects.ts`; draw calls = `src/glasses/render.ts`; SDK wiring = `src/glasses/bridge.ts`; screen types/transitions = `src/glasses/screens/types.ts`; phone tabs = `src/phone/tabs/*`.

### Revalidated backlog (N1–N8)

**N1 — IMU head-tilt to scroll the POI list.** Value: Medium · Effort: Medium · **Glasses-side feasible.**
*Validation:* Confirmed as a legitimate minimal-wearable input pattern in principle (the platform itself lists "head gestures" as a supported input class, per `even-g2-notes`), and the SDK exposes exactly what's needed (`imuControl(true, ImuReportPace.Pxxx)` → `OsEventTypeList.IMU_DATA_REPORT` → `{x,y,z}`). **Supersede the proposed mechanism:** the review's flat `|y| > 0.8 sustained 100ms` threshold will misfire while walking (gait bobs the head continuously) and conflicts with gravity (a static gyro/accel axis reads ~1.0 g at rest depending on axis convention). Better design: (a) high-pass/detrend against a rolling baseline so only *deltas* count, (b) require a deliberate tilt-and-return gesture (cross threshold, then return toward baseline) to emit a single scroll tick — not continuous scroll, (c) gate it to `POI_LIST` and `WIKI_READ` only, and (d) **make it opt-in via a Settings toggle** because there's no programmatic scroll API to "preview" it and motion input is divisive. Implementation: new `effects.ts` subscription started on entering scrollable screens; emits a synthetic `cursor-move ±1` into the existing reducer path (`state.ts:onCursorMove`) — reuses the gesture handling already there, so render/state need no new cases.

**N2 — Auto-refresh POIs when glasses reconnect.** Value: Medium · Effort: Low · **Glasses-side feasible.** *Validation: keep as-is.* `onDeviceStatusChanged` is already subscribed (`bridge.ts:201`) but only updates the phone dot. On a `Disconnected → Connected` transition, dispatch the existing refresh path. **Recommend merging with N3** into one "device-status reactions" handler since both live in that same callback. Touches: `bridge.ts` (transition detection) → existing `refresh`/`fetch-pois` effect.

**N3 — Battery-aware minimap degradation.** Value: Medium · Effort: Low · **Glasses-side feasible.** *Validation: keep, merge with N2.* `DeviceStatus.batteryLevel` confirmed available. Below 20%, skip tile fetch in the minimap encode path and fall back to the fitBounds black-canvas route, plus a "⚡Low" marker in the nav header (`render.ts`). One nuance the review didn't note: also consider gating the IMU/audio subscriptions (N1/N9/N13) off at low battery, since `imuControl`/`audioControl` keep hardware sensors running. Touches: `bridge.ts` (battery threshold state) → `minimap.ts` / `render.ts`.

**N4 — "Search near this POI" pivot.** Value: Medium · Effort: Medium · **Glasses-side feasible.** *Validation: strongly endorsed — independently surfaced by Gaia GPS's "tap a POI to find nearby."* Add a "Search Nearby" action on `POI_ACTIONS` that re-runs `fetch-pois` with the POI's lat/lng as origin instead of the user's. API already accepts arbitrary lat/lng (same path manual-location uses). Touches: `state.ts` (new action + transition from `POI_ACTIONS`), `effects.ts` (`runFetchPois` origin override), `render.ts` (action label). Reuses the manual-location origin plumbing that just landed in v1.9.

**N5 — Recent-history tab on phone.** Value: Medium · Effort: Medium · **Phone-side only.** *Validation: keep.* Last 10–15 navigated-to POIs in a new `wander_nav_history` storage key, shown as a 4th tab. No glasses constraints apply (full React/Tailwind). Pairs naturally with N6. Touches: `src/phone/tabs/` (new tab), `storage.ts`, write on nav-start in `state.ts`/`App.tsx`.

**N6 — Favorites quick-navigate from phone.** Value: Medium (was Low) · Effort: Low · **Phone-side only (triggers glasses flow).** *Validation: bump value up.* Now that v1.9 made phone POI rows tappable (F2) and the manual-location CustomEvent bridge exists, the marginal cost of a "→ Navigate" button on Saved/Recent rows is tiny and it gives the phone a real job. Dispatch a `broadcast-navigate` CustomEvent that `bridge.ts` maps to the existing `fetch-route` → `NAV_ACTIVE` path. Touches: `FavoritesTab.tsx`, `App.tsx`, `bridge.ts`.

**N7 — Quick-settings shortcut on glasses.** Value: Medium · Effort: Medium · **Glasses-side feasible.** *Validation: keep; align with Meta's category-chip swipe.* A long/double-press from `POI_LIST` opens a `QUICK_SETTINGS` screen with the 2–3 most-used toggles (radius ±, "food only" / category cycle). Stay within the 12-container budget and the single-`isEventCapture` rule. Touches: new screen in `screens/types.ts`, `state.ts` (transitions + toggle actions writing the same storage keys Settings uses), `render.ts`.

**N8 — Walking ETA from actual route distance.** Value: Medium (was Low) · Effort: Low · **Glasses-side feasible.** *Validation: re-prioritize UP — accurate ETA is table stakes (Apple Watch, Citymapper, Garmin all do route-distance ETA).* Use `screen.route.totalDistanceMeters` decremented as steps complete, instead of straight-line haversine to destination. Eliminates the jarring "ETA jumps up when I round a corner" bug. Touches: `render.ts:navBodyText`, optionally `state.ts` to track completed-step distance. Low risk, visible polish — worth doing early.

### New recommendations (N9–N15)

**N9 — Proactive "nearby landmark" nudge (the flagship idea).** Value: **High** · Effort: Medium–High · **Glasses-side feasible.**
*Inspired by:* Google Field Trip's proactive geo-cards + VoiceMap's walk-past-and-it-triggers mechanic (reframed to text because the **G2 has no speaker**). This is the strategic centerpiece: it turns Wander from "pull" (user opens app, searches) into "push" (Wander tells you when something good is near), which is the entire reason a glanceable wearable exists and is the one thing the first-party Navigate app doesn't do.
*Behavior:* While the user is walking (and not already navigating), monitor `watchPosition`. When they come within ~80 m of a cached high-quality POI they haven't been nudged about, briefly surface a one-line card: `"Flatiron Building — 60 m left ↖"`. Single tap opens `POI_DETAIL`; ignore and it auto-dismisses.
*Field Trip's failure mode is the spec:* must be (1) **rate-limited** (e.g. ≤1 nudge / 3 min), (2) **deduplicated** via a `nudgedIds` set so the same POI never re-fires, (3) **quality-gated** to POIs with a real Wikipedia article, and (4) **muteable** (reuse the existing category toggles + a master "Proactive nudges" Settings switch). Lower priority while actively in `NAV_ACTIVE`/`WIKI_READ`.
*Touches:* `effects.ts` (geofence check inside the existing `watchPosition` callback — no new sensor needed), `state.ts` (new `nearby-nudge` action + a transient `POI_NUDGE` overlay or a flagged `POI_LIST` banner; track `nudgedIds`), `render.ts` (compact card), `SettingsTab.tsx` + `screens/types.ts` (master toggle, default off for the spam-averse). Server unaffected — uses the already-fetched POI cache.

**N10 — "Up Ahead": POIs along the active route.** Value: **High** · Effort: Low–Medium · **Glasses-side feasible.**
*Inspired by:* Garmin Fenix "Up Ahead" (upcoming course points on a tiny screen).
*Behavior:* During `NAV_ACTIVE`, in addition to the destination, show the next POI the user will physically pass: `"Up ahead: City Library — 120 m"`. Optionally a tiny list of the next 1–3.
*Why it's cheap:* Wander already holds the route polyline (used by the minimap) and a categorized POI list. The only new logic is a geometric filter: POIs whose perpendicular distance to the *remaining* route is below a threshold, ordered by along-route distance. No new SDK calls, no server work.
*Touches:* `state.ts` or a small helper in `navigation/` (compute up-ahead set when route + POIs are both present), `render.ts` (one extra line/section in the nav layout — watch the container budget), reuses `geo.ts`. Synergizes with N9 (same proximity primitive) and with N8 (route-distance reasoning).

**N11 — Off-route / wrong-turn alert.** Value: Medium · Effort: Medium · **Glasses-side feasible.**
*Inspired by:* AllTrails+ "alerts for wrong turns"; Apple Watch arrival/leg buzzes (visual analog since no haptics).
*Behavior:* During `NAV_ACTIVE`, if live position diverges from the route polyline beyond a threshold (e.g. >40 m for >15 s), show a `"Off route — recalculating"` banner and trigger a reroute via the existing route-fetch effect.
*Touches:* `state.ts` (divergence detection in the `position-updated` handler, reusing `geo.ts` haversine-to-polyline), `effects.ts` (reroute call — same path as initial `fetch-route`), `render.ts` (banner). Caveat: only attempt reroute when connected (tie into N2/N3 status state) — don't thrash on a flaky GPS fix.

**N12 — Single-glance `NAV_ACTIVE` reduction + pre-turn alert.** Value: Medium · Effort: Low–Medium · **Glasses-side feasible.**
*Inspired by:* Citymapper Go ("just the piece of info relevant right now") + Apple Watch pre-turn taps.
*Behavior:* Demote the nav screen to its single most useful element at any moment — large next instruction + distance-to-next-turn — and add a transient **"Turn left in 50 ft ←"** pre-alert state as the user approaches a maneuver, instead of always showing the full instruction+ETA+minimap+arrow stack. Keep the minimap reachable but secondary.
*Touches:* `render.ts` (layout pass on `NAV_ACTIVE`), `state.ts` (a `proximityToNextStep` derived value to flip into the pre-alert sub-state). Pairs with N8 (ETA) and N10 (up-ahead) for a coherent nav rework. Lowest-risk way to align with what Apple/Citymapper users already expect.

**N13 — Voice POI search / "what's near me?" via the microphone.** Value: Medium · Effort: **High** · **Glasses-side feasible (input only).**
*Inspired by:* Meta Ray-Ban voice queries and Even's own `audioControl` + the `asr` template in `evenhub-templates`.
*Behavior:* A push-to-talk gesture starts `audioControl(true)`; PCM is streamed (to the phone/server) for speech-to-text, parsed into a category/place query, and run through the existing `fetch-pois`. Lets a hands-full user say "coffee near me" instead of tapping through categories.
*Reality check:* This is the **highest-effort** item here — it needs a PCM→ASR pipeline (the SDK only hands you raw 16 kHz mono PCM; recognition is on you, likely server-side) plus intent parsing. Distinct from Meta's "what am I **looking at**" (that's camera — rejected). Recommend treating as an exploratory spike, not a near-term commit. Touches: `bridge.ts`/`effects.ts` (audio capture + streaming), a new server route for ASR/intent, then the normal fetch path. Mind battery (N3) — leaving the mic open is costly.

**N14 — Phone-side audio walking tour (companion-only).** Value: Medium · Effort: Medium · **Phone-side only.**
*Inspired by:* VoiceMap / GPSmyCity / Detour — but moved to the phone **because the G2 has no speaker.**
*Behavior:* In the phone companion (full-color WebView, has audio out), add an optional "Read aloud" / mini audio-tour mode: as the user walks a sequence of nearby POIs, the phone narrates the Wikipedia summary via the device's `SpeechSynthesis` (TTS) while the glasses show the matching text card (N9) and minimap. Best of both: glasses are the glanceable HUD, phone is the optional narrator.
*Touches:* `src/phone/` only (a player component + TTS via Web Speech API; reuses the wiki summaries already fetched). Zero glasses-display constraints. Natural extension of N5 (history) and N9 (proximity triggers).

**N15 — "Around Me" zero-tap summary widget / Dashboard surface.** Value: Medium · Effort: Low–Medium · **Glasses-side feasible.**
*Inspired by:* Even's own **Dashboard** ("your day at a glance") + Garmin "Around Me" expectation.
*Behavior:* A top-level, zero-drill-down view answering "what's around me right now?" — e.g. the single closest POI per enabled category as a compact list (`"☕ Cafe 40 m · 🏛 Museum 200 m · 🌳 Park 90 m"`). This is the "two-second glance is the complete interaction" surface the Even Hub design thesis rewards, sitting *above* the existing list→detail→actions flow rather than replacing it.
*Touches:* `state.ts` (derive the per-category nearest from the existing POI list — no fetch), `render.ts` (new compact layout, mind the 8-text/4-image container cap and Unicode glyph use per the design guidelines), `screens/types.ts` (new `AROUND_ME` screen or make it the default landing for `POI_LIST`). Reuses `even-toolkit`'s pixel-art icon set for category glyphs.

---

## Suggested Roadmap for v1.10+

Sequenced by value ÷ effort, with dependencies — **not** by severity (these are all net-new features). Group into three releases:

**v1.10 — "Push, not pull" (the strategic leap + cheap polish).**
1. **N8** (route-distance ETA) — tiny, fixes a visible glitch, unblocks clean nav reasoning for N10/N12. Do first.
2. **N2 + N3 merged** (device-status reactions: reconnect-refresh + battery-aware minimap) — one small handler, both Low effort, both off the already-subscribed `onDeviceStatusChanged`.
3. **N10** (Up Ahead) — High value, Low–Medium effort, pure reuse of route + POI data; ships the "glanceable nav" story.
4. **N9** (proactive nudge) — the flagship; Medium–High effort but it's the differentiator vs. the first-party Navigate app. Default the master toggle **off**; ship it after N10 so the proximity primitive is already proven.

**v1.11 — "Better navigation + phone gets a job."**
5. **N12** (single-glance nav + pre-turn alert) — builds on N8/N10.
6. **N11** (off-route alert + reroute) — depends on N2/N3 connection state to avoid thrash.
7. **N5 + N6** (Recent tab + quick-navigate) — phone-only, no display risk, makes the companion useful; N6 reuses F2's tappable rows.
8. **N4** (search near this POI) — reuses v1.9's manual-location origin plumbing.

**v1.12 — "Glanceable surfaces + input experiments."**
9. **N15** (Around Me / Dashboard widget) — leans into the Even Hub design thesis.
10. **N7** (glasses quick-settings) — convenience; medium effort, container-budget care.
11. **N1** (IMU head-tilt scroll) — ship opt-in, after the redesigned debounced/gated state machine is field-tested; it's polish, not a dependency.
12. **N14** (phone audio tour) — phone-only nice-to-have; pairs with N9.
13. **N13** (voice search) — spike first; commit only if the ASR pipeline proves reliable and battery-acceptable.

**Rationale for ordering:** N8 and N2/N3 are near-free and de-risk everything after them. N10 then N9 deliver the strategic "proactive/glanceable" repositioning while reusing existing data (route + POI cache) — maximal value for minimal new infrastructure. Navigation depth (N11/N12) and phone enrichment (N5/N6) follow once the proximity/route primitives are solid. The genuinely new-infrastructure or divisive items (N13 voice, N1 IMU) are last because they carry the most uncertainty.

---

## Explicitly-Rejected Ideas

Common in the wearable/discovery/navigation space, but ruled out by a specific G2 constraint. Documented so they aren't re-proposed without re-deriving the blocker.

| Idea (and where it's common) | Blocking constraint |
|---|---|
| **Camera "what am I looking at?" landmark ID** — Meta Ray-Ban "Look and Ask," the flagship hands-free discovery feature | **G2 has no camera.** The SDK explicitly exposes none. No scene capture, no visual landmark recognition, no AR object tagging is possible on this hardware. |
| **On-glasses narrated audio tours** — VoiceMap, GPSmyCity, Detour | **G2 has no speaker / no audio output** (confirmed by SDK docs and product reviews). Audio narration can only live on the phone companion → see **N14**, which is the salvageable version. |
| **Haptic turn-by-turn taps** — Apple Watch Maps (low/high tone = left/right), Citymapper "taps your wrist for your stop" | **G2 exposes no haptic/vibration actuator.** The *principle* (a pre-turn alert) survives as a **visual** pre-alert → **N12**; the haptic modality does not. |
| **See-through AR route arrows / overlays painted onto the world** — Meta Ray-Ban Display "directions overlaying your view," AR pin overlays | **G2 is not a camera-passthrough or world-locked AR display.** It's a fixed 576×288, 4-bit greyscale heads-up panel with absolute-positioned containers — no spatial anchoring, no per-pixel world overlay. A 2D minimap (which Wander has) is the correct analog. |
| **Color-coded category pins / heatmaps** — every color maps app | **4-bit greyscale only (16 shades of green), no background fill, no color.** Categories must be distinguished by Unicode glyph/icon or label, not color. |
| **Smooth animated map pan/zoom, momentum scrolling** — phone maps, Garmin EPIX | **No animations and no programmatic scroll-position API** in the SDK. List movement is discrete cursor steps (the existing `onCursorMove`); the minimap is a static re-rendered image, not an animatable canvas. |
| **BLE-beacon indoor proximity content** — museum guides (Locatify, STQRY) | **SDK exposes no direct Bluetooth access.** Outdoor GPS geofencing via `watchPosition` is the supported substitute and is what **N9** uses; indoor beacon triggering is not available. |
| **Eye-tracking / hand-tracking gaze or pinch selection** — Vision Pro, hand-tracked XR | **No eye tracking, no hand/finger tracking on G2.** Input is touch/temple, the R1 ring, and head/IMU gestures only. Selection stays gesture-driven. |
| **Rich typography for emphasis (bold "OPEN NOW", big destination name)** | **Single baked-in LVGL font; no bold/italic/size/alignment control.** Emphasis must come from layout/position and Unicode symbols, not type styling. |

---

## Sources

Smart glasses / platform:
- [Even Realities Even Hub launch (Digital Trends)](https://www.digitaltrends.com/wearables/even-realities-launches-even-hub-to-turn-g2-smart-glasses-into-a-full-app-ecosystem/)
- [Even Realities G2 / Even Hub design thesis (Next Reality)](https://virtual.reality.news/news/even-realities-even-hub-launches-can-constrained-smart-glasses-build-an-app-ecosystem/)
- [Even G2 built-in app set (John Rose Eyecare)](https://johnroseeyecare.co.uk/2026/04/23/even-realities-g2-even-hub-the-open-app-store-powering-the-next-era-of-smart-glasses/)
- [even-g2-notes community repo](https://github.com/nickustinov/even-g2-notes)
- [even-toolkit](https://github.com/fabioglimb/even-toolkit) · [evenhub-templates](https://github.com/even-realities/evenhub-templates)
- [Meta Ray-Ban Display pedestrian navigation (Meta)](https://www.meta.com/help/ai-glasses/728826956444153/)
- [Meta Ray-Ban "Look and Ask" / walking tour (TechRadar)](https://www.techradar.com/computing/virtual-reality-augmented-reality/metas-ray-ban-smart-glasses-are-becoming-ai-powered-tour-guides)
- [Even Realities G2 has no speaker (TechEBlog)](https://www.techeblog.com/even-realities-g2-smartglasses-specs-price-release-date/)

Minimal-wearable / navigation:
- [Citymapper on Apple Watch (Citymapper / Medium)](https://medium.com/citymapper/citymapper-on-apple-watch-843c3e757f58)
- [Apple Watch Maps haptic turn-by-turn (Apple Support)](https://support.apple.com/guide/watch/get-directions-apdea7480950/watchos)
- [Garmin "Up Ahead" feature (Garmin Support)](https://support.garmin.com/en-US/?faq=lQMibRoY2I5Y4pP8EXgxv7)

POI discovery / audio tours:
- [Google Field Trip (Wikipedia)](https://en.wikipedia.org/wiki/Field_Trip_(application))
- [Field Trip proactive notifications (AllThingsD)](https://allthingsd.com/20120927/notifications-as-a-platform-googles-new-field-trip-app-pushes-fun-local-facts/)
- [VoiceMap GPS-triggered audio tours](https://voicemap.me/)
- [GPSmyCity / self-guided tours overview (Gamana)](https://www.gamana.app/blog/best-tour-guide-apps-for-travelers)
- [AllTrails hands-free wearable trail experience](https://www.alltrails.com/press/alltrails-updates-hands-free-trail-exploration-for-millions-of-members)
- [Gaia GPS POI / waypoint capabilities](https://www.territorysupply.com/alltrails-vs-gaia-gps)
- [Museum proximity-beacon guides (Locatify)](https://locatify.com/how-bluetooth-beacons-transform-smart-tourism/)

SDK capability ground-truth: `everything-evenhub:device-features` skill (audio/IMU/device-status APIs and the explicit "no speaker / no camera / no scroll-position / no animations" list).
