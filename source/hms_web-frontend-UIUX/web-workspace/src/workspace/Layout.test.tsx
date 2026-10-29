import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axeViolations, renderApp, resetStores, signIn } from '@/test/utils';
import { useWindowStore } from './windowStore';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
  resetStores();
  signIn();
});

async function pickLayout(name: string | RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Window layout' }));
  await user.click(await screen.findByRole('menuitemradio', { name }));
  return user;
}

describe('tile layout picker (FR-16, window-states.md)', () => {
  it('lists the presets and disables the ones that do not fit the work area', async () => {
    renderApp('/workspace');
    act(() => useWindowStore.getState().setArea({ width: 600, height: 300 }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Window layout' }));
    expect(await screen.findByRole('menuitemradio', { name: /Free windows/ })).toBeEnabled();
    expect(screen.getByRole('menuitemradio', { name: /Four windows/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('tiles open windows into slots and shows an "Open module…" placeholder in the free slot', async () => {
    renderApp('/workspace');
    act(() => {
      useWindowStore.getState().open('patients');
      useWindowStore.getState().open('lab');
    });
    await pickLayout(/One \+ two/);
    const s = useWindowStore.getState();
    expect(s.layout).toBe('main2');
    expect(s.windows.filter((w) => w.mode === 'tiled')).toHaveLength(2);
    const slot = document.querySelector('[data-slot="3"]') as HTMLElement;
    expect(within(slot).getByRole('button', { name: 'Open module…' })).toBeInTheDocument();
  });

  it('opening a module from the empty slot fills it', async () => {
    renderApp('/workspace');
    act(() => useWindowStore.getState().open('patients'));
    const user = await pickLayout(/Two columns/);
    const slot = document.querySelector('[data-slot="2"]') as HTMLElement;
    await user.click(within(slot).getByRole('button', { name: 'Open module…' }));
    await user.click(await screen.findByRole('menuitem', { name: /Laboratory Results/ }));
    expect(useWindowStore.getState().windows.find((w) => w.id === 'lab')).toMatchObject({
      mode: 'tiled',
      slot: 1,
    });
    expect(document.querySelector('[data-slot="2"]')).toBeNull();
  });

  it('floating windows are above tiles and tiled windows have no resize handles', async () => {
    renderApp('/workspace');
    act(() => {
      for (const k of ['patients', 'lab', 'radiology'] as const) useWindowStore.getState().open(k);
    });
    await pickLayout(/Two columns/);
    const dialogs = screen.getAllByRole('dialog');
    const tier = (name: string) => dialogs.find((d) => d.getAttribute('aria-label') === name)!;
    expect(tier('Radiology Viewer')).toHaveAttribute('data-tier', 'tile');
    expect(Number(tier('Radiology Viewer').style.zIndex)).toBeLessThan(
      Number(tier('Patient Management').style.zIndex) || 999,
    );
    const tiled = dialogs.filter((d) => d.getAttribute('data-tier') === 'tile');
    expect(tiled).toHaveLength(2);
    expect(tiled[0]!.querySelectorAll('[class*="handle"]')).toHaveLength(0);
  });

  it('compact shell: a too-small work area pauses tiling and says so', async () => {
    renderApp('/workspace');
    act(() => {
      useWindowStore.getState().open('patients');
      useWindowStore.getState().open('lab');
      useWindowStore.getState().setLayout('grid4');
    });
    act(() => useWindowStore.getState().setArea({ width: 700, height: 400 }));
    expect(await screen.findByRole('status')).toHaveTextContent('Layout paused');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
