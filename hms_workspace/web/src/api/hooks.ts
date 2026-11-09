import { useInfiniteResource, useResource } from '@/lib/resource';
import { emrApi, type EncounterPage } from './emrApi';
import type { EncounterListItem } from './journey';
import { patientApi } from './patientApi';

/**
 * Data hooks for the windows. Keys carry identifiers (MRN, no_rawat, search text) in memory only — never persisted, never put
 * in a URL — and `resourceCache.clear()` on sign-out / idle lock wipes them with the rest.
 */
export const emrKeys = {
  journey: (norawat: string) => ['emr', 'journey', norawat] as const,
  bill: (norawat: string) => ['emr', 'bill', norawat] as const,
  encounters: (mrn: string) => ['emr', 'encounters', mrn] as const,
  encounterPages: (mrn: string) => ['emr', 'encounter-pages', mrn] as const,
  payers: (mrn: string) => ['emr', 'payers', mrn] as const,
  search: (q: string) => ['emr', 'search', q] as const,
  patients: (q: string) => ['emr', 'patients', q] as const,
  profile: (mrn: string) => ['patient', 'profile', mrn] as const,
};

/** Identity + profile of one patient (W1 and the identity strip). */
export function usePatientProfile(mrn: string) {
  return useResource(emrKeys.profile(mrn), () => patientApi.getPatientProfile(mrn), {
    enabled: Boolean(mrn),
  });
}

export function useJourney(norawat: string | undefined) {
  const id = norawat ?? '';
  return useResource(emrKeys.journey(id), () => emrApi.getJourney(id), {
    enabled: Boolean(norawat),
  });
}

/** The saved bill of one visit; `enabled` only when the person holds billing.read (the server decides anyway). */
export function useBill(norawat: string, enabled: boolean) {
  return useResource(emrKeys.bill(norawat), () => emrApi.getBill(norawat), {
    enabled: enabled && Boolean(norawat),
  });
}

export function useEncounterList(mrn: string | undefined) {
  const id = mrn ?? '';
  return useResource(emrKeys.encounters(id), () => emrApi.listEncounters(id), {
    enabled: Boolean(mrn),
  });
}

/** Name / MRN lookup; enabled from 2 characters. Pass the debounced text so typing does not fire a request per key. */
export function usePatientSearch(query: string) {
  const q = query.trim();
  return useResource(emrKeys.patients(q), () => emrApi.findPatients(q), { enabled: q.length >= 2 });
}

/** Visits of one patient, newest first, a page at a time ("Load more"). Cursors live in memory only. */
export function useEncounterPages(mrn: string | undefined) {
  const id = mrn ?? '';
  return useInfiniteResource<EncounterPage, string>(
    emrKeys.encounterPages(id),
    (cursor) => emrApi.listEncounterPage(id, cursor),
    (last) => last.nextCursor ?? undefined,
    { enabled: Boolean(mrn) },
  );
}

/** All loaded pages as one list; a visit can never appear twice, even if the data shifts between pages. */
export function flattenEncounterPages(pages: EncounterPage[] | undefined): EncounterListItem[] {
  const seen = new Set<string>();
  const out: EncounterListItem[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.no_rawat)) continue;
      seen.add(item.no_rawat);
      out.push(item);
    }
  }
  return out;
}

/** Payers used on a patient's visits, grouped and ordered by the server (Profile guarantor section). */
export function usePayerHistory(mrn: string | undefined) {
  const id = mrn ?? '';
  return useResource(emrKeys.payers(id), () => emrApi.getPayerHistory(id), {
    enabled: Boolean(mrn),
  });
}

export function useEncounterSearch(query: string) {
  const q = query.trim();
  return useResource(emrKeys.search(q), () => emrApi.findEncounters(q), { enabled: q.length >= 3 });
}
