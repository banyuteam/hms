import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { auditEvents, clearAudit } from '@/audit/audit';
import { axeViolations, renderApp, resetStores, signIn } from '@/test/utils';
import { useWindowStore } from '../../windowStore';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
  resetStores();
  clearAudit();
  signIn();
});

async function openEncounters(mrn = '00012346') {
  const user = userEvent.setup();
  renderApp('/workspace');
  act(() => useWindowStore.getState().open('patient-detail', { mrn }));
  const win = await screen.findByRole('dialog', { name: `Patient Detail - ${mrn}` });
  await within(win).findByRole('heading', { level: 2, name: /./ });
  await user.click(within(win).getByRole('tab', { name: 'Encounters' }));
  return { user, win };
}

describe('Encounters tab (Figma 15, encounters-tab-fields.md)', () => {
  it('lists encounters newest first, selects the first and shows its timeline oldest first', async () => {
    const { win } = await openEncounters();
    const list = await within(win).findByRole('listbox', { name: 'Encounters' });
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveTextContent('27 Oct 2026');
    expect(options[3]).toHaveTextContent('10 Mar 2026');

    const detail = within(win).getByRole('region', { name: 'Encounter detail' });
    expect(within(detail).getByText('Encounter INP-20261027-0001')).toBeInTheDocument();
    const events = within(within(detail).getByRole('list')).getAllByRole('listitem');
    expect(events[0]).toHaveTextContent('Registrasi rawat inap');
    expect(events[events.length - 1]).toHaveTextContent('Not discharged yet');
    expect(auditEvents().some((e) => e.subject === 'encounters')).toBe(true);
  });

  it('filters by type and follows the selection into the detail pane', async () => {
    const { user, win } = await openEncounters();
    await user.click(within(win).getByRole('radio', { name: 'Outpatient' }));
    const list = within(win).getByRole('listbox', { name: 'Encounters' });
    expect(within(list).getAllByRole('option')).toHaveLength(2);

    await user.click(within(list).getAllByRole('option')[1]!);
    const detail = within(win).getByRole('region', { name: 'Encounter detail' });
    expect(within(detail).getByText('Encounter OUT-20260310-0013')).toBeInTheDocument();
    expect(within(detail).getAllByText('Cancelled').length).toBeGreaterThan(0);
  });

  it('shows outcome and length of stay of a discharged inpatient encounter', async () => {
    const { user, win } = await openEncounters();
    await user.click(within(win).getByRole('option', { name: /02 Jul 2026/ }));
    const detail = within(win).getByRole('region', { name: 'Encounter detail' });
    expect(within(detail).getByText('Improved')).toBeInTheDocument();
    expect(within(detail).getByText('4 days')).toBeInTheDocument();
    expect(within(detail).queryByText('Not discharged yet')).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { win } = await openEncounters();
    await within(win).findByRole('listbox', { name: 'Encounters' });
    expect(await axeViolations(win)).toEqual([]);
  });
});
