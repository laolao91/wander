# Wander

**Your city, explained — hands-free on your EvenRealities G2 glasses.**

Wander turns any walk into a guided exploration. It detects what's around you, tells you what it is, and walks you there — all without touching your phone. Point of interest discovery, Wikipedia context, and turn-by-turn navigation, rendered directly on your G2 display.

---

## Test on Real Glasses

Scan this QR code with the EvenHub app to load Wander directly on your G2:

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=https://wander-six-phi.vercel.app&bgcolor=ffffff&color=000000&margin=10" alt="Wander QR Code" width="220"/>
  <br/>
  <a href="https://wander-six-phi.vercel.app">https://wander-six-phi.vercel.app</a>
</p>

---

## What Wander Does

You open it. It finds your location and shows you a ranked list of what's nearby — landmarks, parks, museums, restaurants, hidden historical gems. You scroll through the list on your glasses, tap anything to learn more, and tap again to start walking there.

No phone in your hand. No map to stare at. Just your surroundings, annotated.

---

## Use Cases

**Exploring a new city**
Land in an unfamiliar neighborhood and instantly see what's within walking distance, with Wikipedia context for everything you pass. Wander is built for the curious traveler who wants to understand a place, not just photograph it.

**Walking tours, self-guided**
Stroll through a historic district and let Wander surface the stories behind the buildings you're already looking at. Tap anything for a full Wikipedia article. Navigate to the next stop without pulling out your phone.

**Daily commute detours**
Find out what's on that block you walk past every day. Wander refreshes its POI list in the background every 5 minutes, so if you take a different route, results update automatically.

**Traveling without a guide**
Wander works in any language. Change the display language and all Wikipedia summaries, walking instructions, and POI names localize automatically — useful anywhere in the world where English isn't the default.

---

## Features

**📍 Nearby Discovery**
Wander merges Wikipedia GeoSearch and OpenStreetMap into a single list, sorted by walking distance. Landmarks, parks, transit hubs, restaurants, cafes — up to 20 results, deduped so you never see the same place twice.

**🗺️ Turn-by-Turn Navigation**
Select any POI and get walking directions on your glasses. A live minimap in the corner of the display shows your position relative to the route, updating as you move.

**📖 Wikipedia On-Glasses**
Every landmark and point of interest links to its Wikipedia article. Wander paginates the text into readable chunks so you can flip through it with a scroll gesture, without pulling out your phone.

**🔄 Background Refresh**
The POI list updates silently every 5 minutes. If you're mid-detail on a POI when the refresh lands, Wander holds the new list and applies it when you navigate back — so your reading is never interrupted.

**🌍 Multilingual**
Set your preferred language and Wander routes all Wikipedia content, walking instructions, and place names to the matching locale. Supports any language Wikipedia covers.

**⚡ Fully Hands-Free**
Three gestures cover everything: scroll up, scroll down, tap. Double-tap goes back. The entire app is navigable without touching your phone after launch.

**📱 Phone Companion**
The companion app shows nearby POIs grouped by category with live distance, a refresh bar with accurate "updated X min ago" timing, and a neighbourhood label in the header (e.g. "Upper West Side") resolved via reverse geocoding. A connection status dot shows whether your G2 is paired. Settings — search radius and category filters — sync to the glasses instantly without a restart.

---

## How It Works

```
Your location (GPS)
        ↓
  /api/poi — Wikipedia GeoSearch + OpenStreetMap, merged & ranked
        ↓
  POI_LIST on your G2 — scroll to browse
        ↓
  Tap a POI → POI_DETAIL — summary, distance, action menu
        ↓
  Navigate → /api/route (OpenRouteService)
        ↓
  NAV_ACTIVE — step instructions + live canvas minimap
```

Wikipedia articles load via `/api/wiki` and are paginated at word boundaries so nothing gets cut off mid-sentence.

---

## Glasses UX

Eight screens, three gestures:

| Screen | What you see |
|---|---|
| `LOADING` | Splash while the first POI fetch runs |
| `POI_LIST` | Scrollable list of nearby spots with icon, name, and distance |
| `POI_DETAIL` | Name, distance, walk time, Wikipedia summary, action menu |
| `NAV_ACTIVE` | Turn-by-turn step + remaining distance + live minimap |
| `WIKI_READ` | Paginated Wikipedia article, page X of N |
| `ERROR_LOCATION` | GPS unavailable — tap to retry |
| `ERROR_NETWORK` | Network failure — tap to retry |
| `ERROR_EMPTY` | No POIs found nearby |

**Controls:**
- **Scroll up / down** — move cursor through a list or action menu
- **Single tap** — select the highlighted item
- **Double tap** — back (or exit the app from top-level screens)

---

## API Endpoints

All endpoints are Vercel Serverless Functions. Base URL: `https://wander-six-phi.vercel.app`

| Endpoint | Params | Description |
|---|---|---|
| `GET /api/health` | — | Health check, returns `{"ok":true}` |
| `GET /api/poi` | `lat`, `lng`, `lang?`, `categories?` | Nearby POIs (Wikipedia + OSM merged) |
| `GET /api/wiki` | `title`, `lang?` | Wikipedia article with 380-char pagination |
| `GET /api/route` | `fromLat`, `fromLng`, `toLat`, `toLng`, `lang?` | Walking directions (ORS foot-walking) |
| `GET /api/geocode` | `lat`, `lng` | Reverse geocode to neighbourhood label (Nominatim) |

All endpoints set `Vary: Accept-Language` for correct edge caching.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite + React 19 + TypeScript + Tailwind v4 |
| Backend | Vercel Serverless Functions (TypeScript) |
| Glasses SDK | `@evenrealities/even_hub_sdk` 0.0.10 |
| POI data | Wikipedia GeoSearch API + Overpass/OSM |
| Routing | OpenRouteService foot-walking profile |
| Minimap | HTML Canvas → PNG → SDK `updateImageRawData` |
| Tests | Vitest — 267 unit tests |

---

## Project Structure

```
api/
  health.ts          # Health check
  poi.ts             # POI discovery (Wikipedia + OSM merge)
  wiki.ts            # Wikipedia article fetch + pagination
  route.ts           # ORS walking directions proxy
  geocode.ts         # Reverse geocode → neighbourhood label (Nominatim)

src/glasses/
  state.ts           # Pure reducer — all app logic lives here
  render.ts          # Screen → SDK container objects
  effects.ts         # Side-effect runner (GPS, fetch, openUrl)
  bridge.ts          # SDK wiring — boot, event translation, screen push
  minimap.ts         # Canvas minimap geometry + PNG encoding
  api.ts             # Typed API client wrappers
  screens/types.ts   # Discriminated union for the 8 screen variants

src/phone/
  App.tsx            # Companion app root — layout, effects, G2 status dot
  state.ts           # Phone reducer (settings + nearby)
  types.ts           # PhoneState, events, effects, settings types
  storage.ts         # KV store adapter — persists settings + POI cache
  tabs/
    NearbyTab.tsx    # POI list grouped by category, refresh bar, error states
    SettingsTab.tsx  # Radius slider, category toggles, sync status
```

---

## Local Development

```bash
npm install
npm run dev        # Vite dev server (http://localhost:5173)
npm test           # 122 unit tests via Vitest
npm run typecheck  # TypeScript strict check
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ORS_API_KEY` | Yes | OpenRouteService API key — server-side only, never sent to client |

Copy `.env.example` to `.env.local` and fill in your key for local API testing.

---

## License

MIT
