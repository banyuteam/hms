import { act, configure, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emrApi } from '@/api/emrApi';
import { mapPatient, type ApiPatient } from '@/api/livePatientApi';
import { patientApi } from '@/api/patientApi';
import { homeActions, renderWindows } from '../test/harness';

configure({ asyncUtilTimeout: 8000 });

// Synthetic values only, shaped like a clinical-read-v1 `GET /patients/{mrn}` answer.
const ROW: ApiPatient = {
  mrn: '00012346',
  name: 'Pasien Contoh',
  sex: 'male',
  birth_date: '1985-10-02',
  birth_place: 'Semarang',
  mother_name: '',
  blood_type: 'AB',
  marital_status: 'widowed_divorced',
  religion: 'ISLAM',
  education: 'S1',
  occupation: 'Guru',
  first_registered_on: '2019-03-12',
  nik: { masked: '' },
  phone: { masked: '' },
  email: { masked: '' },
  address: { masked: '' },
  responsible_person: {
    name: '',
    relationship: 'unknown',
    occupation: '',
    address: { masked: '' },
  },
};

afterEach(() => vi.restoreAllMocks());

async function background(row: ApiPatient) {
  vi.spyOn(patientApi, 'getPatientProfile').mockResolvedValue(mapPatient(row));
  vi.spyOn(emrApi, 'listEncounterPage').mockResolvedValue({ items: [], nextCursor: null });
  renderWindows('employee');
  act(() => homeActions().open('emr-profile', { mrn: row.mrn }));
  const win = await screen.findByRole('region', { name: /Patient Profile/ });
  const heading = await within(win).findByRole('heading', { name: 'Background' });
  const section = heading.closest('section')!;
  const value = (label: string) =>
    within(section).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
  return value;
}

describe('Patient Profile · background', () => {
  it('shows blood type, birth place, marital status, religion, education, occupation and first registration', async () => {
    const value = await background(ROW);
    expect(value('Blood type')).toBe('AB');
    expect(value('Birth place')).toBe('Semarang');
    expect(value('Marital status')).toBe('Widowed / divorced');
    expect(value('Religion')).toBe('ISLAM');
    expect(value('Occupation')).toBe('Guru');
    expect(value('Education')).not.toBe('—');
    expect(value('First registered')).toMatch(/2019/);
  });

  it('says "not recorded" (—) instead of guessing when the source has no value', async () => {
    const value = await background({
      ...ROW,
      birth_place: '',
      marital_status: null,
      religion: '',
      education: 'none',
      occupation: '',
      first_registered_on: null,
    });
    for (const label of [
      'Birth place',
      'Marital status',
      'Religion',
      'Education',
      'Occupation',
      'First registered',
    ])
      expect(value(label)).toBe('—');
  });
});
