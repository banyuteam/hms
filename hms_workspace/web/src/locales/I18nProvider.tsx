import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { formatMessage, type MessageValues } from './icu';
import { DEFAULT_LOCALE, INTL_TAG, MESSAGES, type Locale } from './index';

/** Translate a message id. Missing in the active locale → Indonesian → the id itself (and a console error in dev). */
export type Translate = (id: string, values?: MessageValues) => string;

export interface I18n {
  locale: Locale;
  /** In memory only: the language choice is not persisted (CLAUDE.md §5 persistence policy). */
  setLocale: (locale: Locale) => void;
  t: Translate;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function createTranslator(locale: Locale): Translate {
  return (id, values) => {
    const src = MESSAGES[locale][id] ?? MESSAGES[DEFAULT_LOCALE][id];
    if (src === undefined) {
      // Missing keys must be loud in dev/tests, never silent (the catalog test also checks parity).
      if (import.meta.env.DEV) console.error(`[i18n] missing message "${id}" (${locale})`);
      return id;
    }
    return formatMessage(src, values, INTL_TAG[locale]);
  };
}

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const value = useMemo<I18n>(() => {
    const numberTag = INTL_TAG[locale];
    return {
      locale,
      setLocale,
      t: createTranslator(locale),
      formatNumber: (n, options) => new Intl.NumberFormat(numberTag, options).format(n),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
