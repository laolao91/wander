import { describe, it, expect } from 'vitest'
import { resolveLang } from '../_lib/lang.js'

describe('resolveLang', () => {
  it('returns default when nothing is provided', () => {
    expect(resolveLang(undefined, undefined)).toBe('en')
  })

  it('prefers explicit query param over header', () => {
    expect(resolveLang('ja', 'fr-FR,fr;q=0.9')).toBe('ja')
  })

  it('falls back to Accept-Language when no query param', () => {
    expect(resolveLang(undefined, 'de-DE,de;q=0.9,en;q=0.5')).toBe('de')
  })

  it('strips regional subtags', () => {
    expect(resolveLang('fr-CA', undefined)).toBe('fr')
    expect(resolveLang(undefined, 'pt-BR')).toBe('pt')
  })

  it('is case insensitive', () => {
    expect(resolveLang('FR', undefined)).toBe('fr')
    expect(resolveLang(undefined, 'EN-US')).toBe('en')
  })

  it('rejects malformed codes and falls back to default', () => {
    expect(resolveLang('x', undefined)).toBe('en') // too short
    expect(resolveLang('frenchy', undefined)).toBe('en') // too long
    expect(resolveLang('12', undefined)).toBe('en') // not letters
    expect(resolveLang('../evil', undefined)).toBe('en') // injection attempt
  })

  it('rejects non-string query values safely', () => {
    expect(resolveLang(42, undefined)).toBe('en')
    expect(resolveLang(null, undefined)).toBe('en')
    expect(resolveLang(['fr', 'de'], undefined)).toBe('en')
  })

  it('respects allowedLangs whitelist', () => {
    const allowed = new Set(['en', 'fr', 'de'])
    // Japanese isn't in the allowlist → fall back to default
    expect(resolveLang('ja', undefined, 'en', allowed)).toBe('en')
    // French is → use it
    expect(resolveLang('fr', undefined, 'en', allowed)).toBe('fr')
  })

  it('uses a custom default when supplied', () => {
    expect(resolveLang(undefined, undefined, 'ja')).toBe('ja')
  })

  it('handles q-weighted Accept-Language strings', () => {
    expect(resolveLang(undefined, 'zh-CN;q=0.9,en;q=0.5')).toBe('zh')
  })

  it('handles header as array (some frameworks pass it that way)', () => {
    expect(resolveLang(undefined, ['es-MX,es;q=0.9'])).toBe('es')
  })
})
