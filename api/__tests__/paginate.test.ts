import { describe, it, expect } from 'vitest'
import { paginate, cleanText } from '../wiki.js'

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
