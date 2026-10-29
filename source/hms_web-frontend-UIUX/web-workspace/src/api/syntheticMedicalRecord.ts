import type {
  ClinicalNote,
  MedicalRecordSummary,
  MrEncounter,
  MrProcedure,
  PatientRecord,
} from './types';

/**
 * SYNTHETIC medical-record summaries for Phase 2 (no backend yet), shaped like Figma mockups 14 and 16. Invented data only;
 * clinical free text is Indonesian on purpose (shown as stored, never translated, OQ-34). Never add real patient data here.
 */
const DR_AP = 'dr. Andika Pratama, Sp.PD';
const NS_SR = 'Siti Rahayu, S.Kep';
const DR_BS = 'dr. Bambang Susilo, Sp.JP';
const DR_CL = 'dr. Citra Lestari, Sp.PD';
const DR_RW = 'dr. Rina Wulandari';

const proc = (
  id: string,
  at: string,
  name: string,
  role: MrProcedure['role'],
  by: string,
  icd9: string | null,
): MrProcedure => ({ id, at, name, role, by, icd9 });

const note = (n: Omit<ClinicalNote, 'kind'> & { kind?: ClinicalNote['kind'] }): ClinicalNote => ({
  kind: 'progress',
  ...n,
});

const SITI_ENCOUNTERS: MrEncounter[] = [
  {
    no: 'INP-20261027-0001',
    registeredAt: '2026-10-26T14:30:00+07:00',
    care: 'inpatient',
    unit: 'Bangsal A - 301',
    open: true,
    admissionDiagnosis: 'Demam, batuk, sesak napas',
    diagnoses: [
      { code: 'J18.9', name: 'Pneumonia', priority: 1, isNew: true },
      { code: 'I10', name: 'Hipertensi esensial', priority: 2, isNew: false },
    ],
    assessment: {
      chiefComplaint: 'Demam, batuk, dan sesak napas.',
      presentIllness: 'Demam 3 hari, batuk berdahak, sesak napas saat aktivitas.',
      pastIllness: 'Hipertensi sejak 2020.',
      familyHistory: 'Ibu: hipertensi.',
      medicationHistory: 'Amlodipine 5 mg rutin.',
      assessedAt: '2026-10-26T14:45:00+07:00',
      kind: 'admission',
    },
    physicalExam: 'TD 140/90, N 88, RR 18, T 37,8, SpO₂ 96%. Ronki basah kanan bawah.',
    labs: [
      {
        id: 'l1',
        name: 'Darah lengkap',
        at: '2026-10-26T15:10:00+07:00',
        values: 'Leukosit 14,2 (4,0–10,0) · Hb 12,8 (12,0–16,0)',
        note: 'leukositosis',
      },
    ],
    radiology: [
      {
        id: 'r1',
        name: 'Foto thorax PA',
        at: '2026-10-26T16:00:00+07:00',
        reading: 'Infiltrat paru kanan bawah, jantung tidak membesar.',
      },
    ],
    therapy: [
      {
        id: 't1',
        name: 'Ceftriaxone IV 2 g · 1×1',
        period: '26 Okt →',
        orderedAt: '2026-10-26T15:30:00+07:00',
        orderedBy: DR_AP,
        dosesGiven: null,
      },
    ],
    notes: [
      note({
        id: 'n3',
        encounterNo: 'INP-20261027-0001',
        at: '2026-10-27T08:30:00+07:00',
        author: DR_AP,
        soap: {
          s: 'Demam ringan, batuk berkurang.',
          o: 'TD 140/90, N 88, RR 18, T 37,8, SpO₂ 96%.',
          a: 'Pneumonia, membaik dengan terapi antibiotik.',
          p: 'Lanjutkan Ceftriaxone IV, kontrol lab 24–48 jam.',
        },
      }),
      note({
        id: 'n2',
        encounterNo: 'INP-20261027-0001',
        at: '2026-10-26T16:15:00+07:00',
        author: NS_SR,
        kind: 'nursing',
        text: 'TTV stabil, pasien mengeluh nyeri dada berkurang.',
      }),
      note({
        id: 'n1',
        encounterNo: 'INP-20261027-0001',
        at: '2026-10-26T14:45:00+07:00',
        author: DR_AP,
        kind: 'admission',
        text: 'Pasien masuk dengan keluhan demam, batuk, dan sesak napas.',
      }),
    ],
    procedures: [
      proc('p1', '2026-10-26T14:50:00+07:00', 'Terapi oksigen 2 L/menit', 'nurse', NS_SR, '93.96'),
      proc('p2', '2026-10-26T15:05:00+07:00', 'Pengambilan kultur darah', 'nurse', NS_SR, null),
    ],
    outcome: null,
    followUp: null,
    signature: { doctor: DR_AP, status: 'unsigned', at: null },
  },
  {
    no: 'INP-20260312-0003',
    registeredAt: '2026-03-12T11:45:00+07:00',
    care: 'inpatient',
    unit: 'Bangsal Penyakit Dalam 3B',
    open: false,
    admissionDiagnosis: 'Nyeri dada, tekanan darah tinggi',
    diagnoses: [
      { code: 'I10', name: 'Hipertensi esensial', priority: 1, isNew: false },
      { code: 'R07.4', name: 'Nyeri dada, tidak spesifik', priority: 2, isNew: true },
    ],
    assessment: {
      chiefComplaint: 'Nyeri dada dan sakit kepala sejak 1 hari.',
      presentIllness: 'Nyeri dada kiri, tekanan darah 190/110 saat tiba di IGD.',
      pastIllness: 'Hipertensi sejak 2020.',
      familyHistory: 'Ibu: hipertensi.',
      medicationHistory: 'Amlodipine 5 mg rutin.',
      assessedAt: '2026-03-12T11:45:00+07:00',
      kind: 'admission',
    },
    physicalExam: 'TD 190/110, N 96, RR 20, T 36,8, SpO₂ 98%. Jantung dan paru dalam batas normal.',
    labs: [
      {
        id: 'l1',
        name: 'Darah lengkap',
        at: '2026-03-12T09:30:00+07:00',
        values: 'Leukosit 8,2 (4,0–10,0) · Hb 13,1 (12,0–16,0)',
        note: 'dalam batas normal',
      },
      {
        id: 'l2',
        name: 'Troponin I',
        at: '2026-03-12T09:30:00+07:00',
        values: null,
        note: 'negatif, ulang bila nyeri dada berulang',
      },
    ],
    radiology: [],
    therapy: [
      {
        id: 't1',
        name: 'Amlodipine 10 mg · 1×1',
        period: '12–15 Mar',
        orderedAt: '2026-03-12T14:00:00+07:00',
        orderedBy: DR_AP,
        dosesGiven: 4,
      },
      {
        id: 't2',
        name: 'Candesartan 16 mg · 1×1',
        period: '12–15 Mar',
        orderedAt: '2026-03-12T14:00:00+07:00',
        orderedBy: DR_AP,
        dosesGiven: 4,
      },
    ],
    notes: [
      note({
        id: 'n14',
        encounterNo: 'INP-20260312-0003',
        at: '2026-03-14T08:20:00+07:00',
        author: DR_AP,
        soap: {
          s: 'Nyeri dada hilang, tidak ada keluhan.',
          o: 'TD 130/80, N 80, RR 18, SpO₂ 98%.',
          a: 'Hipertensi terkontrol, nyeri dada non-kardiak.',
          p: 'Lanjutkan Amlodipine dan Candesartan, rencana pulang besok.',
        },
      }),
      note({
        id: 'n13',
        encounterNo: 'INP-20260312-0003',
        at: '2026-03-13T09:00:00+07:00',
        author: DR_AP,
        soap: {
          s: 'Nyeri dada berkurang, sakit kepala ringan.',
          o: 'TD 150/90, N 84, RR 18, SpO₂ 98%.',
          a: 'Hipertensi urgensi membaik.',
          p: 'Lanjutkan terapi oral, pantau TD tiap 8 jam.',
        },
      }),
      note({
        id: 'n12b',
        encounterNo: 'INP-20260312-0003',
        at: '2026-03-12T12:10:00+07:00',
        author: NS_SR,
        kind: 'nursing',
        text: 'Pasien tiba di bangsal, TTV stabil, nyeri dada 2/10.',
      }),
      note({
        id: 'n12a',
        encounterNo: 'INP-20260312-0003',
        at: '2026-03-12T11:45:00+07:00',
        author: DR_AP,
        kind: 'admission',
        text: 'Pasien masuk dengan nyeri dada dan tekanan darah tinggi.',
      }),
    ],
    procedures: [
      proc('p1', '2026-03-12T08:40:00+07:00', 'EKG 12 lead', 'doctor', DR_RW, '89.52'),
      proc('p2', '2026-03-12T09:10:00+07:00', 'Pemasangan infus', 'nurse', NS_SR, '38.93'),
      proc(
        'p3',
        '2026-03-12T14:30:00+07:00',
        'Pemantauan tekanan darah tiap 8 jam',
        'nurse',
        NS_SR,
        null,
      ),
      proc('p4', '2026-03-13T09:00:00+07:00', 'Visite dokter', 'doctor', DR_AP, null),
    ],
    outcome: {
      treatment: 'Amlodipine 10 mg, Candesartan 16 mg · EKG · infus · pemantauan tekanan darah',
      diet: 'Diet rendah garam',
      room: 'Bangsal Penyakit Dalam, Kamar 3B',
      lengthOfStayDays: 3,
      condition: 'improved',
      wayOfLeaving: 'doctorPermission',
    },
    followUp: {
      careContinues: 'returnHere',
      controlVisit: '20 Mar 2026 · Poli Penyakit Dalam · dr. Andika Pratama, Sp.PD',
      controlAt: '2026-03-20',
      referral: null,
      takeHome: 'Amlodipine 10 mg 1×1 · Candesartan 16 mg 1×1',
      dietEducation: 'Diet rendah garam; periksa tekanan darah di rumah',
      pendingResults: null,
    },
    signature: { doctor: DR_AP, status: 'signed', at: '2026-03-15T10:40:00+07:00' },
  },
  {
    no: 'RJ-20251103-0011',
    registeredAt: '2025-11-03T09:40:00+07:00',
    care: 'outpatient',
    unit: 'Poli Jantung',
    open: false,
    admissionDiagnosis: null,
    diagnoses: [{ code: 'I10', name: 'Hipertensi esensial', priority: 1, isNew: false }],
    assessment: {
      chiefComplaint: 'Kontrol rutin.',
      presentIllness: 'Tidak ada keluhan.',
      pastIllness: 'Hipertensi sejak 2020.',
      familyHistory: 'Ibu: hipertensi.',
      medicationHistory: 'Amlodipine 5 mg rutin.',
      assessedAt: '2025-11-03T09:50:00+07:00',
      kind: 'outpatient',
    },
    physicalExam: 'TD 138/86, N 76.',
    labs: [],
    radiology: [],
    therapy: [],
    notes: [
      note({
        id: 'n1',
        encounterNo: 'RJ-20251103-0011',
        at: '2025-11-03T10:05:00+07:00',
        author: DR_BS,
        soap: {
          s: 'Kontrol rutin, tidak ada keluhan.',
          o: 'TD 138/86, N 76.',
          a: 'Hipertensi stabil.',
          p: 'Lanjutkan Amlodipine 5 mg.',
        },
      }),
    ],
    procedures: [
      proc('p1', '2025-11-03T10:15:00+07:00', 'Ekokardiografi', 'doctor', DR_BS, '88.72'),
    ],
    outcome: {
      treatment: 'Amlodipine 5 mg · ekokardiografi',
      diet: null,
      room: null,
      lengthOfStayDays: null,
      condition: null,
      wayOfLeaving: null,
    },
    followUp: {
      careContinues: 'returnHere',
      controlVisit: null,
      controlAt: null,
      referral: null,
      takeHome: 'Amlodipine 5 mg 1×1',
      dietEducation: null,
      pendingResults: null,
    },
    signature: { doctor: DR_BS, status: 'signed', at: '2025-11-03T10:30:00+07:00' },
  },
  {
    no: 'RJ-20250618-0004',
    registeredAt: '2025-06-18T08:50:00+07:00',
    care: 'outpatient',
    unit: 'Poli Penyakit Dalam',
    open: false,
    admissionDiagnosis: null,
    diagnoses: [
      { code: 'I10', name: 'Hipertensi esensial', priority: 1, isNew: true },
      { code: 'E78.5', name: 'Hiperlipidemia, tidak spesifik', priority: 2, isNew: true },
    ],
    assessment: {
      chiefComplaint: 'Sakit kepala berulang.',
      presentIllness: 'Sakit kepala 2 minggu, tekanan darah tinggi saat diperiksa di puskesmas.',
      pastIllness: '—',
      familyHistory: 'Ibu: hipertensi.',
      medicationHistory: '—',
      assessedAt: '2025-06-18T09:00:00+07:00',
      kind: 'outpatient',
    },
    physicalExam: 'TD 156/96, N 82.',
    labs: [],
    radiology: [],
    therapy: [],
    notes: [
      note({
        id: 'n1',
        encounterNo: 'RJ-20250618-0004',
        at: '2025-06-18T09:30:00+07:00',
        author: DR_CL,
        soap: {
          s: 'Sakit kepala berulang.',
          o: 'TD 156/96, N 82.',
          a: 'Hipertensi derajat 1, hiperlipidemia.',
          p: 'Mulai Amlodipine 5 mg, kontrol 2 minggu.',
        },
      }),
    ],
    procedures: [proc('p1', '2025-06-18T09:20:00+07:00', 'EKG 12 lead', 'doctor', DR_CL, '89.52')],
    outcome: {
      treatment: 'Amlodipine 5 mg · EKG',
      diet: null,
      room: null,
      lengthOfStayDays: null,
      condition: null,
      wayOfLeaving: null,
    },
    followUp: {
      careContinues: 'returnHere',
      controlVisit: '02 Jul 2025 · Poli Penyakit Dalam',
      controlAt: '2025-07-02',
      referral: null,
      takeHome: 'Amlodipine 5 mg 1×1',
      dietEducation: null,
      pendingResults: null,
    },
    signature: { doctor: DR_CL, status: 'signed', at: '2025-06-18T10:00:00+07:00' },
  },
];

/** The demo patient has a full history; the generic synthetic patients get their current encounter only. */
export function findSyntheticMedicalRecord(record: PatientRecord): MedicalRecordSummary {
  if (record.mrn === '00012346')
    return { allergies: record.allergies, encounters: SITI_ENCOUNTERS };
  const e = record.currentEncounter;
  const open = e.dischargePlan !== 'discharged';
  const h = record.history;
  return {
    allergies: record.allergies,
    encounters: [
      {
        no: e.no,
        registeredAt: e.admittedAt,
        care: e.care,
        unit: e.room === '—' ? e.service : e.room,
        open,
        admissionDiagnosis: null,
        diagnoses: record.diagnoses
          .filter((d) => d.encounterNo === e.no)
          .map(({ code, name, priority, isNew }) => ({ code, name, priority, isNew })),
        assessment: {
          chiefComplaint: h.chiefComplaint,
          presentIllness: h.presentIllness,
          pastIllness: h.pastIllness,
          familyHistory: h.familyHistory,
          medicationHistory: h.medicationHistory,
          assessedAt: h.assessedAt,
          kind: e.care === 'inpatient' ? 'admission' : 'outpatient',
        },
        physicalExam: null,
        labs: [],
        radiology: [],
        therapy: [],
        notes: record.notes.filter((n) => n.encounterNo === e.no),
        procedures: [],
        outcome: open
          ? null
          : {
              treatment: '—',
              diet: null,
              room: null,
              lengthOfStayDays: null,
              condition: null,
              wayOfLeaving: null,
            },
        followUp: open
          ? null
          : {
              careContinues: null,
              controlVisit: null,
              controlAt: null,
              referral: null,
              takeHome: null,
              dietEducation: null,
              pendingResults: null,
            },
        signature: { doctor: e.attending, status: 'unsigned', at: null },
      },
    ],
  };
}
