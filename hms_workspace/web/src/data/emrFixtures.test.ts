import { describe, expect, it } from 'vitest';
import { emrApi } from '@/api/emrApi';
import { SYNTHETIC_JOURNEYS, toListItem } from './emrFixtures';

describe('synthetic visits', () => {
  it('carry the payer recorded on the registration, as the identity strip shows it', async () => {
    const inpatient = SYNTHETIC_JOURNEYS.find((j) => j.no_rawat === '2026/10/26/000123')!;
    expect(toListItem(inpatient).kd_pj).toBe('BPJ');
    const { payers } = await emrApi.getPayerHistory('00012346');
    expect(payers.map((p) => [p.code, p.name, p.visits.length])).toEqual([
      ['BPJ', 'BPJS Kesehatan', 2],
    ]);
  });
});
