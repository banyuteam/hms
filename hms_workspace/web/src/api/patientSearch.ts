/**
 * Patient search rule shared by the synthetic adapter and the live one (which ranks `GET /patients?q=` answers with it).
 *  - Case-, accent- and spacing-insensitive: "SITI  nurhalizá" = "siti nurhaliza".
 *  - Every typed word must match, in any order: "nurhaliza siti" finds "Siti Nurhaliza".
 *  - A word matches anywhere in the name ("haliza") or in the MRN ("12346").
 * Ranking: exact MRN, then names whose words start with the typed words, then the rest; ties by name.
 */
export interface SearchablePatient {
  mrn: string;
  name: string;
}

/** Lower-case, accents removed, punctuation that separates name parts treated as a space. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.,;'’`"()/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words of a query; an empty list means "nothing to search". */
export function searchTerms(query: string): string[] {
  const n = normalizeSearchText(query);
  return n ? n.split(' ') : [];
}

export function matchesPatient(p: SearchablePatient, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  const name = normalizeSearchText(p.name);
  const mrn = p.mrn.toLowerCase();
  return terms.every((t) => name.includes(t) || mrn.includes(t));
}

/** Lower is better. Only meaningful for patients that match. */
export function matchRank(p: SearchablePatient, terms: readonly string[]): number {
  if (terms.length === 1 && p.mrn.toLowerCase() === terms[0]) return 0;
  const words = normalizeSearchText(p.name).split(' ');
  const prefixHits = terms.filter((t) => words.some((w) => w.startsWith(t))).length;
  if (prefixHits === terms.length) return words[0]?.startsWith(terms[0] ?? '') ? 1 : 2;
  return 3;
}

/** Best first, without filtering: for results a server already matched (live search). */
export function rankPatients<T extends SearchablePatient>(list: readonly T[], query: string): T[] {
  const terms = searchTerms(query);
  return list
    .map((p) => ({ p, rank: matchRank(p, terms) }))
    .sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name, 'id'))
    .map((x) => x.p);
}

/** Matching patients, best first. */
export function searchPatients<T extends SearchablePatient>(all: readonly T[], query: string): T[] {
  const terms = searchTerms(query);
  return all
    .filter((p) => matchesPatient(p, terms))
    .map((p) => ({ p, rank: matchRank(p, terms) }))
    .sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name, 'id'))
    .map((x) => x.p);
}
