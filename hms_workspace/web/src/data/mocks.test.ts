import { describe, expect, it } from 'vitest';
import { SYNTHETIC_PATIENTS } from '@/data/syntheticPatients';
import { findSyntheticRecord } from '@/data/syntheticRecords';
import records from './records.json';

/**
 * Guards the demo JSON against drift from `src/api/types.ts` (`PatientCore`). JSON imports lose the enum types, so the allowed values are
 * repeated here: when a union in types.ts changes, update this list too.
 */
const STATUS = ['outpatient', 'inpatient', 'emergency', 'discharged'];
const RELATIONSHIP = ['father', 'mother', 'husband', 'wife', 'sibling', 'child'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isMasked = (v: unknown) =>
  isObject(v) &&
  typeof v.value === 'string' &&
  typeof v.masked === 'string' &&
  v.value !== v.masked;

const TOP_LEVEL_KEYS = [
  'mrn',
  'name',
  'sex',
  'birthDate',
  'ageYears',
  'nik',
  'motherName',
  'birthPlace',
  'bloodType',
  'maritalStatus',
  'religion',
  'education',
  'occupation',
  'firstRegistered',
  'address',
  'phone',
  'email',
  'responsiblePerson',
].sort();

describe('demo JSON (src/data)', () => {
  it('has one unique record per patient row, in the same order', () => {
    const rows = SYNTHETIC_PATIENTS.map((p) => p.mrn);
    expect(new Set(rows).size).toBe(rows.length);
    expect((records as { mrn: string }[]).map((r) => r.mrn)).toEqual(rows);
  });

  it.each(SYNTHETIC_PATIENTS.map((p) => [p.mrn, p] as const))(
    'patient row %s is well-formed',
    (_mrn, p) => {
      expect(Object.keys(p).sort()).toEqual([
        'age',
        'doctor',
        'insurer',
        'mrn',
        'name',
        'service',
        'sex',
        'status',
      ]);
      expect(['male', 'female']).toContain(p.sex);
      expect(STATUS).toContain(p.status);
      expect(Number.isInteger(p.age) && p.age >= 0).toBe(true);
    },
  );

  it.each(SYNTHETIC_PATIENTS.map((p) => [p.mrn, p] as const))(
    'record %s matches its patient row and types',
    (mrn, row) => {
      const r = findSyntheticRecord(mrn);
      expect(r).toBeDefined();
      if (!r) return;
      expect(Object.keys(r).sort()).toEqual(TOP_LEVEL_KEYS);
      expect({ name: r.name, sex: r.sex, ageYears: r.ageYears }).toEqual({
        name: row.name,
        sex: row.sex,
        ageYears: row.age,
      });
      expect(['A', 'B', 'O', 'AB', 'unknown']).toContain(r.bloodType);
      expect(['single', 'married', 'widowedDivorced']).toContain(r.maritalStatus);
      expect(RELATIONSHIP).toContain(r.responsiblePerson.relationship);
    },
  );

  it.each(SYNTHETIC_PATIENTS.map((p) => p.mrn))('record %s is masked and synthetic', (mrn) => {
    const r = findSyntheticRecord(mrn)!;
    for (const m of [r.nik, r.phone, r.email, r.address.line]) expect(isMasked(m)).toBe(true);
    expect(r.email.value.endsWith('@example.com')).toBe(true);
  });
});
