/* eslint-disable jsx-a11y/no-noninteractive-tabindex --
   A disabled button cannot take focus, so its wrapper does: keyboard users reach the tooltip that explains why Edit is off (OQ-03). */
import { TooltipTrigger, Tooltip } from 'react-aria-components';
import { useIntl } from 'react-intl';
import type { PatientRecord } from '@/api/types';
import { emitAudit } from '@/audit/audit';
import { Button } from '@/components/Button';
import { StatusPill, type PillStatus } from '@/components/StatusPill';
import { formatDate } from '@/i18n/format';
import { useLocaleStore } from '@/i18n/localeStore';
import { enumLabel } from './labels';
import styles from './PatientHeader.module.css';

const PILL: Record<PatientRecord['status'], PillStatus> = {
  outpatient: 'neutral',
  inpatient: 'info',
  emergency: 'danger',
  discharged: 'success',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/**
 * Figma "Patient header": identity + the safety bar (allergies are always visible, with text — never colour alone).
 * Write actions are disabled with an explanation in Phase 1 (OQ-03); Print stays enabled and is audited.
 */
export function PatientHeader({ patient }: { patient: PatientRecord }) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const activeAllergies = patient.allergies.filter((a) => a.status === 'active');
  const secondaryDx = patient.diagnoses.find(
    (d) => d.encounterNo === patient.currentEncounter.no && d.priority > 1,
  );

  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(patient.name)}
        </span>
        <div className={styles.info}>
          <div className={styles.nameRow}>
            <h2 className={styles.name}>{patient.name}</h2>
            <StatusPill status={PILL[patient.status]}>
              {intl.formatMessage({ id: `patients.status.${patient.status}` })}
            </StatusPill>
          </div>
          <p className={styles.meta}>
            {intl.formatMessage({ id: 'detail.header.mrn' })} {patient.mrn} ·{' '}
            {intl.formatMessage({ id: 'field.nik' })} {patient.nik.masked}
          </p>
          <p className={styles.meta}>
            {intl.formatMessage(
              { id: 'detail.header.ageSex' },
              {
                sex: enumLabel(intl, 'sex', patient.sex),
                years: patient.ageYears,
                birthDate: formatDate(new Date(`${patient.birthDate}T00:00:00+07:00`), locale),
              },
            )}
          </p>
        </div>
        <div className={styles.actions}>
          <TooltipTrigger delay={300}>
            {/* isDisabled buttons are not focusable; the tooltip text is also the accessible description. */}
            <span
              className={styles.disabledWrap}
              tabIndex={0}
              role="group"
              aria-label={intl.formatMessage({ id: 'detail.header.editDisabled' })}
            >
              <Button isDisabled>{intl.formatMessage({ id: 'detail.header.edit' })}</Button>
            </span>
            <Tooltip className={styles.tooltip}>
              {intl.formatMessage({ id: 'detail.header.editDisabled' })}
            </Tooltip>
          </TooltipTrigger>
          <Button
            onPress={() => {
              emitAudit('record.print', 'patient-header');
              window.print();
            }}
          >
            {intl.formatMessage({ id: 'detail.header.print' })}
          </Button>
        </div>
      </div>
      <ul className={styles.safety} aria-label={intl.formatMessage({ id: 'detail.safety.label' })}>
        <li>
          {activeAllergies.length > 0 ? (
            <StatusPill status="danger">
              {intl.formatMessage(
                { id: 'detail.safety.allergy' },
                {
                  allergens: activeAllergies
                    .map((a) => `${a.allergen} (${a.reaction.toLowerCase()})`)
                    .join(', '),
                },
              )}
            </StatusPill>
          ) : (
            <StatusPill status="neutral">
              {intl.formatMessage({ id: 'detail.safety.noAllergy' })}
            </StatusPill>
          )}
        </li>
        <li>
          <StatusPill status="neutral">
            {patient.bloodType === 'unknown'
              ? intl.formatMessage({ id: 'detail.safety.bloodTypeUnknown' })
              : intl.formatMessage({ id: 'detail.safety.bloodType' }, { type: patient.bloodType })}
          </StatusPill>
        </li>
        {secondaryDx && (
          <li>
            <StatusPill status="neutral">{secondaryDx.name}</StatusPill>
          </li>
        )}
        <li>
          <StatusPill status="neutral">{patient.guarantor.name}</StatusPill>
        </li>
      </ul>
    </header>
  );
}
