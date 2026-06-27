/**
 * Pre-submission gate: every http/https URL in the source must be covered by
 * app.json's network.whitelist. The EvenHub store scanner is static, so any
 * URL string in the bundle — including dead code and error-message strings in
 * third-party libraries — triggers a rejection if it isn't whitelisted.
 *
 * Run this before `evenhub pack` to catch the problem early.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'

const ROOT = join(import.meta.dirname, '../..')

function readAppJson(): { whitelist: string[] } {
  const raw = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'))
  const networkPerm = raw.permissions?.find((p: { name: string }) => p.name === 'network')
  return { whitelist: networkPerm?.whitelist ?? [] }
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.html'])
// Only scan frontend source dirs — not backend `api/`, not test files.
// The EvenHub scanner checks the built bundle (dist/), which only contains
// code imported from these locations.
const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'dist', '.git'])
const FRONTEND_ROOTS = ['src', 'index.html']

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full))
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      files.push(full)
    }
  }
  return files
}

function extractUrls(content: string): string[] {
  // Match http/https URLs up to a natural string boundary.
  // Stops at whitespace, quotes, backtick, ), >, or end-of-string.
  const matches = content.match(/https?:\/\/[^\s'"`,)>]+/g) ?? []
  return [...new Set(matches)]
}

function isCovered(url: string, whitelist: string[]): boolean {
  return whitelist.some(entry => url.startsWith(entry))
}

describe('network whitelist pre-submission check', () => {
  const { whitelist } = readAppJson()
  const sourceFiles = FRONTEND_ROOTS.flatMap(rel => {
    const full = join(ROOT, rel)
    return statSync(full).isDirectory() ? collectSourceFiles(full) : [full]
  })
  const allUrls = sourceFiles.flatMap(f => extractUrls(readFileSync(f, 'utf8')))
  const uniqueUrls = [...new Set(allUrls)]
  const uncovered = uniqueUrls.filter(url => !isCovered(url, whitelist))

  it('app.json has a non-empty network whitelist', () => {
    expect(whitelist.length).toBeGreaterThan(0)
  })

  it('every http/https URL in source is covered by network.whitelist', () => {
    expect(uncovered).toEqual([])
  })
})
