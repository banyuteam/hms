import patients from './patients.json';

/**
 * SYNTHETIC demo rows, stored in `src/data/patients.json` (invented names and MRNs). Never add real patient data there.
 * Master-data text (insurer, service, doctor) is not translated.
 * JSON widens enums to `string`, so the cast below is the single trust point; `src/data/mocks.test.ts` guards the shape.
 */
export type PatientStatus = 'outpatient' | 'inpatient' | 'emergency' | 'discharged';

export interface SyntheticPatient {
  mrn: string;
  name: string;
  age: number;
  sex: 'male' | 'female';
  insurer: string;
  service: string;
  doctor: string;
  status: PatientStatus;
}

export const SYNTHETIC_PATIENTS: readonly SyntheticPatient[] = patients as SyntheticPatient[];
