import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '@/test/utils';
import { renderWorkspace } from './testProbe';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
});

async function pickLayout(name: string | RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Window layout' }));
  await user.click(await screen.findByRole('menuitemradio', { name }));
  return user;
}

describe('tile layout picker', () => {
  it('lists the presets and disables the ones that do not fit the work area', async () => {
    const { probe } = renderWorkspace('/');
    act(() => probe.actions.setArea({ width: 600, height: 300 }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Window layout' }));
    expect(await screen.findByRole('menuitemradio', { name: /Free windows/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: /Four windows/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('tiles open windows into slots and shows an "Open module…" placeholder in the free slot', async () => {
    const { probe } = renderWorkspace('/');
    act(() => {
      probe.actions.open('emr-profile');
      probe.actions.open('emr-records');
    });
    await pickLayout(/One \+ two/);
    expect(probe.state.layout).toBe('main2');
    expect(probe.state.windows.filter((w) => w.mode === 'tiled')).toHaveLength(2);
    const slot = document.querySelector('[data-slot="3"]') as HTMLElement;
    expect(within(slot).getByRole('button', { name: 'Open module…' })).toBeInTheDocument();
  });

  it('opening a module from the empty slot fills it', async () => {
    const { probe } = renderWorkspace('/');
    act(() => probe.actions.open('emr-profile'));
    const user = await pickLayout(/Two columns/);
    const slot = document.querySelector('[data-slot="2"]') as HTMLElement;
    await user.click(within(slot).getByRole('button', { name: 'Open module…' }));
    await user.click(await screen.findByRole('menuitem', { name: /Medical Encounter/ }));
    expect(probe.state.windows.find((w) => w.id === 'emr-encounter')).toMatchObject({
      mode: 'tiled',
      slot: 1,
    });
    expect(document.querySelector('[data-slot="2"]')).toBeNull();
  });

  it('floating windows are above tiles and tiled windows have no resize handles', async () => {
    const { probe } = renderWorkspace('/');
    act(() => {
      for (const k of ['emr-profile', 'emr-records', 'emr-encounter'] as const)
        probe.actions.open(k);
    });
    await pickLayout(/Two columns/);
    const dialogs = screen.getAllByRole('dialog');
    const tiled = dialogs.filter((d) => d.getAttribute('data-tier') === 'tile');
    const floating = dialogs.filter((d) => d.getAttribute('data-tier') !== 'tile');
    expect(tiled).toHaveLength(2);
    expect(floating).toHaveLength(1);
    expect(Number(floating[0]!.style.zIndex)).toBeGreaterThan(
      Math.max(...tiled.map((d) => Number(d.style.zIndex))),
    );
    expect(tiled[0]!.querySelectorAll('[data-handle]')).toHaveLength(0);
  });

  it('compact shell: a too-small work area pauses tiling and says so', async () => {
    const { probe } = renderWorkspace('/');
    act(() => {
      probe.actions.open('emr-profile');
      probe.actions.open('emr-records');
      probe.actions.setLayout('grid4');
    });
    act(() => probe.actions.setArea({ width: 700, height: 400 }));
    expect(await screen.findByText(/Layout paused/)).toHaveAttribute('role', 'status');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
