import type { EncounterHistoryItem, PatientRecord, TimelineEvent } from './types';

/**
 * SYNTHETIC encounter history for Phase 3 (no backend yet). Invented data only; free text is Indonesian on purpose
 * (clinical data is shown as stored, OQ-34). Never add real patient data here.
 */
const ev = (
  id: string,
  kind: TimelineEvent['kind'],
  at: string,
  title: string,
  unit: string,
  doctor: string | null,
): TimelineEvent => ({ id, kind, at, title, unit, doctor });

const DR_PD = 'dr. Andika Pratama, Sp.PD';
const DR_JP = 'dr. Maya Lestari, Sp.JP';
const DR_UM = 'dr. Rudi Hartono';

const SITI_ENCOUNTERS: EncounterHistoryItem[] = [
  {
    no: 'INP-20261027-0001',
    registeredAt: '2026-10-27T08:30:00+07:00',
    care: 'inpatient',
    status: 'admitted',
    unit: 'Ruang Melati 3',
    responsibleDoctor: DR_PD,
    admittedAt: '2026-10-27T10:00:00+07:00',
    dischargedAt: null,
    lengthOfStayDays: null,
    outcome: null,
    payer: 'BPJS Kesehatan',
    sepNo: { value: '0301R0010126V000123', masked: '0301R001••••••V000123' },
    timeline: [
      ev('t1', 'registration', '2026-10-27T08:30:00+07:00', 'Registrasi rawat inap', 'IGD', DR_UM),
      ev(
        't2',
        'laboratory',
        '2026-10-27T09:10:00+07:00',
        'Darah lengkap, GDS',
        'Laboratorium',
        DR_PD,
      ),
      ev('t3', 'radiology', '2026-10-27T09:40:00+07:00', 'Foto thorax PA', 'Radiologi', DR_PD),
      ev(
        't4',
        'admission',
        '2026-10-27T10:00:00+07:00',
        'Masuk Ruang Melati 3, kamar 302',
        'Ruang Melati 3',
        DR_PD,
      ),
      ev(
        't5',
        'prescription',
        '2026-10-27T11:15:00+07:00',
        'Resep: Ceftriaxone 1 g, Paracetamol 500 mg',
        'Farmasi',
        DR_PD,
      ),
      ev('t6', 'visit', '2026-10-28T08:20:00+07:00', 'Visite dokter', 'Ruang Melati 3', DR_PD),
    ],
  },
  {
    no: 'OUT-20260915-0042',
    registeredAt: '2026-09-15T09:05:00+07:00',
    care: 'outpatient',
    status: 'completed',
    unit: 'Poli Penyakit Dalam',
    responsibleDoctor: DR_PD,
    admittedAt: null,
    dischargedAt: null,
    lengthOfStayDays: null,
    outcome: null,
    payer: 'BPJS Kesehatan',
    sepNo: { value: '0301R0010926V000456', masked: '0301R001••••••V000456' },
    timeline: [
      ev(
        'o1',
        'registration',
        '2026-09-15T09:05:00+07:00',
        'Registrasi rawat jalan',
        'Poli Penyakit Dalam',
        DR_PD,
      ),
      ev(
        'o2',
        'procedure',
        '2026-09-15T09:30:00+07:00',
        'Pemeriksaan dan konsultasi',
        'Poli Penyakit Dalam',
        DR_PD,
      ),
      ev('o3', 'laboratory', '2026-09-15T09:50:00+07:00', 'HbA1c', 'Laboratorium', DR_PD),
      ev(
        'o4',
        'prescription',
        '2026-09-15T10:20:00+07:00',
        'Resep: Metformin 500 mg',
        'Farmasi',
        DR_PD,
      ),
    ],
  },
  {
    no: 'INP-20260702-0007',
    registeredAt: '2026-07-02T14:10:00+07:00',
    care: 'inpatient',
    status: 'completed',
    unit: 'Ruang Mawar 2',
    responsibleDoctor: DR_JP,
    admittedAt: '2026-07-02T15:00:00+07:00',
    dischargedAt: '2026-07-06T11:00:00+07:00',
    lengthOfStayDays: 4,
    outcome: 'improved',
    payer: 'BPJS Kesehatan',
    sepNo: { value: '0301R0010726V000789', masked: '0301R001••••••V000789' },
    timeline: [
      ev('i1', 'registration', '2026-07-02T14:10:00+07:00', 'Registrasi rawat inap', 'IGD', DR_UM),
      ev(
        'i2',
        'admission',
        '2026-07-02T15:00:00+07:00',
        'Masuk Ruang Mawar 2, kamar 205',
        'Ruang Mawar 2',
        DR_JP,
      ),
      ev(
        'i3',
        'laboratory',
        '2026-07-02T15:40:00+07:00',
        'Troponin, elektrolit',
        'Laboratorium',
        DR_JP,
      ),
      ev(
        'i4',
        'surgery',
        '2026-07-03T09:00:00+07:00',
        'Angiografi koroner diagnostik',
        'Kamar Operasi 1',
        DR_JP,
      ),
      ev('i5', 'visit', '2026-07-04T08:15:00+07:00', 'Visite dokter', 'Ruang Mawar 2', DR_JP),
      ev('i6', 'discharge', '2026-07-06T11:00:00+07:00', 'Pulang: membaik', 'Ruang Mawar 2', DR_JP),
    ],
  },
  {
    no: 'OUT-20260310-0013',
    registeredAt: '2026-03-10T10:00:00+07:00',
    care: 'outpatient',
    status: 'cancelled',
    unit: 'Poli Umum',
    responsibleDoctor: DR_UM,
    admittedAt: null,
    dischargedAt: null,
    lengthOfStayDays: null,
    outcome: null,
    payer: 'BPJS Kesehatan',
    sepNo: null,
    timeline: [
      ev(
        'c1',
        'registration',
        '2026-03-10T10:00:00+07:00',
        'Registrasi rawat jalan',
        'Poli Umum',
        DR_UM,
      ),
    ],
  },
];

/** The demo patient has a full history; the generic synthetic patients get their current encounter only. */
export function findSyntheticEncounters(record: PatientRecord): EncounterHistoryItem[] {
  if (record.mrn === '00012346') return SITI_ENCOUNTERS;
  const e = record.currentEncounter;
  const inpatient = e.care === 'inpatient';
  return [
    {
      no: e.no,
      registeredAt: e.admittedAt,
      care: e.care,
      status: inpatient ? 'admitted' : 'completed',
      unit: e.room || e.service,
      responsibleDoctor: e.attending,
      admittedAt: inpatient ? e.admittedAt : null,
      dischargedAt: null,
      lengthOfStayDays: null,
      outcome: null,
      payer: e.guarantor,
      sepNo: e.sep?.no ?? null,
      timeline: [ev('r1', 'registration', e.admittedAt, 'Registrasi', e.service, e.attending)],
    },
  ];
}
