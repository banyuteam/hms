import type {
  ClinicalNote,
  EncounterJourney,
  JourneyMoment,
  Laboratory,
  MedicationGiven,
  Prescription,
  ProcedureAction,
  Radiology,
  RoomStay,
  SepRecord,
  Surgery,
  SurgeryReport,
} from './journey';

/**
 * Pure read-side selectors over one journey document. They never invent values:
 * missing data stays `null` and the UI says "Not recorded" / "Not available from source".
 */

export interface Stamp {
  /** Journey key as stored (`YYYY-MM-DDTHH:MM:SS`, `YYYY-MM-DD` or `undated`). */
  key: string;
}

export interface Moment extends Stamp {
  moment: JourneyMoment;
}

/** Ascending, as the contract delivers (`undated` last). */
export function moments(j: EncounterJourney): Moment[] {
  return Object.entries(j.data)
    .map(([key, moment]) => ({ key, moment }))
    .sort((a, b) => sortKey(a.key).localeCompare(sortKey(b.key)));
}

function sortKey(key: string): string {
  return key === 'undated' ? '9999' : key;
}

function collect<K extends keyof JourneyMoment>(
  j: EncounterJourney,
  seg: K,
): (NonNullable<JourneyMoment[K]>[number] & Stamp & { index: number })[] {
  const out: (NonNullable<JourneyMoment[K]>[number] & Stamp & { index: number })[] = [];
  for (const { key, moment } of moments(j)) {
    const list = (moment[seg] ?? []) as NonNullable<JourneyMoment[K]>;
    list.forEach((item, index) => out.push({ ...(item as object), key, index } as never));
  }
  return out;
}

export type NoteRow = ClinicalNote & Stamp & { index: number };
export type LabRow = Laboratory & Stamp & { index: number; id: string };
export type RadiologyRow = Radiology & Stamp & { index: number; id: string; report: string | null };
export type PrescriptionRow = Prescription & Stamp & { index: number };
export type GivenRow = MedicationGiven & Stamp & { index: number };
export type ActionRow = ProcedureAction & Stamp & { index: number };
export type SurgeryRow = Surgery & Stamp & { index: number; report: SurgeryReport | null };

export const notes = (j: EncounterJourney, order: 'asc' | 'desc' = 'asc'): NoteRow[] => {
  const rows = collect(j, 'clinical_notes');
  return order === 'asc' ? rows : rows.reverse();
};

export const labs = (j: EncounterJourney): LabRow[] =>
  collect(j, 'laboratory').map((r) => ({ ...r, id: `lab:${r.key}:${r.index}` }));

/** Pairs each exam with the next unassigned report (reports arrive at a later timestamp than the exam). */
export function radiology(j: EncounterJourney): RadiologyRow[] {
  const exams = collect(j, 'radiology').map((r) => ({
    ...r,
    id: `rad:${r.key}:${r.index}`,
    report: null as string | null,
  }));
  const reports = collect(j, 'radiology_report');
  for (const rep of reports) {
    const target = exams.find((e) => e.report === null && e.key <= rep.key);
    if (target) target.report = rep.hasil;
  }
  return exams;
}

export const prescriptions = (j: EncounterJourney): PrescriptionRow[] => collect(j, 'prescription');
export const medicationGiven = (j: EncounterJourney): GivenRow[] => collect(j, 'medication_given');
export const actions = (j: EncounterJourney): ActionRow[] => collect(j, 'procedures');

export function surgeries(j: EncounterJourney): SurgeryRow[] {
  const reports = collect(j, 'surgery_report');
  return collect(j, 'surgery').map((s, i) => ({ ...s, report: reports[i] ?? null }));
}

export type VitalKey = 'tensi' | 'nadi' | 'respirasi' | 'suhu_tubuh' | 'spo2' | 'gcs';
export const VITAL_KEYS: readonly VitalKey[] = [
  'tensi',
  'nadi',
  'respirasi',
  'suhu_tubuh',
  'spo2',
  'gcs',
];

/** Vital signs exist only inside CPPT notes in this contract — there is no separate vitals segment. */
export function vitals(j: EncounterJourney): NoteRow[] {
  return notes(j).filter((n) => VITAL_KEYS.some((k) => (n[k] ?? '').trim() !== ''));
}

export function roomStay(j: EncounterJourney): RoomStay | null {
  return collect(j, 'room_stay')[0] ?? null;
}

export interface EncounterFacts {
  norawat: string;
  mrn: string | null;
  admittedKey: string | null;
  /** `YYYY-MM-DD HH:MM:SS` as stored, or null when still admitted / outpatient. */
  discharged: string | null;
  lengthOfStay: number | null;
  ward: string | null;
  roomClass: string | null;
  dischargeStatus: string | null;
  careSetting: 'inpatient' | 'outpatient' | null;
  department: string | null;
  dpjp: string | null;
  payer: string | null;
  payerType: 'bpjs' | 'insurer' | 'personal' | null;
  /** Payer code of the visit as stored (`reg_periksa.kd_pj`); null / '' / '-' = none recorded. */
  payerCode: string | null;
  status: string | null;
  deceased: boolean;
  allergy: { state: 'recorded'; text: string } | { state: 'notRecorded' };
  truncated: string[];
  sep: SepFacts;
}

export type SepFacts =
  | { state: 'unavailable' }
  | { state: 'none' }
  | { state: 'present'; records: SepRecord[] };

/**
 * SEPs of the visit. The SEP number is shown in full: it arrives in the audited timeline read (owner decision B-1,
 * ADR-SVC-007), so there is no separate reveal.
 */
export function sepFacts(j: EncounterJourney): SepFacts {
  const list = j.summary.sep;
  if (list === undefined) return { state: 'unavailable' };
  if (list.length === 0) return { state: 'none' };
  return { state: 'present', records: list };
}

export function facts(j: EncounterJourney): EncounterFacts {
  const all = moments(j);
  const reg = all.find((m) => m.moment.registration)?.moment.registration?.[0] ?? null;
  const stay = roomStay(j);
  const enc = j.summary.encounter;
  const dpjp =
    [...j.summary.attending_doctors].sort((a, b) => a.prioritas - b.prioritas)[0]?.doctor_name ??
    reg?.doctor_name ??
    null;
  const allergyTexts = [
    ...notes(j, 'desc').map((n) => n.alergi ?? ''),
    j.summary.discharge_summary_inpatient?.alergi ?? '',
  ]
    .map((t) => t.trim())
    .filter(Boolean);
  const deceased =
    enc?.stts === 'Meninggal' ||
    stay?.stts_pulang === 'Meninggal' ||
    j.summary.discharge_summary_inpatient?.keadaan === 'Meninggal';
  return {
    norawat: j.no_rawat,
    mrn: j.no_rkm_medis,
    admittedKey: all[0]?.key ?? null,
    discharged: stay?.tgl_keluar ? `${stay.tgl_keluar} ${stay.jam_keluar ?? ''}`.trim() : null,
    lengthOfStay: stay?.lama ?? null,
    ward: stay?.ward_name ?? null,
    roomClass: stay?.room_class ?? null,
    dischargeStatus: stay?.stts_pulang ?? null,
    careSetting: enc?.care_setting ?? reg?.care_setting ?? null,
    department: reg?.department_name ?? null,
    dpjp,
    payer: enc?.payer_name ?? reg?.payer_name ?? null,
    payerType: enc?.payer_type ?? reg?.payer_type ?? null,
    payerCode: enc?.kd_pj ?? reg?.kd_pj ?? null,
    status: enc?.stts ?? reg?.stts ?? null,
    deceased,
    // Never "no known allergies": an empty text only means nothing was written.
    allergy: allergyTexts[0]
      ? { state: 'recorded', text: allergyTexts[0] }
      : { state: 'notRecorded' },
    truncated: j.meta.truncated,
    sep: sepFacts(j),
  };
}

/**
 * BPJS visit (payer code BPJ): the only payer with an SEP; decides whether the SEP records are shown. Claim readiness
 * (including which payers need a claim) is evaluated by hms_services, not here (ADR-SVC-006).
 */
export function isBpjs(code: string | null): boolean {
  return (code ?? '').trim().toUpperCase() === 'BPJ';
}
