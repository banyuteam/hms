/**
 * Patient profile model (read side): what the identity strip and the Patient Profile window read. Live data is mapped
 * into it from clinical-read-v1 (`livePatientApi.ts`); demo data comes from `src/data/records.json`. Enum values are
 * normalised here; the UI shows English/Indonesian labels.
 */
export type Sex = 'male' | 'female';
export type BloodType = 'A' | 'B' | 'O' | 'AB' | 'unknown';
export type MaritalStatus = 'single' | 'married' | 'widowedDivorced';
/** Stored codes of `pasien.pnd`. */
export type Education =
  | 'TS'
  | 'TK'
  | 'SD'
  | 'SMP'
  | 'SMA'
  | 'SLTA'
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'S1'
  | 'S2'
  | 'S3'
  | 'none';
export type Relationship = 'father' | 'mother' | 'husband' | 'wife' | 'sibling' | 'child';

/** PHI that is masked by default; `value` is only rendered after an audited reveal. */
export interface MaskedText {
  /** The full value, when the client already holds it (synthetic data only). '' with live data. */
  value: string;
  masked: string;
  /**
   * Live data: asks the server for the full value. The server authorizes the reveal and records it in the audit trail
   * before answering; the value is never held in the browser until then.
   */
  reveal?: () => Promise<string>;
}

export interface Address {
  line: MaskedText;
  /** `false` = the source only has codes for village / district / city / province (live API; names requested in contract request 09, P-1): say so, do not show them as blank. */
  namesAvailable?: boolean;
  village: string;
  district: string;
  city: string;
  province: string;
}

/**
 * What the identity strip and the remodel Profile window read. Synthetic records always fill it; live data (dev) may lack a
 * value: `null` / 'unknown' mean "not recorded" and the UI must say so, never guess.
 */
export interface PatientCore {
  mrn: string;
  name: string;
  sex: Sex | 'unknown';
  birthDate: string | null;
  ageYears: number | null;
  nik: MaskedText;
  motherName: string;
  /** Background (W1). '' / `null` / 'unknown' (blood type) / 'none' (education) = not recorded. */
  birthPlace: string;
  bloodType: BloodType;
  maritalStatus: MaritalStatus | null;
  religion: string;
  education: Education;
  occupation: string;
  firstRegistered: string | null;
  address: Address;
  phone: MaskedText;
  email: MaskedText;
  responsiblePerson: {
    name: string;
    relationship: Relationship | 'unknown';
    occupation: string;
    address: Address;
  };
}
