import { z } from 'zod';
import { ApiError } from './liveApi';
import type {
  CareSetting,
  ClinicalNote,
  DischargeSummaryInpatient,
  EncounterJourney,
  EncounterStts,
  JourneyMoment,
  Kesadaran,
  PayerType,
} from './journey';

/**
 * Live adapter for `GET /api/v1/encounters/{number}/timeline` (hms_services clinical-timeline-v1, ADR-SVC-004) → the
 * `EncounterJourney` the Records, Encounter, Diagnostics and viewer windows read. The server returns values as recorded
 * (legacy codes such as `kesadaran` or `stts_pulang` unchanged) and every time as hospital local time with the facility
 * offset, so the journey keys are the local date-time as written. Nothing is invented: a value the server did not send
 * stays null, and a dispensing time that was never recorded keeps the legacy "not yet" date.
 */

type Text = string | null;

interface Payer {
  code: string;
  name: Text;
  company: Text;
  type: PayerType;
}

/** One timeline entry; the fields present depend on `type` (contract `Entry*`). */
type Entry = { type: string; at: string | null } & Record<string, unknown>;

const timelineSchema = z.object({
  encounter_number: z.string(),
  patient_mrn: z.string().nullable(),
  summary: z.object({
    care_setting: z.enum(['outpatient', 'inpatient', 'unknown']),
    status: z.object({ code: z.string().nullable() }),
    payer: z.object({
      code: z.string(),
      name: z.string().nullable(),
      company: z.string().nullable(),
      type: z.enum(['personal', 'bpjs', 'insurer']),
    }),
    diagnoses: z.array(
      z.object({
        code: z.string(),
        name: z.string().nullable(),
        priority: z.number(),
        care_setting: z.string(),
        case: z.enum(['new', 'existing']).nullable(),
      }),
    ),
    coded_procedures: z.array(
      z.object({
        code: z.string(),
        name: z.string().nullable(),
        priority: z.number(),
        care_setting: z.string(),
      }),
    ),
    attending_doctors: z.array(z.object({ name: z.string().nullable(), priority: z.number() })),
    discharge_summary: z
      .object({
        doctor_name: z.string().nullable(),
        chief_complaint: z.string(),
        course: z.string(),
        main_diagnosis: z.object({ code: z.string(), name: z.string().nullable() }),
        secondary_diagnosis: z.object({ code: z.string(), name: z.string().nullable() }),
        main_procedure: z.object({ code: z.string(), name: z.string().nullable() }),
        allergy: z.string(),
        condition: z.string(),
        discharge_method: z.string(),
        discharge_medication: z.string(),
        diet: z.string(),
        education: z.string(),
        control: z.string().nullable(),
      })
      .nullable(),
    // 1.3.0 (ADR-SVC-007); optional so an older server still reads as "SEP not available".
    sep: z
      .array(
        z.object({
          number: z.string(),
          date: z.string().nullable(),
          service_type: z.string().nullable(),
          class: z.string().nullable(),
          referral_number: z.string().nullable(),
          referring_facility: z.string().nullable(),
          initial_diagnosis: z.object({ code: z.string(), name: z.string().nullable() }),
          destination_clinic: z.string().nullable(),
          dpjp_name: z.string().nullable(),
          discharged_at: z.string().nullable(),
          cob: z.string().nullable(),
        }),
      )
      .optional(),
  }),
  entries: z.array(z.object({ type: z.string(), at: z.string().nullable() }).passthrough()),
  truncated: z.array(z.string()),
});

const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;
/** Legacy "not recorded" date and time, which the windows already show as absent. */
const NO_DATE = '0000-00-00';
const NO_TIME = '00:00:00';

/** Local date and time of a server timestamp, as written (the offset is the facility's own). */
function local(at: unknown): { date: string; time: string } | null {
  const m = typeof at === 'string' ? LOCAL.exec(at) : null;
  return m ? { date: m[1]!, time: m[2]! } : null;
}

export function journeyKey(at: string | null): string {
  const l = local(at);
  return l ? `${l.date}T${l.time}` : 'undated';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const text = (v: unknown): Text => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const care = (v: unknown): CareSetting => (v === 'inpatient' ? 'inpatient' : 'outpatient');
const lanjut = (v: unknown): 'Ralan' | 'Ranap' => (v === 'inpatient' ? 'Ranap' : 'Ralan');
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

const STTS: readonly EncounterStts[] = [
  'Belum',
  'Sudah',
  'Batal',
  'Berkas Diterima',
  'Dirujuk',
  'Meninggal',
  'Dirawat',
  'Pulang Paksa',
  'Berkas Terkirim',
];
const stts = (code: string | null): EncounterStts | null => STTS.find((s) => s === code) ?? null;

/** Adds one entry to its moment. Unknown entry types are ignored, never guessed. */
function addEntry(data: Record<string, JourneyMoment>, e: Entry): void {
  const moment = (data[journeyKey(e.at)] ??= {});
  const at = local(e.at);
  const push = <K extends keyof JourneyMoment>(
    key: K,
    value: NonNullable<JourneyMoment[K]>[number],
  ) => {
    ((moment[key] ??= [] as never) as unknown[]).push(value);
  };
  switch (e.type) {
    case 'registration': {
      const payer = e.payer as Payer;
      const cs = e.care_setting === 'unknown' ? null : care(e.care_setting);
      push('registration', {
        care_setting: cs,
        department_name: text(e.clinic),
        doctor_name: text(e.doctor_name),
        kd_dokter: null,
        kd_pj: payer.code,
        no_reg: text(e.queue_number),
        payer_name: payer.name,
        payer_type: payer.type,
        status_lanjut: lanjut(e.care_setting),
        stts: stts(text((e.status as { code?: unknown }).code)),
      });
      return;
    }
    case 'room_stay': {
      const out = local(e.discharged_at);
      push('room_stay', {
        diagnosa_awal: text(e.admission_diagnosis),
        diagnosa_akhir: text(e.discharge_diagnosis),
        tgl_masuk: at?.date ?? NO_DATE,
        jam_masuk: at?.time ?? NO_TIME,
        tgl_keluar: out?.date ?? null,
        jam_keluar: out?.time ?? null,
        kd_kamar: str(e.room_code),
        lama: num(e.length_of_stay),
        room_class: str(e.room_class),
        stts_pulang: str(e.discharge_status),
        ward_name: text(e.ward),
      });
      return;
    }
    case 'clinical_note': {
      const v = (e.vitals ?? {}) as Record<string, unknown>;
      const note: ClinicalNote = {
        care_setting: care(e.care_setting),
        author_name: text(e.author_name),
        nip: str(e.author_id),
        keluhan: text(e.subjective),
        pemeriksaan: text(e.objective),
        penilaian: str(e.assessment),
        rtl: text(e.plan),
        instruksi: str(e.instruction),
        evaluasi: str(e.evaluation),
        alergi: text(e.allergy),
        kesadaran: str(e.consciousness) as Kesadaran,
        tensi: text(v.blood_pressure),
        nadi: text(v.pulse),
        respirasi: text(v.respiration),
        suhu_tubuh: text(v.temperature),
        spo2: text(v.spo2),
        gcs: text(v.gcs),
        tinggi: text(v.height),
        berat: text(v.weight),
      };
      push('clinical_notes', note);
      return;
    }
    case 'procedure':
      push('procedures', {
        care_setting: care(e.care_setting),
        performed_by: e.performed_by as 'doctor' | 'nurse' | 'doctor_and_nurse',
        procedure_name: text(e.name),
        kd_jenis_prw: str(e.code),
        doctor_name: text(e.doctor_name),
        staff_name: text(e.staff_name),
      });
      return;
    case 'lab_test':
      push('laboratory', {
        test_name: text(e.name),
        kategori: str(e.category) as 'PA' | 'PK' | 'MB',
        kd_jenis_prw: str(e.code),
        doctor_name: text(e.doctor_name),
        analyst_name: text(e.analyst_name),
        referring_doctor_name: text(e.referring_doctor_name),
        results: rows(e.results).map((r) => ({
          id_template: typeof r.template_id === 'number' ? r.template_id : 0,
          item_name: text(r.item),
          nilai: str(r.value),
          nilai_rujukan: str(r.reference_range),
          unit: text(r.unit),
          keterangan: str(r.note),
        })),
        status: lanjut(e.care_setting),
      });
      return;
    case 'radiology_exam':
      push('radiology', {
        exam_name: text(e.name),
        kd_jenis_prw: str(e.code),
        doctor_name: text(e.doctor_name),
        radiographer_name: text(e.radiographer_name),
        referring_doctor_name: text(e.referring_doctor_name),
        proyeksi: str(e.projection),
        status: lanjut(e.care_setting),
      });
      return;
    case 'radiology_report':
      push('radiology_report', { hasil: str(e.text) });
      return;
    case 'prescription': {
      const given = local(e.dispensed_at);
      const prescribed = local(e.prescribed_at);
      push('prescription', {
        no_resep: str(e.number),
        doctor_name: text(e.doctor_name),
        tgl_peresepan: prescribed?.date ?? null,
        jam_peresepan: prescribed?.time ?? null,
        tgl_penyerahan: given?.date ?? NO_DATE,
        jam_penyerahan: given?.time ?? NO_TIME,
        items: rows(e.items).map((i) => ({
          drug_name: text(i.drug_name),
          aturan_pakai: str(i.instructions),
          jml: num(i.quantity),
          unit: text(i.unit),
          kode_brng: text(i.drug_code),
        })),
        compounds: rows(e.compounds).map((c) => ({
          nama_racik: str(c.name),
          aturan_pakai: str(c.instructions),
          jml_dr: num(c.quantity) ?? 0,
          keterangan: str(c.note),
        })),
        status: e.care_setting === 'inpatient' ? 'ranap' : 'ralan',
      });
      return;
    }
    case 'medication_given':
      push('medication_given', {
        drug_name: text(e.drug_name),
        jml: num(e.quantity) ?? 0,
        unit: text(e.unit),
        kode_brng: str(e.drug_code),
        no_batch: str(e.batch),
        dose_instructions: text(e.instructions) ? [{ aturan: text(e.instructions) }] : [],
        ward_name: text(e.ward),
        status: lanjut(e.care_setting),
      });
      return;
    case 'surgery':
      push('surgery', {
        surgery_name: text(e.name),
        operator1_name: text(e.operator_name),
        anesthetist_name: text(e.anesthesiologist_name),
        jenis_anasthesi: str(e.anesthesia),
        kategori: str(e.category),
        status: lanjut(e.care_setting),
      });
      return;
    case 'surgery_report': {
      const done = local(e.finished_at);
      push('surgery_report', {
        diagnosa_preop: str(e.preoperative_diagnosis),
        diagnosa_postop: str(e.postoperative_diagnosis),
        laporan_operasi: str(e.report),
        komplikasi: e.complication === 'Ya' ? 'Ya' : 'Tidak',
        perdarahan: e.bleeding === 'Ya' ? 'Ya' : 'Tidak',
        selesaioperasi: done ? `${done.date} ${done.time}` : '',
        tanggal: at ? `${at.date} ${at.time}` : '',
      });
      return;
    }
    case 'admission_order':
      push('admission_order', {
        // 1.4.0 always sends false (the legacy row has a date only); anything but an explicit true is "not recorded".
        time_recorded: e.time_recorded === true,
        kd_kamar: str(e.room_code),
        nm_bangsal: text(e.ward),
        kelas: text(e.room_class),
        diagnosa: text(e.diagnosis),
        catatan: text(e.note),
        nm_dpjp: text(e.dpjp_name),
      });
      return;
    case 'emergency_assessment': {
      const v = (e.vitals ?? {}) as Record<string, unknown>;
      const px = (e.physical_exam ?? {}) as Record<string, unknown>;
      push('emergency_assessment', {
        doctor_name: text(e.doctor_name),
        anamnesis: str(e.history_source),
        hubungan: str(e.informant_relationship),
        keluhan_utama: str(e.chief_complaint),
        rps: str(e.present_illness),
        rpd: str(e.past_illness),
        rpk: str(e.family_history),
        rpo: str(e.medication_history),
        alergi: str(e.allergy),
        keadaan: str(e.general_condition),
        kesadaran: text(e.consciousness),
        gcs: text(v.gcs),
        td: text(v.blood_pressure),
        nadi: text(v.pulse),
        rr: text(v.respiration),
        suhu: text(v.temperature),
        spo: text(v.spo2),
        bb: text(v.weight),
        tb: text(v.height),
        fisik: {
          kepala: text(px.head),
          mata: text(px.eyes),
          gigi: text(px.teeth),
          leher: text(px.neck),
          thoraks: text(px.thorax),
          abdomen: text(px.abdomen),
          genital: text(px.genitals),
          ekstremitas: text(px.extremities),
        },
        ket_fisik: str(e.physical_findings),
        ket_lokalis: str(e.local_findings),
        ekg: str(e.ecg),
        rad: str(e.radiology),
        lab: str(e.laboratory),
        diagnosis: str(e.diagnosis),
        tata: str(e.management),
        cara_keluar: str(e.disposition),
        deskripsi: str(e.disposition_detail),
        indikasi: str(e.indication),
      });
      return;
    }
  }
}

/** Maps a clinical-timeline-v1 answer; a body of another shape is a server fault (502), never shown half-read. */
export function toJourney(body: unknown): EncounterJourney {
  const parsed = timelineSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(502, 'BAD_SHAPE');
  const tl = parsed.data;
  const s = tl.summary;
  const data: Record<string, JourneyMoment> = {};
  for (const e of tl.entries) addEntry(data, e as Entry);
  // Keys ascending, `undated` last (the server already orders entries; object keys keep insertion order).
  const ordered: Record<string, JourneyMoment> = {};
  for (const k of Object.keys(data).sort((a, b) =>
    a === 'undated' ? 1 : b === 'undated' ? -1 : a.localeCompare(b),
  ))
    ordered[k] = data[k]!;
  const ds = s.discharge_summary;
  return {
    no_rawat: tl.encounter_number,
    no_rkm_medis: tl.patient_mrn,
    data: ordered,
    summary: {
      encounter: {
        care_setting: s.care_setting === 'unknown' ? null : s.care_setting,
        payer_name: s.payer.name,
        payer_type: s.payer.type,
        status_lanjut: lanjut(s.care_setting),
        stts: stts(s.status.code),
        kd_pj: s.payer.code,
      },
      diagnoses: s.diagnoses.map((d) => ({
        kd_penyakit: d.code,
        diagnosis_name: d.name,
        prioritas: d.priority,
        status: lanjut(d.care_setting),
        status_penyakit: d.case === 'new' ? 'Baru' : d.case === 'existing' ? 'Lama' : null,
      })),
      coded_procedures: s.coded_procedures.map((p) => ({
        kode: p.code,
        procedure_name: p.name,
        prioritas: p.priority,
        status: lanjut(p.care_setting),
      })),
      attending_doctors: s.attending_doctors.map((d) => ({
        doctor_name: d.name,
        kd_dokter: '',
        prioritas: d.priority,
      })),
      discharge_summary_inpatient: ds && {
        keluhan_utama: ds.chief_complaint,
        jalannya_penyakit: ds.course,
        diagnosa_utama: ds.main_diagnosis.name ?? '',
        kd_diagnosa_utama: ds.main_diagnosis.code,
        diagnosa_sekunder: ds.secondary_diagnosis.name ?? '',
        kd_diagnosa_sekunder: ds.secondary_diagnosis.code,
        prosedur_utama: ds.main_procedure.name ?? '',
        kd_prosedur_utama: ds.main_procedure.code,
        alergi: ds.allergy,
        // Legacy enum columns, returned as recorded.
        keadaan: ds.condition as DischargeSummaryInpatient['keadaan'],
        cara_keluar: ds.discharge_method as DischargeSummaryInpatient['cara_keluar'],
        obat_pulang: ds.discharge_medication,
        diet: ds.diet,
        edukasi: ds.education,
        doctor_name: ds.doctor_name,
        kontrol: ds.control,
      },
      ...(s.sep && {
        sep: s.sep.map((x) => ({
          no_sep: x.number,
          tglsep: x.date,
          jnspelayanan: x.service_type,
          klsrawat: x.class,
          no_rujukan: x.referral_number,
          nmppkrujukan: x.referring_facility,
          diagawal: x.initial_diagnosis.code || null,
          nmdiagnosaawal: x.initial_diagnosis.name,
          nmpolitujuan: x.destination_clinic,
          nmdpdjp: x.dpjp_name,
          tglpulang: localStored(x.discharged_at),
          cob: x.cob,
        })),
      }),
    },
    meta: { time_basis: 'hospital_local', truncated: tl.truncated },
  };
}

/** Charge categories of the bill, in bill order (clinical-timeline-v1 1.1). */
export const CHARGE_CATEGORIES = [
  'registration',
  'room',
  'outpatient_doctor',
  'outpatient_nurse',
  'outpatient_doctor_nurse',
  'inpatient_doctor',
  'inpatient_nurse',
  'inpatient_doctor_nurse',
  'surgery',
  'laboratory',
  'radiology',
  'medication',
  'take_home_medication',
  'medication_return',
  'extra_charge',
  'discount',
  'service',
] as const;

/**
 * `GET /encounters/{number}/bill` (billing.read): the charges recorded for the visit in the legacy source tables,
 * grouped by category with exact subtotals and total (the cashier's `billing` table is not used), plus the cashier's
 * saved header, payments and receivable as saved. Amounts are decimal strings (IDR).
 */
const billSchema = z.object({
  encounter_number: z.string(),
  currency: z.literal('IDR'),
  basis: z.literal('recorded_charges'),
  care_setting: z.enum(['outpatient', 'inpatient', 'unknown']),
  groups: z.array(
    z.object({
      category: z.enum(CHARGE_CATEGORIES),
      legacy_category: z.string(),
      subtotal: z.string(),
      lines: z.array(
        z.object({
          code: z.string(),
          label: z.string().nullable(),
          quantity: z.string(),
          unit_price: z.string(),
          additional: z.string(),
          amount: z.string(),
          /** Service fee lines only: amount = unit_price (the base) × rate_percent / 100, computed by the server. */
          rate_percent: z.string().nullable(),
          /** Today's price of the code in the tariff book (null: none); `tariff_matches` compares it with unit_price. */
          tariff: z.string().nullable(),
          tariff_matches: z.boolean().nullable(),
        }),
      ),
    }),
  ),
  total: z.string(),
  saved_bill: z
    .object({
      bill_number: z.string().nullable(),
      billed_at: z.string().nullable(),
      care_setting: z.enum(['outpatient', 'inpatient']),
    })
    .nullable(),
  payments: z.array(z.object({ method: z.string(), amount: z.string(), tax: z.string() })),
  receivable: z
    .object({
      status: z.string(),
      total: z.string(),
      down_payment: z.string(),
      remaining: z.string(),
      due_date: z.string().nullable(),
    })
    .nullable(),
  truncated: z.array(z.string()),
});

export type EncounterBill = z.infer<typeof billSchema>;

export function toBill(body: unknown): EncounterBill {
  const parsed = billSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(502, 'BAD_SHAPE');
  return parsed.data;
}

/** Local `YYYY-MM-DD HH:MM:SS` of a server timestamp, for the stored-time formatter. */
export function localStored(at: string | null): string | null {
  const l = local(at);
  return l ? `${l.date} ${l.time}` : null;
}
