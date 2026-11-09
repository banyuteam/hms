import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from './errors';
import {
  ageInYears,
  liveGetPatientProfile,
  mapPatient,
  revealIdentifier,
  type ApiPatient,
} from './livePatientApi';

// Synthetic clinical-read-v1 patient: already cleaned and masked by the server.
const API: ApiPatient = {
  mrn: '000001',
  name: 'Pasien Contoh',
  sex: 'female',
  birth_date: '1985-10-02',
  birth_place: 'Semarang',
  mother_name: 'Ibu Contoh',
  blood_type: 'O',
  marital_status: 'married',
  religion: 'ISLAM',
  education: 'SLTA',
  occupation: 'Guru',
  first_registered_on: '2019-03-12',
  nik: { masked: '3273••••••••0002' },
  phone: { masked: '0812••••3344' },
  email: { masked: 'co••••@example.com' },
  address: { masked: 'Jl. Mela•••' },
  responsible_person: {
    name: 'Wali Contoh',
    relationship: 'husband',
    occupation: 'Wiraswasta',
    address: { masked: '' },
  },
};
const TODAY = new Date(2026, 10, 5);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapPatient (clinical-read-v1 patient -> PatientCore)', () => {
  it('maps identity and background; sensitive values arrive masked, with a server reveal and no full value', () => {
    const p = mapPatient(API, TODAY);
    expect(p).toMatchObject({
      mrn: '000001',
      name: 'Pasien Contoh',
      sex: 'female',
      birthDate: '1985-10-02',
      ageYears: 41,
      bloodType: 'O',
      maritalStatus: 'married',
      education: 'SLTA',
      firstRegistered: '2019-03-12',
      responsiblePerson: { name: 'Wali Contoh', relationship: 'husband' },
    });
    for (const m of [p.nik, p.phone, p.email, p.address.line]) {
      expect(m.value).toBe(''); // the full value is never in the browser before a reveal
      expect(m.masked).not.toBe('');
      expect(m.reveal).toBeTypeOf('function');
    }
    // Not recorded: nothing to mask, nothing to reveal.
    expect(p.responsiblePerson.address.line).toEqual({ value: '', masked: '' });
    expect(p.address.namesAvailable).toBe(false);
  });

  it('never invents values the server does not give', () => {
    const p = mapPatient(
      {
        ...API,
        sex: 'unknown',
        birth_date: null,
        marital_status: null,
        education: 'none',
        blood_type: 'unknown',
        responsible_person: { ...API.responsible_person, relationship: 'other' },
      },
      TODAY,
    );
    expect(p).toMatchObject({
      sex: 'unknown',
      birthDate: null,
      ageYears: null,
      maritalStatus: null,
      education: 'none',
      bloodType: 'unknown',
    });
    expect(p.responsiblePerson.relationship).toBe('unknown');
    expect(mapPatient({ ...API, education: 'PhD' }, TODAY).education).toBe('none');
    expect(mapPatient({ ...API, marital_status: 'widowed_divorced' }, TODAY).maritalStatus).toBe(
      'widowedDivorced',
    );
  });

  it('ageInYears counts whole years and refuses bad dates', () => {
    expect(ageInYears('2000-11-05', TODAY)).toBe(26);
    expect(ageInYears('2000-11-06', TODAY)).toBe(25);
    expect(ageInYears('2030-01-01', TODAY)).toBeNull();
    expect(ageInYears('0000-00-00', TODAY)).toBeNull();
    expect(ageInYears(null, TODAY)).toBeNull();
  });
});

describe('liveGetPatientProfile and reveal', () => {
  it('reads /patients/{mrn} and maps it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(API));
    vi.stubGlobal('fetch', fetchMock);
    expect((await liveGetPatientProfile('000001')).name).toBe('Pasien Contoh');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/patients/000001');
  });

  it('turns 404 into NotFoundError, and refuses an answer that is not this contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 'not_found' } }, 404)));
    await expect(liveGetPatientProfile('nope')).rejects.toBeInstanceOf(NotFoundError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: { no_rkm_medis: '000001' } })));
    await expect(liveGetPatientProfile('000001')).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });

  it('reveal asks the server for exactly one identifier', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ value: '3273010210850002' }));
    vi.stubGlobal('fetch', fetchMock);
    const p = mapPatient(API, TODAY);
    expect(await p.nik.reveal!()).toBe('3273010210850002');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/patients/000001/identifiers/nik');
    await p.address.line.reveal!();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/patients/000001/identifiers/address');
    fetchMock.mockResolvedValueOnce(json({ value: 7 }));
    await expect(revealIdentifier('000001', 'phone')).rejects.toMatchObject({ code: 'BAD_SHAPE' });
  });
});
