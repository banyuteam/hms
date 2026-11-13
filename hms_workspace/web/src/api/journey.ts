/**
 * The encounter ("journey") model the EMR windows read. Live data: clinical-timeline-v1 is validated and mapped into it
 * by `liveTimeline.ts`; demo data: `src/data/emrFixtures.ts`. Field names follow the legacy Khanza columns (Bahasa
 * Indonesia); the UI maps them in `select.ts`. Only the segments the windows read are typed; nothing is guessed.
 */
export type Nullable<T> = T | null;
export type CareSetting = 'inpatient' | 'outpatient';
export type PayerType = 'bpjs' | 'insurer' | 'personal';
export type Kesadaran =
  | 'Compos Mentis'
  | 'Somnolence'
  | 'Sopor'
  | 'Coma'
  | 'Alert'
  | 'Confusion'
  | 'Voice'
  | 'Pain'
  | 'Unresponsive';
export type EncounterStts =
  | 'Belum'
  | 'Sudah'
  | 'Batal'
  | 'Berkas Diterima'
  | 'Dirujuk'
  | 'Meninggal'
  | 'Dirawat'
  | 'Pulang Paksa'
  | 'Berkas Terkirim';

export interface Registration {
  care_setting: Nullable<CareSetting>;
  department_name: Nullable<string>;
  doctor_name: Nullable<string>;
  kd_dokter: Nullable<string>;
  kd_pj: string;
  no_reg: Nullable<string>;
  payer_name: Nullable<string>;
  payer_type: Nullable<PayerType>;
  status_lanjut: 'Ralan' | 'Ranap';
  /** null = not recorded, or a code outside the legacy list. */
  stts: Nullable<EncounterStts>;
}

export interface RoomStay {
  diagnosa_awal: Nullable<string>;
  diagnosa_akhir: Nullable<string>;
  tgl_masuk: string;
  jam_masuk: string;
  tgl_keluar: Nullable<string>;
  jam_keluar: Nullable<string>;
  kd_kamar: string;
  lama: Nullable<number>;
  room_class: string;
  stts_pulang: string;
  ward_name: Nullable<string>;
}

/** CPPT entry (Catatan Perkembangan Pasien Terintegrasi). Free text is shown as stored. */
export interface ClinicalNote {
  care_setting: CareSetting;
  author_name: Nullable<string>;
  nip: string;
  keluhan: Nullable<string>;
  pemeriksaan: Nullable<string>;
  penilaian: string;
  rtl?: Nullable<string>;
  instruksi: string;
  evaluasi: string;
  alergi: Nullable<string>;
  kesadaran: Kesadaran;
  tensi: Nullable<string>;
  nadi: Nullable<string>;
  respirasi?: Nullable<string>;
  suhu_tubuh: Nullable<string>;
  spo2?: Nullable<string>;
  gcs: Nullable<string>;
  ews?: Nullable<string>;
  berat?: Nullable<string>;
  tinggi?: Nullable<string>;
}

/** Billed service / action (`data.procedures`) — NOT the ICD-9-CM coded list (`summary.coded_procedures`). */
export interface ProcedureAction {
  care_setting: CareSetting;
  performed_by: 'doctor' | 'nurse' | 'doctor_and_nurse';
  procedure_name: Nullable<string>;
  kd_jenis_prw: string;
  doctor_name?: Nullable<string>;
  staff_name?: Nullable<string>;
}

export interface LabResultLine {
  id_template: number;
  item_name: Nullable<string>;
  nilai: string;
  nilai_rujukan: string;
  unit: Nullable<string>;
  /** Source flag text (e.g. "H", "L"); the UI never derives a flag itself. */
  keterangan: string;
}

export interface Laboratory {
  test_name: Nullable<string>;
  kategori: 'PA' | 'PK' | 'MB';
  kd_jenis_prw: string;
  doctor_name: Nullable<string>;
  analyst_name: Nullable<string>;
  referring_doctor_name: Nullable<string>;
  results: LabResultLine[];
  status: 'Ralan' | 'Ranap';
}

export interface Radiology {
  exam_name: Nullable<string>;
  kd_jenis_prw: string;
  doctor_name: Nullable<string>;
  radiographer_name: Nullable<string>;
  referring_doctor_name: Nullable<string>;
  proyeksi: string;
  status: 'Ranap' | 'Ralan';
}

export interface RadiologyReport {
  hasil: string;
}

export interface PrescriptionItem {
  drug_name: Nullable<string>;
  aturan_pakai: string;
  jml: Nullable<number>;
  unit: Nullable<string>;
  kode_brng: Nullable<string>;
}

export interface Prescription {
  no_resep: string;
  doctor_name: Nullable<string>;
  tgl_peresepan: Nullable<string>;
  jam_peresepan: Nullable<string>;
  /** Handed over to the patient/ward (Khanza "penyerahan"); a separate state from prescribing. */
  tgl_penyerahan: string;
  jam_penyerahan: string;
  items: PrescriptionItem[];
  compounds: { nama_racik: string; aturan_pakai: string; jml_dr: number; keterangan: string }[];
  status: 'ralan' | 'ranap';
}

/** Khanza "pemberian obat": issued/charged to the patient — NOT a dose-by-dose administration record. */
export interface MedicationGiven {
  drug_name: Nullable<string>;
  jml: number;
  unit: Nullable<string>;
  kode_brng: string;
  no_batch: string;
  dose_instructions: { aturan: Nullable<string> }[];
  ward_name: Nullable<string>;
  status: 'Ralan' | 'Ranap';
}

export interface Surgery {
  surgery_name: Nullable<string>;
  operator1_name: Nullable<string>;
  anesthetist_name: Nullable<string>;
  jenis_anasthesi: string;
  kategori: string;
  status: 'Ranap' | 'Ralan';
}

export interface SurgeryReport {
  diagnosa_preop: string;
  diagnosa_postop: string;
  laporan_operasi: string;
  komplikasi: 'Ya' | 'Tidak';
  perdarahan: 'Ya' | 'Tidak';
  selesaioperasi: string;
  tanggal: string;
}

/**
 * Inpatient admission order (Surat Perintah Rawat Inap, legacy `perintah_ranap`), at most one per visit
 * (clinical-timeline-v1 1.4.0). The legacy row stores a date only: its moment is 00:00 of that date and
 * `time_recorded` is false, so 00:00 is never shown as a recorded time.
 */
export interface AdmissionOrder {
  time_recorded: boolean;
  kd_kamar: string;
  nm_bangsal: Nullable<string>;
  kelas: Nullable<string>;
  diagnosa: Nullable<string>;
  catatan: Nullable<string>;
  nm_dpjp: Nullable<string>;
}

/** Body regions of the emergency assessment's physical exam, each 'Normal' / 'Abnormal' / 'Tidak Diperiksa' as recorded. */
export const EXAM_REGIONS = [
  'kepala',
  'mata',
  'gigi',
  'leher',
  'thoraks',
  'abdomen',
  'genital',
  'ekstremitas',
] as const;
export type ExamRegion = (typeof EXAM_REGIONS)[number];

/**
 * Emergency department medical assessment (legacy `penilaian_medis_igd`), at most one per visit (clinical-timeline-v1
 * 1.4.0). Free text and legacy codes as recorded; '' / null = not recorded. Its allergy text is not part of the
 * patient allergy list (owner decision 2026-11-11).
 */
export interface EmergencyAssessment {
  doctor_name: Nullable<string>;
  anamnesis: string;
  hubungan: string;
  keluhan_utama: string;
  rps: string;
  rpd: string;
  rpk: string;
  rpo: string;
  alergi: string;
  keadaan: string;
  kesadaran: Nullable<string>;
  gcs: Nullable<string>;
  td: Nullable<string>;
  nadi: Nullable<string>;
  rr: Nullable<string>;
  suhu: Nullable<string>;
  spo: Nullable<string>;
  bb: Nullable<string>;
  tb: Nullable<string>;
  fisik: Record<ExamRegion, Nullable<string>>;
  ket_fisik: string;
  ket_lokalis: string;
  ekg: string;
  rad: string;
  lab: string;
  diagnosis: string;
  tata: string;
  cara_keluar: string;
  deskripsi: string;
  indikasi: string;
}

/** What happened at one timestamp, grouped by segment. Every segment is optional (minProperties: 1). */
export interface JourneyMoment {
  registration?: Registration[];
  room_stay?: RoomStay[];
  clinical_notes?: ClinicalNote[];
  procedures?: ProcedureAction[];
  laboratory?: Laboratory[];
  radiology?: Radiology[];
  radiology_report?: RadiologyReport[];
  prescription?: Prescription[];
  medication_given?: MedicationGiven[];
  surgery?: Surgery[];
  surgery_report?: SurgeryReport[];
  admission_order?: AdmissionOrder[];
  emergency_assessment?: EmergencyAssessment[];
}

export interface DiagnosisCode {
  kd_penyakit: string;
  diagnosis_name: Nullable<string>;
  prioritas: number;
  status: 'Ralan' | 'Ranap';
  /** null = new/existing case not recorded. */
  status_penyakit: 'Lama' | 'Baru' | null;
}

export interface CodedProcedure {
  /** ICD-9-CM code. */
  kode: string;
  procedure_name: Nullable<string>;
  prioritas: number;
  status: 'Ralan' | 'Ranap';
}

export interface DischargeSummaryInpatient {
  keluhan_utama: string;
  jalannya_penyakit: string;
  diagnosa_utama: string;
  kd_diagnosa_utama: string;
  diagnosa_sekunder: string;
  kd_diagnosa_sekunder: string;
  prosedur_utama: string;
  kd_prosedur_utama: string;
  alergi: string;
  keadaan: 'Membaik' | 'Sembuh' | 'Keadaan Khusus' | 'Meninggal';
  cara_keluar: 'Atas Izin Dokter' | 'Pindah RS' | 'Pulang Atas Permintaan Sendiri' | 'Lainnya';
  obat_pulang: string;
  diet: string;
  edukasi: string;
  doctor_name: Nullable<string>;
  kontrol: Nullable<string>;
}

/**
 * One SEP of the visit: clinical-timeline-v1 1.3.0 `summary.sep`, read by hms_services from Khanza `bridging_sep`
 * (PK no_sep, FK no_rawat → reg_periksa; one visit can have more than one SEP, e.g. suplesi). The server never reads
 * the patient-identity copy in bridging_sep (no_kartu, nama_pasien, tanggal_lahir, notelep). Field names = bridging_sep
 * columns (`liveTimeline.ts` maps them).
 */
export interface SepRecord {
  /** Shown in full (owner decision B-1, ADR-SVC-007). */
  no_sep: string;
  tglsep: Nullable<string>;
  /** Khanza stores '1' = rawat inap, '2' = rawat jalan. */
  jnspelayanan: Nullable<string>;
  klsrawat: Nullable<string>;
  no_rujukan: Nullable<string>;
  nmppkrujukan: Nullable<string>;
  diagawal: Nullable<string>;
  nmdiagnosaawal: Nullable<string>;
  nmpolitujuan: Nullable<string>;
  nmdpdjp: Nullable<string>;
  tglpulang: Nullable<string>;
  cob: Nullable<string>;
}

export interface JourneySummary {
  encounter: Nullable<{
    care_setting: Nullable<CareSetting>;
    payer_name: Nullable<string>;
    payer_type: Nullable<PayerType>;
    status_lanjut: 'Ralan' | 'Ranap';
    stts: Nullable<EncounterStts>;
    /** Payer code as stored (the live API sends it; synthetic fixtures may omit it). */
    kd_pj?: string;
  }>;
  diagnoses: DiagnosisCode[];
  coded_procedures: CodedProcedure[];
  attending_doctors: { doctor_name: Nullable<string>; kd_dokter: string; prioritas: number }[];
  discharge_summary_inpatient: Nullable<DischargeSummaryInpatient>;
  /**
   * clinical-timeline-v1 1.3.0. `undefined` = the server does not send SEP (older than 1.3.0: "Not available from
   * source"); `[]` = sent, but no SEP for this visit ("Not recorded").
   */
  sep?: SepRecord[];
}

export interface EncounterJourney {
  no_rawat: string;
  no_rkm_medis: Nullable<string>;
  /** Keys: `YYYY-MM-DDTHH:MM:SS`, `YYYY-MM-DD` or `undated`, ascending (hospital local time as stored). */
  data: Record<string, JourneyMoment>;
  summary: JourneySummary;
  /** `truncated` lists segments the server cut short — the UI must say the list is incomplete. */
  meta: { time_basis: string; truncated: string[] };
}

/** One row of `GET /api/v1/patients/{mrn}/encounters` (subset). */
export interface EncounterListItem {
  no_rawat: string;
  no_reg: Nullable<string>;
  no_rkm_medis: Nullable<string>;
  tgl_registrasi: Nullable<string>;
  jam_reg: Nullable<string>;
  status_lanjut: 'Ralan' | 'Ranap';
  stts: Nullable<EncounterStts>;
  /** Payer code as stored (`penjab.kd_pj`); the name needs a lookup the list does not carry (contract request 09, P-1). */
  kd_pj?: string;
  /**
   * Visit-number search hits only (clinical-read-v1 1.2.0), and only for a session that may also read patients: the
   * patient's name, so a mistyped number is not opened as someone else's visit. '' = not recorded; absent = not sent.
   */
  patientName?: string;
}
