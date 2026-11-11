import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '@/test/utils';
import { renderWorkspace } from './testProbe';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
});

const dock = () => screen.getByRole('navigation', { name: 'Open windows' });

async function openFromLauncher(name: RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Module launcher' }));
  await user.click(await screen.findByRole('menuitem', { name }));
  return user;
}

describe('Workspace: windows + dock', () => {
  it('shows Home, the dock with Home current and no windows', async () => {
    const { container } = renderWorkspace('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /^Good (morning|afternoon|evening|night), Demo User$/,
    );
    expect(within(dock()).getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('opens a task window from the launcher: window + active dock tab', async () => {
    const { container } = renderWorkspace('/');
    await openFromLauncher(/Medical Records/);
    expect(await screen.findByRole('dialog', { name: 'Medical Records' })).toBeInTheDocument();
    expect(within(dock()).getByRole('button', { name: 'Records' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(dock()).getByRole('button', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('launcher menu is keyboard operable and Escape returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderWorkspace('/');
    const trigger = screen.getByRole('button', { name: 'Module launcher' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const items = await screen.findAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('minimise hides the window but keeps its dock tab; the tab restores it', async () => {
    const user = await (async () => {
      renderWorkspace('/');
      return openFromLauncher(/Medical Records/);
    })();
    await user.click(await screen.findByRole('button', { name: 'Minimize Medical Records' }));
    expect(screen.queryByRole('dialog', { name: 'Medical Records' })).not.toBeInTheDocument();
    await user.click(within(dock()).getByRole('button', { name: 'Records' }));
    expect(await screen.findByRole('dialog', { name: 'Medical Records' })).toBeVisible();
  });

  it('maximise/restore toggles and close removes the window and tab', async () => {
    const { probe } = renderWorkspace('/');
    const user = await openFromLauncher(/Medical Records/);
    await user.click(await screen.findByRole('button', { name: 'Maximize Medical Records' }));
    expect(probe.state.windows[0]?.mode).toBe('maximized');
    await user.click(screen.getByRole('button', { name: 'Restore Medical Records' }));
    expect(probe.state.windows[0]?.mode).toBe('floating');
    await user.click(screen.getByRole('button', { name: 'Close Medical Records' }));
    expect(screen.queryByRole('dialog', { name: 'Medical Records' })).not.toBeInTheDocument();
    expect(within(dock()).queryByRole('button', { name: 'Records' })).not.toBeInTheDocument();
  });

  it('"Keep on top" is a toggle button; the window then stays above a maximised window', async () => {
    const { container } = renderWorkspace('/');
    await openFromLauncher(/Medical Records/);
    const user = await openFromLauncher(/Patient Profile/);
    await user.click(await screen.findByRole('button', { name: 'Maximize Medical Records' }));
    const pin = screen.getByRole('button', { name: 'Keep Patient Profile on top' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.queryByRole('button', { name: 'Keep Medical Records on top' }),
    ).not.toBeInTheDocument();
    await user.click(pin);
    expect(pin).toHaveAttribute('aria-pressed', 'true');
    const records = screen.getByRole('dialog', { name: 'Medical Records' });
    const profile = screen.getByRole('dialog', { name: 'Patient Profile' });
    await user.click(records);
    expect(profile).toHaveAttribute('data-tier', 'top');
    expect(Number(profile.style.zIndex)).toBeGreaterThan(Number(records.style.zIndex));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('moves a window with the keyboard (arrows) and resizes with Shift+arrows', async () => {
    const { probe } = renderWorkspace('/');
    const user = await openFromLauncher(/Medical Records/);
    const bar = (await screen.findAllByRole('group', { name: 'Medical Records' }))[0]!;
    const before = { ...probe.state.windows[0]!.rect };
    bar.focus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(probe.state.windows[0]!.rect.x).toBe(before.x + 16);
    expect(probe.state.windows[0]!.rect.y).toBe(before.y + 16);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(probe.state.windows[0]!.rect.w).toBe(before.w + 16);
  });

  it('Alt+1 opens the Patient Profile window', async () => {
    const user = userEvent.setup();
    const { probe } = renderWorkspace('/');
    await user.keyboard('{Alt>}{1}{/Alt}');
    expect(probe.state.windows.map((w) => w.id)).toEqual(['emr-profile']);
  });

  it('switches the chrome to Indonesian from the user menu (in memory only)', async () => {
    const user = userEvent.setup();
    renderWorkspace('/');
    await user.click(screen.getByRole('button', { name: /User menu/ }));
    const toId = await screen.findByRole('button', { name: 'Switch language to Bahasa Indonesia' });
    await user.click(toId);
    expect(toId).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(
      within(screen.getByRole('navigation', { name: 'Jendela terbuka' })).getByRole('button', {
        name: 'Beranda',
      }),
    ).toBeInTheDocument();
  });

  it('signs out from the user menu: windows are cleared and the login screen shows', async () => {
    const { probe } = renderWorkspace('/');
    act(() => probe.actions.open('emr-records'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /User menu/ }));
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(probe.pathname).toBe('/login');
    expect(probe.state.windows).toHaveLength(0);
  });

  it('reaches "Sign out" with the keyboard only: Tab moves through the user menu and wraps (WCAG 2.1.1)', async () => {
    const { probe } = renderWorkspace('/');
    act(() => probe.actions.open('emr-records'));
    const user = userEvent.setup();
    screen.getByRole('button', { name: /User menu/ }).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'User menu' });
    const first = within(dialog).getByRole('button', { name: /^Switch language to Bahasa/ });
    expect(first).toHaveFocus();
    await user.tab();
    await user.tab();
    const signOut = within(dialog).getByRole('button', { name: 'Sign out' });
    expect(signOut).toHaveFocus();
    // The panel stays open and Tab wraps to the first control instead of leaving the page.
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(signOut).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(probe.state.windows).toHaveLength(0);
  });
});
