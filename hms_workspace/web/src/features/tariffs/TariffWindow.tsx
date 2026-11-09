import { useId, useState } from 'react';
import { ApiError, isLiveApi } from '@/api/liveApi';
import { Button } from '@/components/Button';
import { formStyles } from '@/components/formStyles';
import { ErrorState, LoadingState } from '@/components/QueryState';
import { DataTable } from '@/features/emr/components/Blocks';
import { useInfiniteResource, useResource } from '@/lib/resource';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useI18n } from '@/locales/I18nProvider';
import { usePermission } from '@/state/auth';
import {
  getLabItems,
  listTariffs,
  TARIFF_CLASSES,
  TARIFF_FILTERS,
  TARIFF_KINDS,
  TARIFF_PERMISSION,
  TARIFF_PLACE,
  TARIFF_STATUSES,
  type TariffItem,
  type TariffKind,
  type TariffPage,
  type TariffQuery,
  type TariffStatus,
} from './tariffApi';

/** Component and price names that have a message; others (the 28 surgery fee columns) are shown as stored. */
const NAMED_COMPONENTS = new Set([
  'material',
  'bhp',
  'doctor_fee',
  'nurse_fee',
  'kso',
  'management',
  'hospital_share',
  'referrer_fee',
  'staff_fee',
  'lab_fee',
]);
/** Prices shown in the list per kind (all of them in the details); drugs: the outpatient price. */
const LIST_PRICES: Record<TariffKind, number> = {
  outpatient_procedure: 3,
  inpatient_procedure: 3,
  surgery: 1,
  drug: 1,
  laboratory: 1,
  radiology: 1,
};

const muted = 'type-body m-0 text-ink-muted';

/**
 * "Tariff book" window (`/tariffs`): today's prices from the legacy master price tables (tariff-book-v1, ADR-SVC-005),
 * read-only. Each legacy tariff code is one price for one payer and class (and clinic or ward). Holds no PHI; the
 * query lives in this window only (never in the URL or browser storage).
 */
export function TariffWindow({ winId }: { winId: string }) {
  const { t } = useI18n();
  const allowed = usePermission(TARIFF_PERMISSION);
  if (!isLiveApi()) return <ErrorState title={t('tariff.title')} message={t('tariff.liveOnly')} />;
  if (!allowed) return <ErrorState title={t('tariff.title')} message={t('tariff.forbidden')} />;
  return <TariffBook winId={winId} />;
}

function TariffBook({ winId }: { winId: string }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<TariffKind>('outpatient_procedure');
  const [query, setQuery] = useState<TariffQuery>({
    q: '',
    payer: '',
    class: '',
    place: '',
    status: 'active',
  });
  const [selected, setSelected] = useState<TariffItem | null>(null);
  const debounced = useDebouncedValue(query);
  const id = (part: string) => `${winId}-${part}`;
  const filters = new Set(TARIFF_FILTERS[kind]);
  const place = TARIFF_PLACE[kind];

  const pages = useInfiniteResource<TariffPage, string>(
    [
      'tariff',
      kind,
      debounced.q,
      debounced.payer,
      debounced.class,
      debounced.place,
      debounced.status,
    ],
    (after) => listTariffs(kind, debounced, after),
    (last) => last.next_after,
  );
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (patch: Partial<TariffQuery>) => {
    setQuery((q) => ({ ...q, ...patch }));
    setSelected(null);
  };
  const forbidden = pages.error instanceof ApiError && pages.error.status === 403;

  return (
    <div className="flex min-h-0 flex-col gap-16 p-16">
      <form
        className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-12"
        aria-label={t('tariff.filters')}
        onSubmit={(e) => e.preventDefault()}
      >
        <div className={formStyles.field}>
          <label htmlFor={id('kind')}>{t('tariff.kind')}</label>
          <select
            id={id('kind')}
            className={formStyles.input}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as TariffKind);
              setSelected(null);
            }}
          >
            {TARIFF_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`tariff.kind.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={formStyles.field}>
          <label htmlFor={id('q')}>{t('tariff.search')}</label>
          <input
            id={id('q')}
            className={formStyles.input}
            type="search"
            maxLength={64}
            value={query.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </div>
        {filters.has('payer') && (
          <div className={formStyles.field}>
            <label htmlFor={id('payer')}>{t('tariff.payer')}</label>
            <input
              id={id('payer')}
              className={formStyles.input}
              maxLength={3}
              value={query.payer}
              onChange={(e) => set({ payer: e.target.value.trim() })}
            />
          </div>
        )}
        {filters.has('class') && (
          <div className={formStyles.field}>
            <label htmlFor={id('class')}>{t('tariff.class')}</label>
            <select
              id={id('class')}
              className={formStyles.input}
              value={query.class}
              onChange={(e) => set({ class: e.target.value })}
            >
              <option value="">{t('tariff.any')}</option>
              {TARIFF_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
        {filters.has('place') && place && (
          <div className={formStyles.field}>
            <label htmlFor={id('place')}>{t(`tariff.place.${place}`)}</label>
            <input
              id={id('place')}
              className={formStyles.input}
              maxLength={5}
              value={query.place}
              onChange={(e) => set({ place: e.target.value.trim() })}
            />
          </div>
        )}
        <div className={formStyles.field}>
          <label htmlFor={id('status')}>{t('tariff.status')}</label>
          <select
            id={id('status')}
            className={formStyles.input}
            value={query.status}
            onChange={(e) => set({ status: e.target.value as TariffStatus })}
          >
            {TARIFF_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`tariff.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </form>

      {pages.isPending ? (
        <LoadingState message={t('tariff.loading')} />
      ) : pages.error ? (
        <ErrorState
          title={t('tariff.title')}
          message={t(forbidden ? 'tariff.forbidden' : 'tariff.error')}
          retryLabel={forbidden ? undefined : t('detail.retry')}
          onRetry={forbidden ? undefined : () => void pages.refetch()}
        />
      ) : items.length === 0 ? (
        <p className={muted} role="status">
          {t('tariff.empty')}
        </p>
      ) : (
        <TariffTable
          kind={kind}
          items={items}
          onSelect={setSelected}
          selected={selected?.code ?? null}
        />
      )}
      {pages.hasNextPage && !pages.isPending && !pages.error && (
        <div className="flex flex-wrap items-center gap-12">
          <Button onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
            {t('tariff.more')}
          </Button>
          {pages.isFetchNextPageError && (
            <p className={muted} role="alert">
              {t('tariff.error')}
            </p>
          )}
        </div>
      )}
      {selected && <TariffDetails kind={kind} item={selected} />}
    </div>
  );
}

function useMoney() {
  const { formatNumber } = useI18n();
  return (v: string) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n)
      ? formatNumber(n, { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 })
      : '—';
  };
}

function TariffTable({
  kind,
  items,
  selected,
  onSelect,
}: {
  kind: TariffKind;
  items: TariffItem[];
  selected: string | null;
  onSelect: (item: TariffItem) => void;
}) {
  const { t } = useI18n();
  const money = useMoney();
  const place = TARIFF_PLACE[kind];
  return (
    <DataTable<TariffItem>
      caption={t(`tariff.kind.${kind}`)}
      rows={items}
      rowKey={(it) => it.code}
      columns={[
        { key: 'code', header: t('tariff.col.code'), render: (it) => it.code },
        {
          key: 'name',
          header: t('tariff.col.name'),
          render: (it) => (
            <>
              {it.name ?? t('common.notRecorded')}
              {!it.active && <span className="text-ink-muted"> · {t('tariff.inactive')}</span>}
            </>
          ),
        },
        ...(kind === 'drug'
          ? [
              {
                key: 'unit',
                header: t('tariff.col.unit'),
                render: (it: TariffItem) => it.unit ?? '—',
              },
            ]
          : [
              {
                key: 'payer',
                header: t('tariff.payer'),
                render: (it: TariffItem) => (it.payer ? (it.payer.name ?? it.payer.code) : '—'),
              },
            ]),
        ...(place
          ? [
              {
                key: 'place',
                header: t(`tariff.place.${place}`),
                render: (it: TariffItem) => (it.place ? (it.place.name ?? it.place.code) : '—'),
              },
            ]
          : []),
        ...(TARIFF_FILTERS[kind].includes('class')
          ? [
              {
                key: 'class',
                header: t('tariff.class'),
                render: (it: TariffItem) => it.class ?? '—',
              },
            ]
          : []),
        {
          key: 'price',
          header: t('tariff.col.price'),
          numeric: true,
          render: (it) => (
            <span className="whitespace-pre-line">
              {it.prices
                .slice(0, LIST_PRICES[kind])
                .map((p) =>
                  LIST_PRICES[kind] > 1 || kind === 'drug'
                    ? `${t(`tariff.price.${p.name}`)}: ${money(p.amount)}`
                    : money(p.amount),
                )
                .join('\n')}
            </span>
          ),
        },
        {
          key: 'open',
          header: t('tariff.col.details'),
          render: (it) => (
            <Button
              variant="ghost"
              aria-pressed={selected === it.code}
              aria-label={t('tariff.details', { code: it.code })}
              onClick={() => onSelect(it)}
            >
              {t('tariff.open')}
            </Button>
          ),
        },
      ]}
    />
  );
}

function TariffDetails({ kind, item }: { kind: TariffKind; item: TariffItem }) {
  const { t } = useI18n();
  const money = useMoney();
  const component = (name: string) =>
    NAMED_COMPONENTS.has(name) ? t(`tariff.component.${name}`) : name.replace(/_/g, ' ');
  return (
    <section
      aria-label={t('tariff.details', { code: item.code })}
      className="flex flex-col gap-12 rounded-md border border-line-subtle p-16"
    >
      <h3 className="type-heading-sm m-0 text-ink">
        {item.code} · {item.name ?? t('common.notRecorded')}
      </h3>
      {item.category && (
        <p className={muted}>
          {t('tariff.category')}: {item.category.name ?? item.category.code}
        </p>
      )}
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-16 gap-y-4">
        {item.prices.map((p) => (
          <div key={p.name} className="contents">
            <dt className="type-body-strong">{t(`tariff.price.${p.name}`)}</dt>
            <dd className="m-0 text-right [font-variant-numeric:tabular-nums]">
              {money(p.amount)}
            </dd>
          </div>
        ))}
        {item.components.map((c) => (
          <div key={c.name} className="contents">
            <dt className="text-ink-muted">{component(c.name)}</dt>
            <dd className="m-0 text-right text-ink-muted [font-variant-numeric:tabular-nums]">
              {money(c.amount)}
            </dd>
          </div>
        ))}
      </dl>
      {kind === 'laboratory' && <LabItems code={item.code} />}
    </section>
  );
}

function LabItems({ code }: { code: string }) {
  const { t } = useI18n();
  const money = useMoney();
  const headingId = useId();
  const items = useResource(['tariff', 'lab-items', code], () => getLabItems(code));
  if (items.isPending) return <p className={muted}>{t('tariff.loading')}</p>;
  if (items.error || !items.data)
    return (
      <p className={muted} role="alert">
        {t('tariff.error')}
      </p>
    );
  return (
    <div className="flex flex-col gap-8">
      <h4 id={headingId} className="type-body-strong m-0">
        {t('tariff.labItems')}
      </h4>
      {items.data.items.length === 0 ? (
        <p className={muted}>{t('tariff.labItems.none')}</p>
      ) : (
        <DataTable
          caption={t('tariff.labItems')}
          rows={items.data.items}
          rowKey={(i) => String(i.template_id)}
          columns={[
            { key: 'name', header: t('tariff.col.name'), render: (i) => i.name ?? '—' },
            { key: 'unit', header: t('tariff.col.unit'), render: (i) => i.unit ?? '—' },
            {
              key: 'price',
              header: t('tariff.col.price'),
              numeric: true,
              render: (i) => money(i.price),
            },
          ]}
        />
      )}
      {items.data.truncated && <p className={muted}>{t('tariff.labItems.truncated')}</p>}
    </div>
  );
}
