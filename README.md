# Wander

**Discover what's around you — on your EvenRealities G2 glasses.**

Wander surfaces nearby landmarks, parks, museums, and restaurants ranked by walking distance. Tap any spot for a Wikipedia summary and turn-by-turn walking directions, all hands-free on your G2 display.

---

## Test on Real Glasses

Scan this QR code with the EvenHub app to load Wander directly on your G2:

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=https://wander-six-phi.vercel.app&bgcolor=ffffff&color=000000&margin=10" alt="Wander QR Code" width="220"/>
  <br/>
  <a href="https://wander-six-phi.vercel.app">https://wander-six-phi.vercel.app</a>
</p>

---

## Features

- **POI Discovery** — merges Wikipedia GeoSearch and OpenStreetMap into a single distance-sorted list, deduped at 25m radius
- **Walking Directions** — turn-by-turn navigation via OpenRouteService with a live canvas minimap on the glasses display
- **Wikipedia Reader** — paginated article summaries rendered directly on the G2, 380 characters per page
- **Background Refresh** — POI list silently refreshes every 5 minutes so results stay current while you explore
- **Localization** — all three API endpoints respect `?lang=` and `Accept-Language` for non-English speakers

---

## Glasses UX

Eight screens managed by a pure reducer (`reduce(state, event) → { state, effects[] }`):

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
| Tests | Vitest — 122 unit tests |

---

## Project Structure

```
api/
  health.ts          # Health check
  poi.ts             # POI discovery (Wikipedia + OSM merge)
  wiki.ts            # Wikipedia article fetch + pagination
  route.ts           # ORS walking directions proxy

src/glasses/
  state.ts           # Pure reducer — all app logic lives here
  render.ts          # Screen → SDK container objects
  effects.ts         # Side-effect runner (GPS, fetch, openUrl)
  bridge.ts          # SDK wiring — boot, event translation, screen push
  minimap.ts         # Canvas minimap geometry + PNG encoding
  api.ts             # Typed API client wrappers
  screens/types.ts   # Discriminated union for the 8 screen variants
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
