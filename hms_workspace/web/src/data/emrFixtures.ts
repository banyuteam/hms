import type { EncounterJourney, EncounterListItem, JourneyMoment } from '@/api/journey';

/**
 * SYNTHETIC data only (no real patients, staff or hospitals), in the journey model of `src/api/journey.ts` — the same
 * model live data is mapped into, so the windows do not know which source they read.
 * MRNs match src/data/syntheticPatients.ts so Patient Management → Profile keeps working.
 */

const DPJP = 'dr. Andi Pratama, Sp.PD';
const NURSE = 'Ns. Rina Kartika, S.Kep';

const inpatient: EncounterJourney = {
  no_rawat: '2026/10/26/000123',
  no_rkm_medis: '00012346',
  meta: { time_basis: 'hospital local time as stored', truncated: [] },
  data: {
    '2026-10-26T14:30:00': {
      registration: [
        {
          care_setting: 'inpatient',
          department_name: 'IGD',
          doctor_name: DPJP,
          kd_dokter: 'D0001',
          kd_pj: 'BPJ',
          no_reg: '014',
          payer_name: 'BPJS Kesehatan',
          payer_type: 'bpjs',
          status_lanjut: 'Ranap',
          stts: 'Dirawat',
        },
      ],
    },
    '2026-10-26T15:05:00': {
      room_stay: [
        {
          diagnosa_awal: 'Dyspnoea, suspected heart failure',
          diagnosa_akhir: 'Congestive heart failure',
          tgl_masuk: '2026-10-26',
          jam_masuk: '15:05:00',
          tgl_keluar: '2026-10-30',
          jam_keluar: '10:00:00',
          kd_kamar: 'MLT-03',
          lama: 4,
          room_class: 'Kelas 2',
          stts_pulang: 'Membaik',
          ward_name: 'Melati',
        },
      ],
      clinical_notes: [
        {
          care_setting: 'inpatient',
          author_name: NURSE,
          nip: 'P0001',
          keluhan: 'Short of breath for 2 days, chest feels heavy, tires easily.',
          pemeriksaan: 'Fine basal crackles both lungs. Pitting oedema both legs.',
          penilaian: 'SDKI: Pola Napas Tidak Efektif [D.0005]',
          rtl: 'SLKI: Pola Napas Membaik [L.01004]. SIKI: monitor respiratory rate, SpO2.',
          instruksi: '',
          evaluasi: 'Problem not yet resolved',
          alergi: 'Amoxicillin — rash (patient report)',
          kesadaran: 'Compos Mentis',
          tensi: '150/95',
          nadi: '104',
          respirasi: '26',
          suhu_tubuh: '36.8',
          spo2: '91',
          gcs: '15',
          ews: '4',
        },
      ],
    },
    '2026-10-26T15:40:00': {
      laboratory: [
        {
          test_name: 'Complete blood count',
          kategori: 'PK',
          kd_jenis_prw: 'LAB-CBC',
          doctor_name: 'dr. Sari Wulandari, Sp.PK',
          analyst_name: 'Analyst A',
          referring_doctor_name: DPJP,
          status: 'Ranap',
          results: [
            {
              id_template: 1,
              item_name: 'Haemoglobin',
              nilai: '11.2',
              nilai_rujukan: '12.0–16.0',
              unit: 'g/dL',
              keterangan: 'L',
            },
            {
              id_template: 2,
              item_name: 'Leukocytes',
              nilai: '9.8',
              nilai_rujukan: '4.0–10.0',
              unit: '10³/µL',
              keterangan: '',
            },
            {
              id_template: 3,
              item_name: 'Platelets',
              nilai: '254',
              nilai_rujukan: '150–400',
              unit: '10³/µL',
              keterangan: '',
            },
          ],
        },
        {
          test_name: 'Renal function',
          kategori: 'PK',
          kd_jenis_prw: 'LAB-RFT',
          doctor_name: 'dr. Sari Wulandari, Sp.PK',
          analyst_name: 'Analyst A',
          referring_doctor_name: DPJP,
          status: 'Ranap',
          results: [
            {
              id_template: 4,
              item_name: 'Creatinine',
              nilai: '1.6',
              nilai_rujukan: '0.6–1.1',
              unit: 'mg/dL',
              keterangan: 'H',
            },
            {
              id_template: 5,
              item_name: 'Urea',
              nilai: '48',
              nilai_rujukan: '15–40',
              unit: 'mg/dL',
              keterangan: 'H',
            },
          ],
        },
      ],
      radiology: [
        {
          exam_name: 'Chest X-ray PA',
          kd_jenis_prw: 'RAD-THX',
          doctor_name: 'dr. Budi Hartono, Sp.Rad',
          radiographer_name: 'Radiographer B',
          referring_doctor_name: DPJP,
          proyeksi: 'PA',
          status: 'Ranap',
        },
      ],
      // The report carries its exam's date and time (`hasil_radiologi` shares `tgl_periksa` + `jam` with the exam).
      radiology_report: [
        {
          hasil:
            'Cardiomegaly (CTR 0.62). Bilateral perihilar haziness consistent with pulmonary congestion. No pneumothorax.',
        },
      ],
    },
    '2026-10-26T17:20:00': {
      clinical_notes: [
        {
          care_setting: 'inpatient',
          author_name: DPJP,
          nip: 'D0001',
          keluhan: 'Breathless, orthopnoea.',
          pemeriksaan: 'BP 150/95, HR 104, RR 26, SpO2 91% room air. JVP raised. Basal crackles.',
          penilaian: 'Acute decompensated heart failure. Hypertension.',
          rtl: 'Diuresis, oxygen, fluid balance, echo when stable.',
          instruksi:
            'Inj. furosemide 40 mg IV / 12 h\nO2 nasal cannula 3 L/min\nFluid balance chart, daily weight',
          evaluasi: '',
          alergi: 'Amoxicillin — rash (patient report)',
          kesadaran: 'Compos Mentis',
          tensi: '150/95',
          nadi: '104',
          respirasi: '26',
          suhu_tubuh: '36.8',
          spo2: '91',
          gcs: '15',
        },
      ],
      prescription: [
        {
          no_resep: 'R-2026102600045',
          doctor_name: DPJP,
          tgl_peresepan: '2026-10-26',
          jam_peresepan: '17:25:00',
          tgl_penyerahan: '2026-10-26',
          jam_penyerahan: '18:10:00',
          status: 'ranap',
          items: [
            {
              drug_name: 'Furosemide 20 mg/2 ml injection',
              aturan_pakai: '40 mg IV every 12 h',
              jml: 4,
              unit: 'ampoule',
              kode_brng: 'B0012',
            },
            {
              drug_name: 'Bisoprolol 2.5 mg tablet',
              aturan_pakai: '1 × 2.5 mg daily',
              jml: 3,
              unit: 'tablet',
              kode_brng: 'B0201',
            },
          ],
          compounds: [],
        },
      ],
    },
    '2026-10-26T18:10:00': {
      medication_given: [
        {
          drug_name: 'Furosemide 20 mg/2 ml injection',
          jml: 2,
          unit: 'ampoule',
          kode_brng: 'B0012',
          no_batch: 'FX2610',
          dose_instructions: [{ aturan: '40 mg IV' }],
          ward_name: 'Melati',
          status: 'Ranap',
        },
      ],
      procedures: [
        {
          care_setting: 'inpatient',
          performed_by: 'nurse',
          procedure_name: 'IV line insertion',
          kd_jenis_prw: 'TND-IV',
          staff_name: NURSE,
        },
      ],
    },
    '2026-10-27T07:10:00': {
      clinical_notes: [
        {
          care_setting: 'inpatient',
          author_name: DPJP,
          nip: 'D0001',
          keluhan: 'Breathing better, productive cough.',
          pemeriksaan: 'BP 130/80, HR 88, RR 22, SpO2 95% on 3 L. Fewer crackles.',
          penilaian: 'Heart failure improving.',
          rtl: 'Continue diuresis, monitor fluid balance, plan echocardiography.',
          instruksi:
            'Inj. furosemide 20 mg IV / 12 h\nBisoprolol 2.5 mg PO daily\nNebulised salbutamol every 8 h',
          evaluasi: '',
          alergi: 'Amoxicillin — rash (patient report)',
          kesadaran: 'Compos Mentis',
          tensi: '130/80',
          nadi: '88',
          respirasi: '22',
          suhu_tubuh: '36.4',
          spo2: '95',
          gcs: '15',
        },
      ],
    },
    '2026-10-28T09:30:00': {
      radiology: [
        {
          exam_name: 'Echocardiography',
          kd_jenis_prw: 'RAD-ECHO',
          doctor_name: 'dr. Rudi Santosa, Sp.JP',
          radiographer_name: null,
          referring_doctor_name: DPJP,
          proyeksi: '-',
          status: 'Ranap',
        },
      ],
      radiology_report: [{ hasil: 'LV dilated, EF 38% (Simpson). Mild mitral regurgitation.' }],
      procedures: [
        {
          care_setting: 'inpatient',
          performed_by: 'doctor',
          procedure_name: 'Echocardiography',
          kd_jenis_prw: 'TND-ECHO',
          doctor_name: 'dr. Rudi Santosa, Sp.JP',
        },
      ],
    },
    '2026-10-30T09:00:00': {
      clinical_notes: [
        {
          care_setting: 'inpatient',
          author_name: NURSE,
          nip: 'P0001',
          keluhan: 'No breathlessness at rest.',
          pemeriksaan: 'BP 124/78, HR 76, RR 18, SpO2 97% room air.',
          penilaian: 'SDKI: Pola Napas Tidak Efektif [D.0005] — resolved',
          rtl: 'Discharge education: fluid & salt restriction, daily weight.',
          instruksi: '',
          evaluasi: 'Problem resolved',
          alergi: 'Amoxicillin — rash (patient report)',
          kesadaran: 'Compos Mentis',
          tensi: '124/78',
          nadi: '76',
          respirasi: '18',
          suhu_tubuh: '36.5',
          spo2: '97',
          gcs: '15',
        },
      ],
    },
  },
  summary: {
    encounter: {
      care_setting: 'inpatient',
      payer_name: 'BPJS Kesehatan',
      payer_type: 'bpjs',
      status_lanjut: 'Ranap',
      stts: 'Sudah',
    },
    diagnoses: [
      {
        kd_penyakit: 'I50.0',
        diagnosis_name: 'Congestive heart failure',
        prioritas: 1,
        status: 'Ranap',
        status_penyakit: 'Baru',
      },
      {
        kd_penyakit: 'I10',
        diagnosis_name: 'Essential (primary) hypertension',
        prioritas: 2,
        status: 'Ranap',
        status_penyakit: 'Lama',
      },
      {
        kd_penyakit: 'D64.9',
        diagnosis_name: 'Anaemia, unspecified',
        prioritas: 3,
        status: 'Ranap',
        status_penyakit: 'Baru',
      },
    ],
    coded_procedures: [
      {
        kode: '88.72',
        procedure_name: 'Diagnostic ultrasound of heart',
        prioritas: 1,
        status: 'Ranap',
      },
      {
        kode: '87.44',
        procedure_name: 'Routine chest x-ray, so described',
        prioritas: 2,
        status: 'Ranap',
      },
    ],
    attending_doctors: [{ doctor_name: DPJP, kd_dokter: 'D0001', prioritas: 1 }],
    sep: [
      {
        no_sep: '0301R0011026V000123',
        tglsep: '2026-10-26',
        jnspelayanan: '1',
        klsrawat: '2',
        no_rujukan: null,
        nmppkrujukan: 'IGD RS (synthetic)',
        diagawal: 'R06.0',
        nmdiagnosaawal: 'Dyspnoea',
        nmpolitujuan: null,
        nmdpdjp: DPJP,
        tglpulang: '2026-10-30 10:00:00',
        cob: '0. Tidak',
      },
    ],
    discharge_summary_inpatient: {
      keluhan_utama: 'Shortness of breath for 2 days',
      jalannya_penyakit: 'Treated with IV diuretics and oxygen; symptoms improved by day 3.',
      diagnosa_utama: 'Congestive heart failure',
      kd_diagnosa_utama: 'I50.0',
      diagnosa_sekunder: 'Essential hypertension',
      kd_diagnosa_sekunder: 'I10',
      prosedur_utama: 'Echocardiography',
      kd_prosedur_utama: '88.72',
      alergi: 'Amoxicillin',
      keadaan: 'Membaik',
      cara_keluar: 'Atas Izin Dokter',
      obat_pulang: 'Furosemide 40 mg PO daily; bisoprolol 2.5 mg PO daily',
      diet: 'Low salt, fluid restriction 1.5 L/day',
      edukasi: 'Daily weight; return if breathless.',
      doctor_name: DPJP,
      kontrol: '2026-11-06',
    },
  },
};

const outpatient: EncounterJourney = {
  no_rawat: '2026/08/14/000051',
  no_rkm_medis: '00012346',
  meta: { time_basis: 'hospital local time as stored', truncated: [] },
  data: {
    '2026-08-14T09:12:00': {
      registration: [
        {
          care_setting: 'outpatient',
          department_name: 'Poli Penyakit Dalam',
          doctor_name: DPJP,
          kd_dokter: 'D0001',
          kd_pj: 'BPJ',
          no_reg: '007',
          payer_name: 'BPJS Kesehatan',
          payer_type: 'bpjs',
          status_lanjut: 'Ralan',
          stts: 'Sudah',
        },
      ],
      clinical_notes: [
        {
          care_setting: 'outpatient',
          author_name: DPJP,
          nip: 'D0001',
          keluhan: 'Routine control, occasional headache.',
          pemeriksaan: 'BP 145/90, HR 80.',
          penilaian: 'Hypertension, not at target.',
          rtl: 'Adjust antihypertensive; control in 1 month.',
          instruksi: 'Amlodipine 10 mg PO daily',
          evaluasi: '',
          alergi: 'Amoxicillin — rash (patient report)',
          kesadaran: 'Compos Mentis',
          tensi: '145/90',
          nadi: '80',
          suhu_tubuh: '36.6',
          gcs: '15',
        },
      ],
      prescription: [
        {
          no_resep: 'R-2026081400012',
          doctor_name: DPJP,
          tgl_peresepan: '2026-08-14',
          jam_peresepan: '09:30:00',
          tgl_penyerahan: '2026-08-14',
          jam_penyerahan: '10:05:00',
          status: 'ralan',
          items: [
            {
              drug_name: 'Amlodipine 10 mg tablet',
              aturan_pakai: '1 × 1 daily',
              jml: 30,
              unit: 'tablet',
              kode_brng: 'B0310',
            },
          ],
          compounds: [],
        },
      ],
    },
  },
  summary: {
    encounter: {
      care_setting: 'outpatient',
      payer_name: 'BPJS Kesehatan',
      payer_type: 'bpjs',
      status_lanjut: 'Ralan',
      stts: 'Sudah',
    },
    diagnoses: [
      {
        kd_penyakit: 'I10',
        diagnosis_name: 'Essential (primary) hypertension',
        prioritas: 1,
        status: 'Ralan',
        status_penyakit: 'Lama',
      },
    ],
    coded_procedures: [],
    attending_doctors: [{ doctor_name: DPJP, kd_dokter: 'D0001', prioritas: 1 }],
    sep: [
      {
        no_sep: '0301R0010826V000051',
        tglsep: '2026-08-14',
        jnspelayanan: '2',
        klsrawat: '3',
        no_rujukan: '030101020826P000777',
        nmppkrujukan: 'Puskesmas Synthetic',
        diagawal: 'I10',
        nmdiagnosaawal: 'Essential (primary) hypertension',
        nmpolitujuan: 'Penyakit Dalam',
        nmdpdjp: DPJP,
        tglpulang: null,
        cob: '0. Tidak',
      },
    ],
    discharge_summary_inpatient: null,
  },
};

function emptyOutpatient(mrn: string, norawat: string, at: string): EncounterJourney {
  const moment: JourneyMoment = {
    registration: [
      {
        care_setting: 'outpatient',
        department_name: 'Poli Umum',
        doctor_name: 'dr. Maya Putri',
        kd_dokter: 'D0007',
        kd_pj: 'UMU',
        no_reg: '021',
        payer_name: 'Umum',
        payer_type: 'personal',
        status_lanjut: 'Ralan',
        stts: 'Belum',
      },
    ],
  };
  return {
    no_rawat: norawat,
    no_rkm_medis: mrn,
    meta: { time_basis: 'hospital local time as stored', truncated: [] },
    data: { [at]: moment },
    summary: {
      encounter: {
        care_setting: 'outpatient',
        payer_name: 'Umum',
        payer_type: 'personal',
        status_lanjut: 'Ralan',
        stts: 'Belum',
      },
      diagnoses: [],
      coded_procedures: [],
      attending_doctors: [],
      discharge_summary_inpatient: null,
    },
  };
}

export const SYNTHETIC_JOURNEYS: readonly EncounterJourney[] = [
  inpatient,
  outpatient,
  emptyOutpatient('00012345', '2026/11/03/000088', '2026-11-03T08:40:00'),
];

export function toListItem(j: EncounterJourney): EncounterListItem {
  const firstKey = Object.keys(j.data).find((k) => k !== 'undated') ?? null;
  const reg = Object.values(j.data).find((m) => m.registration)?.registration?.[0];
  return {
    no_rawat: j.no_rawat,
    no_reg: reg?.no_reg ?? null,
    no_rkm_medis: j.no_rkm_medis,
    tgl_registrasi: firstKey ? firstKey.slice(0, 10) : null,
    jam_reg: firstKey && firstKey.length > 10 ? firstKey.slice(11) : null,
    status_lanjut: j.summary.encounter?.status_lanjut ?? reg?.status_lanjut ?? 'Ralan',
    stts: j.summary.encounter?.stts ?? null,
    kd_pj: j.summary.encounter?.kd_pj,
  };
}
