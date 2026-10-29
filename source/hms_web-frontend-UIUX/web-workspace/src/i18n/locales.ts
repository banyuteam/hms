export const LOCALES = ['id', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
/** English is the default UI language (product owner, 2026-10-28; ADR-0003 Amendment 3). */
export const DEFAULT_LOCALE: Locale = 'en';
/** Non-PHI browser preference (ADR-0003 Amendment 1: language is saved per browser). */
export const LOCALE_STORAGE_KEY = 'hms.locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Saved choice → English (the default; the browser language is deliberately not used). Storage access is always guarded. */
export function detectInitialLocale(storage: Pick<Storage, 'getItem'> | undefined): Locale {
  try {
    const saved = storage?.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage blocked (private mode etc.) — fall through */
  }
  return DEFAULT_LOCALE;
}

export function saveLocale(locale: Locale, storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}
