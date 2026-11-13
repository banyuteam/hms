import { useI18n } from '@/locales/I18nProvider';
import { EXAM_REGIONS } from '@/api/journey';
import type { AdmissionOrderRow, EmergencyAssessmentRow } from '@/api/select';
import { FieldList, FieldRow } from '@/components/FieldRow';
import { StoredTime } from '@/components/StoredTime';
import { TextBlock } from './Blocks';
import { w } from '../windows/windowsStyles';

const VITALS = ['td', 'nadi', 'rr', 'suhu', 'spo', 'gcs', 'bb', 'tb'] as const;
const vitalsRow =
  'type-caption flex gap-4 [&_dd]:m-0 [&_dd]:font-semibold [&_dd]:text-ink [&_dd]:[font-variant-numeric:tabular-nums] [&_dt]:text-ink-muted';

/**
 * Emergency department medical assessment (legacy `penilaian_medis_igd`, clinical-timeline-v1 1.4.0), grouped as the
 * IGD form is filled in: history · examination · physical exam · results · diagnosis and management · disposition.
 * Text and legacy codes as recorded; nothing is derived. An abnormal body region says "Abnormal" in words (never colour
 * alone). The allergy text here is the form's own; it does not feed the patient allergy list (owner decision 2026-11-11).
 */
export function EmergencyAssessment({ a }: { a: EmergencyAssessmentRow }) {
  const { t } = useI18n();
  const vitals = VITALS.filter((k) => (a[k] ?? '').trim() !== '');
  const history =
    a.anamnesis === 'Alloanamnesis' && a.hubungan.trim()
      ? `${a.anamnesis} · ${t('emr.igd.informant', { who: a.hubungan })}`
      : a.anamnesis;

  return (
    <article
      className="flex flex-col gap-12 rounded-md border border-line-subtle bg-surface p-12"
      aria-label={t('emr.igd.label', { doctor: a.doctor_name ?? '—' })}
    >
      <header className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <h3 className="type-heading-sm m-0 text-ink [font-variant-numeric:tabular-nums]">
          <StoredTime value={a.key} absent={t('emr.undated')} />
        </h3>
        <span className="type-body-strong text-ink-secondary">
          {a.doctor_name ?? t('emr.igd.doctorUnknown')}
        </span>
      </header>

      <div className={w.stack}>
        <h4 className={w.columnTitle}>{t('emr.igd.history')}</h4>
        <TextBlock label={t('emr.igd.anamnesis')} text={history} />
        <TextBlock label={t('emr.igd.chiefComplaint')} text={a.keluhan_utama} />
        <TextBlock label={t('emr.igd.rps')} text={a.rps} />
        <TextBlock label={t('emr.igd.rpd')} text={a.rpd} />
        <TextBlock label={t('emr.igd.rpk')} text={a.rpk} />
        <TextBlock label={t('emr.igd.rpo')} text={a.rpo} />
        <TextBlock label={t('emr.igd.allergy')} text={a.alergi} />
      </div>

      <div className={w.stack}>
        <h4 className={w.columnTitle}>{t('emr.igd.exam')}</h4>
        <TextBlock label={t('emr.igd.condition')} text={a.keadaan} />
        <TextBlock label={t('emr.vitals.kesadaran')} text={a.kesadaran} />
        {vitals.length > 0 ? (
          <dl
            className="m-0 flex flex-wrap gap-x-16 gap-y-4 rounded-sm bg-surface-subtle px-8 py-6"
            aria-label={t('emr.vitals.title')}
          >
            {vitals.map((k) => (
              <div key={k} className={vitalsRow}>
                <dt>{t(`emr.igd.vitals.${k}`)}</dt>
                <dd>{a[k]}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <TextBlock label={t('emr.vitals.title')} text="" />
        )}
      </div>

      <div className={w.stack}>
        <h4 className={w.columnTitle}>{t('emr.igd.physical')}</h4>
        <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(var(--hms-size-field-label),1fr))] gap-x-16 gap-y-4">
          {EXAM_REGIONS.map((r) => {
            const v = a.fisik[r];
            return (
              <div key={r} className={vitalsRow}>
                <dt>{t(`emr.igd.region.${r}`)}</dt>
                <dd className={v === 'Abnormal' ? w.flag : undefined}>{v ?? '—'}</dd>
              </div>
            );
          })}
        </dl>
        <TextBlock label={t('emr.igd.physicalFindings')} text={a.ket_fisik} />
        <TextBlock label={t('emr.igd.localFindings')} text={a.ket_lokalis} />
      </div>

      <div className={w.stack}>
        <h4 className={w.columnTitle}>{t('emr.igd.results')}</h4>
        <TextBlock label={t('emr.igd.ecg')} text={a.ekg} />
        <TextBlock label={t('emr.igd.radiology')} text={a.rad} />
        <TextBlock label={t('emr.igd.laboratory')} text={a.lab} />
      </div>

      <div className={w.stack}>
        <h4 className={w.columnTitle}>{t('emr.igd.plan')}</h4>
        <TextBlock label={t('emr.igd.diagnosis')} text={a.diagnosis} />
        <TextBlock label={t('emr.igd.management')} text={a.tata} />
      </div>

      <div className={w.stack}>
        <h4 className={w.columnTitle}>{t('emr.igd.disposition')}</h4>
        <TextBlock label={t('emr.igd.dispositionMethod')} text={a.cara_keluar} />
        <TextBlock label={t('emr.igd.dispositionDetail')} text={a.deskripsi} />
        <TextBlock label={t('emr.igd.indication')} text={a.indikasi} />
      </div>
    </article>
  );
}

/**
 * Inpatient admission order (Surat Perintah Rawat Inap, legacy `perintah_ranap`). The legacy row has a date only, so
 * the time is said to be not recorded instead of showing 00:00.
 */
export function AdmissionOrder({ o }: { o: AdmissionOrderRow }) {
  const { t } = useI18n();
  const ward = [o.nm_bangsal, o.kelas, o.kd_kamar].filter(Boolean).join(' · ');
  return (
    <FieldList>
      <FieldRow
        label={t('emr.admissionOrder.date')}
        value={
          <>
            <StoredTime value={o.time_recorded ? o.key : o.key.slice(0, 10)} absent="—" />
            {!o.time_recorded && (
              <span className="text-ink-muted"> · {t('emr.admissionOrder.timeNotRecorded')}</span>
            )}
          </>
        }
      />
      <FieldRow label={t('emr.admissionOrder.room')} value={ward || undefined} />
      <FieldRow label={t('emr.admissionOrder.diagnosis')} value={o.diagnosa ?? undefined} />
      <FieldRow label={t('emr.admissionOrder.note')} value={o.catatan ?? undefined} />
      <FieldRow label={t('emr.admissionOrder.dpjp')} value={o.nm_dpjp ?? undefined} />
    </FieldList>
  );
}
