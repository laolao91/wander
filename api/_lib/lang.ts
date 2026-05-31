/**
 * Shared language resolution for Wander's API endpoints.
 *
 * The leading underscore on `_lib` tells Vercel not to route this as a
 * serverless function — it's import-only for the sibling endpoints.
 */

const LANG_CODE_RE = /^[a-z]{2,3}$/

/**
 * Resolve a base ISO 639-1 language code from a query param and/or the
 * Accept-Language header, validating the result before returning it.
 * Regional subtags (fr-CA) are stripped to the base (fr). Anything that
 * doesn't match the 2-3 lowercase-letter shape falls through to the default.
 *
 * Priority: query param > header > default.
 *
 * @param queryLang   Value from `req.query.lang` (any type — we validate)
 * @param acceptLanguage  Raw `Accept-Language` header value
 * @param defaultLang  Fallback when nothing resolves (usually 'en')
 * @param allowedLangs Optional whitelist. If provided, a candidate must
 *                     also appear in this set to be accepted. Used by ORS
 *                     where only specific languages are supported upstream.
 */
export function resolveLang(
  queryLang: unknown,
  acceptLanguage: string | string[] | undefined,
  defaultLang = 'en',
  allowedLangs?: ReadonlySet<string>,
): string {
  const candidates: string[] = []
  if (typeof queryLang === 'string' && queryLang.trim()) candidates.push(queryLang)
  const header = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage
  if (header) {
    // First tag only; strip optional q-weight (e.g. "fr;q=0.9").
    const first = header.split(',')[0]?.split(';')[0]?.trim()
    if (first) candidates.push(first)
  }
  for (const c of candidates) {
    const base = c.toLowerCase().split('-')[0]
    if (!LANG_CODE_RE.test(base)) continue
    if (allowedLangs && !allowedLangs.has(base)) continue
    return base
  }
  return defaultLang
}
