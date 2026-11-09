import { INTL_TAG as TAG, type Locale } from './index';

/**
 * Formats a timestamp exactly as stored (hospital local time, no offset — API convention) without
 * converting time zones: the parts are read from the string and rendered with timeZone UTC.
 * Accepts `YYYY-MM-DDTHH:MM:SS`, `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD`. Returns null for `undated`/garbage and for
 * values that are not real calendar dates/times — including the legacy "no date" `0000-00-00`, which `Date.UTC` would
 * otherwise roll over to 30 Nov 1899 and show as if something had happened then.
 */

export function parseStored(
  value: string | null | undefined,
): { date: Date; hasTime: boolean } | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (!m) return null;
  const part = (i: number) => Number(m[i] ?? 0);
  const year = part(1);
  const month = part(2);
  const day = part(3);
  const hour = part(4);
  const minute = part(5);
  const second = part(6);
  // Years 0–99 are mapped to 1900–1999 by Date.UTC; no stored clinical or billing date is that old.
  if (year < 1000) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Out-of-range parts (month 00, 31 Feb, 25:00) roll over silently; only an exact round trip is a real value.
  const real =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return real ? { date, hasTime: m[4] !== undefined } : null;
}

export function formatStoredDate(value: string | null | undefined, locale: Locale): string | null {
  const p = parseStored(value);
  if (!p) return null;
  return new Intl.DateTimeFormat(TAG[locale], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(p.date);
}

export function formatStored(value: string | null | undefined, locale: Locale): string | null {
  const p = parseStored(value);
  if (!p) return null;
  const date = formatStoredDate(value, locale);
  if (!p.hasTime) return date;
  const hh = String(p.date.getUTCHours()).padStart(2, '0');
  const mm = String(p.date.getUTCMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

export type StoredValue =
  | { kind: 'absent' }
  | { kind: 'valid'; date: Date; hasTime: boolean }
  | { kind: 'invalid'; raw: string };

/** The legacy "no date" (`0000-00-00`, with or without a time) and the journey's `undated` key mean "not recorded". */
const ABSENT_DATE = /^0000-00-00(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;
/** A time without its date (date column empty): the date was not recorded. */
const TIME_ONLY = /^\d{2}:\d{2}(?::\d{2})?$/;

/**
 * Classifies a stored timestamp: `absent` (nothing recorded), `valid`, or `invalid` — the source holds a value that is
 * not a real date/time. Invalid is a data-quality problem and must be shown as such, never as absent or as a date.
 */
export function readStored(value: string | null | undefined): StoredValue {
  const v = (value ?? '').trim();
  if (v === '' || v === 'undated' || ABSENT_DATE.test(v) || TIME_ONLY.test(v)) {
    return { kind: 'absent' };
  }
  const p = parseStored(v);
  return p ? { kind: 'valid', ...p } : { kind: 'invalid', raw: v };
}

/** Machine-readable value for <time dateTime>. */
export function isoStored(value: string | null | undefined): string | undefined {
  const p = parseStored(value);
  if (!p) return undefined;
  return p.hasTime ? p.date.toISOString().slice(0, 19) : p.date.toISOString().slice(0, 10);
}
