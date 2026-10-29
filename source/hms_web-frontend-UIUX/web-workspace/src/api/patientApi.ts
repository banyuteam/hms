import { findSyntheticEncounters } from './syntheticEncounters';
import { findSyntheticMedicalRecord } from './syntheticMedicalRecord';
import { findSyntheticRecord } from './syntheticRecords';
import type { EncounterHistoryItem, MedicalRecordSummary, PatientRecord } from './types';

export class NotFoundError extends Error {
  constructor() {
    super('not-found');
    this.name = 'NotFoundError';
  }
}

/** The only door to patient data. Phase 2 reads synthetic records; Phase 3+ swaps in openapi-fetch against the BFF. */
export interface PatientApi {
  getPatient(mrn: string): Promise<PatientRecord>;
  /** Visit history, newest first; each item carries its timeline (oldest first). The BFF merges and sorts, not the browser. */
  getEncounters(mrn: string): Promise<EncounterHistoryItem[]>;
  /** Medical Record tab: per-encounter clinical summary (newest first) plus the patient-level allergies. */
  getMedicalRecord(mrn: string): Promise<MedicalRecordSummary>;
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
  getEncounters: (mrn) =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        const rec = findSyntheticRecord(mrn);
        if (!rec) return reject(new NotFoundError());
        const list = structuredClone(findSyntheticEncounters(rec));
        resolve(list.sort((x, y) => y.registeredAt.localeCompare(x.registeredAt)));
      }, latencyMs());
    }),
  getMedicalRecord: (mrn) =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        const rec = findSyntheticRecord(mrn);
        if (!rec) return reject(new NotFoundError());
        resolve(structuredClone(findSyntheticMedicalRecord(rec)));
      }, latencyMs());
    }),
};
