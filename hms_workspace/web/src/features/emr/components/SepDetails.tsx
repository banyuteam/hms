import { useI18n } from '@/locales/I18nProvider';
import { FieldList, FieldRow } from '@/components/FieldRow';
import type { SepFacts } from '@/api/select';
import { StoredTime } from '@/components/StoredTime';
import { NotAvailable } from './Blocks';

/** Khanza `bridging_sep.jnspelayanan`: '1' rawat inap, '2' rawat jalan; anything else is shown as stored. */
export function sepServiceKey(code: string | null): string | null {
  if (code === '1') return 'emr.care.inpatient';
  if (code === '2') return 'emr.care.outpatient';
  return null;
}

/**
 * SEP (Surat Eligibilitas Peserta) of a BPJS visit, from clinical-timeline-v1 1.3.0 `summary.sep` (legacy
 * `bridging_sep`). The SEP no. is shown in full (owner decision B-1, ADR-SVC-007: it arrives in the audited timeline
 * read). Three states: not sent (older server) · sent but none recorded · one or more SEPs (e.g. suplesi).
 */
export function SepDetails({ sep }: { sep: SepFacts }) {
  const { t } = useI18n();

  if (sep.state === 'unavailable') return <NotAvailable reason="source" />;
  if (sep.state === 'none')
    return <p className="type-body-strong m-0 text-danger-fg">{t('emr.sep.none')}</p>;

  return (
    <div className="flex flex-col gap-16 [&>*+*]:border-t [&>*+*]:border-line-subtle [&>*+*]:pt-16">
      {sep.records.map((s, i) => {
        const service = sepServiceKey(s.jnspelayanan);
        return (
          <FieldList key={`${s.no_sep}-${i}`}>
            <FieldRow
              label={t('emr.sep.no')}
              value={<span className="[font-variant-numeric:tabular-nums]">{s.no_sep}</span>}
            />
            <FieldRow
              label={t('emr.sep.date')}
              value={<StoredTime value={s.tglsep} absent="—" />}
            />
            <FieldRow
              label={t('emr.sep.service')}
              value={service ? t(service) : (s.jnspelayanan ?? undefined)}
            />
            <FieldRow
              label={t('emr.sep.class')}
              value={s.klsrawat ? t('emr.sep.classValue', { n: s.klsrawat }) : undefined}
            />
            <FieldRow
              label={t('emr.sep.referral')}
              value={[s.nmppkrujukan, s.no_rujukan].filter(Boolean).join(' · ') || undefined}
            />
            <FieldRow
              label={t('emr.sep.initialDx')}
              value={[s.diagawal, s.nmdiagnosaawal].filter(Boolean).join(' ') || undefined}
            />
            <FieldRow label={t('emr.sep.clinic')} value={s.nmpolitujuan ?? undefined} />
            <FieldRow label={t('emr.sep.dpjp')} value={s.nmdpdjp ?? undefined} />
            <FieldRow label={t('emr.sep.cob')} value={s.cob ?? undefined} />
            <FieldRow
              label={t('emr.sep.discharge')}
              value={<StoredTime value={s.tglpulang} absent="—" />}
            />
          </FieldList>
        );
      })}
    </div>
  );
}
