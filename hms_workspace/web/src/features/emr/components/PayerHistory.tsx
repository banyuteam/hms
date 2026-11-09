import { useId, useState } from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { ApiError, isBadShape } from '@/api/liveApi';
import { usePayerHistory } from '@/api/hooks';
import type { PayerGroup } from '@/api/emrApi';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { StoredTime, useStoredText } from '@/components/StoredTime';
import { RowList, SummaryRow } from './Blocks';

const note = 'type-caption m-0 text-ink-muted';
const countPill =
  'type-caption-strong rounded-full bg-hover px-6 text-ink-muted [font-variant-numeric:tabular-nums]';
const head =
  'type-body flex min-h-control w-full flex-wrap items-center gap-x-8 gap-y-2 rounded-sm border-0 bg-transparent px-8 py-6 text-left text-ink-secondary cursor-pointer hover:bg-hover focus-visible:-outline-offset-2';

/**
 * Guarantor section of the Patient Profile: the payers recorded on the patient's visits (`reg_periksa.kd_pj` → `penjab`),
 * grouped by payer code, the payer with the most recent visit first. Each payer expands to its visits (latest first);
 * a visit opens Medical Records for that no_rawat. All groups start collapsed.
 */
export function PayerHistory({
  mrn,
  onOpenVisit,
}: {
  mrn: string;
  onOpenVisit: (norawat: string) => void;
}) {
  const { t } = useI18n();
  const history = usePayerHistory(mrn);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(code)) next.add(code);
      return next;
    });

  if (history.isPending) return <p className={note}>{t('detail.loading')}</p>;
  if (history.error || !history.data) {
    // Without encounter.read the visits behind the payers are not the person's to see: a final answer, no Retry.
    const forbidden = history.error instanceof ApiError && history.error.status === 403;
    return (
      <div role="alert" className={note}>
        {t(
          forbidden
            ? 'emr.payer.forbidden'
            : isBadShape(history.error)
              ? 'data.error.badShape'
              : 'emr.payer.error',
        )}{' '}
        {!forbidden && (
          <Button variant="ghost" onClick={() => void history.refetch()}>
            {t('emr.search.retry')}
          </Button>
        )}
      </div>
    );
  }
  const { payers, truncated } = history.data;
  if (payers.length === 0) return <p className={note}>{t('emr.w1.noVisits')}</p>;

  return (
    <>
      <p className={note}>{t('emr.payer.note')}</p>
      <ul className="m-0 flex list-none flex-col p-0" aria-label={t('emr.payer.list')}>
        {payers.map((p) => (
          <PayerItem
            key={p.code}
            payer={p}
            open={expanded.has(p.code)}
            onToggle={() => toggle(p.code)}
            onOpenVisit={onOpenVisit}
          />
        ))}
      </ul>
      {truncated && <p className={note}>{t('emr.payer.truncated')}</p>}
    </>
  );
}

function PayerItem({
  payer,
  open,
  onToggle,
  onOpenVisit,
}: {
  payer: PayerGroup;
  open: boolean;
  onToggle: () => void;
  onOpenVisit: (norawat: string) => void;
}) {
  const { t } = useI18n();
  const storedText = useStoredText();
  const panelId = useId();
  const n = payer.visits.length;

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
        {payer.code ? (
          <strong className="font-semibold tracking-[var(--hms-text-overline-tracking)] text-ink">
            {payer.code}
          </strong>
        ) : null}
        <span className={payer.code && payer.name ? 'text-ink' : 'text-ink-muted'}>
          {!payer.code ? t('emr.payer.noCode') : (payer.name ?? t('emr.payer.noName'))}
        </span>
        <span className={countPill}>{t('emr.payer.visits', { n })}</span>
        <span className="ml-auto text-ink-muted [font-variant-numeric:tabular-nums]">
          {t('emr.payer.last', { when: storedText(payer.lastVisit, t('emr.undated')) ?? '' })}
        </span>
      </button>
      <div id={panelId} hidden={!open} className="pb-8 pl-24">
        {open && (
          <RowList label={t('emr.payer.visitsOf', { payer: payer.code || t('emr.payer.noCode') })}>
            {payer.visits.map((v) => (
              <SummaryRow
                key={v.no_rawat}
                icon={v.status_lanjut === 'Ranap' ? 'bed' : 'stethoscope'}
                label={
                  <StoredTime
                    value={`${v.tgl_registrasi ?? ''} ${v.jam_reg ?? ''}`}
                    absent={t('emr.undated')}
                  />
                }
                preview={`${v.no_rawat} · ${t(`emr.care.${v.status_lanjut === 'Ranap' ? 'inpatient' : 'outpatient'}`)}${v.stts ? ` · ${v.stts}` : ''}`}
                onOpen={() => onOpenVisit(v.no_rawat)}
                openLabel={t('emr.open.records')}
              />
            ))}
          </RowList>
        )}
      </div>
    </li>
  );
}
