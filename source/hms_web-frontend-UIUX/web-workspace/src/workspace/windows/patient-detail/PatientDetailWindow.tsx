import { useId, useState, type ReactElement } from 'react';
import { useIntl } from 'react-intl';
import { NotFoundError } from '@/api/patientApi';
import { usePatient } from '@/api/usePatient';
import { Button } from '@/components/Button';
import { DetailTabs } from './DetailTabs';
import { PatientHeader } from './PatientHeader';
import { AuditLogPage } from './pages/AuditLogPage';
import { ComingSoonTab } from './pages/ComingSoonTab';
import { MedicalRecordTab } from './pages/MedicalRecordTab';
import { OverviewTab } from './pages/OverviewTab';
import { ProfilePage } from './pages/ProfilePage';
import { ProfileSidebar } from './ProfileSidebar';
import { BUILT_TABS, type Section } from './sections';
import styles from './PatientDetailWindow.module.css';

/**
 * Patient Detail window (PRD FR-18, Figma 04 / 10–14): profile sidebar · patient header + safety bar · clinical tabs · content.
 * One place is active at a time (OQ-50). Read-only in Phase 1/2; data comes from the synthetic patient API.
 */
export function PatientDetailWindow({ mrn }: { mrn: string }) {
  const intl = useIntl();
  const panelId = useId();
  const [section, setSection] = useState<Section>({ type: 'tab', id: 'overview' });
  const { data: patient, isPending, error, refetch } = usePatient(mrn);

  const activeTab = section.type === 'tab' ? section.id : null;
  const activeProfile = section.type === 'profile' ? section.id : null;

  let content: ReactElement | null = null;
  let panelLabel = '';
  if (patient) {
    if (section.type === 'profile') {
      panelLabel = intl.formatMessage({ id: `detail.profile.${section.id}` });
      content =
        section.id === 'audit' ? (
          <AuditLogPage />
        ) : (
          <ProfilePage id={section.id} patient={patient} />
        );
    } else {
      panelLabel = intl.formatMessage({ id: `detail.tab.${section.id}` });
      if (section.id === 'overview') {
        content = (
          <OverviewTab
            patient={patient}
            onViewProfile={(id) => setSection({ type: 'profile', id })}
          />
        );
      } else if (section.id === 'medicalRecord') {
        content = <MedicalRecordTab patient={patient} />;
      } else if (!BUILT_TABS.includes(section.id)) {
        content = <ComingSoonTab title={panelLabel} />;
      }
    }
  }

  return (
    <div className={styles.root}>
      <ProfileSidebar
        active={activeProfile}
        onSelect={(id) => setSection({ type: 'profile', id })}
      />
      <div className={styles.main}>
        {isPending && (
          <div className={styles.state} role="status" aria-live="polite">
            <div className={styles.skeleton} aria-hidden="true" />
            <p>{intl.formatMessage({ id: 'detail.loading' })}</p>
          </div>
        )}
        {error && (
          <div className={styles.state} role="alert">
            <h2 className={styles.stateTitle}>
              {intl.formatMessage({ id: 'detail.error.title' })}
            </h2>
            <p>
              {intl.formatMessage({
                id:
                  error instanceof NotFoundError ? 'detail.error.notFound' : 'detail.error.generic',
              })}
            </p>
            {!(error instanceof NotFoundError) && (
              <Button onPress={() => void refetch()}>
                {intl.formatMessage({ id: 'detail.retry' })}
              </Button>
            )}
          </div>
        )}
        {patient && (
          <>
            <PatientHeader patient={patient} />
            <DetailTabs
              active={activeTab}
              onSelect={(id) => setSection({ type: 'tab', id })}
              panelId={panelId}
            />
            <div
              key={`${section.type}-${section.id}`}
              id={panelId}
              className={styles.content}
              role={section.type === 'tab' ? 'tabpanel' : 'region'}
              aria-label={panelLabel}
              tabIndex={0}
            >
              {content}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
