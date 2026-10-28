import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { auditEvents, clearAudit } from '@/audit/audit';
import { axeViolations, renderApp, resetStores, signIn } from '@/test/utils';
import { REVEAL_MS } from '@/components/MaskedValue';
import { useWindowStore } from '../../windowStore';

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_AUTH', 'true');
  resetStores();
  clearAudit();
  signIn();
});

async function openDetail(mrn = '00012346') {
  const view = renderApp('/workspace');
  act(() => useWindowStore.getState().open('patient-detail', { mrn }));
  const win = await screen.findByRole('dialog', { name: `Patient Detail - ${mrn}` });
  await within(win).findByRole('heading', { level: 2, name: /./ });
  return { win, ...view };
}

describe('Patient Detail window (Figma 04, 10–14)', () => {
  it('opens from the patient list with Enter and shows identity, safety bar and the dock tab', async () => {
    const user = userEvent.setup();
    renderApp('/workspace');
    await user.click(screen.getByRole('button', { name: /Patient Management/ }));
    const list = await screen.findByRole('dialog', { name: 'Patient Management' });
    const row = within(list).getByRole('row', { name: /Siti Nurhaliza/ });
    row.focus();
    await user.keyboard('{Enter}');
    const win = await screen.findByRole('dialog', { name: 'Patient Detail - 00012346' });
    expect(
      await within(win).findByRole('heading', { level: 2, name: 'Siti Nurhaliza' }),
    ).toBeInTheDocument();
    expect(within(win).getByText('Allergy: Penisilin (ruam)')).toBeInTheDocument();
    expect(within(win).getByText('Blood type O')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Open windows' })).getByRole('button', {
        name: 'Detail 00012346',
      }),
    ).toBeInTheDocument();
  });

  it('is read-only: Edit is disabled with an explanation, Print stays enabled', async () => {
    const { win } = await openDetail();
    expect(within(win).getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(within(win).getByRole('button', { name: 'Print' })).toBeEnabled();
  });

  it('keeps one active place: a sidebar item deactivates the tab and vice versa (OQ-50)', async () => {
    const user = userEvent.setup();
    const { win } = await openDetail();
    expect(within(win).getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const nav = within(win).getByRole('navigation', { name: 'Patient profile' });
    expect(within(nav).getAllByRole('button')).toHaveLength(5); // 4 profile pages + Audit Log, nothing that mirrors a tab
    await user.click(within(nav).getByRole('button', { name: 'Contact' }));
    expect(within(nav).getByRole('button', { name: 'Contact' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const tab of within(win).getAllByRole('tab'))
      expect(tab).toHaveAttribute('aria-selected', 'false');
    expect(within(win).getByRole('heading', { level: 2, name: 'Contact' })).toBeInTheDocument();
    await user.click(within(win).getByRole('tab', { name: 'Medical Record' }));
    expect(within(nav).getByRole('button', { name: 'Contact' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('shows at most 8 tabs and puts the rest under More; an active tab inside More stays visible', async () => {
    const user = userEvent.setup();
    const { win } = await openDetail();
    expect(within(win).getAllByRole('tab')).toHaveLength(8);
    expect(within(win).queryByRole('tab', { name: 'Documents' })).not.toBeInTheDocument();
    await user.click(within(win).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Documents' }));
    expect(within(win).getByRole('heading', { level: 2, name: 'Documents' })).toBeInTheDocument();
    expect(within(win).getByText(/arrives in Phase 3/)).toBeInTheDocument();
    expect(within(win).getByRole('button', { name: 'More' })).toHaveTextContent('Documents');
  });

  it('opens the Personal Information profile from the Overview card shortcut', async () => {
    const user = userEvent.setup();
    const { win } = await openDetail();
    await user.click(within(win).getByRole('button', { name: 'View profile' }));
    expect(
      within(win).getByRole('heading', { level: 2, name: 'Personal Information' }),
    ).toBeInTheDocument();
    expect(within(win).getByText("Bachelor's (S1)")).toBeInTheDocument(); // enum shown with an English label
    expect(within(win).getByText('Married')).toBeInTheDocument();
  });

  it('masks PHI by default; the reveal is audited without PHI in the event and hides itself after 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { win } = await openDetail();
      const nav = within(win).getByRole('navigation', { name: 'Patient profile' });
      await user.click(within(nav).getByRole('button', { name: 'Personal Information' }));
      expect(within(win).getByText('3273••••••••0002')).toBeInTheDocument();
      expect(within(win).queryByText('3273010210850002')).not.toBeInTheDocument();
      await user.click(within(win).getByRole('button', { name: 'Reveal NIK' }));
      expect(within(win).getByText('3273010210850002')).toBeInTheDocument();
      expect(within(win).getByRole('button', { name: 'Hide NIK' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const ev = auditEvents().find((e) => e.action === 'phi.reveal');
      expect(ev?.subject).toBe('nik');
      expect(JSON.stringify(ev)).not.toContain('3273');
      act(() => {
        vi.advanceTimersByTime(REVEAL_MS + 100);
      });
      expect(within(win).getByText('3273••••••••0002')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Guarantor & Insurance shows the BPJS class and masks the SEP number', async () => {
    const user = userEvent.setup();
    const { win } = await openDetail();
    const nav = within(win).getByRole('navigation', { name: 'Patient profile' });
    await user.click(within(nav).getByRole('button', { name: 'Guarantor & Insurance' }));
    expect(within(win).getByText('BPJS class')).toBeInTheDocument();
    expect(within(win).getByText('Class 2')).toBeInTheDocument();
    expect(within(win).getByText('0301R••••••V000123')).toBeInTheDocument();
  });

  it('Medical Record tab: diagnoses, history, notes, allergies; scope and search; audit on open', async () => {
    const user = userEvent.setup();
    const { win } = await openDetail();
    await user.click(within(win).getByRole('tab', { name: 'Medical Record' }));
    expect(
      auditEvents().some((e) => e.action === 'record.open' && e.subject === 'medical-record'),
    ).toBe(true);
    expect(within(win).getByText('J18.9')).toBeInTheDocument();
    expect(within(win).getAllByText('Hipertensi esensial').length).toBeGreaterThan(0); // clinical data stays as stored
    expect(
      within(win).getByText('Demam 3 hari, batuk berdahak, sesak napas saat aktivitas.'),
    ).toBeInTheDocument();
    expect(within(win).getByText('Ruam')).toBeInTheDocument();
    // current encounter only: the March outpatient note is not shown
    expect(within(win).queryByText('Kontrol rutin, tanpa keluhan.')).not.toBeInTheDocument();
    await user.click(within(win).getByRole('radio', { name: 'All encounters' }));
    expect(within(win).getByText('Kontrol rutin, tanpa keluhan.')).toBeInTheDocument();
    await user.type(
      within(win).getByRole('searchbox', { name: 'Search diagnoses and notes' }),
      'ceftriaxone',
    );
    expect(within(win).queryByText('Kontrol rutin, tanpa keluhan.')).not.toBeInTheDocument();
    expect(within(win).getByText(/Lanjutkan Ceftriaxone IV/)).toBeInTheDocument();
  });

  it("Audit Log lists this session's events", async () => {
    const user = userEvent.setup();
    const { win } = await openDetail();
    await user.click(within(win).getByRole('tab', { name: 'Medical Record' }));
    const nav = within(win).getByRole('navigation', { name: 'Patient profile' });
    await user.click(within(nav).getByRole('button', { name: 'Audit Log' }));
    expect(within(win).getByText('Record opened')).toBeInTheDocument();
  });

  it('shows a not-found state for an unknown patient', async () => {
    renderApp('/workspace');
    act(() => useWindowStore.getState().open('patient-detail', { mrn: '99999999' }));
    const win = await screen.findByRole('dialog', { name: 'Patient Detail - 99999999' });
    expect(await within(win).findByRole('alert')).toHaveTextContent(
      'No patient with this number was found.',
    );
  });

  it('works in Indonesian with clinical data untouched', async () => {
    const user = userEvent.setup();
    const { win } = await openDetail();
    await user.click(screen.getByRole('button', { name: /User menu/ }));
    await user.click(
      await screen.findByRole('radio', { name: 'Switch language to Bahasa Indonesia' }),
    );
    await user.keyboard('{Escape}');
    const idWin = await screen.findByRole('dialog', { name: 'Detail Pasien - 00012346' });
    expect(within(idWin).getByRole('tab', { name: 'Rekam Medis' })).toBeInTheDocument();
    expect(within(idWin).getByText('Alergi: Penisilin (ruam)')).toBeInTheDocument();
    expect(win).toBeDefined();
  });

  it('has no a11y violations (jsdom axe; contrast is covered by the token table)', async () => {
    const user = userEvent.setup();
    const { container, win } = await openDetail();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(within(win).getByRole('tab', { name: 'Medical Record' }));
    expect(await axeViolations(container)).toEqual([]);
  }, 90_000);
});
