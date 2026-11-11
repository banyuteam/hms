import { useI18n } from '@/locales/I18nProvider';
import { Icon } from '@/components/Icon';
import { StatusPill } from '@/components/StatusPill';
import type { EncounterFacts } from '@/api/select';
import type { AllergyEntry } from '@/api/emrApi';
import { formatStoredDate, readStored } from '@/locales/storedTime';
import { InvalidValue } from '@/components/StoredTime';

const id =
  'type-body border-l border-line pl-12 [font-variant-numeric:tabular-nums] cq-compact:border-l-0 cq-compact:pl-0';
const flags = 'm-0 flex list-none flex-wrap gap-6 p-0 [&_span]:whitespace-normal';

/** The patient's allergies across visits, as loaded for the strip (`toAllergyStatus`). */
export type AllergyStatus =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'ready'; entries: AllergyEntry[]; truncated: boolean };

export interface IdentityPerson {
  name: string | null;
  mrn: string | null;
  /** `YYYY-MM-DD` as stored. */
  birthDate: string | null;
  ageYears: number | null;
  sex: 'male' | 'female' | null;
  /**
   * Whether name/birth date/sex are known yet (default `ready`). While `loading` or `unavailable` the empty fields are
   * NOT "not recorded" — saying so would hide that the patient has not been confirmed by name and date of birth.
   */
  status?: 'ready' | 'loading' | 'unavailable';
  /** Allergies of every visit; absent = not loaded for this session (no clinical access): nothing is shown. */
  allergies?: AllergyStatus;
}

/**
 * Patient-safety strip at the top of every patient window: two identifiers (name + date of birth, plus MRN),
 * the patient's allergies (every visit; "not recorded" stated), encounter context, DPJP, payer, a deceased banner and a
 * warning when the server truncated a list.
 */
export function IdentityStrip({
  person,
  facts,
  scope = 'encounter',
}: {
  person: IdentityPerson | null;
  facts?: EncounterFacts | null;
  /**
   * `patient` (Patient Profile): no visit context — showing the last visit's ward/DPJP/SEP there reads as
   * "admitted now". Allergies are patient-level, so they are shown in both scopes.
   */
  scope?: 'encounter' | 'patient';
}) {
  const { t, locale } = useI18n();
  const dob = formatStoredDate(person?.birthDate, locale);
  const dobStored = readStored(person?.birthDate);
  const status = person?.status ?? 'ready';

  return (
    <div
      className="flex flex-col gap-8 border-b border-line-subtle bg-surface px-16 py-12"
      role="group"
      aria-label={t('emr.identity.label')}
    >
      {facts?.deceased && (
        <p
          className="type-body-strong m-0 flex items-center gap-8 rounded-md bg-danger-bg px-12 py-6 text-danger-fg"
          role="alert"
        >
          <Icon name="alert" size={16} />
          {t('emr.identity.deceased')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 text-ink-secondary cq-compact:gap-x-8">
        <Icon name="user" size={20} />
        {status === 'ready' ? (
          <strong className="type-title-md text-ink">
            {person?.name ?? t('common.notRecorded')}
          </strong>
        ) : (
          <strong
            className={
              status === 'loading'
                ? 'type-body-strong text-ink-muted'
                : 'type-body-strong text-warning-fg'
            }
            role="status"
          >
            {status === 'unavailable' && <Icon name="alert" size={16} />}
            {t(status === 'loading' ? 'emr.identity.loading' : 'emr.identity.unavailable')}
          </strong>
        )}
        <span className={id}>
          {t('emr.identity.mrn', { mrn: person?.mrn ?? facts?.mrn ?? '—' })}
        </span>
        {status === 'ready' && (
          <span className={id}>
            {dobStored.kind === 'invalid' ? (
              <>
                {t('field.birthDate')}: <InvalidValue kind="date" raw={dobStored.raw} />
              </>
            ) : dob ? (
              t('emr.identity.dob', { date: dob, age: person?.ageYears ?? '—' })
            ) : (
              t('emr.identity.dobMissing')
            )}
          </span>
        )}
        {person?.sex && <span className={id}>{t(`emr.sex.${person.sex}`)}</span>}
        {facts && scope === 'encounter' && (
          <span className={id}>{t('emr.identity.norawat', { norawat: facts.norawat })}</span>
        )}
      </div>
      {(person?.allergies || (facts && scope === 'encounter')) && (
        <ul className={flags} aria-label={t('emr.identity.context')}>
          <AllergyFlags status={person?.allergies} visit={facts?.allergy} />
          {facts && scope === 'encounter' && <EncounterFlags facts={facts} />}
        </ul>
      )}
    </div>
  );
}

/**
 * Allergy first, always stated (owner decision 2026-11-10, replacing 2026-11-09): every distinct text written on any
 * visit, plus this visit's notes; "not recorded" when nothing is written anywhere (never "no allergy"); a warning when
 * the list is incomplete. When the other visits could not be read, only this visit's allergies are shown, with no
 * warning (owner decision 2026-11-10; the Profile still reports the failure). Nothing is shown to a session without
 * clinical access.
 */
function AllergyFlags({
  status,
  visit,
}: {
  status: AllergyStatus | undefined;
  visit: EncounterFacts['allergy'] | undefined;
}) {
  const { t } = useI18n();
  const texts = [
    ...new Set([
      ...(status?.state === 'ready' ? status.entries.map((e) => e.text) : []),
      ...(visit?.state === 'recorded' ? visit.texts : []),
    ]),
  ];
  return (
    <>
      {texts.length > 0 && (
        <li>
          <StatusPill status="danger">
            {t('emr.identity.allergy', { text: texts.join('; ') })}
          </StatusPill>
        </li>
      )}
      {texts.length === 0 && status?.state === 'ready' && (
        <li>
          <StatusPill status="warning">{t('emr.identity.allergyNone')}</StatusPill>
        </li>
      )}
      {texts.length === 0 && status?.state === 'loading' && (
        <li>
          <StatusPill status="neutral">{t('emr.identity.allergyLoading')}</StatusPill>
        </li>
      )}
      {status?.state === 'ready' && status.truncated && (
        <li>
          <StatusPill status="warning">{t('emr.identity.allergyTruncated')}</StatusPill>
        </li>
      )}
    </>
  );
}

function EncounterFlags({ facts }: { facts: EncounterFacts }) {
  const { t } = useI18n();
  return (
    <>
      {facts.careSetting && (
        <li>
          <StatusPill status="neutral">
            {t(`emr.care.${facts.careSetting}`)}
            {facts.ward ? ` · ${facts.ward}` : facts.department ? ` · ${facts.department}` : ''}
          </StatusPill>
        </li>
      )}
      <li>
        <StatusPill status="info">
          {t('emr.identity.dpjp', { name: facts.dpjp ?? t('common.notRecorded') })}
        </StatusPill>
      </li>
      {facts.payer && (
        <li>
          <StatusPill status="neutral">
            {t('emr.identity.payer', { payer: facts.payer })}
          </StatusPill>
        </li>
      )}
      {facts.payerType === 'bpjs' && (
        <li>
          {facts.sep.state === 'present' ? (
            <StatusPill status="info">
              {t('emr.identity.sep', {
                no: facts.sep.records.map((r) => r.no_sep).join(', '),
              })}
            </StatusPill>
          ) : facts.sep.state === 'none' ? (
            <StatusPill status="danger">{t('emr.identity.sepNone')}</StatusPill>
          ) : (
            <StatusPill status="neutral">{t('emr.identity.sepUnavailable')}</StatusPill>
          )}
        </li>
      )}
      {facts.truncated.length > 0 && (
        <li>
          <StatusPill status="warning">
            {t('emr.identity.truncated', { segments: facts.truncated.join(', ') })}
          </StatusPill>
        </li>
      )}
    </>
  );
}
