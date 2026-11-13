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

  it('History lists the admission order (date only) and the emergency assessment, each opening Medical Encounter', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    const win = await waitFor(() => windowByTitle(/^Medical Records · /));
    await within(win).findByRole('heading', { name: 'History' });
    const order = within(win).getByRole('button', { name: /^Inpatient admission order/ });
    // At 00:00 of its date (owner decision 2026-11-11), and it says the time is not recorded.
    expect(order).toHaveTextContent(
      /time not recorded · Melati · Acute decompensated heart failure/,
    );
    const igd = within(win).getByRole('button', { name: /^Emergency medical assessment/ });
    expect(igd).toHaveTextContent(
      /dr\. Sari Wulandari · Acute decompensated heart failure · Rawat Inap di/,
    );
    // Time order: the order's 00:00 comes before the 14:30 registration, the 14:50 assessment after it.
    const registration = within(win).getByText('Registration');
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(order, registration)).toBe(true);
    expect(follows(registration, igd)).toBe(true);
    await userEvent.click(igd);
    await waitFor(() => expect(windowIds()).toContain(`emr-encounter:${NR}`));
  });

  it('Medical Encounter shows the emergency assessment and the admission order only on a visit that has them', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    const win = await waitFor(() => windowByTitle(/^Medical Encounter · /));
    await within(win).findByRole('heading', { name: 'Emergency medical assessment' });
    const igd = within(win).getByRole('article', {
      name: 'Emergency assessment by dr. Sari Wulandari',
    });
    for (const h of ['History', 'Examination', 'Physical examination', 'Investigations']) {
      expect(within(igd).getByRole('heading', { name: h })).toBeInTheDocument();
    }
    // An abnormal region says so in words, never by colour alone.
    expect(within(igd).getByText('Thorax').nextElementSibling).toHaveTextContent('Abnormal');
    expect(within(igd).getByText('Teeth').nextElementSibling).toHaveTextContent('Tidak Diperiksa');
    expect(within(igd).getByText('Rawat Inap di')).toBeInTheDocument();
    expect(within(igd).getByText('Medication history').nextElementSibling).toHaveTextContent(
      'Amlodipine 10 mg daily.',
    );
    expect(within(igd).getByText('Family history').nextElementSibling).toHaveTextContent(
      'Not recorded',
    );

    expect(
      within(win).getByRole('heading', { name: 'Inpatient admission order' }),
    ).toBeInTheDocument();
    expect(within(win).getByText(/time not recorded/)).toBeInTheDocument();
    expect(within(win).queryByText(/00:00/)).toBeNull();
    expect(await axeViolations(win)).toEqual([]);
  });

  it('a visit without them has no such sections', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: '2026/08/14/000051' }));
    const win = await waitFor(() => windowByTitle(/^Medical Encounter · /));
    await within(win).findAllByRole('heading', { name: 'Clinical notes (CPPT)' });
    expect(within(win).queryByRole('heading', { name: 'Emergency medical assessment' })).toBeNull();
    expect(within(win).queryByRole('heading', { name: 'Inpatient admission order' })).toBeNull();
  });

  it('lists each SEP as a row that expands to its details and collapses again', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    const win = await waitFor(() => windowByTitle(/^Medical Records · /));
    const list = await within(win).findByRole('list', { name: 'SEP list' });
    const row = within(list).getByRole('button', { name: /0301R0011026V000123/ });
    expect(row).toHaveTextContent(/Inpatient.*Class 2.*SEP date/);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(within(list).queryByText('Initial diagnosis (SEP)')).toBeNull();

    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(row.getAttribute('aria-controls')!)!;
    expect(panel).toBeVisible();
    expect(within(panel).getByText('Initial diagnosis (SEP)')).toBeInTheDocument();
    expect(within(panel).getByText('R06.0 Dyspnoea')).toBeInTheDocument();

    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(panel).not.toBeVisible();
    expect(await axeViolations(win)).toEqual([]);
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
    // Says it cannot save before anyone presses it: visibly unavailable, still focusable, the reason as its description.
    const button = await screen.findByRole('button', { name: /new cppt note.*preview/i });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(
      /preview only — this action cannot save anything yet/i,
    );
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

  it('a drill-down sits next to the window it was opened from in the dock, not at the end', async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    act(() => homeActions().open('emr-profile', { mrn: '00012345' }));
    act(() => homeActions().activate(`emr-records:${NR}`));
    const win = await waitFor(() => windowByTitle(/^Medical Records · /));
    await within(win).findByRole('heading', { name: 'History' });
    await userEvent.click(within(win).getByRole('button', { name: 'Encounter' }));
    await waitFor(() =>
      expect(windowIds()).toEqual([
        `emr-records:${NR}`,
        `emr-encounter:${NR}`,
        'emr-profile:00012345',
      ]),
    );
  });

  it("puts the window's actions in the identity strip's name row (no toolbar row of their own)", async () => {
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    const win = await waitFor(() => windowByTitle(/^Medical Records · /));
    const strip = await within(win).findByRole('group', { name: 'Patient identity' });
    const actions = within(strip).getByRole('group', { name: 'Window actions' });
    expect(within(actions).getByRole('button', { name: 'Encounter' })).toBeInTheDocument();
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
