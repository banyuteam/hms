import enCommon from './en/common.json';
import enEmr from './en/emr.json';
import idCommon from './id/common.json';
import idEmr from './id/emr.json';

export const LOCALES = ['id', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Indonesian is the default and the fallback for a missing translation (CLAUDE.md §8). */
export const DEFAULT_LOCALE: Locale = 'id';

/** BCP 47 tags: `en-GB` gives day-month-year and a 24 h clock ("neutral English with Indonesian conventions"). */
export const INTL_TAG: Record<Locale, string> = { id: 'id-ID', en: 'en-GB' };

export type Catalog = Readonly<Record<string, string>>;

/** One flat catalog per locale: `common` (shell, login, shared components) + `emr` (patient windows, assistant). */
export const MESSAGES: Record<Locale, Catalog> = {
  id: { ...idCommon, ...idEmr },
  en: { ...enCommon, ...enEmr },
};
