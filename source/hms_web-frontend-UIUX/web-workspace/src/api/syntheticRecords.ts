import { SYNTHETIC_PATIENTS, type SyntheticPatient } from '@/data/syntheticPatients';
import type { Address, MaskedText, PatientRecord } from './types';

/**
 * SYNTHETIC patient records for Phase 2 (no backend yet). Names/MRNs are the demo rows from the design mockups; everything
 * else is invented. Free text is Indonesian on purpose: clinical data is shown as stored, never translated (OQ-34).
 * Never add real patient data here.
 */
const masked = (value: string, shown: string): MaskedText => ({ value, masked: shown });

const SITI: PatientRecord = {
  mrn: '00012346',
  name: 'Siti Nurhaliza',
  sex: 'female',
  birthDate: '1985-10-02',
  ageYears: 40,
  status: 'inpatient',
  nik: masked('3273010210850002', '3273••••••••0002'),
  birthPlace: 'Semarang',
  bloodType: 'O',
  maritalStatus: 'married',
  religion: 'Islam',
  education: 'S1',
  occupation: 'Guru',
  ethnicity: 'Jawa',
  language: 'Indonesia',
  motherName: 'Sri Wahyuni',
  disability: null,
  firstRegistered: '2019-03-12',
  lastVisit: '2026-10-26',
  encounterCount: 14,
  phone: masked('081234563344', '0812••••3344'),
  email: masked('siti.n@example.com', 'si••••@example.com'),
  address: {
    line: masked('Jl. Melati No. 12, RT 03 RW 05', 'Jl. Melati •••, RT •• RW ••'),
    village: 'Pudakpayung',
    district: 'Banyumanik',
    city: 'Semarang',
    province: 'Jawa Tengah',
  },
  guarantor: {
    name: 'BPJS Kesehatan',
    membershipNo: masked('0001234567123', '0001••••••123'),
    employer: 'SMA Negeri 5 Semarang',
    insurerPhone: null,
  },
  responsiblePerson: {
    name: 'Ahmad Fauzi',
    relationship: 'husband',
    occupation: 'Wiraswasta',
    address: {
      line: masked('Jl. Melati No. 12, RT 03 RW 05', 'Jl. Melati •••'),
      village: 'Pudakpayung',
      district: 'Banyumanik',
      city: 'Semarang',
      province: 'Jawa Tengah',
    },
  },
  currentEncounter: {
    no: 'INP-20261027-0001',
    admittedAt: '2026-10-26T14:30:00+07:00',
    care: 'inpatient',
    service: 'Penyakit Dalam',
    attending: 'dr. Andika Pratama, Sp.PD',
    room: 'Bangsal A - 301',
    primaryDx: 'J18.9 - Pneumonia',
    secondaryDx: 'I10 - Hipertensi esensial',
    dischargePlan: 'underTreatment',
    guarantor: 'BPJS Kesehatan',
    sep: {
      no: masked('0301R0010126V000123', '0301R••••••V000123'),
      date: '2026-10-26',
      care: 'inpatient',
      careClass: 2,
      referralFrom: 'faskes1',
      referrer: 'Puskesmas Contoh',
      initialDiagnosis: 'J18.9 - Pneumonia',
      cob: false,
    },
    responsible: {
      name: 'Ahmad Fauzi',
      relationship: 'husband',
      address: masked('Jl. Melati No. 12, RT 03 RW 05', 'Jl. Melati •••'),
    },
  },
  diagnoses: [
    {
      encounterNo: 'INP-20261027-0001',
      code: 'J18.9',
      name: 'Pneumonia',
      priority: 1,
      isNew: true,
      care: 'inpatient',
    },
    {
      encounterNo: 'INP-20261027-0001',
      code: 'I10',
      name: 'Hipertensi esensial',
      priority: 2,
      isNew: false,
      care: 'inpatient',
    },
    {
      encounterNo: 'RJ-20260324-0007',
      code: 'I10',
      name: 'Hipertensi esensial',
      priority: 1,
      isNew: false,
      care: 'outpatient',
    },
  ],
  history: {
    chiefComplaint: 'Demam, batuk, dan sesak napas.',
    presentIllness: 'Demam 3 hari, batuk berdahak, sesak napas saat aktivitas.',
    pastIllness: 'Hipertensi sejak 2020.',
    familyHistory: 'Ibu: hipertensi.',
    medicationHistory: 'Amlodipine 5 mg rutin.',
    assessedAt: '2026-10-26T14:45:00+07:00',
  },
  notes: [
    {
      id: 'n3',
      encounterNo: 'INP-20261027-0001',
      at: '2026-10-27T08:30:00+07:00',
      author: 'dr. Andika Pratama, Sp.PD',
      kind: 'progress',
      soap: {
        s: 'Demam ringan, batuk berkurang.',
        o: 'TD 140/90, N 88, RR 18, T 37.8, SpO₂ 96%. Ronki basah kanan bawah.',
        a: 'Pneumonia, membaik dengan terapi antibiotik.',
        p: 'Lanjutkan Ceftriaxone IV, kontrol lab 24–48 jam, observasi klinis.',
      },
    },
    {
      id: 'n2',
      encounterNo: 'INP-20261027-0001',
      at: '2026-10-26T16:15:00+07:00',
      author: 'Siti Rahayu, S.Kep',
      kind: 'nursing',
      text: 'TTV stabil, pasien mengeluh nyeri dada berkurang.',
    },
    {
      id: 'n1',
      encounterNo: 'INP-20261027-0001',
      at: '2026-10-26T14:45:00+07:00',
      author: 'dr. Andika Pratama, Sp.PD',
      kind: 'admission',
      text: 'Pasien masuk dengan keluhan demam, batuk, dan sesak napas.',
    },
    {
      id: 'n0',
      encounterNo: 'RJ-20260324-0007',
      at: '2026-03-24T10:05:00+07:00',
      author: 'dr. Hanna Lestari, Sp.JP',
      kind: 'progress',
      soap: {
        s: 'Kontrol rutin, tanpa keluhan.',
        o: 'TD 138/86, N 80.',
        a: 'Hipertensi terkontrol.',
        p: 'Lanjutkan Amlodipine 5 mg, kontrol 3 bulan.',
      },
    },
  ],
  allergies: [
    {
      id: 'a1',
      allergen: 'Penisilin',
      reaction: 'Ruam',
      category: 'medication',
      type: 'allergy',
      criticality: 'high',
      status: 'active',
      verification: 'confirmed',
      recordedAt: '2026-10-26T14:45:00+07:00',
    },
  ],
  vitals: {
    at: '2026-10-27T08:00:00+07:00',
    systolic: 140,
    diastolic: 90,
    heartRate: 88,
    respiratoryRate: 18,
    temperatureC: 37.8,
    spo2: 96,
    weightKg: 65,
  },
  medications: [
    { name: 'Ceftriaxone', dose: '1 g IV q12h', status: 'ongoing' },
    { name: 'Paracetamol', dose: '500 mg PO q8h', status: 'ongoing' },
    { name: 'Amlodipine', dose: '5 mg PO qd', status: 'ongoing' },
  ],
};

/** Plain generated record for every other demo row: enough to exercise every screen, not a clinical story. */
function generic(row: SyntheticPatient, index: number): PatientRecord {
  const care = row.status === 'inpatient' ? 'inpatient' : 'outpatient';
  const addr = (): Address => ({
    line: masked(
      `Jl. Contoh No. ${10 + index}, RT 0${1 + (index % 5)} RW 0${1 + (index % 4)}`,
      'Jl. Contoh •••, RT •• RW ••',
    ),
    village: 'Contoh',
    district: 'Banyumanik',
    city: 'Semarang',
    province: 'Jawa Tengah',
  });
  const no = `${care === 'inpatient' ? 'INP' : 'RJ'}-2026102${index % 8}-00${10 + index}`;
  return {
    mrn: row.mrn,
    name: row.name,
    sex: row.sex,
    birthDate: `${2026 - row.age}-06-15`,
    ageYears: row.age,
    status: row.status,
    nik: masked(`32730100000000${10 + index}`, '3273••••••••00' + (10 + index)),
    birthPlace: 'Semarang',
    bloodType: (['A', 'B', 'O', 'AB'] as const)[index % 4]!,
    maritalStatus: row.age < 18 ? 'single' : 'married',
    religion: 'Islam',
    education: row.age < 18 ? 'SD' : 'SMA',
    occupation: row.age < 18 ? 'Pelajar' : 'Wiraswasta',
    ethnicity: 'Jawa',
    language: 'Indonesia',
    motherName: 'Ibu Contoh',
    disability: null,
    firstRegistered: '2022-01-10',
    lastVisit: '2026-10-2' + (index % 8),
    encounterCount: 3 + index,
    phone: masked(`08120000${1000 + index}`, '0812••••' + (1000 + index)),
    email: masked(`pasien${index}@example.com`, 'pa••••@example.com'),
    address: addr(),
    guarantor: {
      name: row.insurer,
      membershipNo: masked(
        `000100000${1000 + index}`,
        '0001••••••' + (1000 + index).toString().slice(1),
      ),
      employer: null,
      insurerPhone: null,
    },
    responsiblePerson: {
      name: 'Keluarga Contoh',
      relationship: row.sex === 'male' ? 'wife' : 'husband',
      occupation: 'Wiraswasta',
      address: addr(),
    },
    currentEncounter: {
      no,
      admittedAt: '2026-10-2' + (index % 8) + 'T09:00:00+07:00',
      care,
      service: row.service,
      attending: row.doctor,
      room: care === 'inpatient' ? 'Bangsal B - 20' + index : '—',
      primaryDx: 'Z00.0 - Pemeriksaan umum',
      secondaryDx: '—',
      dischargePlan: row.status === 'discharged' ? 'discharged' : 'underTreatment',
      guarantor: row.insurer,
      sep:
        row.insurer === 'BPJS Kesehatan'
          ? {
              no: masked(`0301R001012${index}V00010${index}`, '0301R••••••V00010' + index),
              date: '2026-10-2' + (index % 8),
              care,
              careClass: 3,
              referralFrom: 'faskes1',
              referrer: 'Puskesmas Contoh',
              initialDiagnosis: 'Z00.0 - Pemeriksaan umum',
              cob: false,
            }
          : null,
      responsible: {
        name: 'Keluarga Contoh',
        relationship: row.sex === 'male' ? 'wife' : 'husband',
        address: masked('Jl. Contoh', 'Jl. Contoh •••'),
      },
    },
    diagnoses: [
      { encounterNo: no, code: 'Z00.0', name: 'Pemeriksaan umum', priority: 1, isNew: true, care },
    ],
    history: {
      chiefComplaint: 'Kontrol.',
      presentIllness: '—',
      pastIllness: '—',
      familyHistory: '—',
      medicationHistory: '—',
      assessedAt: '2026-10-2' + (index % 8) + 'T09:10:00+07:00',
    },
    notes: [
      {
        id: `n-${row.mrn}`,
        encounterNo: no,
        at: '2026-10-2' + (index % 8) + 'T09:30:00+07:00',
        author: row.doctor,
        kind: 'progress',
        soap: {
          s: 'Tanpa keluhan baru.',
          o: 'TTV dalam batas normal.',
          a: 'Kondisi stabil.',
          p: 'Lanjutkan terapi.',
        },
      },
    ],
    allergies: [],
    vitals: {
      at: '2026-10-2' + (index % 8) + 'T09:00:00+07:00',
      systolic: 120,
      diastolic: 80,
      heartRate: 78,
      respiratoryRate: 18,
      temperatureC: 36.7,
      spo2: 98,
      weightKg: 60 + index,
    },
    medications: [],
  };
}

const RECORDS = new Map<string, PatientRecord>(
  SYNTHETIC_PATIENTS.map((row, i) => [row.mrn, row.mrn === SITI.mrn ? SITI : generic(row, i)]),
);

export function findSyntheticRecord(mrn: string): PatientRecord | undefined {
  return RECORDS.get(mrn);
}
