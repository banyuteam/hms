import { SYNTHETIC_PATIENTS, type SyntheticPatient } from '@/data/syntheticPatients';
import records from './records.json';
import type { PatientCore } from '@/api/types';

/**
 * SYNTHETIC patient profiles for the demo data path, stored in `src/data/records.json`. Names, MRNs and every value are
 * invented. Free text is Indonesian on purpose: data is shown as stored, never translated. Never add real patient data there.
 * JSON widens enums to `string`, so the cast below is the single trust point; `src/data/mocks.test.ts` guards the shape.
 */
const RECORDS = new Map<string, PatientCore>(
  (records as unknown as PatientCore[]).map((record) => [record.mrn, record]),
);

export function findSyntheticRecord(mrn: string): PatientCore | undefined {
  return RECORDS.get(mrn);
}

export function listSyntheticPatients(): readonly SyntheticPatient[] {
  return SYNTHETIC_PATIENTS;
}
