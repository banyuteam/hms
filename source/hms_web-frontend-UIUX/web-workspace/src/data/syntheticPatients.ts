/**
 * SYNTHETIC demo rows (names/MRNs come from the design mockups, which the repo rules treat as demo data).
 * Never add real patient data here. Master-data text (insurer, service, doctor) is not translated (OQ-34).
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

export const SYNTHETIC_PATIENTS: readonly SyntheticPatient[] = [
  {
    mrn: '00012346',
    name: 'Siti Nurhaliza',
    age: 40,
    sex: 'female',
    insurer: 'BPJS Kesehatan',
    service: 'Penyakit Dalam',
    doctor: 'dr. Andika Pratama, Sp.PD',
    status: 'inpatient',
  },
  {
    mrn: '00012345',
    name: 'Budi Santoso',
    age: 57,
    sex: 'male',
    insurer: 'Umum',
    service: 'Poli Jantung',
    doctor: 'dr. Hanna Lestari, Sp.JP',
    status: 'outpatient',
  },
  {
    mrn: '00012344',
    name: 'Ratna Dewi',
    age: 29,
    sex: 'female',
    insurer: 'BPJS Kesehatan',
    service: 'Kebidanan',
    doctor: 'dr. Sari Utami, Sp.OG',
    status: 'outpatient',
  },
  {
    mrn: '00012343',
    name: 'Agus Prasetyo',
    age: 66,
    sex: 'male',
    insurer: 'BPJS Kesehatan',
    service: 'IGD',
    doctor: 'dr. Rudi Hartono',
    status: 'emergency',
  },
  {
    mrn: '00012342',
    name: 'Maya Lestari',
    age: 34,
    sex: 'female',
    insurer: 'Asuransi swasta',
    service: 'Poli Anak',
    doctor: 'dr. Wulan Pertiwi, Sp.A',
    status: 'outpatient',
  },
  {
    mrn: '00012341',
    name: 'Hendra Wijaya',
    age: 48,
    sex: 'male',
    insurer: 'BPJS Kesehatan',
    service: 'Bedah',
    doctor: 'dr. Bagus Setiawan, Sp.B',
    status: 'inpatient',
  },
  {
    mrn: '00012340',
    name: 'Dewi Anggraini',
    age: 72,
    sex: 'female',
    insurer: 'BPJS Kesehatan',
    service: 'Penyakit Dalam',
    doctor: 'dr. Andika Pratama, Sp.PD',
    status: 'discharged',
  },
  {
    mrn: '00012339',
    name: 'Rizky Ramadhan',
    age: 8,
    sex: 'male',
    insurer: 'Umum',
    service: 'Poli Anak',
    doctor: 'dr. Wulan Pertiwi, Sp.A',
    status: 'outpatient',
  },
];
