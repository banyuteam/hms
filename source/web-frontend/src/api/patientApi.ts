import { findSyntheticRecord } from './syntheticRecords';
import type { PatientRecord } from './types';

export class NotFoundError extends Error {
  constructor() {
    super('not-found');
    this.name = 'NotFoundError';
  }
}

/** The only door to patient data. Phase 2 reads synthetic records; Phase 3+ swaps in openapi-fetch against the BFF. */
export interface PatientApi {
  getPatient(mrn: string): Promise<PatientRecord>;
}

function latencyMs(): number {
  const raw = Number(import.meta.env.VITE_MOCK_LATENCY_MS ?? 150);
  return Number.isFinite(raw) && raw >= 0 ? raw : 150;
}

export const patientApi: PatientApi = {
  getPatient: (mrn) =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        const rec = findSyntheticRecord(mrn);
        if (rec) resolve(structuredClone(rec));
        else reject(new NotFoundError());
      }, latencyMs());
    }),
};
