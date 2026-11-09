/** Test-only helper: renders the whole app and exposes the home state, its actions and the router location. */
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '@/App';
import { AppProviders } from '@/AppProviders';
import { demoUser, type Role } from '@/state/auth';
import { useHome, useHomeActions, type HomeActions, type HomeState } from '@/state/home';

export interface Probe {
  state: HomeState;
  actions: HomeActions;
  pathname: string;
}

export function renderWorkspace(route = '/', role: Role = 'doctor') {
  const probe = {} as Probe;
  function Spy() {
    probe.state = useHome();
    probe.actions = useHomeActions();
    probe.pathname = useLocation().pathname;
    return null;
  }
  const result = render(
    <AppProviders initialLocale="en" initialAuth={{ user: demoUser(role), notice: null }}>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
        <Spy />
      </MemoryRouter>
    </AppProviders>,
  );
  return { ...result, probe };
}
