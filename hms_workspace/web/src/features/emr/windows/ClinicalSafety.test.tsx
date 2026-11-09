import { act, configure, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emrApi } from '@/api/emrApi';
import type { EncounterJourney, Prescription } from '@/api/journey';
import { ApiError } from '@/api/liveApi';
import { patientApi } from '@/api/patientApi';
import { SYNTHETIC_CLAIM_EVALUATIONS } from '@/data/claimFixtures';
import { claimApi, type ClaimEvaluation } from '@/api/claimApi';
import { resourceCache } from '@/lib/resource';
import { homeActions, renderWindows } from '../test/harness';

configure({ asyncUtilTimeout: 8000 });
afterEach(() => {
  vi.restoreAllMocks();
  resourceCache.clear();
});

const NR = '2026/10/26/000123';
const RX = 'R-2026102600045';

/** The synthetic journey with prescription RX changed by `patch` (structure-agnostic: found by `no_resep`). */
function journeyWithPrescription(patch: Partial<Prescription>) {
  const original = emrApi.getJourney.bind(emrApi);
  vi.spyOn(emrApi, 'getJourney').mockImplementation(async (norawat) => {
    const j = await original(norawat);
    return JSON.parse(JSON.stringify(j), (_key, value: unknown) =>
      value && typeof value === 'object' && (value as Prescription).no_resep === RX
        ? { ...(value as Prescription), ...patch }
        : value,
    ) as EncounterJourney;
  });
}

/** The synthetic journey with every object that has `field` patched to `value`. */
function journeyWithField(field: string, value: string) {
  const original = emrApi.getJourney.bind(emrApi);
  vi.spyOn(emrApi, 'getJourney').mockImplementation(async (norawat) => {
    const j = await original(norawat);
    return JSON.parse(JSON.stringify(j), (_key, v: unknown) =>
      v && typeof v === 'object' && field in v ? { ...v, [field]: value } : v,
    ) as EncounterJourney;
  });
}

const identityStrip = () => screen.findByRole('group', { name: 'Patient identity' });

describe('clinical safety of the EMR windows', () => {
  it('a prescription not handed over yet (legacy 0000-00-00) is shown as not recorded, never as a date', async () => {
    journeyWithPrescription({ tgl_penyerahan: '0000-00-00', jam_penyerahan: '00:00:00' });
    renderWindows('employee');
    act(() => homeActions().open('prescription', { norawat: NR, item: RX }));
    const label = await screen.findByText('Handed over');
    const row = label.parentElement as HTMLElement;
    expect(within(row).getByText('Not recorded')).toBeInTheDocument();
    expect(screen.queryByText(/1899/)).toBeNull();
  });

  it('the pharmacy table lists compounded prescriptions next to single drugs', async () => {
    journeyWithPrescription({
      compounds: [
        {
          nama_racik: 'Racikan Puyer A',
          aturan_pakai: '3 × 1 sachet',
          jml_dr: 10,
          keterangan: '',
        },
      ],
    });
    renderWindows('employee');
    act(() => homeActions().open('emr-diagnostics', { norawat: NR }));
    const table = await screen.findByRole('table', { name: 'Prescribed' });
    const row = within(table).getByText('Compound: Racikan Puyer A').closest('tr') as HTMLElement;
    expect(within(row).getByText('3 × 1 sachet')).toBeInTheDocument();
    expect(within(row).getByText('10')).toBeInTheDocument();
    // Single drugs are still there.
    expect(within(table).getByText('Furosemide 20 mg/2 ml injection')).toBeInTheDocument();
  });

  it('while the patient identity is loading the strip says so, not "not recorded"', async () => {
    vi.spyOn(patientApi, 'getPatientProfile').mockReturnValue(new Promise(() => {}));
    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    const strip = await identityStrip();
    expect(within(strip).getByRole('status')).toHaveTextContent('Loading patient identity…');
    expect(within(strip).queryByText('Not recorded')).toBeNull();
    expect(within(strip).queryByText('Date of birth not recorded')).toBeNull();
    expect(within(strip).getByText(/^MRN /)).toBeInTheDocument();
  });

  it('when the patient identity cannot be loaded the strip warns, not "not recorded"', async () => {
    vi.spyOn(patientApi, 'getPatientProfile').mockRejectedValue(new ApiError(500, 'internal'));
    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    const strip = await identityStrip();
    expect(
      await within(strip).findByText(
        /Patient identity could not be loaded — confirm the patient by MRN/,
      ),
    ).toBeInTheDocument();
    expect(within(strip).queryByText('Not recorded')).toBeNull();
    expect(within(strip).queryByText('Date of birth not recorded')).toBeNull();
  });

  it('a prescribed time that is not a real date is flagged, not hidden', async () => {
    journeyWithPrescription({ tgl_peresepan: '2026-02-31' });
    renderWindows('employee');
    act(() => homeActions().open('prescription', { norawat: NR, item: RX }));
    const label = await screen.findByText('Prescribed');
    const row = label.parentElement as HTMLElement;
    expect(
      within(row).getByText('Invalid date in source: “2026-02-31 17:25:00”'),
    ).toBeInTheDocument();
  });

  it('an unreadable discharge date is a data problem, never "Not discharged"', async () => {
    journeyWithField('tgl_keluar', '2026-10-32');
    renderWindows('employee');
    act(() => homeActions().open('emr-records', { norawat: NR }));
    expect(await screen.findByText(/Invalid date in source: “2026-10-32/)).toBeInTheDocument();
    expect(screen.queryByText('Not discharged')).toBeNull();
  });

  it('a visit answer in the wrong shape says the data cannot be read safely', async () => {
    vi.spyOn(emrApi, 'getJourney').mockRejectedValue(new ApiError(502, 'BAD_SHAPE'));
    renderWindows('employee');
    act(() => homeActions().open('emr-encounter', { norawat: NR }));
    expect(await screen.findByText(/sent data this screen cannot read safely/)).toBeInTheDocument();
  });
});

async function openRecords(norawat: string) {
  renderWindows('employee');
  act(() => homeActions().open('emr-records', { norawat }));
  const win = await screen.findByRole('region', { name: /^Medical Records · / });
  await within(win).findByRole('heading', { name: 'Diagnoses (ICD-10)' });
  const index = within(win).getAllByRole('navigation', { name: /^Sections · / })[0]!;
  return { win, index };
}

describe('Medical Records · claim and SEP by the visit payer code', () => {
  const SELF_PAY = '2026/11/03/000088'; // kd_pj UMU
  const shown = (win: HTMLElement, index: HTMLElement, name: string) =>
    Boolean(within(win).queryByRole('heading', { name })) &&
    Boolean(within(index).queryByText(name));

  /** The synthetic BPJS stay with its payer code replaced everywhere. */
  function withPayerCode(code: string) {
    const original = emrApi.getJourney.bind(emrApi);
    vi.spyOn(emrApi, 'getJourney').mockImplementation(
      async (norawat) =>
        JSON.parse(JSON.stringify(await original(norawat)), (key, v: unknown) =>
          key === 'kd_pj' ? code : v,
        ) as EncounterJourney,
    );
  }

  it('BPJ: claim readiness with the SEP check, and the SEP section', async () => {
    const { win, index } = await openRecords(NR);
    expect(shown(win, index, 'Claim readiness')).toBe(true);
    expect(await within(win).findByText('SEP present (BPJS)')).toBeInTheDocument();
    expect(shown(win, index, 'SEP (BPJS)')).toBe(true);
  });

  /** What hms_services would answer for the BPJS stay after `change` (the browser no longer decides). */
  function serverAnswers(change: (e: ClaimEvaluation) => ClaimEvaluation) {
    vi.spyOn(claimApi, 'evaluate').mockImplementation(async () =>
      change(structuredClone(SYNTHETIC_CLAIM_EVALUATIONS[NR]!)),
    );
  }

  it('another payer (insurer): claim readiness without any SEP part', async () => {
    withPayerCode('A09');
    serverAnswers((e) => ({
      ...e,
      findings: e.findings.filter((f) => f.rule_id !== 'sep_present'),
    }));
    const { win, index } = await openRecords(NR);
    expect(shown(win, index, 'Claim readiness')).toBe(true);
    expect(await within(win).findByText('Primary diagnosis coded')).toBeInTheDocument();
    expect(within(win).queryByText('SEP present (BPJS)')).toBeNull();
    expect(within(win).queryByRole('heading', { name: 'SEP (BPJS)' })).toBeNull();
    expect(within(index).queryByText('SEP (BPJS)')).toBeNull();
  });

  it.each([['UMU'], ['-'], [''], ['KRX']])(
    '%j: the server says no claim applies, so no claim readiness and no SEP',
    async (code) => {
      withPayerCode(code);
      serverAnswers((e) => ({
        ...e,
        status: 'not_applicable',
        applicability: { applies: false, reason: 'payer_not_claimable' },
        findings: [],
      }));
      const { win, index } = await openRecords(NR);
      await waitFor(() =>
        expect(within(win).queryByRole('heading', { name: 'Claim readiness' })).toBeNull(),
      );
      expect(within(index).queryByText('Claim readiness')).toBeNull();
      expect(within(win).queryByRole('heading', { name: 'SEP (BPJS)' })).toBeNull();
    },
  );

  it('the synthetic UMU visit has no claim section', async () => {
    const { win } = await openRecords(SELF_PAY);
    await waitFor(() =>
      expect(within(win).queryByRole('heading', { name: 'Claim readiness' })).toBeNull(),
    );
  });

  it('when the server cannot check, the section says so and offers a retry — never a passed check', async () => {
    vi.spyOn(claimApi, 'evaluate').mockRejectedValue(new ApiError(503, 'service_unavailable'));
    const { win } = await openRecords(NR);
    expect(
      await within(win).findByText('Claim checks are unavailable right now — nothing was checked.'),
    ).toBeInTheDocument();
    expect(within(win).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(within(win).queryByText('Primary diagnosis coded')).toBeNull();
  });
});

describe('Medical Records · discharge summary (inpatient only)', () => {
  const OUTPATIENT = '2026/08/14/000051';

  it('is shown, and listed in the section index, for an inpatient stay', async () => {
    const { win, index } = await openRecords(NR);
    expect(within(win).getByRole('heading', { name: 'Discharge Summary' })).toBeInTheDocument();
    expect(within(index).getByText('Discharge Summary')).toBeInTheDocument();
  });

  const allergyRow = (win: HTMLElement) => {
    const section = within(win)
      .getByRole('heading', { name: 'Discharge Summary' })
      .closest('section')!;
    const label = within(section).getByText('Allergy');
    return { section, label, row: label.parentElement as HTMLElement };
  };

  it('shows the allergy written in the discharge summary first, under the author', async () => {
    const { win } = await openRecords(NR);
    const { section, label, row } = allergyRow(win);
    expect(within(row).getByText('Amoxicillin')).toBeInTheDocument();
    // First labelled row of the summary (before the chief complaint).
    const complaint = within(section).getByText('Chief complaint');
    expect(
      label.compareDocumentPosition(complaint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('an empty allergy in the summary reads "Not recorded", never "no known allergies"', async () => {
    const original = emrApi.getJourney.bind(emrApi);
    vi.spyOn(emrApi, 'getJourney').mockImplementation(async (norawat) => {
      const j = await original(norawat);
      const ds = j.summary.discharge_summary_inpatient;
      return ds
        ? { ...j, summary: { ...j.summary, discharge_summary_inpatient: { ...ds, alergi: '  ' } } }
        : j;
    });
    const { win } = await openRecords(NR);
    const { row } = allergyRow(win);
    expect(within(row).getByText('Not recorded')).toBeInTheDocument();
    expect(within(row).queryByText(/no known/i)).toBeNull();
  });

  it('is left out for an outpatient visit, page and section index alike', async () => {
    const { win, index } = await openRecords(OUTPATIENT);
    expect(within(win).queryByRole('heading', { name: 'Discharge Summary' })).toBeNull();
    expect(within(index).queryByText('Discharge Summary')).toBeNull();
  });

  it('still shows a summary that is recorded on a visit not marked inpatient', async () => {
    const original = emrApi.getJourney.bind(emrApi);
    vi.spyOn(emrApi, 'getJourney').mockImplementation(async (norawat) => {
      const j = await original(norawat);
      if (norawat !== OUTPATIENT) return j;
      const inpatient = await original(NR);
      return {
        ...j,
        summary: {
          ...j.summary,
          discharge_summary_inpatient: inpatient.summary.discharge_summary_inpatient,
        },
      };
    });
    const { win } = await openRecords(OUTPATIENT);
    expect(within(win).getByRole('heading', { name: 'Discharge Summary' })).toBeInTheDocument();
    expect(within(win).getByText('Shortness of breath for 2 days')).toBeInTheDocument();
  });
});
