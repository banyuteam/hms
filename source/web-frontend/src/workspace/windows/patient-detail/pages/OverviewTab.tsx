import { useIntl } from 'react-intl';
import type { PatientRecord, Vitals } from '@/api/types';
import { Card } from '@/components/Card';
import { FieldList, FieldRow } from '@/components/FieldRow';
import { StatusPill } from '@/components/StatusPill';
import { formatDate, formatDateTime } from '@/i18n/format';
import { useLocaleStore } from '@/i18n/localeStore';
import { enumLabel } from '../labels';
import type { ProfileId } from '../sections';
import styles from './pages.module.css';

type Flag = 'high' | 'low' | null;
function vitalFlags(v: Vitals): Record<'bp' | 'hr' | 'rr' | 'temp' | 'spo2', Flag> {
  return {
    bp: v.systolic >= 140 || v.diastolic >= 90 ? 'high' : v.systolic < 90 ? 'low' : null,
    hr: v.heartRate > 100 ? 'high' : v.heartRate < 60 ? 'low' : null,
    rr: v.respiratoryRate > 20 ? 'high' : v.respiratoryRate < 12 ? 'low' : null,
    temp: v.temperatureC >= 37.5 ? 'high' : v.temperatureC < 36 ? 'low' : null,
    spo2: v.spo2 < 95 ? 'low' : null,
  };
}

/** Figma "Overview": summary cards. Personal Information is a summary with a "View profile" shortcut — not a second home (OQ-50). */
export function OverviewTab({
  patient,
  onViewProfile,
}: {
  patient: PatientRecord;
  onViewProfile: (id: ProfileId) => void;
}) {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const enc = patient.currentEncounter;
  const date = (iso: string) => formatDate(new Date(iso), locale);
  const flags = vitalFlags(patient.vitals);
  const num = (n: number, digits = 0) =>
    intl.formatNumber(n, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const recentNotes = patient.notes.filter((n) => n.encounterNo === enc.no).slice(0, 3);
  const tiles: Array<{ key: string; label: string; value: string; unit: string; flag: Flag }> = [
    {
      key: 'bp',
      label: intl.formatMessage({ id: 'vital.bp' }),
      value: `${patient.vitals.systolic}/${patient.vitals.diastolic}`,
      unit: 'mmHg',
      flag: flags.bp,
    },
    {
      key: 'hr',
      label: intl.formatMessage({ id: 'vital.hr' }),
      value: num(patient.vitals.heartRate),
      unit: '/min',
      flag: flags.hr,
    },
    {
      key: 'rr',
      label: intl.formatMessage({ id: 'vital.rr' }),
      value: num(patient.vitals.respiratoryRate),
      unit: '/min',
      flag: flags.rr,
    },
    {
      key: 'temp',
      label: intl.formatMessage({ id: 'vital.temp' }),
      value: num(patient.vitals.temperatureC, 1),
      unit: '°C',
      flag: flags.temp,
    },
    {
      key: 'spo2',
      label: intl.formatMessage({ id: 'vital.spo2' }),
      value: num(patient.vitals.spo2),
      unit: '%',
      flag: flags.spo2,
    },
    {
      key: 'weight',
      label: intl.formatMessage({ id: 'vital.weight' }),
      value: num(patient.vitals.weightKg),
      unit: 'kg',
      flag: null,
    },
  ];

  return (
    <div className={`${styles.page} ${styles.columns}`}>
      <div className={styles.stack}>
        <Card
          title={intl.formatMessage({ id: 'detail.card.personal' })}
          icon="user"
          action={intl.formatMessage({ id: 'overview.viewProfile' })}
          onAction={() => onViewProfile('personal')}
        >
          <FieldList>
            <FieldRow label={intl.formatMessage({ id: 'field.fullName' })} value={patient.name} />
            <FieldRow label={intl.formatMessage({ id: 'field.mrn' })} value={patient.mrn} />
            <FieldRow
              label={intl.formatMessage({ id: 'field.nik' })}
              masked={patient.nik}
              fieldKey="nik"
            />
            <FieldRow
              label={intl.formatMessage({ id: 'field.gender' })}
              value={enumLabel(intl, 'sex', patient.sex)}
            />
            <FieldRow
              label={intl.formatMessage({ id: 'field.birthDate' })}
              value={`${date(`${patient.birthDate}T00:00:00+07:00`)} (${intl.formatMessage({ id: 'unit.years' }, { n: patient.ageYears })})`}
            />
            <FieldRow
              label={intl.formatMessage({ id: 'field.maritalStatus' })}
              value={enumLabel(intl, 'marital', patient.maritalStatus)}
            />
            <FieldRow
              label={intl.formatMessage({ id: 'field.address' })}
              masked={patient.address.line}
              fieldKey="address"
            />
            <FieldRow
              label={intl.formatMessage({ id: 'field.phone' })}
              masked={patient.phone}
              fieldKey="phone"
            />
            <FieldRow
              label={intl.formatMessage({ id: 'field.occupation' })}
              value={patient.occupation}
            />
            <FieldRow
              label={intl.formatMessage({ id: 'field.emergencyContact' })}
              value={`${patient.responsiblePerson.name} (${enumLabel(intl, 'relationship', patient.responsiblePerson.relationship)})`}
            />
          </FieldList>
        </Card>
        <Card title={intl.formatMessage({ id: 'detail.card.notes' })} icon="clipboard">
          {recentNotes.length === 0 ? (
            <p className={styles.empty}>{intl.formatMessage({ id: 'overview.notes.empty' })}</p>
          ) : (
            recentNotes.map((n) => (
              <div key={n.id} className={styles.note}>
                <span className={styles.noteHead}>{formatDateTime(new Date(n.at), locale)}</span>
                <span className={styles.muted}>
                  {enumLabel(intl, 'note', n.kind)} · {n.author}
                </span>
                <span>{n.soap ? n.soap.a : n.text}</span>
              </div>
            ))
          )}
        </Card>
      </div>
      <div className={styles.stack}>
        <Card title={intl.formatMessage({ id: 'detail.card.encounter' })} icon="bed">
          <FieldList>
            <FieldRow label={intl.formatMessage({ id: 'field.encounterNo' })} value={enc.no} />
            <FieldRow
              label={intl.formatMessage({ id: 'field.admission' })}
              value={formatDateTime(new Date(enc.admittedAt), locale)}
            />
            <FieldRow label={intl.formatMessage({ id: 'field.service' })} value={enc.service} />
            <FieldRow label={intl.formatMessage({ id: 'field.attending' })} value={enc.attending} />
            <FieldRow label={intl.formatMessage({ id: 'field.room' })} value={enc.room} />
            <FieldRow label={intl.formatMessage({ id: 'field.primaryDx' })} value={enc.primaryDx} />
            <FieldRow
              label={intl.formatMessage({ id: 'field.secondaryDx' })}
              value={enc.secondaryDx}
            />
            <FieldRow
              label={intl.formatMessage({ id: 'field.dischargePlan' })}
              value={enumLabel(intl, 'dischargePlan', enc.dischargePlan)}
            />
          </FieldList>
        </Card>
        <Card title={intl.formatMessage({ id: 'detail.card.vitals' })} icon="activity">
          <span className={styles.muted}>
            {intl.formatMessage(
              { id: 'detail.vitals.latest' },
              { at: formatDateTime(new Date(patient.vitals.at), locale) },
            )}
          </span>
          <div className={styles.vitals}>
            {tiles.map((t) => (
              <div key={t.key} className={styles.vital} data-flag={t.flag ?? undefined}>
                <span className={styles.blockLabel}>{t.label}</span>
                <span className={styles.vitalValue}>
                  {t.value}
                  {t.flag === 'high' && <span aria-hidden="true">↑</span>}
                  {t.flag === 'low' && <span aria-hidden="true">↓</span>}
                  <span className={styles.unit}>{t.unit}</span>
                </span>
                {t.flag && (
                  <span className="visually-hidden">
                    {intl.formatMessage({ id: `vital.${t.flag}` })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
        <Card title={intl.formatMessage({ id: 'detail.card.medications' })} icon="pill">
          {patient.medications.length === 0 ? (
            <p className={styles.empty}>{intl.formatMessage({ id: 'overview.meds.empty' })}</p>
          ) : (
            patient.medications.map((m) => (
              <div key={m.name} className={styles.med}>
                <span className={styles.medText}>
                  {m.name} {m.dose}
                </span>
                <StatusPill status="success">
                  {intl.formatMessage({ id: `status.${m.status}` })}
                </StatusPill>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
