#!/usr/bin/env node
// Post-build pre-submission gate: every http/https URL literal in the
// BUILT bundle (dist/assets/*.js) must be covered by app.json's
// network.whitelist. src/__tests__/network-whitelist.test.ts only scans
// hand-authored source — this catches URLs that only appear after
// bundling (e.g. baked into a third-party dependency), which the
// EvenHub store's static scanner checks against the shipped bundle.
// See Wander_v2_Research.md L4.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST_ASSETS = join(ROOT, 'dist', 'assets')

function readAppJsonWhitelist() {
  const raw = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'))
  const networkPerm = raw.permissions?.find((p) => p.name === 'network')
  return networkPerm?.whitelist ?? []
}

function extractUrls(content) {
  const matches = content.match(/https?:\/\/[^\s'"`,)>]+/g) ?? []
  return [...new Set(matches)]
}

function isCovered(url, whitelist) {
  return whitelist.some((entry) => url.startsWith(entry))
}

// react-dom bakes these XML/SVG/MathML namespace URIs into every build
// as literal string identifiers passed to createElementNS/setAttributeNS
// — they are never fetched over the network. Excluded here (not added
// to app.json's whitelist, since they aren't real network endpoints);
// without this exclusion the checker would fail on every single build,
// which defeats its purpose as an automated pre-submission gate.
const KNOWN_NON_NETWORK_URLS = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
])

const whitelist = readAppJsonWhitelist()
const files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'))
const allUrls = files.flatMap((f) => extractUrls(readFileSync(join(DIST_ASSETS, f), 'utf8')))
const uncovered = [...new Set(allUrls)].filter(
  (url) => !isCovered(url, whitelist) && !KNOWN_NON_NETWORK_URLS.has(url),
)

if (uncovered.length > 0) {
  console.error('[check-bundle-whitelist] Uncovered URLs found in built bundle:')
  for (const url of uncovered) console.error(`  ${url}`)
  console.error('\nAdd these to app.json permissions[].whitelist, or confirm they are false positives, before packing.')
  process.exit(1)
}
console.log(`[check-bundle-whitelist] OK — ${allUrls.length} URL(s) found in dist/assets, all covered.`)
