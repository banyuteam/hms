import { useId, useState } from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { FieldList, FieldRow } from '@/components/FieldRow';
import { Icon } from '@/components/Icon';
import type { SepFacts } from '@/api/select';
import { StoredTime } from '@/components/StoredTime';
import { NotAvailable } from './Blocks';

type SepRecord = Extract<SepFacts, { state: 'present' }>['records'][number];

const head =
  'type-body flex min-h-control w-full flex-wrap items-center gap-x-8 gap-y-2 rounded-sm border-0 bg-transparent px-8 py-6 text-left text-ink-secondary cursor-pointer hover:bg-hover focus-visible:-outline-offset-2';
const classPill =
  'type-caption-strong rounded-full bg-hover px-6 text-ink-muted [font-variant-numeric:tabular-nums]';

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
 *
 * One row per SEP (no., date, service type, care class) that expands to its details, like the Profile's payer list.
 * All rows start collapsed; the SEP no. is also in the identity strip.
 */
export function SepDetails({ sep }: { sep: SepFacts }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  if (sep.state === 'unavailable') return <NotAvailable reason="source" />;
  if (sep.state === 'none')
    return <p className="type-body-strong m-0 text-danger-fg">{t('emr.sep.none')}</p>;

  return (
    <ul className="m-0 flex list-none flex-col p-0" aria-label={t('emr.sep.list')}>
      {sep.records.map((s, i) => (
        <SepItem
          key={`${s.no_sep}-${i}`}
          sep={s}
          open={expanded.has(i)}
          onToggle={() => toggle(i)}
        />
      ))}
    </ul>
  );
}

function SepItem({
  sep: s,
  open,
  onToggle,
}: {
  sep: SepRecord;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const panelId = useId();
  const service = sepServiceKey(s.jnspelayanan);
  const serviceText = service ? t(service) : s.jnspelayanan;

  return (
    <li className="[&:not(:first-child)]:border-t [&:not(:first-child)]:border-line-subtle">
      <button
        type="button"
        className={head}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
        <strong className="font-semibold text-ink [font-variant-numeric:tabular-nums]">
          {s.no_sep}
        </strong>
        {serviceText && <span className="text-ink">{serviceText}</span>}
        {s.klsrawat && (
          <span className={classPill}>{t('emr.sep.classValue', { n: s.klsrawat })}</span>
        )}
        <span className="ml-auto text-ink-muted [font-variant-numeric:tabular-nums]">
          {t('emr.sep.date')} <StoredTime value={s.tglsep} absent="—" />
        </span>
      </button>
      <div id={panelId} hidden={!open} className="pb-8 pl-32">
        {open && (
          <FieldList>
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
        )}
      </div>
    </li>
  );
}
