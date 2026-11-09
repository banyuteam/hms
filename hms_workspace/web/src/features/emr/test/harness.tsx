import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppProviders } from '@/AppProviders';
import { WindowBody } from '@/features/workspace/WindowBody';
import { demoUser, type Role } from '@/state/auth';
import { useHome, useHomeActions, type HomeActions, type HomeState } from '@/state/home';

/**
 * Test harness for the EMR windows: real providers (in-memory state) and every open window rendered through `WindowBody`,
 * without the workspace chrome. The probe exposes the home state and actions so a test can open windows like a user would
 * from Home, and assert on window ids.
 */
const probe: { state: HomeState | null; actions: HomeActions | null } = {
  state: null,
  actions: null,
};

function Probe() {
  probe.state = useHome();
  probe.actions = useHomeActions();
  return null;
}

function Windows() {
  const { windows } = useHome();
  return (
    <>
      {windows.map((w) => (
        <div key={w.id} data-window={w.id}>
          <WindowBody win={w} />
        </div>
      ))}
    </>
  );
}

export function renderWindows(role: Role = 'employee') {
  return render(
    <AppProviders initialLocale="en" initialAuth={{ user: demoUser(role), notice: null }}>
      <MemoryRouter>
        <Probe />
        <Windows />
      </MemoryRouter>
    </AppProviders>,
  );
}

export function homeActions(): HomeActions {
  if (!probe.actions) throw new Error('renderWindows() first');
  return probe.actions;
}

export function windowIds(): string[] {
  return probe.state?.windows.map((w) => w.id) ?? [];
}

export function windowMode(id: string): string | undefined {
  return probe.state?.windows.find((w) => w.id === id)?.mode;
}
