import { describe, expect, it } from 'vitest';
import { SYNTHETIC_JOURNEYS } from '@/data/emrFixtures';
import type { EncounterJourney } from './journey';
import {
  facts,
  groupAllergies,
  isBpjs,
  labs,
  moments,
  notes,
  radiology,
  sepFacts,
  surgeries,
  unlinkedRadiologyReports,
  unlinkedSurgeryReports,
  vitals,
} from './select';

const inpatient = SYNTHETIC_JOURNEYS[0] as EncounterJourney;
const fresh = SYNTHETIC_JOURNEYS[2] as EncounterJourney;

describe('journey selectors', () => {
  it('orders moments ascending with undated last', () => {
    const j: EncounterJourney = {
      ...fresh,
      data: { undated: { procedures: [] }, '2026-01-02T08:00:00': {}, '2026-01-01': {} },
    };
    expect(moments(j).map((m) => m.key)).toEqual(['2026-01-01', '2026-01-02T08:00:00', 'undated']);
  });

  it('gives CPPT oldest-first by default and newest-first on request', () => {
    const asc = notes(inpatient).map((n) => n.key);
    expect(asc).toEqual([...asc].sort());
    expect(notes(inpatient, 'desc')[0]?.key).toBe(asc[asc.length - 1]);
  });

  it('pairs a radiology report only with the exam of the same date and time, never inventing one', () => {
    const rows = radiology(inpatient);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.report)).toBe(true);
    expect(unlinkedRadiologyReports(inpatient)).toEqual([]);
    const noReport: EncounterJourney = {
      ...inpatient,
      data: Object.fromEntries(
        Object.entries(inpatient.data).map(([k, m]) => [k, { ...m, radiology_report: undefined }]),
      ),
    };
    expect(radiology(noReport).every((r) => r.report === null)).toBe(true);
  });

  it('never attaches a report to a neighbouring exam: one at another time is listed on its own', () => {
    const exam = {
      exam_name: 'Chest X-ray',
      kd_jenis_prw: 'R1',
      doctor_name: null,
      radiographer_name: null,
      referring_doctor_name: null,
      proyeksi: '',
      status: 'Ranap' as const,
    };
    const j: EncounterJourney = {
      ...inpatient,
      data: {
        '2026-01-01T08:00:00': { radiology: [exam, { ...exam, exam_name: 'Abdomen' }] },
        '2026-01-01T09:00:00': { radiology: [{ ...exam, exam_name: 'Pelvis' }] },
        // Written at a time no exam has (the old code paired it with the first earlier exam).
        '2026-01-01T10:30:00': { radiology_report: [{ hasil: 'Stray report' }] },
        undated: {
          radiology: [{ ...exam, exam_name: 'Undated' }],
          radiology_report: [{ hasil: 'Undated report' }],
        },
      },
    };
    j.data['2026-01-01T08:00:00']!.radiology_report = [{ hasil: 'Shared report' }];
    const rows = radiology(j);
    // One report covers every exam of its time.
    expect(rows.map((r) => [r.exam_name, r.report])).toEqual([
      ['Chest X-ray', 'Shared report'],
      ['Abdomen', 'Shared report'],
      ['Pelvis', null],
      ['Undated', null],
    ]);
    expect(unlinkedRadiologyReports(j).map((r) => r.hasil)).toEqual([
      'Stray report',
      'Undated report',
    ]);
  });

  it('pairs a surgery report only with the surgery of the same date and time', () => {
    const op = {
      surgery_name: 'Appendectomy',
      operator1_name: null,
      anesthetist_name: null,
      jenis_anasthesi: '',
      kategori: '',
      status: 'Ranap' as const,
    };
    const report = {
      diagnosa_preop: 'pre',
      diagnosa_postop: 'post',
      laporan_operasi: 'done',
      komplikasi: 'Tidak' as const,
      perdarahan: 'Tidak' as const,
      selesaioperasi: '',
      tanggal: '',
    };
    const j: EncounterJourney = {
      ...inpatient,
      data: {
        '2026-01-01T08:00:00': { surgery: [op], surgery_report: [report] },
        '2026-01-02T08:00:00': { surgery: [{ ...op, surgery_name: 'Second' }] },
        '2026-01-03T08:00:00': { surgery_report: [{ ...report, laporan_operasi: 'stray' }] },
      },
    };
    expect(surgeries(j).map((s) => [s.surgery_name, s.report?.laporan_operasi ?? null])).toEqual([
      ['Appendectomy', 'done'],
      ['Second', null],
    ]);
    expect(unlinkedSurgeryReports(j).map((r) => r.laporan_operasi)).toEqual(['stray']);
  });

  it('groups allergy entries by exact text, latest first, keeping where each was last written', () => {
    const entries = groupAllergies([
      {
        text: 'Latex',
        at: '2026-01-01T08:00:00',
        encounter: 'A',
        source: 'clinical_note_outpatient',
      },
      {
        text: 'Penicillin',
        at: '2026-03-01T08:00:00',
        encounter: 'B',
        source: 'clinical_note_inpatient',
      },
      {
        text: 'Latex',
        at: '2026-02-01T08:00:00',
        encounter: 'C',
        source: 'clinical_note_inpatient',
      },
      { text: 'latex', at: null, encounter: 'D', source: 'discharge_summary' },
    ]);
    expect(entries).toEqual([
      {
        text: 'Penicillin',
        lastRecorded: '2026-03-01 08:00:00',
        lastEncounter: 'B',
        source: 'clinical_note_inpatient',
        timesRecorded: 1,
      },
      {
        text: 'Latex',
        lastRecorded: '2026-02-01 08:00:00',
        lastEncounter: 'C',
        source: 'clinical_note_inpatient',
        timesRecorded: 2,
      },
      // A different spelling is its own entry; undated entries come last.
      {
        text: 'latex',
        lastRecorded: null,
        lastEncounter: 'D',
        source: 'discharge_summary',
        timesRecorded: 1,
      },
    ]);
  });

  it('takes vitals only from CPPT notes that have them', () => {
    expect(vitals(inpatient).length).toBeGreaterThan(0);
    expect(vitals(fresh)).toHaveLength(0);
  });

  it('keeps lab flags exactly as the source sent them', () => {
    const flags = labs(inpatient).flatMap((l) => l.results.map((r) => r.keterangan));
    expect(flags).toContain('H');
    expect(flags).toContain('');
  });

  it('never turns missing allergy text into "no known allergies"', () => {
    // Every distinct text of the visit, newest note first — not only the latest one.
    expect(facts(inpatient).allergy).toEqual({
      state: 'recorded',
      texts: ['Amoxicillin — rash (patient report)', 'Amoxicillin'],
    });
    expect(facts(fresh).allergy).toEqual({ state: 'notRecorded' });
  });

  it('derives the stay facts from room_stay and summary', () => {
    const f = facts(inpatient);
    expect(f).toMatchObject({
      lengthOfStay: 4,
      ward: 'Melati',
      dpjp: 'dr. Andi Pratama, Sp.PD',
      payerType: 'bpjs',
      deceased: false,
    });
    expect(f.discharged).toBe('2026-10-30 10:00:00');
  });
});

describe('SEP', () => {
  it('tells "not sent by the API" apart from "none recorded" and "present" (number in full, B-1)', () => {
    expect(sepFacts(fresh)).toEqual({ state: 'unavailable' });
    expect(sepFacts({ ...inpatient, summary: { ...inpatient.summary, sep: [] } })).toEqual({
      state: 'none',
    });
    const present = sepFacts(inpatient);
    expect(present.state).toBe('present');
    if (present.state === 'present') expect(present.records[0]?.no_sep).toBe('0301R0011026V000123');
  });
});

describe('payer code rules', () => {
  it('reads the visit payer code', () => {
    expect(facts(inpatient).payerCode).toBe('BPJ');
    expect(facts(fresh).payerCode).toBe('UMU');
  });

  it('BPJS (the only payer with an SEP) is BPJ only', () => {
    expect(isBpjs('BPJ')).toBe(true);
    expect(isBpjs(' bpj ')).toBe(true);
    for (const code of [null, '-', 'UMU', 'A09']) expect(isBpjs(code), String(code)).toBe(false);
  });
});
