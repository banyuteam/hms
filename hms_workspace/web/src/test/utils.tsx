import { render } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import type { Locale } from '@/locales';
import { demoUser, type AuthState, type Role } from '@/state/auth';

export interface RenderAppOptions {
  /** Signed-in role; omit for a signed-out session. */
  role?: Role;
  locale?: Locale;
}

/** Renders the whole app (providers + routes) at `route`. Tests default to English, like the old suite. */
export function renderApp(route = '/login', { role, locale = 'en' }: RenderAppOptions = {}) {
  const initialAuth: AuthState | undefined = role
    ? { user: demoUser(role), notice: null }
    : undefined;
  return render(
    <AppProviders initialLocale={locale} initialAuth={initialAuth}>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

/** axe-core in jsdom: colour contrast needs real layout/paint, so it is covered by the token contrast table. */
export async function axeViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}
