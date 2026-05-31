# Phase 0 — Capture Real-Glasses Event Logs

**Goal:** Get 5–15 lines of `[wander][evt] …` console output from real hardware so Phase 1 bridge fixes are data-driven, not guesses.

**Time required:** ~10–15 minutes.

---

## 1. Deploy the diagnostic build

The `console.log` is already in `src/glasses/bridge.ts`. You just need to push it live.

```bash
cd "/Users/stevenlao/CoworkSandbox/EvenHub_Developer_Submissions/Wander_v1.0"
git status                      # sanity check — you should see bridge.ts modified
git add src/glasses/bridge.ts
git commit -m "Phase 0: add diagnostic event logging"
git push origin main            # Vercel will auto-deploy
```

Wait ~1–2 minutes for Vercel to finish. Verify at <https://wander-six-phi.vercel.app/api/health> (should return 200).

---

## 2. Enable Web Inspector on iPhone (one-time)

On your iPhone:
1. Open **Settings → Apps → Safari → Advanced**
2. Turn **Web Inspector** ON
3. (If hidden: Settings → Apps → Safari → scroll to bottom)

On your Mac:
1. Open **Safari**
2. **Safari menu → Settings → Advanced**
3. Check **"Show features for web developers"**
4. A new **Develop** menu appears in the menu bar

---

## 3. Connect iPhone to Mac

1. Plug the iPhone into the Mac via Lightning/USB-C cable
2. If prompted on the phone, tap **Trust This Computer** and enter passcode
3. Keep the phone unlocked while testing

---

## 4. Open the Wander app on your iPhone

In the **EvenHub app** on your iPhone:
1. Make sure G2 glasses are paired and connected
2. Launch **Wander** (scan QR from `README.md` if not installed)
3. Let it load — you should see the POI list on the glasses

---

## 5. Attach Safari Web Inspector

On your Mac:
1. In Safari, click the **Develop** menu
2. Find your iPhone's name in the list (e.g. "Steven's iPhone")
3. Hover over it — you should see **"Wander"** (or the WebView URL `wander-six-phi.vercel.app`)
4. Click it — Web Inspector opens
5. Click the **Console** tab

You should see existing log lines including `[wander] …` messages. Clear the console (🚫 icon top-left of the inspector) so new events stand out.

---

## 6. Capture events — do each action, watch the console

Perform each action below **one at a time**. After each action, take note of (or screenshot) the resulting `[wander][evt] …` line(s).

> **Important:** If an action produces *zero* `[wander][evt]` lines, that's itself a critical datapoint — write "NO LOG" for that action.

### Actions to perform (in order)

| # | Action on glasses | What to capture |
|---|---|---|
| 1 | **Scroll down** (R1 ring or temple slide) while on POI list | 1 log line |
| 2 | **Scroll up** back to the first POI | 1 log line |
| 3 | **Single-tap** a POI | 1 log line (this is the bug — tap does nothing right now) |
| 4 | **Double-tap** from POI list | 1 log line (should surface exit prompt) |
| 5 | **Scroll down** on CONFIRM_EXIT prompt | 1 log line (should move cursor to "Exit") |
| 6 | **Scroll up** on CONFIRM_EXIT prompt | 1 log line (cursor back to "Stay") |
| 7 | **Single-tap** on CONFIRM_EXIT with cursor on "Stay" | 1 log line (should cancel exit, bug: unresponsive) |
| 8 | (If app still open) **Double-tap** again to try exit | 1 log line |

If you reach POI_DETAIL at any point (the single-tap bug might fix itself intermittently):

| # | Action on glasses | What to capture |
|---|---|---|
| 9 | **Scroll down** on POI_DETAIL | 1 log line (cursor to next action) |
| 10 | **Single-tap** on any action | 1 log line |
| 11 | **Double-tap** from POI_DETAIL | 1 log line (should prompt exit, not go back) |

---

## 7. Copy logs back to me

In Safari's console:
1. Right-click any `[wander][evt]` line
2. Use **Select All** or just drag-select all the `[wander][evt]` lines
3. Copy (⌘C)
4. Paste into the next chat session

Each line looks like:
```
[wander][evt] screen=POI_LIST source=list eventType=0 (undefined=CLICK?) {"listEvent":{"eventType":0,"currentSelectItemIndex":2,...}}
```

The bits I need most:
- `screen=…` (which screen you were on)
- `source=…` (list vs text vs sys)
- `eventType=…` (the raw value — 0, undefined, or an enum number)
- The JSON payload at the end

---

## 8. Also tell me

- **Which actions produced no log at all** (the "NO LOG" cases)
- **Anything that felt wrong** beyond the known bugs — different glyphs rendered, delays, etc.
- **Simulator bonus** (optional): run `npm run simulator` locally and repeat actions 1–4 in the simulator. If you can paste those logs too, it'll let me compare simulator vs real hardware event shapes directly.

---

## 9. Troubleshooting

- **No iPhone under Develop menu**: unlock phone, unplug/replug, make sure Wander WebView is actually open in the foreground
- **No `[wander][evt]` logs at all**: the new build may not have deployed yet — check Vercel dashboard for deploy status, or force-reload the Wander app (kill + relaunch from EvenHub)
- **Console flooded with other stuff**: type `[wander][evt]` in the console filter box to narrow to just these logs

---

## 10. When you're done

Come back with the logs and I'll start Phase 1 (bridge input fixes). The logs tell me exactly what `eventType` shape real hardware sends and which event source (`list` / `text` / `sys`) each screen actually uses.

If anything in this walkthrough is unclear, say which step and I'll rewrite it.
