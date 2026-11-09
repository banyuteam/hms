import { useMemo } from 'react';
import { AuditSubjectProvider } from '@/audit/subject';
import { useI18n } from '@/locales/I18nProvider';
import { ApiError, isBadShape } from '@/api/liveApi';
import { NotFoundError } from '@/api/patientApi';
import { Button } from '@/components/Button';
import { FieldList, FieldRow } from '@/components/FieldRow';
import { Icon } from '@/components/Icon';
import { useHomeActions } from '@/state/home';
import {
  flattenEncounterPages,
  useEncounterPages,
  useJourney,
  usePatientProfile,
  usePayerHistory,
} from '@/api/hooks';
import { facts as toFacts } from '@/api/select';
import { RowList, Section, StateView, SummaryRow } from '../components/Blocks';
import { IdentityStrip } from '../components/IdentityStrip';
import { PayerHistory } from '../components/PayerHistory';
import { AskAssistant, EditAction } from '../components/RecordActions';
import { RecordSearch } from '../components/RecordSearch';
import { WindowPage } from '../components/WindowPage';
import { StoredTime, useStoredText } from '@/components/StoredTime';
import { useOpen } from './EncounterGate';
import { w } from './windowsStyles';

/**
 * W1 Patient Profile (key: MRN). One page, no tabs: identity · background · contact · emergency contact · special notes
 * (allergy from the last visit's notes) · guarantor (payers used on the visits, from `reg_periksa` + `penjab`) · visits
 * (newest admission first → each opens W2 for that no_rawat). PHI fields stay masked with audited reveal.
 */
export function ProfileWindow({ winId, mrn }: { winId: string; mrn?: string }) {
  const { t } = useI18n();
  const { retarget } = useHomeActions();

  if (!mrn) {
    return (
      <StateView kind="empty" title={t('emr.w1.title')} message={t('emr.blank.patient')}>
        <RecordSearch
          patients
          onPick={(pick) =>
            pick.type === 'patient'
              ? retarget(winId, { mrn: pick.hit.mrn })
              : pick.item.no_rkm_medis && retarget(winId, { mrn: pick.item.no_rkm_medis })
          }
        />
      </StateView>
    );
  }
  return <Profile mrn={mrn} />;
}

function Profile({ mrn }: { mrn: string }) {
  const { t } = useI18n();
  const storedText = useStoredText();
  const open = useOpen();
  const patient = usePatientProfile(mrn);
  const visits = useEncounterPages(mrn);
  const list = useMemo(() => flattenEncounterPages(visits.data?.pages), [visits.data]);
  const latest = list[0];
  const latestJourney = useJourney(latest?.no_rawat);
  const payers = usePayerHistory(mrn); // same cache entry as the guarantor section; here only for the counts
  const facts = useMemo(
    () => (latestJourney.data ? toFacts(latestJourney.data) : null),
    [latestJourney.data],
  );

  if (patient.isPending) return <StateView kind="loading" message={t('detail.loading')} />;
  if (patient.error || !patient.data) {
    const notFound = patient.error instanceof NotFoundError;
    const forbidden = patient.error instanceof ApiError && patient.error.status === 403;
    return (
      <StateView
        kind="error"
        title={t('detail.error.title')}
        message={t(
          forbidden
            ? 'detail.error.forbidden'
            : notFound
              ? 'detail.error.notFound'
              : isBadShape(patient.error)
                ? 'data.error.badShape'
                : 'detail.error.generic',
        )}
        onRetry={notFound || forbidden ? undefined : () => void patient.refetch()}
      />
    );
  }
  const p = patient.data;
  const rp = p.responsiblePerson;

  return (
    <AuditSubjectProvider patient={p.mrn}>
      <WindowPage
        label={`${t('emr.w1.title')} · ${p.mrn}`}
        identity={
          <IdentityStrip
            person={{
              name: p.name,
              mrn: p.mrn,
              birthDate: p.birthDate,
              ageYears: p.ageYears,
              sex: p.sex === 'unknown' ? null : p.sex,
            }}
            facts={facts}
            scope="patient"
          />
        }
        sections={[
          { id: 'identity', label: t('emr.w1.identity') },
          { id: 'background', label: t('emr.w1.background') },
          { id: 'contact', label: t('emr.w1.contact') },
          { id: 'emergency', label: t('emr.w1.emergency'), count: 1 },
          { id: 'special', label: t('emr.special.title') },
          { id: 'guarantor', label: t('emr.w1.guarantor'), count: payers.data?.payers.length },
          { id: 'visits', label: t('emr.w1.visits'), count: list.length },
        ]}
        toolbar={
          <>
            <EditAction label={t('emr.edit.profile')} />
            {/* The patient only: the user tags the visit to ask about (F-7). */}
            <AskAssistant tag={{ id: `pt:${p.mrn}`, kind: 'patient', mrn: p.mrn }} />
          </>
        }
      >
        <Section id="identity" title={t('emr.w1.identity')} icon="user">
          <FieldList>
            <FieldRow label={t('field.fullName')} value={p.name || undefined} />
            <FieldRow label={t('field.mrn')} value={p.mrn} />
            <FieldRow label={t('field.nik')} masked={p.nik} fieldKey="nik" />
            <FieldRow
              label={t('field.birthDate')}
              value={
                [
                  storedText(p.birthDate, null, true),
                  p.ageYears === null ? null : t('emr.identity.age', { age: p.ageYears }),
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
            />
            <FieldRow label={t('field.gender')} value={t(`emr.sex.${p.sex}`)} />
            <FieldRow label={t('field.motherName')} value={p.motherName || undefined} />
          </FieldList>
        </Section>

        <Section id="background" title={t('emr.w1.background')} icon="clipboard">
          <FieldList>
            <FieldRow label={t('field.bloodType')} value={t(`enum.blood.${p.bloodType}`)} />
            <FieldRow label={t('field.birthPlace')} value={p.birthPlace || undefined} />
            <FieldRow
              label={t('field.maritalStatus')}
              value={p.maritalStatus ? t(`enum.marital.${p.maritalStatus}`) : undefined}
            />
            <FieldRow label={t('field.religion')} value={p.religion || undefined} />
            <FieldRow
              label={t('field.education')}
              value={p.education === 'none' ? undefined : t(`enum.education.${p.education}`)}
            />
            <FieldRow label={t('field.occupation')} value={p.occupation || undefined} />
            <FieldRow
              label={t('field.firstRegistered')}
              value={<StoredTime value={p.firstRegistered} absent="—" dateOnly />}
            />
          </FieldList>
        </Section>

        <Section id="contact" title={t('emr.w1.contact')} icon="phone">
          <FieldList>
            <FieldRow label={t('field.address')} masked={p.address.line} fieldKey="address" />
            <FieldRow
              label={t('field.city')}
              value={
                p.address.namesAvailable === false
                  ? t('emr.na.source')
                  : [p.address.village, p.address.district, p.address.city, p.address.province]
                      .filter(Boolean)
                      .join(', ') || undefined
              }
            />
            <FieldRow label={t('field.phone')} masked={p.phone} fieldKey="phone" />
            <FieldRow label={t('field.email')} masked={p.email} fieldKey="email" />
          </FieldList>
        </Section>

        <Section id="emergency" title={t('emr.w1.emergency')} icon="users" count={1}>
          <p className={w.note}>{t('emr.w1.emergencyNote')}</p>
          <FieldList>
            <FieldRow label={t('field.name')} value={rp.name || undefined} />
            <FieldRow
              label={t('field.relationship')}
              value={t(`enum.relationship.${rp.relationship}`)}
            />
            <FieldRow
              label={t('field.address')}
              masked={rp.address.line}
              fieldKey="responsible.address"
            />
          </FieldList>
        </Section>

        <Section id="special" title={t('emr.special.title')} icon="pin">
          <FieldList>
            <FieldRow
              label={t('emr.special.allergy')}
              value={
                visits.isPending || (latest && latestJourney.isPending) ? (
                  <span className="text-ink-muted">{t('emr.special.loading')}</span>
                ) : (visits.isError && !visits.data) || latestJourney.error ? (
                  <span role="alert" className="text-warning-fg">
                    {t('emr.special.error')}{' '}
                    {/* A failed visit list already has its Try again under Visits. */}
                    {Boolean(latestJourney.error) && (
                      <Button variant="ghost" onClick={() => void latestJourney.refetch()}>
                        {t('emr.search.retry')}
                      </Button>
                    )}
                  </span>
                ) : !latest || !facts ? (
                  <span className="text-ink-muted">{t('emr.special.noVisits')}</span>
                ) : facts.allergy.state === 'recorded' ? (
                  <strong className="inline-flex items-start gap-6 text-danger-fg">
                    <Icon name="alert" size={16} className="mt-2 flex-none" />
                    <span className="whitespace-pre-line">{facts.allergy.text}</span>
                  </strong>
                ) : (
                  t('emr.special.allergyNotRecorded')
                )
              }
            />
          </FieldList>
          {latest && facts && (
            <p className={w.note}>{t('emr.special.source', { norawat: latest.no_rawat })}</p>
          )}
        </Section>

        <Section
          id="guarantor"
          title={t('emr.w1.guarantor')}
          icon="shield"
          count={payers.data?.payers.length}
        >
          <PayerHistory mrn={p.mrn} onOpenVisit={(norawat) => open('emr-records', { norawat })} />
        </Section>

        <Section id="visits" title={t('emr.w1.visits')} icon="route" count={list.length}>
          <p className={w.note}>{t('emr.w1.visitsSort')}</p>
          {visits.isPending ? (
            <p className={w.note}>{t('detail.loading')}</p>
          ) : visits.isError && !visits.data ? (
            <div role="alert" className={w.note}>
              {t('emr.w1.visitsError')}{' '}
              <Button variant="ghost" onClick={() => void visits.refetch()}>
                {t('emr.search.retry')}
              </Button>
            </div>
          ) : list.length === 0 ? (
            <p className={w.note}>{t('emr.w1.noVisits')}</p>
          ) : (
            <>
              <RowList label={t('emr.w1.visits')}>
                {list.map((v) => (
                  <SummaryRow
                    key={v.no_rawat}
                    icon={v.status_lanjut === 'Ranap' ? 'bed' : 'stethoscope'}
                    label={
                      <StoredTime
                        value={`${v.tgl_registrasi ?? ''} ${v.jam_reg ?? ''}`}
                        absent={t('emr.undated')}
                      />
                    }
                    preview={`${v.no_rawat} · ${t(`emr.care.${v.status_lanjut === 'Ranap' ? 'inpatient' : 'outpatient'}`)}${v.stts ? ` · ${v.stts}` : ''}${v.kd_pj && v.kd_pj.trim() !== '-' ? ` · ${t('emr.w1.payer', { code: v.kd_pj.trim() })}` : ''}`}
                    onOpen={() => open('emr-records', { norawat: v.no_rawat })}
                    openLabel={t('emr.open.records')}
                  />
                ))}
              </RowList>
              <p className={w.note} aria-live="polite">
                {t('emr.w1.visitsShown', { n: list.length })}
                {visits.hasNextPage ? ` · ${t('emr.w1.moreAvailable')}` : ''}
              </p>
              {visits.isFetchNextPageError && (
                <p role="alert" className={w.note}>
                  {t('emr.w1.moreError')}
                </p>
              )}
              {visits.hasNextPage && (
                <Button
                  onClick={() => void visits.fetchNextPage()}
                  disabled={visits.isFetchingNextPage}
                >
                  {t(visits.isFetchingNextPage ? 'emr.w1.loadingMore' : 'emr.w1.loadMore')}
                </Button>
              )}
            </>
          )}
        </Section>
      </WindowPage>
    </AuditSubjectProvider>
  );
}
