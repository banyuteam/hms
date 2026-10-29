import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import axe from 'axe-core';
import { AppRoutes } from '@/App';
import { useAuthStore } from '@/auth/authStore';
import { AppProviders } from '@/AppProviders';
import { useLocaleStore } from '@/i18n/localeStore';
import { useWindowStore } from '@/workspace/windowStore';

export function resetStores() {
  useAuthStore.setState({ user: null, notice: null });
  useWindowStore.getState().reset();
  useLocaleStore.setState({ locale: 'en' });
}

export function renderApp(route = '/login') {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
}

/** axe-core in jsdom: colour contrast needs real layout/paint, so it is covered by the token contrast table + e2e. */
export async function axeViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}

export function signIn() {
  useAuthStore.setState({
    user: { id: 'demo-user', nameKey: 'user.demo.name', roleKey: 'user.demo.role' },
    notice: null,
  });
}
