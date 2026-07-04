/**
 * Languages offered in the phone Settings picker. Deliberately scoped to
 * exactly the codes api/route.ts's ORS_SUPPORTED_LANGS accepts (not the
 * full open-ended set api/_lib/lang.ts's resolveLang would technically
 * pass through) — every choice here must work end-to-end for
 * navigation, Wikipedia, and POI fetches. Keep in sync with
 * api/route.ts's ORS_SUPPORTED_LANGS if that list ever changes.
 */
export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'gr', label: 'Ελληνικά' },
  { code: 'he', label: 'עברית' },
  { code: 'hu', label: 'Magyar' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'ne', label: 'नेपाली' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'nb', label: 'Norsk' },
  { code: 'pl', label: 'Polski' },
  { code: 'pt', label: 'Português' },
  { code: 'ro', label: 'Română' },
  { code: 'ru', label: 'Русский' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'zh', label: '中文' },
  { code: 'cz', label: 'Čeština' },
]
