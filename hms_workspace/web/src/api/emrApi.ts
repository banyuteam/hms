import { LiveUnsupportedError, NotFoundError, patientApi } from '@/api/patientApi';
import { SYNTHETIC_JOURNEYS, toListItem } from '@/data/emrFixtures';
import type { EncounterJourney, EncounterListItem } from './journey';
import { liveEmrApi } from './liveEmrApi';
import { allergyRecords, groupAllergies } from './select';
import type { EncounterBill } from './liveTimeline';

/**
 * The only door to encounter data for the EMR windows: synthetic fixtures, or hms_services (`liveEmrApi.ts`:
 * clinical-read-v1 for visits and search, clinical-timeline-v1 for the timeline and bill). Never the database directly.
 * Visits are keyed by no_rawat and patients by no_rkm_medis (the hospital's business identifiers).
 */
/** Visits per page of the patient profile ("Load more"). */
export const ENCOUNTER_PAGE_SIZE = 50;

export interface EncounterPage {
  items: EncounterListItem[];
  /** Opaque; pass it back to get the next (older) page. `null` = that was the last page. */
  nextCursor: string | null;
}

export interface EmrApi {
  /** The newest visits of a patient in one go (up to 100); the profile uses `listEncounterPage` instead. */
  listEncounters(mrn: string): Promise<EncounterListItem[]>;
  /** One page of a patient's visits, newest first (live: `GET /patients/{mrn}/encounters?sort=-no_rawat&cursor=`). */
  listEncounterPage(mrn: string, cursor?: string): Promise<EncounterPage>;
  getJourney(norawat: string): Promise<EncounterJourney>;
  /** The bill as saved by the cashier (live only: the synthetic data has no bills → LiveUnsupportedError). */
  getBill(norawat: string): Promise<EncounterBill>;
  findEncounters(query: string): Promise<EncounterListItem[]>;
  /** Patient lookup by name or MRN (live: GET /api/v1/patients?q=). Fewer than 2 characters finds nothing. */
  findPatients(query: string): Promise<PatientHit[]>;
  /** Payers used on the patient's visits, each with its visits (live: GET /patients/{mrn}/payers, encounter.read). */
  getPayerHistory(mrn: string): Promise<PayerHistory>;
  /**
   * Every allergy written on any of the patient's visits, grouped by text (live: GET /patients/{mrn}/allergies,
   * clinical-read-v1 1.2.0, encounter.clinical.read). An empty list means nothing is written, never "no allergy".
   */
  getPatientAllergies(mrn: string): Promise<PatientAllergies>;
}

/** Where an allergy entry was written. */
export type AllergySource =
  | 'clinical_note_outpatient'
  | 'clinical_note_inpatient'
  | 'discharge_summary';

/** One allergy text as written (never normalised), with its latest entry. */
export interface AllergyEntry {
  text: string;
  /** Latest dated entry with this text, `YYYY-MM-DD HH:MM:SS` hospital local time; null = not dated. */
  lastRecorded: string | null;
  lastEncounter: string;
  source: AllergySource;
  timesRecorded: number;
}

/** Latest first. `truncated` = the patient has more entries than the server reads: the list may be incomplete. */
export interface PatientAllergies {
  entries: AllergyEntry[];
  truncated: boolean;
}

/** One payer used on a patient's visits (`reg_periksa.kd_pj` → `penjab`), with those visits latest first. */
export interface PayerGroup {
  /** Payer code as stored; '' = no payer recorded on those visits. */
  code: string;
  /** `penjab.png_jawab`; null = the code has no row in the payer master. */
  name: string | null;
  /** Latest dated visit with this payer, `YYYY-MM-DD HH:MM:SS` hospital local time; null = none dated. */
  lastVisit: string | null;
  visits: EncounterListItem[];
}

/** Payers ordered by their latest visit. `truncated` = the patient has more visits than the server reads (oldest left out). */
export interface PayerHistory {
  payers: PayerGroup[];
  truncated: boolean;
}

/** Groups visits (already latest first) by payer code, keeping that order — the synthetic twin of the server's grouping. */
export function groupByPayer(
  visits: readonly (EncounterListItem & { payer_name?: string | null })[],
): PayerGroup[] {
  const groups = new Map<string, PayerGroup>();
  for (const { payer_name, ...v } of visits) {
    const code = (v.kd_pj ?? '').trim();
    const dated = v.tgl_registrasi ? `${v.tgl_registrasi} ${v.jam_reg ?? ''}`.trim() : null;
    const g = groups.get(code) ?? { code, name: payer_name ?? null, lastVisit: dated, visits: [] };
    g.lastVisit ??= dated;
    g.visits.push(v);
    groups.set(code, g);
  }
  return [...groups.values()];
}

/**
 * A patient search result. Name alone cannot tell two patients apart: the result also shows date of birth and sex
 * (second identifier), as the server sends them. `birthDate` null = not recorded / not a valid date.
 */
export interface PatientHit {
  mrn: string;
  name: string;
  sex: 'male' | 'female' | 'unknown';
  birthDate: string | null;
}

function latencyMs(): number {
  const raw = Number(import.meta.env.VITE_MOCK_LATENCY_MS ?? 150);
  return Number.isFinite(raw) && raw >= 0 ? raw : 150;
}

function later<T>(fn: () => T): Promise<T> {
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

/** Newest admission first (W1 visit list default). */
export function byAdmissionDesc(a: EncounterListItem, b: EncounterListItem): number {
  const ka = `${a.tgl_registrasi ?? ''} ${a.jam_reg ?? ''}`;
  const kb = `${b.tgl_registrasi ?? ''} ${b.jam_reg ?? ''}`;
  return kb.localeCompare(ka);
}

const syntheticEmrApi: EmrApi = {
  listEncounters: (mrn) =>
    later(() =>
      SYNTHETIC_JOURNEYS.filter((j) => j.no_rkm_medis === mrn)
        .map(toListItem)
        .sort(byAdmissionDesc),
    ),
  listEncounterPage: (mrn, cursor) =>
    later(() => {
      const all = SYNTHETIC_JOURNEYS.filter((j) => j.no_rkm_medis === mrn)
        .map(toListItem)
        .sort(byAdmissionDesc);
      const start = cursor ? Number(cursor) : 0;
      const end = start + ENCOUNTER_PAGE_SIZE;
      return { items: all.slice(start, end), nextCursor: end < all.length ? String(end) : null };
    }),
  getJourney: (norawat) =>
    later(() => {
      const j = SYNTHETIC_JOURNEYS.find((x) => x.no_rawat === norawat);
      if (!j) throw new NotFoundError();
      return j;
    }),
  getBill: () => Promise.reject(new LiveUnsupportedError()),
  findEncounters: async (query) => {
    const hits = await later(() => {
      const q = query.trim();
      if (!q) return [];
      return SYNTHETIC_JOURNEYS.map(toListItem)
        .filter((e) => e.no_rawat === q || e.no_rawat.includes(q))
        .sort(byAdmissionDesc);
    });
    // The patient's name with each hit, as the server sends it to a session that may read patients.
    return Promise.all(
      hits.map(async (e) => {
        const p = e.no_rkm_medis
          ? await patientApi.getPatientProfile(e.no_rkm_medis).catch(() => null)
          : null;
        return { ...e, patientName: p?.name ?? '' };
      }),
    );
  },
  // Patient data only ever comes through `patientApi` (the single door), never from the synthetic files directly.
  findPatients: async (query) => {
    const q = query.trim();
    if (q.length < 2) return [];
    const { items } = await patientApi.listPatients({ query: q });
    return items.map((p) => ({ mrn: p.mrn, name: p.name, sex: p.sex, birthDate: p.birthDate }));
  },
  getPayerHistory: (mrn) =>
    later(() => {
      const visits = SYNTHETIC_JOURNEYS.filter((j) => j.no_rkm_medis === mrn)
        .map((j) => ({ ...toListItem(j), payer_name: j.summary.encounter?.payer_name ?? null }))
        .sort(byAdmissionDesc);
      return { payers: groupByPayer(visits), truncated: false };
    }),
  getPatientAllergies: (mrn) =>
    later(() => ({
      entries: groupAllergies(
        SYNTHETIC_JOURNEYS.filter((j) => j.no_rkm_medis === mrn).flatMap(allergyRecords),
      ),
      truncated: false,
    })),
};

/** `VITE_DATA_SOURCE=bff`: real data from hms_services (liveApi.ts); otherwise synthetic. */
// Written inline (not via isLiveApi()) so the bundler folds it and drops the unused adapter.
export const emrApi: EmrApi =
  import.meta.env.VITE_DATA_SOURCE === 'bff' ? liveEmrApi : syntheticEmrApi;
