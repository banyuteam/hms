import { z } from 'zod';
import { NotFoundError } from '@/api/errors';
import { ApiError, liveGet, seg } from '@/api/liveApi';
import {
  ENCOUNTER_PAGE_SIZE,
  type EmrApi,
  type PatientAllergies,
  type PatientHit,
  type PayerHistory,
} from './emrApi';
import { rankPatients, searchTerms } from './patientSearch';
import type { EncounterListItem, EncounterStts } from './journey';
import { toBill, toJourney } from './liveTimeline';
import { validStoredDate } from './livePatientApi';

/**
 * Live adapter for `emrApi` (hms_services clinical-read-v1, ADR-SVC-003):
 *  - listEncounters     → GET /patients/{mrn}/encounters?limit=100 (newest first)
 *  - listEncounterPage  → same, paged with `before` (the last encounter number of the previous page)
 *  - findEncounters     → start of an encounter number (`2026/10`, `2026/10/26`, a full number) → GET /encounters?q=
 *  - findPatients       → name and/or MRN words, any order → GET /patients?q=, ranked here like the synthetic data
 *  - getJourney         → GET /encounters/{number}/timeline (clinical-timeline-v1, encounter.clinical.read), mapped to
 *                          the journey the windows read (liveTimeline.ts)
 *  - getBill            → GET /encounters/{number}/bill (billing.read): the bill as saved by the cashier
 *  - getPayerHistory    → GET /patients/{mrn}/payers (clinical-read-v1 1.1.0, encounter.read): payers grouped by the server
 *  - getPatientAllergies → GET /patients/{mrn}/allergies (clinical-read-v1 1.2.0, encounter.clinical.read): allergy
 *                         texts of every visit, grouped by exact text, latest first
 */

const apiEncounterSchema = z.object({
  encounter_number: z.string(),
  queue_number: z.string().nullable(),
  patient_mrn: z.string().nullable(),
  registered_at: z.string().nullable(),
  care_setting: z.enum(['outpatient', 'inpatient', 'unknown']),
  status: z.object({ code: z.string().nullable(), system: z.string() }),
  payer_code: z.string().nullable(),
});

const payerHistorySchema = z.object({
  payers: z.array(
    z.object({
      code: z.string(),
      name: z.string().nullable(),
      last_visit_at: z.string().nullable(),
      visit_count: z.number().int().min(1),
      encounters: z.array(apiEncounterSchema).min(1),
    }),
  ),
  truncated: z.boolean(),
});

const allergiesSchema = z.object({
  allergies: z.array(
    z.object({
      text: z.string(),
      last_recorded_at: z.string().nullable(),
      last_encounter_number: z.string(),
      source: z.enum(['clinical_note_outpatient', 'clinical_note_inpatient', 'discharge_summary']),
      times_recorded: z.number().int().min(1),
    }),
  ),
  truncated: z.boolean(),
});

/** `2026-10-26T08:15:00+07:00` → `2026-10-26 08:15:00` (hospital local time as written; the offset is the facility's). */
function localStamp(at: string | null): string | null {
  return at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(at)
    ? `${at.slice(0, 10)} ${at.slice(11, 19)}`
    : null;
}

/** An encounter as clinical-read-v1 returns it (`registered_at`: hospital local time with the facility offset). */
type ApiEncounter = z.infer<typeof apiEncounterSchema>;

const STTS: readonly EncounterStts[] = [
  'Belum',
  'Sudah',
  'Batal',
  'Berkas Diterima',
  'Dirujuk',
  'Meninggal',
  'Dirawat',
  'Pulang Paksa',
  'Berkas Terkirim',
];

/** The list item the windows read. Local date and time are taken as written (the offset is the facility's own). */
export function toListItem(e: ApiEncounter): EncounterListItem {
  const local = e.registered_at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(e.registered_at);
  return {
    no_rawat: e.encounter_number,
    no_reg: e.queue_number,
    no_rkm_medis: e.patient_mrn,
    tgl_registrasi: local ? e.registered_at!.slice(0, 10) : null,
    jam_reg: local ? e.registered_at!.slice(11, 19) : null,
    // The legacy column is a NOT NULL Ralan/Ranap enum; `unknown` would mean a contract change and is shown as outpatient
    // only because the list has no third value (the encounter number stays visible).
    status_lanjut: e.care_setting === 'inpatient' ? 'Ranap' : 'Ralan',
    stts: STTS.find((s) => s === e.status.code) ?? null,
    ...(e.payer_code ? { kd_pj: e.payer_code } : {}),
  };
}

function encountersOf(body: unknown): ApiEncounter[] {
  const list = (body as { encounters?: unknown }).encounters;
  if (!Array.isArray(list)) throw new ApiError(502, 'BAD_SHAPE');
  return list as ApiEncounter[];
}

/** Start of a visit number: the year and a slash, then digits/slashes, at most the full 17 characters. */
const NO_RAWAT_PREFIX = /^\d{4}\/[\d/]{0,12}$/;
/** Server limits for GET /patients?q= (clinical-read-v1): 2–64 characters, at most 5 words. */
const PATIENT_Q = { min: 2, max: 64, words: 5 };

/** 404 is a normal "nothing there" for lookups; everything else is a real failure. */
async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const liveEmrApi: EmrApi = {
  listEncounters: async (mrn) => {
    const res = await orNull(liveGet(`/patients/${seg(mrn)}/encounters`, { limit: 100 }));
    return res ? encountersOf(res).map(toListItem) : [];
  },

  listEncounterPage: async (mrn, cursor) => {
    const res = await orNull(
      liveGet<{ next_before?: string }>(`/patients/${seg(mrn)}/encounters`, {
        limit: ENCOUNTER_PAGE_SIZE,
        before: cursor ?? undefined,
      }),
    );
    if (!res) return { items: [], nextCursor: null };
    return { items: encountersOf(res).map(toListItem), nextCursor: res.next_before ?? null };
  },

  getJourney: async (norawat) => {
    const res = await orNull(liveGet(`/encounters/${seg(norawat)}/timeline`));
    if (!res) throw new NotFoundError();
    return toJourney(res);
  },

  getBill: async (norawat) => {
    const res = await orNull(liveGet(`/encounters/${seg(norawat)}/bill`));
    if (!res) throw new NotFoundError();
    return toBill(res);
  },

  findEncounters: async (query) => {
    const q = query.trim();
    if (!NO_RAWAT_PREFIX.test(q) || q.length < 3) return []; // names and MRNs are patient searches, never sent here
    return encountersOf(await liveGet('/encounters', { q, limit: 25 })).map((e) => {
      const name = (e as { patient_name?: unknown }).patient_name;
      return typeof name === 'string'
        ? { ...toListItem(e), patientName: name.trim() }
        : toListItem(e);
    });
  },

  findPatients: async (query): Promise<PatientHit[]> => {
    // Normalised words only (case, accents and punctuation removed). The text travels in the query string: hms_services
    // logs paths without query strings and never records the search text in the audit trail.
    const words = searchTerms(query).slice(0, PATIENT_Q.words);
    const q = words.join(' ');
    if (q.length < PATIENT_Q.min || q.length > PATIENT_Q.max) return [];
    const res = await liveGet<{ patients?: unknown }>('/patients', { q, limit: 25 });
    if (!Array.isArray(res.patients)) throw new ApiError(502, 'BAD_SHAPE');
    const hits = (
      res.patients as { mrn: string; name: string; sex?: string; birth_date?: string | null }[]
    ).map(
      (p): PatientHit => ({
        mrn: p.mrn,
        name: p.name.trim(),
        sex: p.sex === 'male' || p.sex === 'female' ? p.sex : 'unknown',
        birthDate: validStoredDate(p.birth_date),
      }),
    );
    return rankPatients(hits, q);
  },

  getPatientAllergies: async (mrn): Promise<PatientAllergies> => {
    const parsed = allergiesSchema.safeParse(await liveGet(`/patients/${seg(mrn)}/allergies`));
    if (!parsed.success) throw new ApiError(502, 'BAD_SHAPE');
    return {
      truncated: parsed.data.truncated,
      entries: parsed.data.allergies
        .map((a) => ({
          text: a.text.trim(),
          lastRecorded: localStamp(a.last_recorded_at),
          lastEncounter: a.last_encounter_number.trim(),
          source: a.source,
          timesRecorded: a.times_recorded,
        }))
        .filter((a) => a.text && a.text !== '-'),
    };
  },

  getPayerHistory: async (mrn): Promise<PayerHistory> => {
    const parsed = payerHistorySchema.safeParse(await liveGet(`/patients/${seg(mrn)}/payers`));
    if (!parsed.success) throw new ApiError(502, 'BAD_SHAPE');
    return {
      truncated: parsed.data.truncated,
      payers: parsed.data.payers.map((p) => ({
        code: p.code.trim(),
        name: p.name?.trim() || null,
        lastVisit: localStamp(p.last_visit_at),
        visits: p.encounters.map(toListItem),
      })),
    };
  },
};
