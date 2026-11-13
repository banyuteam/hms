import { type PatientStatus, type SyntheticPatient } from '@/data/syntheticPatients';
import { LiveUnsupportedError, NotFoundError } from './errors';
import { ageInYears, liveGetPatientProfile } from './livePatientApi';
import { findSyntheticRecord, listSyntheticPatients } from '@/data/syntheticRecords';
import { searchPatients, searchTerms } from './patientSearch';
import type { PatientCore } from './types';

export { LiveUnsupportedError, NotFoundError };

/** One row of the patient list (live: an item of `GET /api/v1/patients`). */
export type PatientSummary = SyntheticPatient & {
  /** Second identifier shown next to the name in search results; null = not recorded. */
  birthDate: string | null;
};

/** Server-side filters (live: `?q=&status=`). An empty `query` and a missing `status` mean "no filter". */
export interface PatientListParams {
  /** Name or MRN fragment, case-insensitive. */
  query?: string;
  status?: PatientStatus;
}

export interface PatientPage {
  items: PatientSummary[];
  /** Patients in the register before filtering, for the "Showing X of Y" footer. */
  total: number;
}

/** The only door to patient data: synthetic demo records, or clinical-read-v1 on hms_services (`VITE_DATA_SOURCE=bff`). */
export interface PatientApi {
  /** What the identity strip and the Profile window read; live data may leave values unrecorded. */
  getPatientProfile(mrn: string): Promise<PatientCore>;
  listPatients(params?: PatientListParams): Promise<PatientPage>;
}

function latencyMs(): number {
  const raw = Number(import.meta.env.VITE_MOCK_LATENCY_MS ?? 150);
  return Number.isFinite(raw) && raw >= 0 ? raw : 150;
}

/** Runs `fn` after the simulated latency; a throw becomes a rejection, and the result is cloned like a network payload. */
function after<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(structuredClone(fn()));
      } catch (e) {
        reject(e);
      }
    }, latencyMs());
  });
}

const syntheticPatientApi: PatientApi = {
  getPatientProfile: (mrn) =>
    after(() => {
      const rec = findSyntheticRecord(mrn);
      if (!rec) throw new NotFoundError();
      // Age on today's date from the birth date, as live data and the search results compute it — never the
      // fixture's stored number, which goes stale (search said 41 while the profile said 40).
      return { ...rec, ageYears: ageInYears(rec.birthDate) };
    }),
  listPatients: ({ query, status } = {}) =>
    after(() => {
      const all = listSyntheticPatients();
      const byStatus = all.filter((p) => !status || p.status === status);
      const items = searchTerms(query ?? '').length
        ? searchPatients(byStatus, query ?? '')
        : byStatus;
      return {
        items: items.map((p) => ({
          ...p,
          birthDate: findSyntheticRecord(p.mrn)?.birthDate ?? null,
        })),
        total: all.length,
      };
    }),
};

/**
 * Live (`isLiveApi()`): the profile comes from clinical-read-v1 `GET /patients/{mrn}`. Live search is `liveEmrApi.findPatients`
 * (`GET /patients?q=`); this status-filtered list with a register total is not in the contract, so it fails loudly.
 */
const livePatientApi: PatientApi = {
  getPatientProfile: liveGetPatientProfile,
  listPatients: () => Promise.reject(new LiveUnsupportedError()),
};

// Written inline (not via isLiveApi()) so the bundler folds it and drops the unused adapter.
export const patientApi: PatientApi =
  import.meta.env.VITE_DATA_SOURCE === 'bff' ? livePatientApi : syntheticPatientApi;
