import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '@/auth/authStore';
import { axeViolations, renderApp, resetStores, signIn } from '@/test/utils';
import { useWindowStore } from './windowStore';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
  resetStores();
  signIn();
});

const dock = () => screen.getByRole('navigation', { name: 'Open windows' });

describe('Workspace: first window + dock', () => {
  it('shows Home with the quick-start tiles, the dock and no windows', async () => {
    const { container } = renderApp('/workspace');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /^Good (morning|afternoon|evening|night), Demo User$/,
    );
    expect(screen.getByRole('button', { name: /Patient Management/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Medical Record/ })).toBeDisabled(); // "Soon"
    expect(within(dock()).getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('dialog', { name: 'Patient Management' })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens Patient Management from a tile: window + dock tab + synthetic table', async () => {
    const user = userEvent.setup();
    const { container } = renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Patient Management/ }));
    const win = await screen.findByRole('dialog', { name: 'Patient Management' });
    expect(within(win).getByRole('table', { name: 'Patient list' })).toBeInTheDocument();
    expect(within(win).getAllByRole('row')).toHaveLength(9); // header + 8 synthetic rows
    expect(within(dock()).getByRole('button', { name: 'Patient Management' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(dock()).getByRole('button', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('minimise hides the window but keeps its dock tab; the tab restores it', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Patient Management/ }));
    await user.click(await screen.findByRole('button', { name: 'Minimize Patient Management' }));
    expect(screen.queryByRole('dialog', { name: 'Patient Management' })).not.toBeInTheDocument();
    const tab = within(dock()).getByRole('button', { name: 'Patient Management' });
    await user.click(tab);
    expect(await screen.findByRole('dialog', { name: 'Patient Management' })).toBeVisible();
  });

  it('maximise/restore toggles and close removes the window and tab', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Patient Management/ }));
    await user.click(await screen.findByRole('button', { name: 'Maximize Patient Management' }));
    expect(useWindowStore.getState().windows[0]?.mode).toBe('maximized');
    await user.click(screen.getByRole('button', { name: 'Restore Patient Management' }));
    expect(useWindowStore.getState().windows[0]?.mode).toBe('floating');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Patient Management' })).getByRole('button', {
        name: 'Close Patient Management',
      }),
    );
    expect(screen.queryByRole('dialog', { name: 'Patient Management' })).not.toBeInTheDocument();
    expect(
      within(dock()).queryByRole('button', { name: 'Patient Management' }),
    ).not.toBeInTheDocument();
  });

  it('moves a window with the keyboard (arrows) and resizes with Shift+arrows', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Patient Management/ }));
    const bar = (await screen.findAllByRole('group', { name: 'Patient Management' }))[0]!;
    const before = { ...useWindowStore.getState().windows[0]! };
    bar.focus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    const moved = useWindowStore.getState().windows[0]!;
    expect(moved.rect.x).toBe(before.rect.x + 16);
    expect(moved.rect.y).toBe(before.rect.y + 16);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(useWindowStore.getState().windows[0]!.rect.w).toBe(before.rect.w + 16);
  });

  it('Alt+1 opens Patient Management', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.keyboard('{Alt>}{1}{/Alt}');
    // userEvent sets e.code from the key for digits
    expect(useWindowStore.getState().windows.map((w) => w.id)).toEqual(['patients']);
  });

  it('patient list filters by name / MRN and by status; rows are keyboard navigable', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Patient Management/ }));
    const win = await screen.findByRole('dialog', { name: 'Patient Management' });
    await user.type(within(win).getByRole('searchbox', { name: 'Search patients' }), 'siti');
    expect(within(win).getAllByRole('row')).toHaveLength(2);
    expect(within(win).getByText('Showing 1 of 8 patients')).toBeInTheDocument();
    await user.clear(within(win).getByRole('searchbox', { name: 'Search patients' }));
    await user.click(within(win).getByRole('radio', { name: 'ER' }));
    expect(within(win).getAllByRole('row')).toHaveLength(2);
    expect(within(win).getByText('Agus Prasetyo')).toBeInTheDocument();
    await user.type(within(win).getByRole('searchbox', { name: 'Search patients' }), 'zzz');
    expect(within(win).getByText('No matching patients.')).toBeInTheDocument();
  });

  it('opens an Indonesian UI with translated chrome but untranslated master data', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Patient Management/ }));
    await user.click(await screen.findByRole('button', { name: /User menu/ }));
    await user.click(
      await screen.findByRole('radio', { name: 'Switch language to Bahasa Indonesia' }),
    );
    await user.keyboard('{Escape}'); // close the (modal) popover so the page is no longer aria-hidden
    const win = await screen.findByRole('dialog', { name: 'Manajemen Pasien' });
    expect(within(win).getByRole('columnheader', { name: 'No. RM' })).toBeInTheDocument();
    expect(within(win).getAllByText('Penyakit Dalam').length).toBeGreaterThan(0); // master data stays as stored
    expect(
      within(screen.getByRole('navigation', { name: 'Jendela terbuka' })).getByRole('button', {
        name: 'Beranda',
      }),
    ).toBeInTheDocument();
  });

  it('logs out from the user menu: session and windows are cleared, login screen with notice', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Patient Management/ }));
    await user.click(await screen.findByRole('button', { name: /User menu/ }));
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('You have signed out.');
    expect(useAuthStore.getState().user).toBeNull();
    expect(useWindowStore.getState().windows).toHaveLength(0);
  });
});
