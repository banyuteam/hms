import type { ReactNode } from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { useSectionDomId } from './WindowPage';

const countPill =
  'type-caption-strong rounded-full bg-hover px-6 text-ink-muted [font-variant-numeric:tabular-nums]';
const row =
  'type-body flex min-h-control w-full items-center gap-8 rounded-sm border-0 bg-transparent px-8 py-6 text-left text-ink-secondary';
const muted = 'type-body m-0 text-ink-muted';
const cell =
  'px-12 py-8 data-[numeric]:text-right data-[numeric]:[font-variant-numeric:tabular-nums]';

/** One section of a remodel window page (target of the section index). Card look = Figma Card + Card Header. */
export function Section({
  id,
  title,
  icon,
  count,
  actions,
  children,
}: {
  id: string;
  title: string;
  icon: IconName;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const domId = useSectionDomId()(id);
  return (
    // No accessible name on purpose: the window is the landmark; sections are reached by heading / section index
    // (named sections duplicated landmarks across windows — an axe finding).
    <section
      id={domId}
      className="flex min-w-0 scroll-mt-16 flex-col gap-12 rounded-md border border-line-subtle bg-surface p-16"
    >
      <header className="flex items-center gap-8 text-ink-secondary">
        <Icon name={icon} size={16} />
        <h2
          id={`${domId}-h`}
          className="type-title-md m-0 text-ink outline-none focus-visible:focus-ring"
          tabIndex={-1}
        >
          {title}
        </h2>
        {count !== undefined && <span className={countPill}>{count}</span>}
        {actions && <div className="ml-auto flex flex-wrap gap-8">{actions}</div>}
      </header>
      <div className="flex min-w-0 flex-col gap-12">{children}</div>
    </section>
  );
}

/** Summary line with an optional drill-down (opens another window, never a hidden tab). */
export function SummaryRow({
  icon,
  label,
  count,
  preview,
  onOpen,
  openLabel,
}: {
  icon: IconName;
  /** Usually text; a node for a stored time that may carry a data-quality warning. */
  label: ReactNode;
  count?: number;
  preview?: ReactNode;
  onOpen?: () => void;
  /** Accessible name of the drill-down, e.g. "Open laboratory viewer". */
  openLabel?: string;
}) {
  const inner = (
    <>
      <Icon name={icon} size={16} />
      <span className="min-w-field-label flex-none font-semibold text-ink cq-compact:min-w-0">
        {label}
      </span>
      {count !== undefined && <span className={countPill}>{count}</span>}
      <span className="min-w-0 flex-1 truncate">{preview}</span>
      {onOpen && <Icon name="chevronRight" size={16} />}
    </>
  );
  return (
    <li className="[&:not(:first-child)]:border-t [&:not(:first-child)]:border-line-subtle">
      {onOpen ? (
        <button
          type="button"
          className={`${row} cursor-pointer hover:bg-hover focus-visible:-outline-offset-2`}
          onClick={onOpen}
          title={openLabel}
        >
          {inner}
          {openLabel && <span className="sr-only">{` — ${openLabel}`}</span>}
        </button>
      ) : (
        <div className={row}>{inner}</div>
      )}
    </li>
  );
}

export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0" aria-label={label}>
      {children}
    </ul>
  );
}

/** Explicit absence — never shown as "normal" or "none". */
export function NotAvailable({ reason = 'source' }: { reason?: 'source' | 'recorded' }) {
  const { t } = useI18n();
  return <p className={muted}>{t(reason === 'source' ? 'emr.na.source' : 'common.notRecorded')}</p>;
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  /**
   * Keep the cell on one line (dates and times): a squeezed table scrolls sideways rather than breaking a date into four
   * lines. Numeric cells never wrap either, so a value stays with its unit ("4 ampoule", "11.2 g/dL").
   */
  nowrap?: boolean;
}

/** Plain semantic table in a focusable scroll region (keyboard: Tab into it, arrows scroll). */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
}) {
  return (
    <div
      className="overflow-auto rounded-md border border-line-subtle focus-visible:focus-ring"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must be keyboard reachable
      tabIndex={0}
      role="group"
      aria-label={caption}
    >
      <table className="type-body w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`${cell} type-caption-strong sticky top-0 border-b border-line-subtle bg-surface-subtle text-left whitespace-nowrap text-ink-muted`}
                data-numeric={c.numeric || undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className="[&:last-child>td]:border-b-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${cell} border-b border-line-subtle align-top text-ink${c.nowrap || c.numeric ? ' whitespace-nowrap' : ''}`}
                  data-numeric={c.numeric || undefined}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Loading / error / empty state of a whole window (every screen needs all three). */
export function StateView({
  kind,
  title,
  message,
  onRetry,
  children,
}: {
  kind: 'loading' | 'error' | 'empty';
  title?: string;
  message: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-12 px-24 py-32 text-center text-ink-muted [&_p]:m-0"
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? undefined : 'polite'}
    >
      {kind === 'loading' && (
        <div
          className="h-control-lg w-[min(var(--hms-size-search),100%)] rounded-md bg-hover"
          aria-hidden="true"
        />
      )}
      {title && <h2 className="type-title-md m-0 text-ink">{title}</h2>}
      <p>{message}</p>
      {onRetry && <Button onClick={onRetry}>{t('detail.retry')}</Button>}
      {children}
    </div>
  );
}

/**
 * Labelled block of free text exactly as stored (CPPT, reports). `text` may also be a node (e.g. `<StoredTime>`), which
 * then renders its own absent/invalid state.
 */
export function TextBlock({ label, text }: { label: string; text: ReactNode }) {
  const { t } = useI18n();
  const value =
    text === null || text === undefined || typeof text === 'string' ? (text ?? '').trim() : text;
  return (
    <div className="grid grid-cols-[var(--hms-size-field-label)_minmax(0,1fr)] gap-12 cq-compact:grid-cols-[minmax(0,1fr)] cq-compact:gap-2">
      <span className="text-[length:var(--hms-text-caption-size)] leading-[var(--hms-text-body-line)] text-ink-muted">
        {label}
      </span>
      <p
        className={
          value ? 'type-body m-0 [overflow-wrap:anywhere] whitespace-pre-line text-ink' : muted
        }
      >
        {value || t('common.notRecorded')}
      </p>
    </div>
  );
}
