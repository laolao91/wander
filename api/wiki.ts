import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveLang } from './_lib/lang.js'
import { applyCors } from './_lib/cors.js'

/**
 * GET /api/wiki?title=<url-encoded wikipedia page title>
 *
 * Returns a Wikipedia article as paginated plain text suitable for the
 * G2 WIKI_READ screen (~380 chars per page, split at word boundaries).
 *
 * Note: WANDER_BUILD_SPEC.md §4 references the REST endpoint
 * /api/rest_v1/page/plain/{title}, but that path does not exist on
 * the Wikipedia REST API. We use the Action API's `extracts` prop
 * with `explaintext=1` instead — that actually returns plain text.
 */

const UA = 'Wander/1.0 (Even Realities G2 companion app; steven.lao30@gmail.com)'
const PAGE_SIZE_CHARS = 380
const FETCH_TIMEOUT_MS = 8000

type SummaryApiResponse = {
  title?: string
  extract?: string
  description?: string
  type?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return

  const rawTitle = req.query.title
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''

  if (!title) {
    res.status(400).json({ error: 'Missing required query param: title' })
    return
  }

  const lang = resolveLang(req.query.lang, req.headers['accept-language'])

  try {
    const [summary, pages] = await Promise.all([
      fetchSummary(title, lang),
      fetchFullExtract(title, lang),
    ])

    if (!pages) {
      res.status(404).json({ error: 'Article not found', title, lang })
      return
    }

    // Short cache — Wikipedia content is stable enough and the glasses app
    // rereads this on every "Read More" tap. Vary by language so cached
    // English doesn't bleed into a French request.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.setHeader('Vary', 'Accept-Language')
    res.status(200).json({
      title: summary?.title ?? title.replace(/_/g, ' '),
      summary: summary?.extract ?? pages[0] ?? '',
      pages,
      totalPages: pages.length,
      lang,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    res.status(502).json({ error: 'Wikipedia fetch failed', detail: msg })
  }
}

async function fetchSummary(title: string, lang: string): Promise<SummaryApiResponse | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  const r = await fetchWithTimeout(url)
  if (!r.ok) return null
  return (await r.json()) as SummaryApiResponse
}

async function fetchFullExtract(title: string, lang: string): Promise<string[] | null> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'plain',
    redirects: '1',
    format: 'json',
    formatversion: '2',
    titles: title,
    origin: '*',
  })
  const url = `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`
  const r = await fetchWithTimeout(url)
  if (!r.ok) return null

  type PageV2 = { title: string; extract?: string; missing?: boolean }
  const data = (await r.json()) as {
    query?: { pages?: PageV2[] | Record<string, PageV2> }
  }

  // formatversion=2 returns pages as an array; fallback handles legacy shape.
  const rawPages = data.query?.pages
  const pageList: PageV2[] = Array.isArray(rawPages)
    ? rawPages
    : rawPages
      ? Object.values(rawPages)
      : []

  const page = pageList[0]
  if (!page || page.missing || !page.extract) return null

  const cleaned = cleanText(page.extract)
  if (!cleaned) return null

  return paginate(cleaned, PAGE_SIZE_CHARS)
}

/**
 * Strip cruft the Wikipedia extracts API occasionally leaves behind
 * (reference markers, empty section headers, orphan whitespace).
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\[\d+\]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*={2,}.*?={2,}\s*$/gm, '')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '..')
    .trim()
}

/**
 * Split text into pages of at most `size` characters, breaking at word
 * boundaries so the G2 display doesn't cut a word in half.
 */
export function paginate(text: string, size: number): string[] {
  if (text.length <= size) return [text]
  const pages: string[] = []
  let cursor = 0

  while (cursor < text.length) {
    let end = Math.min(cursor + size, text.length)
    if (end < text.length) {
      const slice = text.slice(cursor, end)
      // Prefer paragraph break > sentence end > whitespace.
      const paragraphBreak = slice.lastIndexOf('\n\n')
      const sentenceEnd = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
      )
      const space = slice.lastIndexOf(' ')
      if (paragraphBreak > size * 0.5) end = cursor + paragraphBreak + 2
      else if (sentenceEnd > size * 0.5) end = cursor + sentenceEnd + 2
      else if (space > 0) end = cursor + space + 1
    }
    pages.push(text.slice(cursor, end).trim())
    cursor = end
  }

  return pages.filter((p) => p.length > 0)
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}
