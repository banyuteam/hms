import { describe, expect, it } from 'vitest';
import { journeyKey, localStored, toBill, toJourney } from './liveTimeline';
import { facts, labs, prescriptions } from './select';

// Synthetic clinical-timeline-v1 answer (no real patient data).
const SUMMARY = {
  care_setting: 'inpatient',
  status: { code: 'Dirawat', system: 'legacy-hms:reg_periksa.stts' },
  payer: { code: 'BPJ', name: 'BPJS Kesehatan', company: 'BPJS', type: 'bpjs' },
  diagnoses: [
    { code: 'A01.0', name: 'Demam tifoid', priority: 1, care_setting: 'inpatient', case: 'new' },
    { code: 'R50.9', name: null, priority: 2, care_setting: 'inpatient', case: null },
  ],
  coded_procedures: [
    { code: '47.09', name: 'Appendectomy', priority: 1, care_setting: 'inpatient' },
  ],
  attending_doctors: [{ name: 'dr. Contoh', priority: 1 }],
  discharge_summary: null,
};
const TIMELINE = {
  encounter_number: '2026/10/26/000123',
  patient_mrn: '000001',
  summary: SUMMARY,
  entries: [
    {
      type: 'registration',
      at: '2026-10-26T08:15:00+07:00',
      queue_number: '003',
      care_setting: 'inpatient',
      status: { code: 'Dirawat', system: 'legacy-hms:reg_periksa.stts' },
      payer: SUMMARY.payer,
      clinic: 'IGD',
      doctor_name: 'dr. Contoh',
    },
    {
      type: 'lab_test',
      at: '2026-10-26T09:00:00+07:00',
      code: 'LAB01',
      name: 'Darah lengkap',
      category: 'PK',
      care_setting: 'inpatient',
      doctor_name: 'dr. Lab',
      referring_doctor_name: 'dr. Contoh',
      analyst_name: 'Analis',
      results: [
        {
          template_id: 11,
          item: 'Hemoglobin',
          value: '13.1',
          reference_range: '12-16',
          unit: 'g/dL',
          note: '',
        },
      ],
    },
    {
      type: 'room_stay',
      at: '2026-10-26T10:00:00+07:00',
      room_code: 'VIP.01',
      room_class: 'Kelas VIP',
      ward: 'Melati',
      admission_diagnosis: 'Febris',
      discharge_diagnosis: null,
      discharged_at: '2026-10-30T11:00:00+07:00',
      length_of_stay: '4',
      discharge_status: 'Membaik',
    },
    {
      type: 'prescription',
      at: '2026-10-26T12:00:00+07:00',
      number: 'R001',
      prescribed_at: '2026-10-26T12:00:00+07:00',
      dispensed_at: null,
      care_setting: 'inpatient',
      doctor_name: 'dr. Contoh',
      items: [
        {
          drug_code: 'B001',
          drug_name: 'Parasetamol 500',
          quantity: '10',
          unit: 'TAB',
          instructions: '3x1',
        },
      ],
      compounds: [],
    },
    {
      type: 'clinical_note',
      at: '2026-10-27T07:00:00+07:00',
      care_setting: 'inpatient',
      author_id: 'P001',
      author_name: 'Perawat Contoh',
      subjective: 'demam',
      objective: 'tampak lemah',
      assessment: 'febris',
      plan: 'observasi',
      instruction: '',
      evaluation: '',
      allergy: '',
      consciousness: 'Compos Mentis',
      vitals: { blood_pressure: '120/80', pulse: '88', weight: null },
    },
    { type: 'radiology_report', at: null, text: 'Kesan normal' },
    { type: 'not_in_the_contract', at: null },
  ],
  truncated: ['lab_result'],
};

describe('toJourney (clinical-timeline-v1 → journey)', () => {
  it('groups entries by local time as written, undated last', () => {
    const j = toJourney(TIMELINE);
    expect(Object.keys(j.data)).toEqual([
      '2026-10-26T08:15:00',
      '2026-10-26T09:00:00',
      '2026-10-26T10:00:00',
      '2026-10-26T12:00:00',
      '2026-10-27T07:00:00',
      'undated',
    ]);
    expect(j.data.undated).toEqual({ radiology_report: [{ hasil: 'Kesan normal' }] });
    expect(j.meta.truncated).toEqual(['lab_result']);
  });

  it('maps the fields the windows read, inventing nothing', () => {
    const j = toJourney(TIMELINE);
    const note = j.data['2026-10-27T07:00:00']!.clinical_notes![0]!;
    expect(note).toMatchObject({
      keluhan: 'demam',
      pemeriksaan: 'tampak lemah',
      penilaian: 'febris',
      rtl: 'observasi',
      alergi: null,
      kesadaran: 'Compos Mentis',
      tensi: '120/80',
      berat: null,
      nip: 'P001',
    });
    const stay = j.data['2026-10-26T10:00:00']!.room_stay![0]!;
    expect(stay).toMatchObject({
      tgl_masuk: '2026-10-26',
      jam_masuk: '10:00:00',
      tgl_keluar: '2026-10-30',
      lama: 4,
      diagnosa_akhir: null,
    });
    const rx = prescriptions(j)[0]!;
    expect(rx.tgl_penyerahan).toBe('0000-00-00'); // not handed over yet: the legacy "no date", shown as absent
    expect(rx.items[0]).toMatchObject({
      drug_name: 'Parasetamol 500',
      jml: 10,
      aturan_pakai: '3x1',
    });
    expect(labs(j)[0]!.results[0]).toMatchObject({ id_template: 11, nilai: '13.1', unit: 'g/dL' });
    expect(j.summary.diagnoses.map((d) => d.status_penyakit)).toEqual(['Baru', null]);
    expect(j.summary.encounter).toMatchObject({
      stts: 'Dirawat',
      payer_type: 'bpjs',
      kd_pj: 'BPJ',
    });
    const f = facts(j);
    expect(f.payerType).toBe('bpjs');
    expect(f.status).toBe('Dirawat');
  });

  it('a status outside the legacy list stays null', () => {
    const j = toJourney({
      ...TIMELINE,
      summary: { ...SUMMARY, status: { code: 'Something', system: '' } },
    });
    expect(j.summary.encounter?.stts).toBeNull();
  });

  it('refuses a body of another shape', () => {
    expect(() => toJourney({ encounter_number: 'x', entries: [] })).toThrow(/BAD_SHAPE/);
  });

  it('maps the SEPs of 1.3.0 in full; an older server without them reads as "not available"', () => {
    const sep = {
      number: '0301R0011026V000123',
      date: '2026-10-26',
      service_type: '1',
      class: '2',
      referral_number: null,
      referring_facility: 'IGD RS (synthetic)',
      initial_diagnosis: { code: 'R06.0', name: 'Dyspnoea' },
      destination_clinic: null,
      dpjp_name: 'dr. Contoh',
      discharged_at: '2026-10-30T10:00:00+07:00',
      cob: '0. Tidak',
      suplesi: '0. Tidak',
      suplesi_sep_number: null,
    };
    const j = toJourney({ ...TIMELINE, summary: { ...SUMMARY, sep: [sep] } });
    expect(j.summary.sep).toEqual([
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
        nmdpdjp: 'dr. Contoh',
        tglpulang: '2026-10-30 10:00:00',
        cob: '0. Tidak',
      },
    ]);
    expect(facts(j).sep).toMatchObject({ state: 'present' });
    expect(toJourney({ ...TIMELINE, summary: { ...SUMMARY, sep: [] } }).summary.sep).toEqual([]);
    expect(toJourney(TIMELINE).summary.sep).toBeUndefined();
    expect(() =>
      toJourney({ ...TIMELINE, summary: { ...SUMMARY, sep: [{ ...sep, number: null }] } }),
    ).toThrow(/BAD_SHAPE/);
  });

  it('keys and stored times use the local time as written', () => {
    expect(journeyKey('2026-10-26T08:15:00+07:00')).toBe('2026-10-26T08:15:00');
    expect(journeyKey(null)).toBe('undated');
    expect(localStored('2026-10-30T14:00:00+07:00')).toBe('2026-10-30 14:00:00');
  });
});

describe('toBill', () => {
  it('accepts the grouped charges and refuses the old saved-bill shape or anything else', () => {
    const bill = {
      encounter_number: '2026/10/26/000123',
      currency: 'IDR',
      basis: 'recorded_charges',
      care_setting: 'inpatient',
      groups: [
        {
          category: 'medication',
          legacy_category: 'Obat',
          subtotal: '5000.00',
          lines: [
            {
              code: 'B001',
              label: null,
              quantity: '10.00',
              unit_price: '500.00',
              additional: '0.00',
              amount: '5000.00',
              rate_percent: null,
              tariff: '5000.00',
              tariff_matches: true,
            },
          ],
        },
      ],
      total: '5000.00',
      saved_bill: null,
      payments: [],
      receivable: null,
      truncated: [],
    };
    expect(toBill(bill).groups[0]!.lines[0]!.amount).toBe('5000.00');
    expect(() => toBill({ ...bill, currency: 'USD' })).toThrow(/BAD_SHAPE/);
    expect(() => toBill({ ...bill, groups: [{ ...bill.groups[0], category: 'parking' }] })).toThrow(
      /BAD_SHAPE/,
    );
    expect(() => toBill({ ...bill, basis: undefined, saved: true, lines: [] })).toThrow(
      /BAD_SHAPE/,
    );
  });
});
