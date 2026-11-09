import type { ReactNode } from 'react';
import type { Locale } from '@/locales';
import { I18nProvider } from '@/locales/I18nProvider';
import { AssistantProvider } from '@/state/assistant';
import { AuthProvider, type AuthState } from '@/state/auth';
import { HomeProvider } from '@/state/home';

/** All state is React Context + reducers, in memory only. `initial*` props exist for tests. */
export function AppProviders({
  children,
  initialLocale,
  initialAuth,
}: {
  children: ReactNode;
  initialLocale?: Locale;
  initialAuth?: AuthState;
}) {
  return (
    <I18nProvider initialLocale={initialLocale}>
      <AuthProvider initialState={initialAuth}>
        <HomeProvider>
          <AssistantProvider>{children}</AssistantProvider>
        </HomeProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
