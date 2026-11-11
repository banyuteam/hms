import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/AppProviders';
import { demoUser } from '@/state/auth';
import { useHome, useHomeActions, type HomeActions, type HomeState } from '@/state/home';
import {
  useCloseWindow,
  useReportUnsaved,
  WindowGuardProvider,
  WindowIdProvider,
} from './windowGuard';
import { renderWorkspace } from './testProbe';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
});

describe('closing windows', () => {
  it('a window with no unsaved changes closes at once and can be reopened', async () => {
    const { probe } = renderWorkspace('/');
    act(() => probe.actions.open('emr-records', { norawat: '2026/10/26/000123' }));
    const user = userEvent.setup();
    const dock = screen.getByRole('navigation', { name: 'Open windows' });
    await user.click(within(dock).getByRole('button', { name: /^Close Medical Records .* tab$/ }));
    expect(probe.state.windows).toHaveLength(0);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(/Medical Records .* closed/);
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(probe.state.windows.map((w) => w.params.norawat)).toEqual(['2026/10/26/000123']);
  });
});

/** A window body that has unsaved changes while `dirty` is on. */
function Editor({ id, dirty }: { id: string; dirty: boolean }) {
  return (
    <WindowIdProvider id={id}>
      <Report dirty={dirty} />
    </WindowIdProvider>
  );
}
function Report({ dirty }: { dirty: boolean }) {
  useReportUnsaved(dirty);
  return null;
}

let home: { state: HomeState; actions: HomeActions; close: (id: string) => void };
function Spy() {
  home = { state: useHome(), actions: useHomeActions(), close: useCloseWindow() };
  return null;
}

function renderGuard(dirty: boolean) {
  const view = (d: boolean) => (
    <AppProviders initialLocale="en" initialAuth={{ user: demoUser('doctor'), notice: null }}>
      <WindowGuardProvider>
        <Spy />
        {home?.state.windows.map((w) => <Editor key={w.id} id={w.id} dirty={d} />)}
      </WindowGuardProvider>
    </AppProviders>
  );
  const r = render(view(dirty));
  act(() => home.actions.open('iam-admin'));
  r.rerender(view(dirty));
  return home.state.windows[0]!.id;
}

describe('unsaved changes', () => {
  it('asks before closing; "Back to the window" (the default) keeps it, Escape too', async () => {
    const id = renderGuard(true);
    const user = userEvent.setup();
    act(() => home.close(id));
    const dialog = screen.getByRole('alertdialog', { name: /^Close .*\?$/ });
    expect(dialog).toHaveTextContent('changes that are not saved');
    expect(within(dialog).getByRole('button', { name: 'Back to the window' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(home.state.windows).toHaveLength(1);
    act(() => home.close(id));
    await user.click(screen.getByRole('button', { name: 'Close without saving' }));
    expect(home.state.windows).toHaveLength(0);
  });

  it('does not ask when nothing is unsaved', () => {
    const id = renderGuard(false);
    act(() => home.close(id));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(home.state.windows).toHaveLength(0);
  });
});
