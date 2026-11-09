import { describe, expect, it } from 'vitest';
import { SYNTHETIC_JOURNEYS } from '@/data/emrFixtures';
import type { EncounterJourney } from './journey';
import { facts, isBpjs, labs, moments, notes, radiology, sepFacts, vitals } from './select';

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

  it('pairs radiology exams with the next report, never inventing one', () => {
    const rows = radiology(inpatient);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.report)).toBe(true);
    const noReport: EncounterJourney = {
      ...inpatient,
      data: Object.fromEntries(
        Object.entries(inpatient.data).map(([k, m]) => [k, { ...m, radiology_report: undefined }]),
      ),
    };
    expect(radiology(noReport).every((r) => r.report === null)).toBe(true);
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
    expect(facts(inpatient).allergy).toEqual({
      state: 'recorded',
      text: expect.stringContaining('Amoxicillin'),
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
