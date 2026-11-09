import { act, configure, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emrApi, groupByPayer, type PayerHistory } from '@/api/emrApi';
import type { EncounterListItem } from '@/api/journey';
import { ApiError } from '@/api/liveApi';
import { liveEmrApi } from '@/api/liveEmrApi';
import { axeViolations } from '@/test/utils';
import { homeActions, renderWindows, windowIds } from '../test/harness';

configure({ asyncUtilTimeout: 8000 });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MRN = '00012346';
const visit = (
  no_rawat: string,
  date: string,
  kd_pj: string,
  ranap = false,
): EncounterListItem => ({
  no_rawat,
  no_reg: '001',
  no_rkm_medis: MRN,
  tgl_registrasi: date,
  jam_reg: '09:00:00',
  status_lanjut: ranap ? 'Ranap' : 'Ralan',
  stts: 'Sudah',
  kd_pj,
});

// Synthetic: two BPJS visits around one self-paying visit, a code missing from the payer list, and a visit with no payer.
const HISTORY: PayerHistory = {
  truncated: false,
  payers: [
    {
      code: 'BPJ',
      name: 'BPJS Kesehatan',
      lastVisit: '2026-10-26 09:00:00',
      visits: [
        visit('2026/10/26/000123', '2026-10-26', 'BPJ', true),
        visit('2026/08/14/000051', '2026-08-14', 'BPJ'),
      ],
    },
    {
      code: 'UMU',
      name: 'Umum',
      lastVisit: '2026-09-01 09:00:00',
      visits: [visit('2026/09/01/000010', '2026-09-01', 'UMU')],
    },
    { code: 'X99', name: null, lastVisit: null, visits: [visit('2026/06/01/000001', '', 'X99')] },
    { code: '', name: null, lastVisit: null, visits: [visit('2026/05/01/000001', '', '')] },
  ],
};

async function openGuarantor(history: PayerHistory | Error = HISTORY) {
  const spy = vi.spyOn(emrApi, 'getPayerHistory');
  if (history instanceof Error) spy.mockRejectedValue(history);
  else spy.mockResolvedValue(history);
  renderWindows('employee');
  act(() => homeActions().open('emr-profile', { mrn: MRN }));
  const win = await screen.findByRole('region', { name: /Patient Profile/ });
  const heading = await within(win).findByRole('heading', { name: 'Guarantor & insurance' });
  return { win, section: heading.closest('section')!, spy };
}

const payerButtons = (section: HTMLElement) =>
  within(within(section).getByRole('list', { name: 'Payer history' }))
    .getAllByRole('button')
    .filter((b) => b.hasAttribute('aria-expanded'));

describe('Patient Profile · guarantor (payers per visit)', () => {
  it('lists each payer code with its name, newest payer first, all collapsed', async () => {
    const { section } = await openGuarantor();
    await within(section).findByText('BPJS Kesehatan');
    const buttons = payerButtons(section);
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^BPJBPJS Kesehatan2 visitsLast 26 Oct 2026 09:00$/),
      expect.stringMatching(/^UMUUmum1 visitLast 0?1 Sept? 2026 09:00$/),
      expect.stringMatching(/^X99Name not in the payer list1 visitLast Undated/),
      expect.stringMatching(/^No payer recorded1 visit/),
    ]);
    for (const b of buttons) expect(b).toHaveAttribute('aria-expanded', 'false');
    expect(within(section).queryByText(/2026\/10\/26\/000123/)).toBeNull();
  });

  it('expands a payer to its visits (latest first), each opening Medical Records, and collapses again', async () => {
    const user = userEvent.setup();
    const { section } = await openGuarantor();
    await within(section).findByText('BPJS Kesehatan');
    const bpjs = payerButtons(section)[0]!;

    await user.click(bpjs);
    expect(bpjs).toHaveAttribute('aria-expanded', 'true');
    const visits = within(section).getByRole('list', { name: 'Visits with payer BPJ' });
    expect(document.getElementById(bpjs.getAttribute('aria-controls')!)).toContainElement(visits);
    const rows = within(visits).getAllByRole('button', { name: /Open medical record/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('2026/10/26/000123 · Inpatient · Sudah'),
      expect.stringContaining('2026/08/14/000051 · Outpatient · Sudah'),
    ]);
    // The other payers stay collapsed.
    expect(payerButtons(section)[1]).toHaveAttribute('aria-expanded', 'false');

    await user.click(rows[1]!);
    expect(windowIds().some((id) => id.includes('2026/08/14/000051'))).toBe(true);

    await user.click(bpjs);
    expect(bpjs).toHaveAttribute('aria-expanded', 'false');
    expect(within(section).queryByRole('list', { name: 'Visits with payer BPJ' })).toBeNull();
  });

  it('shows the section count and has no axe violations', async () => {
    const user = userEvent.setup();
    const { win, section } = await openGuarantor();
    await within(section).findByText('BPJS Kesehatan');
    expect(within(section).getByText('4', { selector: 'span' })).toBeInTheDocument();
    await user.click(payerButtons(section)[0]!);
    expect(await axeViolations(win)).toEqual([]);
  });

  it('says so when the server read only the latest visits', async () => {
    const { section } = await openGuarantor({ ...HISTORY, truncated: true });
    expect(
      await within(section).findByText(/Only the latest 500 visits were read/),
    ).toBeInTheDocument();
  });

  it('no visits: "No visits recorded.", never an empty list', async () => {
    const { section } = await openGuarantor({ payers: [], truncated: false });
    expect(await within(section).findByText('No visits recorded.')).toBeInTheDocument();
    expect(within(section).queryByRole('list', { name: 'Payer history' })).toBeNull();
  });

  it('without encounter.read it says why and offers no Retry', async () => {
    const { section } = await openGuarantor(new ApiError(403, 'forbidden'));
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent(/do not have permission to view visits/);
    expect(within(alert).queryByRole('button')).toBeNull();
  });

  it('a failed load is an error with Try again that recovers', async () => {
    const user = userEvent.setup();
    const { section, spy } = await openGuarantor(new Error('boom'));
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent(/could not be loaded/);
    spy.mockResolvedValue(HISTORY);
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(section).findByText('BPJS Kesehatan')).toBeInTheDocument();
  });
});

describe('payer grouping', () => {
  it('demo data: groups visits (latest first) by payer code, keeping the latest-visit order', () => {
    const groups = groupByPayer([
      { ...visit('2026/10/26/000123', '2026-10-26', 'BPJ'), payer_name: 'BPJS Kesehatan' },
      { ...visit('2026/09/01/000010', '2026-09-01', 'UMU'), payer_name: 'Umum' },
      { ...visit('2026/08/14/000051', '2026-08-14', 'BPJ'), payer_name: 'BPJS Kesehatan' },
    ]);
    expect(groups.map((g) => [g.code, g.name, g.lastVisit, g.visits.length])).toEqual([
      ['BPJ', 'BPJS Kesehatan', '2026-10-26 09:00:00', 2],
      ['UMU', 'Umum', '2026-09-01 09:00:00', 1],
    ]);
    expect(groups[0]!.visits[0]).not.toHaveProperty('payer_name');
  });

  it('live: maps GET /patients/{mrn}/payers and rejects a malformed answer', async () => {
    const enc = {
      encounter_number: '2026/10/26/000123',
      queue_number: '001',
      patient_mrn: MRN,
      registered_at: '2026-10-26T09:00:00+07:00',
      care_setting: 'inpatient',
      status: { code: 'Dirawat', system: 'legacy-hms:reg_periksa.stts' },
      payer_code: 'BPJ',
    };
    const body = {
      truncated: false,
      payers: [
        {
          code: 'BPJ',
          name: ' BPJS Kesehatan ',
          last_visit_at: '2026-10-26T09:00:00+07:00',
          visit_count: 1,
          encounters: [enc],
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const h = await liveEmrApi.getPayerHistory(MRN);
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/v1/patients/${MRN}/payers`);
    expect(h.payers[0]).toMatchObject({
      code: 'BPJ',
      name: 'BPJS Kesehatan',
      lastVisit: '2026-10-26 09:00:00',
      visits: [{ no_rawat: '2026/10/26/000123', status_lanjut: 'Ranap', kd_pj: 'BPJ' }],
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ payers: [{ code: 'BPJ' }], truncated: false }), {
        status: 200,
      }),
    );
    await expect(liveEmrApi.getPayerHistory(MRN)).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });
});
