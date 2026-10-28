import type { PatientStatus } from '@/data/syntheticPatients';

/**
 * Patient Detail data model (read side). Field list verified against the Khanza schema snapshot
 * (design/web-frontend/patient-profile-fields.md, patient-medical-record-fields.md). Enum values are
 * normalised here; the UI shows English/Indonesian labels (decided 2026-10-29).
 * TODO(contract): replace by the OpenAPI types generated from source/shared once the BFF contract exists.
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
export type CareType = 'inpatient' | 'outpatient';

/** PHI that is masked by default; `value` is only rendered after an audited reveal. */
export interface MaskedText {
  value: string;
  masked: string;
}

export interface Address {
  line: MaskedText;
  village: string;
  district: string;
  city: string;
  province: string;
}

export interface Diagnosis {
  encounterNo: string;
  code: string;
  /** Shown as stored (not translated). */
  name: string;
  /** `diagnosa_pasien.prioritas`: 1 → primary. */
  priority: number;
  isNew: boolean;
  care: CareType;
}

export interface ClinicalNote {
  id: string;
  encounterNo: string;
  at: string;
  author: string;
  kind: 'progress' | 'nursing' | 'admission';
  /** SOAP (progress notes) or free text — clinical free text is shown as stored. */
  soap?: { s: string; o: string; a: string; p: string };
  text?: string;
}

export interface Allergy {
  id: string;
  allergen: string;
  reaction: string;
  /** Vocabulary of these columns is undefined in the DDL (OQ-54): placeholders until real values are known. */
  category: 'medication' | 'food' | 'other';
  type: 'allergy' | 'intolerance';
  criticality: 'low' | 'high' | 'unknown';
  status: 'active' | 'inactive';
  verification: 'confirmed' | 'unconfirmed';
  recordedAt: string;
}

export interface MedicalHistory {
  chiefComplaint: string;
  presentIllness: string;
  pastIllness: string;
  familyHistory: string;
  medicationHistory: string;
  assessedAt: string;
}

export interface Vitals {
  at: string;
  systolic: number;
  diastolic: number;
  heartRate: number;
  respiratoryRate: number;
  temperatureC: number;
  spo2: number;
  weightKg: number;
}

export interface Medication {
  name: string;
  dose: string;
  status: 'ongoing' | 'stopped';
}

export interface Sep {
  no: MaskedText;
  date: string;
  care: CareType;
  careClass: 1 | 2 | 3;
  referralFrom: 'faskes1' | 'faskes2';
  referrer: string;
  initialDiagnosis: string;
  cob: boolean;
}

export interface Encounter {
  no: string;
  admittedAt: string;
  care: CareType;
  service: string;
  attending: string;
  room: string;
  primaryDx: string;
  secondaryDx: string;
  dischargePlan: 'underTreatment' | 'planned' | 'discharged';
  guarantor: string;
  sep: Sep | null;
  responsible: { name: string; relationship: Relationship; address: MaskedText };
}

export interface PatientRecord {
  mrn: string;
  name: string;
  sex: Sex;
  birthDate: string;
  ageYears: number;
  status: PatientStatus;
  nik: MaskedText;
  birthPlace: string;
  bloodType: BloodType;
  maritalStatus: MaritalStatus;
  religion: string;
  education: Education;
  occupation: string;
  ethnicity: string;
  language: string;
  motherName: string;
  disability: string | null;
  firstRegistered: string;
  lastVisit: string;
  encounterCount: number;
  phone: MaskedText;
  email: MaskedText;
  address: Address;
  guarantor: {
    name: string;
    membershipNo: MaskedText;
    employer: string | null;
    insurerPhone: string | null;
  };
  responsiblePerson: {
    name: string;
    relationship: Relationship;
    occupation: string;
    address: Address;
  };
  currentEncounter: Encounter;
  diagnoses: Diagnosis[];
  history: MedicalHistory;
  notes: ClinicalNote[];
  allergies: Allergy[];
  vitals: Vitals;
  medications: Medication[];
}
