import type { ReactNode } from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { formatStored, formatStoredDate, isoStored, readStored } from '@/locales/storedTime';
import { Icon } from './Icon';

export type InvalidKind = 'date' | 'amount' | 'number';

/** Raw source text is shown so the problem can be reported, but never more than this. */
const RAW_MAX = 40;

function shorten(raw: string): string {
  return raw.length > RAW_MAX ? `${raw.slice(0, RAW_MAX)}…` : raw;
}

/**
 * A value the source holds that is not valid for its type (e.g. `2026-02-31`). Data-quality warning: icon + text with
 * the raw value, never shown as "not recorded" or as a normal value. The client only checks the format; whether a value
 * is clinically plausible is not decided here.
 */
export function InvalidValue({ kind, raw }: { kind: InvalidKind; raw: string }) {
  const { t } = useI18n();
  return (
    <span className="type-caption-strong inline-flex items-center gap-4 rounded-sm bg-warning-bg px-6 text-warning-fg [font-variant-numeric:normal]">
      <Icon name="alert" size={16} />
      {t(`data.invalid.${kind}`, { raw: shorten(raw) })}
    </span>
  );
}

/**
 * A stored timestamp: formatted when valid, `absent` when nothing is recorded (default: "Not recorded", muted) and an
 * {@link InvalidValue} warning when the source value is not a real date/time.
 */
export function StoredTime({
  value,
  absent,
  dateOnly = false,
}: {
  value: string | null | undefined;
  absent?: ReactNode;
  dateOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const stored = readStored(value);
  if (stored.kind === 'absent') {
    return <>{absent ?? <span className="text-ink-muted">{t('common.notRecorded')}</span>}</>;
  }
  if (stored.kind === 'invalid') return <InvalidValue kind="date" raw={stored.raw} />;
  return (
    <time dateTime={isoStored(value)}>
      {dateOnly ? formatStoredDate(value, locale) : formatStored(value, locale)}
    </time>
  );
}

/**
 * Text-only variant for places that need a string (window titles, message values, list labels): an invalid value
 * becomes the same warning text, without the styling. Absent returns `absent` (default null) so callers keep their
 * own fallback.
 */
export function useStoredText() {
  const { t, locale } = useI18n();
  return (
    value: string | null | undefined,
    absent: string | null = null,
    dateOnly = false,
  ): string | null => {
    const stored = readStored(value);
    if (stored.kind === 'absent') return absent;
    if (stored.kind === 'invalid') return t('data.invalid.date', { raw: shorten(stored.raw) });
    return dateOnly ? formatStoredDate(value, locale) : formatStored(value, locale);
  };
}
