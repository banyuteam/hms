import { useI18n } from '@/locales/I18nProvider';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { InvalidValue, useStoredText } from '@/components/StoredTime';
import type { ReactNode } from 'react';
import { useBill } from '@/api/hooks';
import { ApiError, isBadShape, isLiveApi } from '@/api/liveApi';
import { localStored, type EncounterBill } from '@/api/liveTimeline';
import { usePermission } from '@/state/auth';
import { DataTable, TextBlock } from './Blocks';
import { w } from '../windows/windowsStyles';

type Group = EncounterBill['groups'][number];

/** One table row: a category heading, a charge line, a category subtotal or the grand total. */
type Row =
  | { kind: 'heading'; key: string; group: Group }
  | { kind: 'line'; key: string; line: Group['lines'][number] }
  | { kind: 'subtotal'; key: string; group: Group }
  | { kind: 'total'; key: string; amount: string };

const muted = 'type-body m-0 text-ink-muted';

/**
 * Charges of one visit in the billing document (clinical-timeline-v1 `GET /encounters/{number}/bill`, billing.read):
 * what the source tables record for the visit, grouped by category, with the server's exact subtotals and total. The
 * cashier's saved bill number, payments and receivable are shown as saved. Nothing is calculated here; the server
 * decides access, the permission check only avoids a request that would be refused.
 */
export function BillCharges({ norawat }: { norawat: string }) {
  const { t } = useI18n();
  const live = isLiveApi();
  const allowed = usePermission('billing.read');
  const bill = useBill(norawat, live && allowed);
  const label = t('emr.viewer.billing.charges');

  if (!live) return <TextBlock label={label} text={t('emr.na.source')} />;
  if (!allowed || (bill.error instanceof ApiError && bill.error.status === 403))
    return <TextBlock label={label} text={t('emr.viewer.billing.forbidden')} />;
  if (bill.isPending) return <p className={muted}>{t('emr.viewer.billing.loading')}</p>;
  if (bill.error || !bill.data)
    return (
      <div className="flex flex-wrap items-center gap-12" role="alert">
        <p className={muted}>
          {t(isBadShape(bill.error) ? 'data.error.badShape' : 'emr.viewer.billing.error')}
        </p>
        <Button variant="secondary" onClick={() => void bill.refetch()}>
          {t('detail.retry')}
        </Button>
      </div>
    );
  return <Charges bill={bill.data} />;
}

function Charges({ bill }: { bill: EncounterBill }) {
  const { t, formatNumber } = useI18n();
  const storedText = useStoredText();
  const label = t('emr.viewer.billing.charges');

  // Empty = not recorded ("—"); a value that is not a number is a data problem and says so (text, or a warning cell).
  const invalid = (v: string) => v.trim() !== '' && !Number.isFinite(Number(v));
  const money = (v: string) =>
    v.trim() === ''
      ? '—'
      : invalid(v)
        ? t('data.invalid.amount', { raw: v })
        : formatNumber(Number(v), {
            style: 'currency',
            currency: bill.currency,
            maximumFractionDigits: 2,
          });
  const qty = (v: string) =>
    v.trim() === ''
      ? '—'
      : invalid(v)
        ? t('data.invalid.number', { raw: v })
        : formatNumber(Number(v));
  const moneyCell = (v: string): ReactNode =>
    invalid(v) ? <InvalidValue kind="amount" raw={v} /> : money(v);
  const qtyCell = (v: string): ReactNode =>
    invalid(v) ? <InvalidValue kind="number" raw={v} /> : qty(v);
  const category = (g: Group) => t(`emr.viewer.billing.category.${g.category}`);

  const rows: Row[] = [];
  for (const g of bill.groups) {
    rows.push({ kind: 'heading', key: `h:${g.category}`, group: g });
    g.lines.forEach((line, i) => rows.push({ kind: 'line', key: `l:${g.category}:${i}`, line }));
    rows.push({ kind: 'subtotal', key: `s:${g.category}`, group: g });
  }
  rows.push({ kind: 'total', key: 'total', amount: bill.total });

  const strong = (v: ReactNode) => <strong className="font-semibold">{v}</strong>;
  const r = bill.receivable;

  return (
    <div className={w.stack}>
      <TextBlock
        label={t('emr.viewer.billing.savedLabel')}
        text={
          bill.saved_bill
            ? t('emr.viewer.billing.saved', {
                number: bill.saved_bill.bill_number ?? '—',
                when:
                  storedText(
                    localStored(bill.saved_bill.billed_at) ?? bill.saved_bill.billed_at,
                    t('emr.undated'),
                  ) ?? t('emr.undated'),
              })
            : t('emr.viewer.billing.notSaved')
        }
      />
      {bill.groups.length === 0 ? (
        <TextBlock label={label} text={t('emr.viewer.billing.noCharges')} />
      ) : (
        <DataTable<Row>
          caption={t('emr.viewer.billing.lines')}
          rows={rows}
          rowKey={(row) => row.key}
          columns={[
            {
              key: 'item',
              header: t('emr.viewer.billing.col.item'),
              render: (row) => {
                if (row.kind === 'heading') return strong(category(row.group));
                if (row.kind === 'subtotal')
                  return t('emr.viewer.billing.subtotal', { category: category(row.group) });
                if (row.kind === 'total') return strong(t('emr.viewer.billing.total'));
                return (
                  <>
                    {row.line.label ?? t('common.notRecorded')}{' '}
                    <span className={`${w.code} text-ink-muted`}>{row.line.code}</span>
                  </>
                );
              },
            },
            {
              key: 'qty',
              header: t('emr.viewer.billing.col.qty'),
              numeric: true,
              render: (row) =>
                row.kind !== 'line'
                  ? ''
                  : row.line.rate_percent !== null
                    ? invalid(row.line.rate_percent)
                      ? qtyCell(row.line.rate_percent)
                      : t('emr.viewer.billing.rate', { rate: qty(row.line.rate_percent) })
                    : qtyCell(row.line.quantity),
            },
            {
              key: 'price',
              header: t('emr.viewer.billing.col.price'),
              numeric: true,
              render: (row) => (row.kind === 'line' ? moneyCell(row.line.unit_price) : ''),
            },
            {
              key: 'add',
              header: t('emr.viewer.billing.col.additional'),
              numeric: true,
              render: (row) =>
                row.kind === 'line' && Number(row.line.additional) !== 0
                  ? moneyCell(row.line.additional)
                  : '',
            },
            {
              key: 'amount',
              header: t('emr.viewer.billing.col.amount'),
              numeric: true,
              render: (row) =>
                row.kind === 'line'
                  ? moneyCell(row.line.amount)
                  : row.kind === 'subtotal'
                    ? strong(moneyCell(row.group.subtotal))
                    : row.kind === 'total'
                      ? strong(moneyCell(row.amount))
                      : '',
            },
            {
              key: 'tariff',
              header: t('emr.viewer.billing.col.tariff'),
              numeric: true,
              render: (row) => {
                if (row.kind !== 'line' || row.line.tariff === null) return '';
                const differs = row.line.tariff_matches === false;
                return (
                  <span className="inline-flex items-center justify-end gap-4">
                    {differs && <Icon name="alert" size={14} aria-hidden="true" />}
                    {moneyCell(row.line.tariff)}
                    {differs && (
                      <span className="type-caption">{t('emr.viewer.billing.tariffDiffers')}</span>
                    )}
                  </span>
                );
              },
            },
          ]}
        />
      )}
      {bill.groups.some((g) => g.lines.some((l) => l.tariff !== null)) && (
        <p className={w.note}>{t('emr.viewer.billing.tariffNote')}</p>
      )}
      {bill.truncated.length > 0 && (
        <p className={`${muted} font-semibold`} role="note">
          {t('emr.viewer.billing.truncated')}
        </p>
      )}
      <TextBlock
        label={t('emr.viewer.billing.payments')}
        text={bill.payments
          .map((p) =>
            [
              `${p.method}: ${money(p.amount)}`,
              p.tax && Number(p.tax) !== 0
                ? t('emr.viewer.billing.payment.tax', { amount: money(p.tax) })
                : null,
            ]
              .filter(Boolean)
              .join(', '),
          )
          .join('\n')}
      />
      <TextBlock
        label={t('emr.viewer.billing.receivable')}
        text={
          r &&
          [
            t('emr.viewer.billing.receivable.text', {
              status: r.status,
              total: money(r.total),
              down: money(r.down_payment),
              remaining: money(r.remaining),
            }),
            storedText(r.due_date)
              ? t('emr.viewer.billing.receivable.due', { date: storedText(r.due_date) ?? '' })
              : null,
          ]
            .filter(Boolean)
            .join(', ')
        }
      />
      <p className={w.note}>{t('emr.viewer.billing.source')}</p>
    </div>
  );
}
