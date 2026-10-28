export const LOCALES = ['id', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'id';
/** Non-PHI browser preference (ADR-0003 Amendment 1: language is saved per browser). */
export const LOCALE_STORAGE_KEY = 'hms.locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Saved choice → browser language if English → Indonesian. Storage access is always guarded. */
export function detectInitialLocale(
  storage: Pick<Storage, 'getItem'> | undefined,
  languages: readonly string[] = [],
): Locale {
  try {
    const saved = storage?.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage blocked (private mode etc.) — fall through */
  }
  const first = languages[0]?.toLowerCase() ?? '';
  return first.startsWith('en') ? 'en' : DEFAULT_LOCALE;
}

export function saveLocale(locale: Locale, storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}
