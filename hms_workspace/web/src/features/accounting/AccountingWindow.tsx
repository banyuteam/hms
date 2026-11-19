import { useState } from 'react';
import { isLiveApi } from '@/api/liveApi';
import { ErrorState, LoadingState } from '@/components/QueryState';

import { useResource } from '@/lib/resource';
import { useI18n } from '@/locales/I18nProvider';
import { usePermission } from '@/state/auth';
import {
  ACCOUNTING_PERMISSIONS,
  getBalanceSheet,
  getIncomeStatement,
  type AccountingGroup,
  type AccountingLine,
} from './accountingApi';

type ReportKey = 'neraca' | 'labaRugi';

/**
 * "Keuangan" window (`/accounting`): the financial statements of the accounting application, read through
 * hms_services (ADR-SVC-014). Read-only, and holds no patient data.
 *
 * Two reports for now — the balance sheet and the income statement, which share one shape: groups of accounts with
 * a total. The other five have shapes of their own (a six-column worksheet, journal lines, ageing buckets) and
 * arrive with their own rendering.
 */
export function AccountingWindow() {
  const { t } = useI18n();
  const [report, setReport] = useState<ReportKey>('neraca');

  const canNeraca = usePermission(ACCOUNTING_PERMISSIONS.neraca);
  const canLabaRugi = usePermission(ACCOUNTING_PERMISSIONS.labaRugi);

  // Synthetic data would mean inventing a balance sheet, and an invented balance sheet is exactly the thing that
  // ends up in a screenshot. The window says so instead, the same as the tariff book.
  if (!isLiveApi()) {
    return <ErrorState title={t('accounting.title')} message={t('accounting.liveOnly')} />;
  }
  if (!canNeraca && !canLabaRugi) {
    return <ErrorState title={t('accounting.title')} message={t('accounting.forbidden')} />;
  }

  const allowed: ReportKey[] = [];
  if (canNeraca) allowed.push('neraca');
  if (canLabaRugi) allowed.push('labaRugi');
  const current = allowed.includes(report) ? report : allowed[0];

  return (
    <div className="flex h-full flex-col gap-16 p-16">
      {allowed.length > 1 && (
        <div role="tablist" className="flex gap-8">
          {allowed.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === current}
              onClick={() => setReport(key)}
              className={
                key === current
                  ? 'type-body cursor-pointer rounded-sm border border-line bg-hover px-12 py-8 text-ink'
                  : 'type-body cursor-pointer rounded-sm border border-line bg-transparent px-12 py-8 text-ink-secondary hover:bg-hover'
              }
            >
              {t(`accounting.${key}.title`)}
            </button>
          ))}
        </div>
      )}

      {current === 'neraca' ? <Neraca /> : <LabaRugi />}
    </div>
  );
}

/** Period: this month. A picker is the next piece; the reports already accept any year and month. */
function thisPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function Neraca() {
  const { t, locale } = useI18n();
  const { year, month } = thisPeriod();
  const state = useResource(['accounting', 'neraca', year, month], () => getBalanceSheet(year, month));

if (state.isPending) return <LoadingState message={t('accounting.loading')} />;
  if (state.error || !state.data) {
    return <ErrorState title={t('accounting.neraca.title')} message={t('accounting.failed')} />;
  }

  const d = state.data;

  return (
    <div className="flex flex-col gap-24 overflow-auto">
      <Group title={t('accounting.neraca.assets')} group={d.aset} locale={locale} />
      <Group title={t('accounting.neraca.liabilities')} group={d.kewajiban} locale={locale} />
      <Group title={t('accounting.neraca.equity')} group={d.ekuitas} locale={locale} />

      {/*
        Two figures that live in no account at all: there is no year-end closing journal in the accounting
        application, so last year's result and this year's are computed and reported as their own lines. Shown
        apart from the equity accounts so nobody looks for them in the ledger and concludes something is missing.
      */}
      <dl className="type-body m-0 grid grid-cols-[1fr_auto] gap-x-16 gap-y-8">
        <dt className="m-0 text-ink-secondary">{t('accounting.neraca.priorYear')}</dt>
        <dd className="m-0 text-right tabular-nums">{money(d.laba_tahun_lalu, locale)}</dd>
        <dt className="m-0 text-ink-secondary">{t('accounting.neraca.currentYear')}</dt>
        <dd className="m-0 text-right tabular-nums">{money(d.laba_rugi_berjalan, locale)}</dd>
        <dt className="m-0 font-medium text-ink">{t('accounting.neraca.totalLiabEquity')}</dt>
        <dd className="m-0 text-right font-medium tabular-nums">
          {money(d.total_kewajiban_ekuitas, locale)}
        </dd>
      </dl>

      {/*
        The difference is shown as it stands, not folded into a "balanced" verdict. What counts as balanced is one
        decision and it belongs to the accounting application, not to a second opinion here.
      */}
      {Math.abs(d.selisih) >= 0.01 && (
        <p className="type-body m-0 text-status-warning-fg">
          {t('accounting.neraca.difference', { amount: money(d.selisih, locale) })}
        </p>
      )}
    </div>
  );
}

function LabaRugi() {
  const { t, locale } = useI18n();
  const { year, month } = thisPeriod();
  const state = useResource(['accounting', 'laba-rugi', year, month], () =>
    getIncomeStatement(year, month),
  );

  if (state.isPending) return <LoadingState message={t('accounting.loading')} />;
  if (state.error || !state.data) {
    return <ErrorState title={t('accounting.labaRugi.title')} message={t('accounting.failed')} />;
  }

  const d = state.data;

  return (
    <div className="flex flex-col gap-24 overflow-auto">
      <Group title={t('accounting.labaRugi.revenue')} group={{ baris: d.pendapatan, total: d.total.pendapatan }} locale={locale} />
      <Group title={t('accounting.labaRugi.cogs')} group={{ baris: d.hpp, total: d.total.hpp }} locale={locale} />
      <Group title={t('accounting.labaRugi.expenses')} group={{ baris: d.beban, total: d.total.beban }} locale={locale} />
      <Group title={t('accounting.labaRugi.otherCost')} group={{ baris: d.biaya_lain, total: d.total.biaya_lain }} locale={locale} />
      <Group title={t('accounting.labaRugi.tax')} group={{ baris: d.pajak, total: d.total.pajak }} locale={locale} />

      <dl className="type-body m-0 grid grid-cols-[1fr_auto] gap-x-16 gap-y-8">
        <dt className="m-0 text-ink-secondary">{t('accounting.labaRugi.gross')}</dt>
        <dd className="m-0 text-right tabular-nums">{money(d.total.laba_kotor, locale)}</dd>
        <dt className="m-0 text-ink-secondary">{t('accounting.labaRugi.operating')}</dt>
        <dd className="m-0 text-right tabular-nums">{money(d.total.laba_operasi, locale)}</dd>
        <dt className="m-0 font-medium text-ink">{t('accounting.labaRugi.net')}</dt>
        <dd className="m-0 text-right font-medium tabular-nums">{money(d.total.laba_rugi, locale)}</dd>
      </dl>
    </div>
  );
}

function Group({
  title,
  group,
  locale,
}: {
  title: string;
  group: AccountingGroup;
  locale: string;
}) {
  const { t } = useI18n();

  if (group.baris.length === 0) {
    return (
      <section>
        <h3 className="type-title-sm mt-0 mb-8">{title}</h3>
        <p className="type-body m-0 text-ink-muted">{t('accounting.empty')}</p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="type-title-sm mt-0 mb-8">{title}</h3>
      <table className="type-body w-full border-collapse">
        <tbody>
          {group.baris.map((row: AccountingLine) => (
            <tr key={row.kode} className="border-b border-line">
              <td className="py-4 pr-8 align-top text-ink-muted tabular-nums">{row.kode}</td>
              {/* depth comes from the account tree; the indent is the only thing it is used for here. */}
              <td className="py-4 pr-8 align-top" style={{ paddingLeft: `${(row.depth - 1) * 16}px` }}>
                {row.nama}
              </td>
              <td className="py-4 text-right align-top tabular-nums">{money(row.nilai, locale)}</td>
            </tr>
          ))}
          <tr>
            <td />
            <td className="py-8 font-medium text-ink">{t('accounting.total')}</td>
            <td className="py-8 text-right font-medium tabular-nums">{money(group.total, locale)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/**
 * Rupiah, two decimals, grouped. Rounded only for display — the figure behind it is the accounting application's,
 * and 4725470309.579999 reaching here is a float artefact of JSON, not a cent that exists.
 */
function money(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}