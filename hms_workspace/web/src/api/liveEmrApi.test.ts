import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/api/errors';
import { liveEmrApi, toListItem } from './liveEmrApi';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number) =>
  new Response(JSON.stringify({ error: { code: 'x', message: '' } }), { status });

// Synthetic clinical-read-v1 encounter.
const ENC = {
  encounter_number: '2026/10/26/000123',
  queue_number: '001',
  patient_mrn: '000001',
  registered_at: '2026-10-26T09:00:00+07:00',
  care_setting: 'inpatient' as const,
  status: { code: 'Dirawat', system: 'legacy-hms:reg_periksa.stts' },
  payer_code: 'BPJ',
};
const ITEM = {
  no_rawat: '2026/10/26/000123',
  no_reg: '001',
  no_rkm_medis: '000001',
  tgl_registrasi: '2026-10-26',
  jam_reg: '09:00:00',
  status_lanjut: 'Ranap',
  stts: 'Dirawat',
  kd_pj: 'BPJ',
};

let fetchMock: ReturnType<typeof vi.fn>;
const lastUrl = () => fetchMock.mock.calls.at(-1)![0] as string;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('liveEmrApi (clinical-read-v1)', () => {
  it('toListItem maps the encounter to the list item, keeping the local date and time as written', () => {
    expect(toListItem(ENC)).toEqual(ITEM);
    expect(
      toListItem({
        ...ENC,
        registered_at: null,
        care_setting: 'outpatient',
        status: { code: 'Unknown', system: '' },
        payer_code: null,
      }),
    ).toEqual({
      ...ITEM,
      tgl_registrasi: null,
      jam_reg: null,
      status_lanjut: 'Ralan',
      stts: null, // a status the UI does not know is not guessed
      kd_pj: undefined,
    });
  });

  it('listEncounters asks for the newest 100 visits of the patient', async () => {
    fetchMock.mockResolvedValue(ok({ encounters: [ENC] }));
    const list = await liveEmrApi.listEncounters('000001');
    expect(lastUrl()).toBe('/api/v1/patients/000001/encounters?limit=100');
    expect(list).toEqual([ITEM]);
  });

  it('listEncounterPage asks for 50 per page, passes `before` on, and reports the next one', async () => {
    fetchMock.mockResolvedValueOnce(ok({ encounters: [ENC], next_before: ENC.encounter_number }));
    expect(await liveEmrApi.listEncounterPage('000001')).toEqual({
      items: [ITEM],
      nextCursor: ENC.encounter_number,
    });
    expect(lastUrl()).toBe('/api/v1/patients/000001/encounters?limit=50');

    fetchMock.mockResolvedValueOnce(ok({ encounters: [] }));
    expect(await liveEmrApi.listEncounterPage('000001', ENC.encounter_number)).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(lastUrl()).toBe(
      `/api/v1/patients/000001/encounters?limit=50&before=${encodeURIComponent(ENC.encounter_number)}`,
    );

    fetchMock.mockResolvedValueOnce(fail(404));
    expect(await liveEmrApi.listEncounterPage('nope')).toEqual({ items: [], nextCursor: null });
    fetchMock.mockResolvedValueOnce(fail(503));
    await expect(liveEmrApi.listEncounterPage('000001')).rejects.toMatchObject({ status: 503 });
  });

  it('listEncounters answers [] for an unknown patient (404) but surfaces failures and bad answers', async () => {
    fetchMock.mockResolvedValueOnce(fail(404));
    expect(await liveEmrApi.listEncounters('nope')).toEqual([]);
    fetchMock.mockResolvedValueOnce(fail(403));
    await expect(liveEmrApi.listEncounters('000001')).rejects.toMatchObject({ status: 403 });
    fetchMock.mockResolvedValueOnce(ok({ data: [] })); // not this contract
    await expect(liveEmrApi.listEncounters('000001')).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });

  it('getJourney reads the timeline of the encoded encounter number; 404 is NotFound, 403 surfaces', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        encounter_number: ENC.encounter_number,
        patient_mrn: '000001',
        summary: {
          care_setting: 'inpatient',
          status: { code: 'Dirawat', system: 'legacy-hms:reg_periksa.stts' },
          payer: { code: 'BPJ', name: 'BPJS', company: null, type: 'bpjs' },
          diagnoses: [],
          coded_procedures: [],
          attending_doctors: [],
          discharge_summary: null,
        },
        entries: [],
        truncated: [],
      }),
    );
    const j = await liveEmrApi.getJourney(ENC.encounter_number);
    expect(lastUrl()).toBe('/api/v1/encounters/2026%2F10%2F26%2F000123/timeline');
    expect(j.no_rawat).toBe(ENC.encounter_number);
    fetchMock.mockResolvedValueOnce(fail(404));
    await expect(liveEmrApi.getJourney('2026/10/26/999999')).rejects.toBeInstanceOf(NotFoundError);
    fetchMock.mockResolvedValueOnce(fail(403));
    await expect(liveEmrApi.getJourney(ENC.encounter_number)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('getBill reads the saved bill; a body of another shape is refused', async () => {
    fetchMock.mockResolvedValueOnce(ok({ encounter_number: ENC.encounter_number, saved: false }));
    await expect(liveEmrApi.getBill(ENC.encounter_number)).rejects.toMatchObject({
      code: 'BAD_SHAPE',
    });
    expect(lastUrl()).toBe('/api/v1/encounters/2026%2F10%2F26%2F000123/bill');
  });

  it('findEncounters searches by the start of an encounter number and sends nothing else', async () => {
    for (const q of ['2026/10', '2026/10/26', '2026/10/26/0001', ENC.encounter_number]) {
      fetchMock.mockResolvedValueOnce(ok({ encounters: [ENC] }));
      expect(await liveEmrApi.findEncounters(` ${q} `)).toEqual([ITEM]);
      expect(lastUrl()).toBe(`/api/v1/encounters?q=${encodeURIComponent(q)}&limit=25`);
    }
    fetchMock.mockClear();
    for (const q of ['2026', '014', 'siti', '00012346', '2026/10/26/0001234']) {
      expect(await liveEmrApi.findEncounters(q)).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('findEncounters keeps the patient name only when the server sends it (session may read patients)', async () => {
    fetchMock.mockResolvedValueOnce(ok({ encounters: [{ ...ENC, patient_name: ' Siti ' }] }));
    expect(await liveEmrApi.findEncounters('2026/10/26')).toEqual([
      { ...ITEM, patientName: 'Siti' },
    ]);
    fetchMock.mockResolvedValueOnce(ok({ encounters: [ENC] }));
    expect((await liveEmrApi.findEncounters('2026/10/26'))[0]).not.toHaveProperty('patientName');
  });

  it('findEncounters surfaces a failed search instead of answering "no results"', async () => {
    fetchMock.mockResolvedValueOnce(fail(503));
    await expect(liveEmrApi.findEncounters('2026/10/26')).rejects.toMatchObject({ status: 503 });
  });

  it('getPatientAllergies reads the allergy entries of every visit as written (clinical-read-v1 1.2.0)', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        allergies: [
          {
            text: ' Amoxicillin — rash ',
            last_recorded_at: '2026-10-30T09:00:00+07:00',
            last_encounter_number: '2026/10/26/000123',
            source: 'clinical_note_inpatient',
            times_recorded: 5,
          },
          {
            text: 'Amoxicillin',
            last_recorded_at: null,
            last_encounter_number: '2026/10/26/000123',
            source: 'discharge_summary',
            times_recorded: 1,
          },
        ],
        truncated: false,
      }),
    );
    expect(await liveEmrApi.getPatientAllergies('000001')).toEqual({
      truncated: false,
      entries: [
        {
          text: 'Amoxicillin — rash',
          lastRecorded: '2026-10-30 09:00:00',
          lastEncounter: '2026/10/26/000123',
          source: 'clinical_note_inpatient',
          timesRecorded: 5,
        },
        {
          text: 'Amoxicillin',
          lastRecorded: null,
          lastEncounter: '2026/10/26/000123',
          source: 'discharge_summary',
          timesRecorded: 1,
        },
      ],
    });
    expect(lastUrl()).toBe('/api/v1/patients/000001/allergies');
    // A shape the client does not know is an error, never an empty ("not recorded") list.
    fetchMock.mockResolvedValueOnce(ok({ allergies: [{ text: 'x' }], truncated: false }));
    await expect(liveEmrApi.getPatientAllergies('000001')).rejects.toMatchObject({ status: 502 });
  });

  it('findPatients sends normalised words to the server search and ranks the matches', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        patients: [
          { mrn: '000003', name: 'Ratna Dewi', sex: 'female', birth_date: '1980-02-30' },
          { mrn: '000007', name: ' Dewi Anggraini ', sex: 'female', birth_date: '1985-10-02' },
          { mrn: '000009', name: '', sex: 'unknown', birth_date: null },
        ],
      }),
    );
    const hits = await liveEmrApi.findPatients('  DEWI,  ');
    expect(lastUrl()).toBe('/api/v1/patients?q=dewi&limit=25');
    // A name starting with the word comes first; a missing name stays empty, never invented.
    expect(hits).toEqual([
      // Date of birth and sex come along as the second identifier; a date not on the calendar is not shown as one.
      { mrn: '000007', name: 'Dewi Anggraini', sex: 'female', birthDate: '1985-10-02' },
      { mrn: '000003', name: 'Ratna Dewi', sex: 'female', birthDate: null },
      { mrn: '000009', name: '', sex: 'unknown', birthDate: null },
    ]);

    fetchMock.mockResolvedValueOnce(ok({ patients: [] }));
    await liveEmrApi.findPatients('Nurhalizá   Siti a b c d e');
    // At most 5 words, accents removed (form encoding: a space is "+").
    expect(lastUrl()).toBe('/api/v1/patients?q=nurhaliza+siti+a+b+c&limit=25');

    fetchMock.mockClear();
    expect(await liveEmrApi.findPatients('s')).toEqual([]);
    expect(await liveEmrApi.findPatients(' . ')).toEqual([]);
    expect(await liveEmrApi.findPatients('x'.repeat(65))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('findPatients surfaces a failed search instead of answering "no results"', async () => {
    fetchMock.mockResolvedValueOnce(fail(400));
    await expect(liveEmrApi.findPatients('siti')).rejects.toMatchObject({ status: 400 });
  });
});
