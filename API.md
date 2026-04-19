# Wander API

Serverless endpoints backing the Wander G2 app. All routes are plain HTTP
GETs, return JSON, and set appropriate edge-cache headers. Base URL in
production: `https://wander-laolao91s-projects.vercel.app`.

## Conventions

- **Coordinates:** All lat/lng pairs are WGS84 decimal degrees. Wander
  uses `[lat, lng]` order throughout its own data, even though upstream
  ORS and GeoJSON use `[lng, lat]` internally — we flip at the edge.
- **Distances:** Server returns both meters (integer) and miles (2dp).
- **Language:** Every endpoint accepts an optional `?lang=` query param.
  Fallback order: query param → `Accept-Language` header → `en`. Regional
  subtags like `fr-CA` are stripped to the base code. All responses set
  `Vary: Accept-Language`.
- **Errors:** Non-2xx responses are JSON of shape
  `{ "error": "description", "detail"?: "..." }`. 4xx = client problem,
  5xx = upstream/infra problem.

---

## GET `/api/health`

Liveness probe.

**Response 200**
```json
{
  "ok": true,
  "app": "wander",
  "version": "1.0.0",
  "phase": 1,
  "now": "2026-04-18T19:44:39.785Z"
}
```

---

## GET `/api/poi`

Fetches and merges nearby points of interest from Wikipedia GeoSearch
and OpenStreetMap Overpass. Deduplicated, distance-sorted, filtered by
category. Returns at most 20 results.

**Query params**

| Name | Type | Default | Notes |
|---|---|---|---|
| `lat` | number | required | WGS84 latitude |
| `lng` | number | required | WGS84 longitude |
| `radius` | number | `0.75` | Miles. Clamped to `[0.1, 1.5]`. |
| `categories` | CSV | `landmark,park,museum,religion,food` | See category list below. |
| `lang` | string | `en` | Base ISO 639-1 code for Wikipedia content. |

**Categories and icons** (icons are single-codepoint glyphs the glasses can render)

| Category | Icon | Sources |
|---|---|---|
| `landmark` | ★ | Wikipedia (any geo-tagged article) |
| `park` | ■ | OSM `leisure=park|garden|nature_reserve` |
| `museum` | ▲ | OSM `tourism=museum|gallery`, `amenity=arts_centre` |
| `religion` | † | OSM `amenity=place_of_worship` |
| `art` | ○ | OSM `tourism=artwork` |
| `library` | ◉ | OSM `amenity=library` |
| `food` | ◆ | OSM `amenity=restaurant|cafe|fast_food` |
| `nightlife` | ● | OSM `amenity=bar|pub|nightclub` |

**Response 200** — array of POI objects

```json
[
  {
    "id": "wiki_1359783",
    "name": "Tour Eiffel",
    "category": "landmark",
    "categoryIcon": "★",
    "lat": 48.858296,
    "lng": 2.294479,
    "distanceMeters": 12,
    "distanceMiles": 0.01,
    "bearingDegrees": 188,
    "walkMinutes": 1,
    "wikiTitle": "Tour_Eiffel",
    "wikiSummary": "La tour Eiffel est une tour autoportante...",
    "websiteUrl": "https://fr.wikipedia.org/wiki/Tour_Eiffel",
    "source": "wikipedia"
  }
]
```

- `source`: `"wikipedia" | "osm"`. Wikipedia wins on dedupe ties.
- `bearingDegrees`: 0° = north, clockwise.
- `walkMinutes`: computed at ~5 km/h (80 m/min), minimum 1.
- `wikiTitle` / `wikiSummary` are `null` for OSM-only results.
- `websiteUrl` can come from Wikipedia or OSM `website`/`contact:website`/`url` tags; `null` if none.

**Dedupe rule:** two results collapse if within 25m AND their names are
similar (identical after normalization, one contains the other, or they
share a 6-char prefix). Wikipedia wins ties.

**Caching:** `s-maxage=60, stale-while-revalidate=300`.

**Reliability notes**

- Overpass is chronically flaky. We race all three mirrors (Kumi, main,
  private.coffee) in parallel via `Promise.any` and keep the first one
  that returns parseable JSON. Per-mirror fetch timeout is 12s, with a
  5s server-side `timeout` in the Overpass query itself. We detect HTML
  error pages returned at HTTP 200 (the common "server too busy" case)
  by checking whether the response body starts with `<` before parsing
  JSON. If all three mirrors fail, the endpoint returns Wikipedia-only
  results rather than erroring out.
- Wikipedia GeoSearch radius is capped upstream at 10km; our max radius
  of 1.5mi (~2.4km) stays well under that.

---

## GET `/api/wiki`

Fetches a Wikipedia article as plain text paginated to ~380-char pages
at word boundaries. Sized for the G2 WIKI_READ screen.

**Query params**

| Name | Type | Default | Notes |
|---|---|---|---|
| `title` | string | required | URL-encoded Wikipedia page title. Spaces or underscores both OK. |
| `lang` | string | `en` | Wikipedia subdomain (`en`, `fr`, `ja`, etc.). |

**Response 200**
```json
{
  "title": "Tour Eiffel",
  "summary": "La tour Eiffel est une tour...",
  "pages": ["page 1 text...", "page 2 text...", "..."],
  "totalPages": 7,
  "lang": "fr"
}
```

- `summary`: short lead (from REST summary endpoint) or page 1 if unavailable.
- `pages[i]` is at most 380 chars, broken at paragraph > sentence > word boundaries.
- Em dashes (`—`), en dashes (`–`), and ellipses (`…`) are normalized to
  ASCII equivalents the G2 font can render.

**Response 404** — article doesn't exist in the requested language:
```json
{ "error": "Article not found", "title": "...", "lang": "fr" }
```

**Caching:** `s-maxage=3600, stale-while-revalidate=86400`.

---

## GET `/api/route`

Proxies OpenRouteService `/v2/directions/foot-walking` with a trimmed
response shape. ORS API key lives in Vercel env only.

**Query params**

| Name | Type | Default | Notes |
|---|---|---|---|
| `fromLat` | number | required | |
| `fromLng` | number | required | |
| `toLat` | number | required | |
| `toLng` | number | required | |
| `lang` | string | `en` | ORS-supported only: en, de, es, fr, gr, he, hu, id, it, ja, ne, nl, nb, pl, pt, ro, ru, tr, zh, cz. Unsupported falls back to `en`. |

**Response 200**
```json
{
  "totalDistanceMeters": 432,
  "totalDurationSeconds": 328,
  "steps": [
    {
      "instruction": "Head north on Rue de la Bourdonnais",
      "distanceMeters": 120,
      "durationSeconds": 90,
      "maneuverType": "depart",
      "street": "Rue de la Bourdonnais"
    }
  ],
  "geometry": [[48.858, 2.294], [48.859, 2.295]],
  "language": "en"
}
```

- `maneuverType`: one of `depart`, `arrive`, `turn-left`, `turn-right`,
  `sharp-left`, `sharp-right`, `slight-left`, `slight-right`, `straight`,
  `keep-left`, `keep-right`, `u-turn`, `enter-roundabout`, `exit-roundabout`.
- `geometry`: `[lat, lng]` pairs (flipped from ORS's `[lng, lat]`).
- `street`: `null` when ORS doesn't know the street name.

**Caching:** `no-store` (route response is user-position-specific).

**Errors**

- 400: missing/non-finite coordinates
- 404: no foot route found between the two points
- 500: server missing `ORS_API_KEY`
- 502: ORS upstream failure

---

## Running tests

```bash
npm test         # one-shot
npm run test:watch
```

Tests cover pure helpers (language resolution, text pagination, text
cleaning). Network-touching code is tested against the live deploy via
`curl` — see the verification steps in `CHANGELOG.md` per phase.

## Environment variables

| Name | Required for | Notes |
|---|---|---|
| `ORS_API_KEY` | `/api/route` | OpenRouteService API key. Vercel env only — never exposed to the client. |

---

*Contract version matches `app.json` → `version`. Breaking changes bump
the major and are noted in `CHANGELOG.md`.*
