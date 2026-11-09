import { useI18n } from '@/locales/I18nProvider';
import { Icon } from '@/components/Icon';
import { StatusPill } from '@/components/StatusPill';
import type { EncounterFacts } from '@/api/select';
import { formatStoredDate, readStored } from '@/locales/storedTime';
import { InvalidValue } from '@/components/StoredTime';

const id =
  'type-body border-l border-line pl-12 [font-variant-numeric:tabular-nums] cq-compact:border-l-0 cq-compact:pl-0';
const flags = 'm-0 flex list-none flex-wrap gap-6 p-0 [&_span]:whitespace-normal';

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
}

/**
 * Patient-safety strip at the top of every patient window: two identifiers (name + date of birth, plus MRN),
 * encounter context, a recorded allergy, DPJP, payer, a deceased banner and a warning when the server truncated a
 * list. "No allergy written" is not shown here (owner decision 2026-11-09): the Patient Profile states it under
 * Special notes, and the CPPT shows each note's allergy field.
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
   * "admitted now". The last visit's allergy note is in the profile's Special notes section instead.
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
      {facts && scope === 'encounter' && (
        <ul className={flags} aria-label={t('emr.identity.context')}>
          {facts.allergy.state === 'recorded' && (
            <li>
              <StatusPill status="danger">
                {t('emr.identity.allergy', { text: facts.allergy.text })}
              </StatusPill>
            </li>
          )}
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
        </ul>
      )}
    </div>
  );
}
