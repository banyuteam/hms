import { useMemo, type ReactNode } from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { ApiError, isBadShape } from '@/api/liveApi';
import { NotFoundError } from '@/api/patientApi';
import {
  useHome,
  useHomeActions,
  windowId,
  type WindowKind,
  type WindowParams,
} from '@/state/home';
import { useJourney, usePatientProfile } from '@/api/hooks';
import { AuditSubjectProvider } from '@/audit/subject';
import type { EncounterJourney } from '@/api/journey';
import { facts as toFacts, type EncounterFacts } from '@/api/select';
import { StateView } from '../components/Blocks';
import type { IdentityPerson } from '../components/IdentityStrip';
import { RecordSearch } from '../components/RecordSearch';

export interface EncounterView {
  journey: EncounterJourney;
  facts: EncounterFacts;
  person: IdentityPerson;
}

/** Patient identity for the strip; same cache key as W1 so the data is shared and cleared on sign-out. */
export function usePerson(mrn: string | null | undefined): IdentityPerson | null {
  const q = usePatientProfile(mrn ?? '');
  if (!mrn) return null;
  const p = q.data;
  return {
    name: p?.name ?? null,
    mrn,
    birthDate: p?.birthDate ?? null,
    ageYears: p?.ageYears ?? null,
    sex: p?.sex && p.sex !== 'unknown' ? p.sex : null,
    // Loaded data wins over a later refetch error; until then, empty fields are "loading"/"unavailable", not absent.
    status: p ? 'ready' : q.error ? 'unavailable' : q.isPending ? 'loading' : 'ready',
  };
}

/**
 * Window opener used by every drill-down (new window, never a tab).
 * Maximised windows stack above floating ones (`features/workspace/frames.ts`), so a drill-down opened from a maximised
 * window opens maximised too — otherwise it would be created behind it, invisible.
 */
export function useOpen() {
  const { windows, activeId } = useHome();
  const { open, toggleMaximize } = useHomeActions();
  return (kind: WindowKind, params: WindowParams) => {
    const from = windows.find((w) => w.id === activeId);
    const id = windowId(kind, params);
    const existing = windows.find((w) => w.id === id);
    open(kind, params);
    // `open` restores a minimised window to tiled/floating, so only an already-maximised target is left as it is.
    if (from?.mode === 'maximized' && existing?.mode !== 'maximized') toggleMaximize(id);
  };
}

/**
 * Shared shell of the encounter windows (W2/W3/W4 and viewers): blank → `no_rawat` search (picking retargets
 * this window), loading, not found / error, then `children(view)`.
 */
export function EncounterGate({
  winId,
  norawat,
  blankTitle,
  patientSearch = false,
  children,
}: {
  winId: string;
  norawat: string | undefined;
  blankTitle: string;
  /** Blank search also finds patients (name / no_rkm_medis) and lists their visits underneath. */
  patientSearch?: boolean;
  children: (view: EncounterView) => ReactNode;
}) {
  const { t } = useI18n();
  const { retarget } = useHomeActions();
  const journey = useJourney(norawat);
  const person = usePerson(journey.data?.no_rkm_medis);
  const facts = useMemo(() => (journey.data ? toFacts(journey.data) : null), [journey.data]);

  if (!norawat) {
    return (
      <StateView
        kind="empty"
        title={blankTitle}
        message={t(patientSearch ? 'emr.blank.messagePatient' : 'emr.blank.message')}
      >
        <RecordSearch
          patientVisits={patientSearch}
          onPick={(pick) => {
            if (pick.type === 'encounter') retarget(winId, { norawat: pick.item.no_rawat });
          }}
        />
      </StateView>
    );
  }
  if (journey.isPending) {
    return <StateView kind="loading" message={t('detail.loading')} />;
  }
  if (journey.error || !journey.data || !facts) {
    const notFound = journey.error instanceof NotFoundError;
    // Not permitted (the timeline needs encounter.clinical.read) or not found: final answers, so no Retry.
    const forbidden = journey.error instanceof ApiError && journey.error.status === 403;
    const key = forbidden
      ? 'emr.error.forbiddenTimeline'
      : notFound
        ? 'emr.error.notFound'
        : isBadShape(journey.error)
          ? 'data.error.badShape'
          : 'detail.error.generic';
    return (
      <StateView
        kind="error"
        title={t('detail.error.title')}
        message={t(key, { norawat })}
        onRetry={notFound || forbidden ? undefined : () => void journey.refetch()}
      />
    );
  }
  return (
    <AuditSubjectProvider
      patient={journey.data.no_rkm_medis ?? undefined}
      encounter={journey.data.no_rawat}
    >
      {children({
        journey: journey.data,
        facts,
        person: person ?? {
          name: null,
          mrn: journey.data.no_rkm_medis,
          birthDate: null,
          ageYears: null,
          sex: null,
        },
      })}
    </AuditSubjectProvider>
  );
}
