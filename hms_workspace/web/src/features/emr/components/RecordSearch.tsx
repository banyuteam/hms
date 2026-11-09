import { useId, useState } from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import type { PatientHit } from '@/api/emrApi';
import { useEncounterList, useEncounterSearch, usePatientSearch } from '@/api/hooks';
import type { EncounterListItem } from '@/api/journey';
import { useStoredText } from '@/components/StoredTime';

const hit =
  'type-body flex w-full cursor-pointer flex-wrap items-center gap-x-8 gap-y-4 rounded-sm border-0 bg-transparent p-8 text-left text-ink-secondary hover:bg-selected focus-visible:-outline-offset-2';
const hitMain = 'font-semibold text-ink [font-variant-numeric:tabular-nums]';
const hitMeta = 'text-[length:var(--hms-text-caption-size)] text-ink-muted';
const hint = 'type-caption m-0 text-ink-muted';

export type SearchPick =
  | { type: 'encounter'; item: EncounterListItem }
  | { type: 'patient'; hit: PatientHit };

/** Patients listed in "patient → visits" mode; more matches ask the user to refine. */
export const MAX_PATIENT_SNIPPETS = 5;

/** One encounter result row (shared by the no_rawat hits and the per-patient visit snippets). */
function EncounterHit({
  e,
  showMrn,
  onPick,
}: {
  e: EncounterListItem;
  showMrn: boolean;
  onPick: (pick: SearchPick) => void;
}) {
  const { t } = useI18n();
  const storedText = useStoredText();
  return (
    <button type="button" className={hit} onClick={() => onPick({ type: 'encounter', item: e })}>
      <Icon name={e.status_lanjut === 'Ranap' ? 'bed' : 'stethoscope'} size={16} />
      <span className={hitMain}>{e.no_rawat}</span>
      <span className={hitMeta}>
        {[
          storedText(`${e.tgl_registrasi ?? ''} ${e.jam_reg ?? ''}`.trim()),
          t(`emr.care.${e.status_lanjut === 'Ranap' ? 'inpatient' : 'outpatient'}`),
          e.stts,
          showMrn && e.no_rkm_medis ? t('emr.identity.mrn', { mrn: e.no_rkm_medis }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </button>
  );
}

/** Snippet under a patient match: that patient's visits, newest admission first (GET /patients/{id}/encounters). */
function PatientVisits({ hit, onPick }: { hit: PatientHit; onPick: (pick: SearchPick) => void }) {
  const { t } = useI18n();
  const visits = useEncounterList(hit.mrn);
  const headId = useId();
  const list = visits.data ?? [];
  return (
    <li className="flex flex-col gap-2 py-4 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line-subtle">
      <p
        id={headId}
        className="type-body m-0 flex flex-wrap items-center gap-x-8 gap-y-4 px-8 py-4 text-ink-secondary"
      >
        <Icon name="user" size={16} />
        <span className={hitMain}>{hit.name}</span>
        <span className={hitMeta}>{t('emr.identity.mrn', { mrn: hit.mrn })}</span>
      </p>
      {visits.isPending ? (
        <p className="type-caption m-0 pr-8 pl-[calc(var(--hms-size-icon-sm)+var(--hms-space-16))] text-ink-muted">
          {t('emr.search.searching')}
        </p>
      ) : visits.isError ? (
        <p
          role="alert"
          className="type-caption m-0 flex flex-wrap items-center gap-x-8 pr-8 pl-[calc(var(--hms-size-icon-sm)+var(--hms-space-16))] text-ink-muted"
        >
          {t('emr.w1.visitsError')}
          <Button variant="ghost" onClick={() => void visits.refetch()}>
            {t('emr.search.retry')}
          </Button>
        </p>
      ) : list.length === 0 ? (
        <p className="type-caption m-0 pr-8 pl-[calc(var(--hms-size-icon-sm)+var(--hms-space-16))] text-ink-muted">
          {t('emr.w1.noVisits')}
        </p>
      ) : (
        <ul
          className="m-0 flex list-none flex-col gap-2 p-0 pl-[calc(var(--hms-size-icon-sm)+var(--hms-space-8))]"
          aria-labelledby={headId}
        >
          {list.map((e) => (
            <li key={e.no_rawat}>
              <EncounterHit e={e} showMrn={false} onPick={onPick} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Fast search by `no_rawat` (encounter_id) and, when `patients` is on, by name / MRN (patient_id = no_rkm_medis).
 * `patientVisits` (Medical Records): a patient match shows that patient's visits as a snippet underneath, so
 * a visit can be opened without going through the profile. Results are buttons (Enter opens).
 * Nothing typed here is stored or put in a URL.
 */
export function RecordSearch({
  onPick,
  patients = false,
  patientVisits = false,
  label,
}: {
  onPick: (pick: SearchPick) => void;
  patients?: boolean;
  patientVisits?: boolean;
  label?: string;
}) {
  const { t } = useI18n();
  const listId = useId();
  const inputId = useId();
  const [query, setQuery] = useState('');
  // The box updates instantly; the requests follow once typing pauses.
  const debounced = useDebouncedValue(query);
  const encounters = useEncounterSearch(debounced);
  const byPatient = patients || patientVisits;
  const patientSearch = usePatientSearch(byPatient ? debounced : '');
  const allPeople = patientSearch.data ?? [];
  const people = patientVisits ? allPeople.slice(0, MAX_PATIENT_SNIPPETS) : allPeople;
  const q = query.trim();
  const canSearch = q.length >= 3 || (byPatient && q.length >= 2);
  const searching =
    canSearch && (q !== debounced.trim() || encounters.isFetching || patientSearch.isFetching);
  // A failed search is never reported as "no results": results from the search that worked still show.
  const failed = !searching && (encounters.isError || patientSearch.isError);
  const retry = () => {
    if (encounters.isError) void encounters.refetch();
    if (patientSearch.isError) void patientSearch.refetch();
  };
  const fieldLabel =
    label ??
    t(
      patientVisits
        ? 'emr.search.labelVisitOrPatient'
        : patients
          ? 'emr.search.labelAny'
          : 'emr.search.labelEncounter',
    );
  const placeholder = patientVisits
    ? 'emr.search.placeholderVisitOrPatient'
    : patients
      ? 'emr.search.placeholderAny'
      : 'emr.search.placeholderEncounter';
  const encounterHits = encounters.data ?? [];
  const total = encounterHits.length + people.length;

  return (
    <div className="flex w-[min(var(--hms-size-search),100%)] flex-col gap-8 text-left">
      <div className="flex flex-col gap-4">
        <label htmlFor={inputId} className="type-caption-strong text-ink-secondary">
          {fieldLabel}
        </label>
        <div className="flex h-control-lg items-center gap-8 rounded-md border border-line bg-surface px-12 text-ink-muted focus-within:border-line-focus focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-line-focus">
          <Icon name="search" size={16} />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears the box (search-field convention), like the former React Aria SearchField.
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
              }
            }}
            aria-describedby={listId}
            autoComplete="off"
            spellCheck={false}
            className="type-body min-w-0 flex-1 border-0 bg-transparent text-ink outline-none [&::-webkit-search-cancel-button]:hidden"
            placeholder={t(placeholder)}
          />
        </div>
      </div>
      <div
        id={listId}
        className="empty:hidden"
        aria-live="polite"
        aria-busy={searching || undefined}
      >
        {q.length > 0 && !canSearch && (
          <p className={hint}>
            {t(byPatient ? 'emr.search.minCharsPatient' : 'emr.search.minChars')}
          </p>
        )}
        {searching && <p className={hint}>{t('emr.search.searching')}</p>}
        {failed && (
          <p role="alert" className={`${hint} flex flex-wrap items-center gap-x-8`}>
            {t('emr.search.error')}
            <Button variant="ghost" onClick={retry}>
              {t('emr.search.retry')}
            </Button>
          </p>
        )}
        {canSearch && !searching && !failed && total === 0 && (
          <p className={hint}>{t('emr.search.noResults')}</p>
        )}
        {total > 0 && (
          <ul
            className="m-0 flex list-none flex-col gap-2 rounded-md border border-line-subtle bg-surface p-4"
            aria-label={t('emr.search.results', { n: total })}
          >
            {encounterHits.map((e) => (
              <li key={`e-${e.no_rawat}`}>
                <EncounterHit e={e} showMrn onPick={onPick} />
              </li>
            ))}
            {people.map((p) =>
              patientVisits ? (
                <PatientVisits key={`p-${p.mrn}`} hit={p} onPick={onPick} />
              ) : (
                <li key={`p-${p.mrn}`}>
                  <button
                    type="button"
                    className={hit}
                    onClick={() => onPick({ type: 'patient', hit: p })}
                  >
                    <Icon name="user" size={16} />
                    <span className={hitMain}>{p.name}</span>
                    <span className={hitMeta}>{t('emr.identity.mrn', { mrn: p.mrn })}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
        {patientVisits && allPeople.length > MAX_PATIENT_SNIPPETS && (
          <p className={hint}>
            {t('emr.search.morePatients', { n: allPeople.length - MAX_PATIENT_SNIPPETS })}
          </p>
        )}
      </div>
    </div>
  );
}
