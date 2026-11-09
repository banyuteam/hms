import { describe, expect, it } from 'vitest';
import { matchesPatient, normalizeSearchText, searchPatients, searchTerms } from './patientSearch';

// Synthetic names only.
const PEOPLE = [
  { mrn: '00012346', name: 'Siti Nurhaliza' },
  { mrn: '00012345', name: 'Budi Santoso' },
  { mrn: '00012344', name: 'Ratna Dewi' },
  { mrn: '00012340', name: 'Dewi Anggraini' },
  { mrn: '00012339', name: 'Rizky Ramadhan' },
];
const names = (q: string) => searchPatients(PEOPLE, q).map((p) => p.name);

describe('patient search rule', () => {
  it('normalises case, accents, punctuation and spacing', () => {
    expect(normalizeSearchText('  SITI   Nurhalizá. ')).toBe('siti nurhaliza');
    expect(searchTerms('Nur-haliza,  siti')).toEqual(['nur', 'haliza', 'siti']);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('finds a name from any part of it, in any word order', () => {
    for (const q of [
      'siti',
      'SITI',
      'nurhal',
      'haliza',
      'siti nur',
      'nurhaliza siti',
      'siti  nurhaliza',
      ' siti ',
    ]) {
      expect(names(q), q).toEqual(['Siti Nurhaliza']);
    }
    expect(names('dewi ratna')).toEqual(['Ratna Dewi']);
    expect(names('santoso budi')).toEqual(['Budi Santoso']);
  });

  it('needs every typed word to match', () => {
    expect(names('siti budi')).toEqual([]);
    expect(matchesPatient(PEOPLE[0]!, [])).toBe(false);
  });

  it('finds by full or partial MRN, and an exact MRN comes first', () => {
    expect(names('00012346')).toEqual(['Siti Nurhaliza']);
    expect(names('12346')).toEqual(['Siti Nurhaliza']);
    expect(searchPatients(PEOPLE, '0001234').length).toBe(4);
  });

  it('ranks names that start with the typed word before other matches', () => {
    // "dewi": "Dewi Anggraini" starts with it; "Ratna Dewi" has it as a later word.
    expect(names('dewi')).toEqual(['Dewi Anggraini', 'Ratna Dewi']);
    // "ra": word-start matches (Ratna, Rizky Ramadhan) before the inside match (Anggraini).
    expect(names('ra')).toEqual(['Ratna Dewi', 'Rizky Ramadhan', 'Dewi Anggraini']);
  });
});
