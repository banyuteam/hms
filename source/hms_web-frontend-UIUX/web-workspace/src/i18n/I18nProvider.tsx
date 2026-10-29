import { useEffect, type ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import en from './messages/en.json';
import id from './messages/id.json';
import { useLocaleStore } from './localeStore';
import type { Locale } from './locales';

export const MESSAGES: Record<Locale, Record<string, string>> = { id, en };

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <IntlProvider
      locale={locale}
      defaultLocale="en"
      messages={MESSAGES[locale]}
      onError={(err) => {
        // Missing keys must be loud in dev/tests, never silent (CI also checks catalog parity).
        if (import.meta.env.DEV) console.error(err.message);
      }}
    >
      {children}
    </IntlProvider>
  );
}
