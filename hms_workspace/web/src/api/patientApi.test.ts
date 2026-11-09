import { describe, expect, it } from 'vitest';
import { NotFoundError, patientApi } from './patientApi';

describe('patientApi.listPatients (server-side filtering contract)', () => {
  it('returns every patient and the register total when no filter is given', async () => {
    const page = await patientApi.listPatients();
    expect(page.items).toHaveLength(8);
    expect(page.total).toBe(8);
  });

  it('filters by name or MRN fragment, case-insensitively, but keeps the unfiltered total', async () => {
    expect((await patientApi.listPatients({ query: 'SITI' })).items.map((p) => p.mrn)).toEqual([
      '00012346',
    ]);
    expect((await patientApi.listPatients({ query: ' 0001234 ' })).items.length).toBeGreaterThan(1);
    const none = await patientApi.listPatients({ query: 'zzz' });
    expect(none).toEqual({ items: [], total: 8 });
  });

  it('filters by status and combines it with the text query', async () => {
    const er = await patientApi.listPatients({ status: 'emergency' });
    expect(er.items.map((p) => p.name)).toEqual(['Agus Prasetyo']);
    expect(await patientApi.listPatients({ status: 'emergency', query: 'siti' })).toEqual({
      items: [],
      total: 8,
    });
  });

  it('returns copies, so callers cannot mutate the register', async () => {
    const a = await patientApi.listPatients();
    a.items[0]!.name = 'changed';
    expect((await patientApi.listPatients()).items[0]!.name).not.toBe('changed');
  });

  it('getPatientProfile rejects with NotFoundError for an unknown MRN', async () => {
    await expect(patientApi.getPatientProfile('nope')).rejects.toBeInstanceOf(NotFoundError);
    expect((await patientApi.getPatientProfile('00012346')).name).toBe('Siti Nurhaliza');
  });
});
