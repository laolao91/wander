# Changelog

All notable changes to Wander will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Phase 1 scaffold: Vite + React 19 + TypeScript + Tailwind v4
- even-toolkit web components + Even Hub SDK integration stub
- Vercel serverless function skeleton at `api/health.ts`
- `app.json` manifest and project structure per Wander build spec
- **Phase 2a** — `/api/wiki` endpoint: Wikipedia article fetch + 380-char
  pagination at word boundaries (uses Action API `extracts` instead of
  the spec's referenced REST `plain` endpoint — that path does not exist)
- **Phase 2a** — `/api/route` endpoint: OpenRouteService foot-walking
  proxy with simplified step + geometry output tuned for G2 NAV_ACTIVE
- **Phase 2b** — `/api/poi` endpoint: merges Wikipedia GeoSearch
  (via `generator=geosearch`) and Overpass (OSM) into a single,
  deduped, distance-sorted, category-filtered POI list. Dedupe uses
  a 25m radius + name similarity so nearby distinct businesses aren't
  collapsed (tightened from spec's 20m). Wikipedia preferred on ties.
- **Phase 2b** — Overpass mirror fallback: tries Kumi Systems → main →
  private.coffee, with HTML-at-200 detection for the common "server
  too busy" error that previously silently dropped all OSM results.
- **Phase 2c** — Localization across all three public endpoints:
  accept `?lang=` query param, fall back to `Accept-Language` header,
  default to `en`. `/api/wiki` and `/api/poi` route Wikipedia calls
  to the matching language subdomain; `/api/route` passes the locale
  through to ORS for localized walking instructions (falls back to
  English for languages ORS doesn't support). Regional subtags like
  `fr-CA` are stripped to the base code. All responses set
  `Vary: Accept-Language` so edge caches don't cross-contaminate.
