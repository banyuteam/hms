import type { PatientStatus } from '@/data/syntheticPatients';

/**
 * Patient Detail data model (read side). Field list verified against the Khanza schema snapshot
 * (design/hms_web-frontend-UIUX/web-workspace/patient-profile-fields.md, patient-medical-record-fields.md). Enum values are
 * normalised here; the UI shows English/Indonesian labels (decided 2026-10-29).
 * TODO(contract): replace by the OpenAPI types generated from source/hms_shared once the BFF contract exists.
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

/** `reg_periksa.stts` normalised. Which values the hospital really uses is open (OQ-59). */
export type EncounterStatus =
  'registered' | 'admitted' | 'completed' | 'cancelled' | 'referred' | 'deceased' | 'againstAdvice';

/** `kamar_inap.stts_pulang` normalised (inpatient only). */
export type DischargeOutcome = 'recovered' | 'improved' | 'againstAdvice' | 'referred' | 'deceased';

export type TimelineEventKind =
  | 'registration'
  | 'procedure'
  | 'visit'
  | 'laboratory'
  | 'radiology'
  | 'prescription'
  | 'admission'
  | 'surgery'
  | 'discharge';

/** One thing the hospital did in an encounter. Merged and sorted by the BFF; the UI only renders (encounters-tab-fields.md §2). */
export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  at: string;
  /** Name and key values on one line; clinical text is shown as stored. */
  title: string;
  /** Unit that provided it (shown as stored). */
  unit: string;
  doctor: string | null;
}

/** One `reg_periksa` row with its detail (Figma mockup 15). */
export interface EncounterHistoryItem {
  /** `reg_periksa.no_rawat` — PHI identifier. */
  no: string;
  registeredAt: string;
  care: CareType;
  status: EncounterStatus;
  unit: string;
  responsibleDoctor: string;
  admittedAt: string | null;
  /** Empty while the patient is still admitted. */
  dischargedAt: string | null;
  lengthOfStayDays: number | null;
  outcome: DischargeOutcome | null;
  payer: string;
  sepNo: MaskedText | null;
  /** Oldest first. */
  timeline: TimelineEvent[];
}

/**
 * Medical Record tab: high-level summary, one block per encounter (patient-medical-record-fields.md §1, §2a).
 * Read-only digest; fees and prices are Billing data and never appear here. Clinical free text is shown as stored (OQ-34).
 */
export interface MrDiagnosis {
  code: string;
  name: string;
  /** `diagnosa_pasien.prioritas`: 1 → primary. */
  priority: number;
  isNew: boolean;
}

export interface MrAssessment {
  chiefComplaint: string;
  presentIllness: string;
  pastIllness: string;
  familyHistory: string;
  medicationHistory: string;
  assessedAt: string;
  kind: 'admission' | 'outpatient';
}

export interface MrLabResult {
  id: string;
  name: string;
  at: string;
  /** Value and reference range as stored (text); the UI derives no High/Low flag (OQ-66). */
  values: string | null;
  /** `detail_periksa_lab.keterangan`: free-text detail of the result. */
  note: string | null;
}

export interface MrRadiologyResult {
  id: string;
  name: string;
  at: string;
  reading: string;
}

export interface MrTherapy {
  id: string;
  name: string;
  period: string;
  orderedAt: string;
  orderedBy: string;
  dosesGiven: number | null;
}

export interface MrProcedure {
  id: string;
  at: string;
  name: string;
  role: 'doctor' | 'nurse' | 'doctorNurse';
  by: string;
  /** Coded ICD-9-CM procedure used for claims, when there is one. */
  icd9: string | null;
}

/** `resume_pasien_ranap.keadaan` / `cara_keluar` / `dilanjutkan` normalised. */
export type MrCondition = 'improved' | 'recovered' | 'special' | 'deceased';
export type MrWayOfLeaving = 'doctorPermission' | 'transferred' | 'ownRequest' | 'other';
export type MrCareContinues =
  'returnHere' | 'otherHospital' | 'externalDoctor' | 'healthCentre' | 'other';

export interface MrOutcome {
  treatment: string;
  diet: string | null;
  room: string | null;
  lengthOfStayDays: number | null;
  condition: MrCondition | null;
  wayOfLeaving: MrWayOfLeaving | null;
}

export interface MrFollowUp {
  careContinues: MrCareContinues | null;
  controlVisit: string | null;
  /** Date of the control visit (`surat_kontrol_umum.tanggal_datang`), when known; drives "open follow-up". */
  controlAt: string | null;
  referral: string | null;
  takeHome: string | null;
  dietEducation: string | null;
  pendingResults: string | null;
}

/** Acknowledgement by the doctor in charge (OQ-65): a verification flag, not a legally valid e-signature. */
export interface MrSignature {
  doctor: string;
  status: 'signed' | 'unsigned';
  at: string | null;
}

export interface MrEncounter {
  no: string;
  registeredAt: string;
  care: CareType;
  unit: string;
  /** Still open: sections 5–7 show "Not discharged yet". */
  open: boolean;
  admissionDiagnosis: string | null;
  diagnoses: MrDiagnosis[];
  assessment: MrAssessment | null;
  physicalExam: string | null;
  labs: MrLabResult[];
  radiology: MrRadiologyResult[];
  therapy: MrTherapy[];
  notes: ClinicalNote[];
  procedures: MrProcedure[];
  outcome: MrOutcome | null;
  followUp: MrFollowUp | null;
  signature: MrSignature;
}

export interface MedicalRecordSummary {
  /** Patient-level (not per encounter): `alergi_pasien` has no usable link to `no_rawat`. */
  allergies: Allergy[];
  /** Newest encounter first. */
  encounters: MrEncounter[];
}
