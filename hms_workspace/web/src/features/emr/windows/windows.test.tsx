import { act, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { emrApi } from '@/api/emrApi';
import { homeReducer, initialHomeState } from '@/state/home';
import { axeViolations } from '@/test/utils';
import { homeActions, renderWindows, windowIds, windowMode } from '../test/harness';

configure({ asyncUtilTimeout: 8000 });

const NR = '2026/10/26/000123';

function windowByTitle(re: RegExp) {
  return screen.getByRole('region', { name: re });
}

describe('EMR windows', () => {
  it('Medical Records has a section index and no tab bar, and drills down into new windows', async () => {
    renderWindows('doctor');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    const win = await waitFor(() => windowByTitle(/^Medical Records · /));
    await within(win).findByRole('heading', { name: 'History' });
    expect(within(win).queryByRole('tablist')).toBeNull();
    expect(within(win).getAllByRole('navigation', { name: /^Sections · / })).toHaveLength(1);
    expect(within(win).getByText(/Allergy: Amoxicillin/)).toBeInTheDocument();
    expect(within(win).queryByRole('heading', { name: /immuni[sz]ation/i })).toBeNull();

    await userEvent.click(
      within(win).getAllByRole('button', { name: /open laboratory viewer/i })[0]!,
    );
    expect(windowIds()).toContain(`lab:${NR}|lab:2026-10-26T15:40:00:0`);
  });

  it('the compact "Sections" menu lists every section and jumps to it', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    const win = await waitFor(() => windowByTitle(/^Medical Records · /));
    await within(win).findByRole('heading', { name: 'History' });
    await userEvent.click(within(win).getByRole('button', { name: 'Sections' }));
    const menu = await screen.findByRole('menu', { name: 'Sections' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(3);
    await userEvent.click(within(menu).getByRole('menuitem', { name: /History/ }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows the SEP number in full, in the identity strip and the SEP section (owner decision B-1)', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    const win = await waitFor(() => windowByTitle(/^Medical Records · /));
    await within(win).findByRole('heading', { name: 'SEP (BPJS)' });
    expect(within(win).getByText('SEP 0301R0011026V000123')).toBeInTheDocument();
    expect(within(win).getByText('0301R0011026V000123')).toBeInTheDocument();
    expect(within(win).queryByRole('button', { name: /reveal sep no\./i })).toBeNull();
    expect(within(win).queryByText(/•/)).toBeNull();
  });

  it('Medical Records finds a patient by name or no_rkm_medis and lists their visits underneath', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-records'));
    const input = await screen.findByRole('searchbox', {
      name: /find visit by no_rawat, patient name or no_rkm_medis/i,
    });
    await userEvent.type(input, 'Siti');
    const visits = await screen.findByRole('list', { name: /siti nurhaliza/i });
    const rows = await within(visits).findAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('2026/10/26/000123'),
      expect.stringContaining('2026/08/14/000051'),
    ]);

    await userEvent.clear(input);
    await userEvent.type(input, '00012346');
    await screen.findByRole('list', { name: /siti nurhaliza/i });
    await userEvent.click(
      within(screen.getByRole('list', { name: /siti nurhaliza/i })).getAllByRole('button')[1]!,
    );
    await waitFor(() => expect(windowIds()).toEqual(['emr-records:2026/08/14/000051']));
  });

  it('searches visits by no_rawat only (encounter_id), not by registration no.', async () => {
    expect(await emrApi.findEncounters('014')).toEqual([]);
    expect((await emrApi.findEncounters('2026/10/26')).map((e) => e.no_rawat)).toEqual([NR]);
  });

  it('shows doctor edit actions only to the doctor (UI only)', async () => {
    const { unmount } = renderWindows('doctor');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    const button = await screen.findByRole('button', { name: /new cppt note/i });
    await userEvent.click(button);
    expect(screen.getByText(/preview only — nothing is saved/i)).toBeInTheDocument();
    unmount();

    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    await screen.findAllByRole('heading', { name: 'Clinical notes (CPPT)' });
    expect(screen.queryByRole('button', { name: /new cppt note/i })).toBeNull();
  });

  it('hides the UI-only edit actions from the doctor in a production build', async () => {
    vi.stubEnv('DEV', false);
    renderWindows('doctor');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    await screen.findAllByRole('heading', { name: 'Clinical notes (CPPT)' });
    expect(screen.queryByRole('button', { name: /new cppt note/i })).toBeNull();
  });

  it('a blank window searches by no_rawat and retargets itself', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-diagnostics'));
    const input = await screen.findByRole('searchbox', { name: /find visit by no_rawat/i });
    await userEvent.type(input, '2026/10/26');
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(NR) }));
    await waitFor(() => expect(windowIds()).toEqual([`emr-diagnostics:${NR}`]));
  });

  it('a drill-down from a maximised window opens maximised too', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    act(() => homeActions().toggleMaximize(`emr-records:${NR}`));
    const win = await waitFor(() => windowByTitle(/^Medical Records · /));
    await within(win).findByRole('heading', { name: 'History' });
    await userEvent.click(within(win).getByRole('button', { name: 'Encounter' }));
    await waitFor(() => expect(windowMode(`emr-encounter:${NR}`)).toBe('maximized'));
  });

  it('has no axe violations in the Medical Records window', async () => {
    renderWindows('doctor');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    const win = await waitFor(() => windowByTitle(/^Medical Records · /));
    await within(win).findByRole('heading', { name: 'History' });
    expect(await axeViolations(win)).toEqual([]);
  });
});

describe('home reducer retarget', () => {
  it('moves a blank window to a record, or focuses an existing one instead of duplicating', () => {
    let s = homeReducer(initialHomeState, {
      type: 'window/opened',
      kind: 'emr-records',
      params: {},
    });
    s = homeReducer(s, { type: 'window/retargeted', id: 'emr-records', params: { norawat: NR } });
    expect(s.windows.map((w) => w.id)).toEqual([`emr-records:${NR}`]);
    s = homeReducer(s, { type: 'window/opened', kind: 'emr-records', params: {} });
    s = homeReducer(s, { type: 'window/retargeted', id: 'emr-records', params: { norawat: NR } });
    expect(s.windows.map((w) => w.id)).toEqual([`emr-records:${NR}`]);
    expect(s.activeId).toBe(`emr-records:${NR}`);
  });
});
