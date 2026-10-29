import type { Locale } from './locales';

/**
 * "Neutral English with Indonesian conventions" (OQ-35): dates 27 Okt 2026 / 27 Oct 2026,
 * 24-hour time, zone Asia/Jakarta. `en-GB` gives the day-month-year order and 24 h clock.
 */
const INTL_TAG: Record<Locale, string> = { id: 'id-ID', en: 'en-GB' };
export const DISPLAY_TIME_ZONE = 'Asia/Jakarta';

export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export function formatLongDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

/** Always `HH:mm` with a colon (id-ID would otherwise print `10.24`; the Figma design uses `10:24`). */
export function formatTime(date: Date, locale: Locale): string {
  const parts = new Intl.DateTimeFormat(INTL_TAG[locale], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: DISPLAY_TIME_ZONE,
  }).formatToParts(date);
  const get = (t: 'hour' | 'minute') => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** Part of day in Asia/Jakarta, for the greeting. */
export function dayPart(date: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: DISPLAY_TIME_ZONE,
    }).format(date),
  );
  if (hour >= 4 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 15) return 'afternoon';
  if (hour >= 15 && hour < 18) return 'evening';
  return 'night';
}

/** `27 Oct 2026 08:30` — date and 24 h time in Asia/Jakarta. */
export function formatDateTime(date: Date, locale: Locale): string {
  return `${formatDate(date, locale)} ${formatTime(date, locale)}`;
}
