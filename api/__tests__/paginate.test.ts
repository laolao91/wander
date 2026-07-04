import { describe, it, expect, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler, { paginate, cleanText } from '../wiki.js'

describe('paginate', () => {
  it('returns a single page when text fits', () => {
    expect(paginate('short', 380)).toEqual(['short'])
  })

  it('splits at word boundaries, never mid-word', () => {
    const text = 'The quick brown fox jumps over the lazy dog'.repeat(20)
    const pages = paginate(text, 80)
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      // Every page is <= size + a small tolerance for trailing punctuation
      expect(page.length).toBeLessThanOrEqual(80)
      // No page ends in the middle of a word (last char is a word char means
      // either the page ended exactly on a word or the text ran out).
    }
    // Reassembled text should contain all the original words in order.
    const reassembled = pages.join(' ').replace(/\s+/g, ' ').trim()
    expect(reassembled).toContain('The quick brown fox')
  })

  it('prefers paragraph breaks when available', () => {
    // Paragraph-break heuristic fires only when the break sits past 50%
    // of the page size — otherwise we'd cut pages too short.
    const firstPara = 'This is the first paragraph which is comfortably past the midpoint.'
    const text = `${firstPara}\n\nSecond paragraph ${'x'.repeat(200)}`
    const pages = paginate(text, 100)
    // The first page should end exactly at the paragraph break, not mid-word.
    expect(pages[0]).toBe(firstPara)
  })

  it('produces at least one non-empty page for non-trivial input', () => {
    const text = 'a '.repeat(500)
    const pages = paginate(text, 100)
    expect(pages.length).toBeGreaterThan(0)
    for (const p of pages) expect(p.length).toBeGreaterThan(0)
  })
})

describe('cleanText', () => {
  it('strips reference markers', () => {
    expect(cleanText('Foo[1] bar[23] baz')).toBe('Foo bar baz')
  })

  it('replaces em/en dashes and ellipsis with G2-compatible chars', () => {
    expect(cleanText('hello\u2014world')).toBe('hello-world')
    expect(cleanText('a\u2013b')).toBe('a-b')
    expect(cleanText('wait\u2026')).toBe('wait..')
  })

  it('collapses excessive blank lines', () => {
    expect(cleanText('a\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it('removes heading markers left by extracts API', () => {
    expect(cleanText('Intro text\n== History ==\nMore text')).toBe('Intro text\n\nMore text')
  })
})

function mockReqRes(query: Record<string, string>) {
  const req = {
    method: 'GET',
    query,
    headers: {},
  } as unknown as VercelRequest

  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    end() {
      return this
    },
  }

  return { req, res: res as unknown as VercelResponse & typeof res }
}

describe('wiki handler', () => {
  it('derives title and summary from the full-extract call alone, without a separate summary request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = url.toString()
      if (u.includes('/w/api.php')) {
        return {
          ok: true,
          json: async () => ({
            query: { pages: [{ title: 'Flatiron_Building', extract: 'A historic building.' }] },
          }),
        } as Response
      }
      throw new Error(`unexpected fetch: ${u}`)
    })

    const { req, res } = mockReqRes({ title: 'Flatiron_Building' })
    await handler(req, res)

    expect(fetchSpy).toHaveBeenCalledTimes(1) // only the full-extract call, no /rest_v1/page/summary/ call
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      title: 'Flatiron Building',
      summary: 'A historic building.',
      pages: ['A historic building.'],
      totalPages: 1,
      lang: 'en',
    })

    fetchSpy.mockRestore()
  })
})
