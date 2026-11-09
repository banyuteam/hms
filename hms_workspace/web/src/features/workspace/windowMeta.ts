import type { IconName } from '@/components/Icon';
import type { Translate } from '@/locales/I18nProvider';
import type { WindowKind, WindowState } from '@/state/home';

/**
 * Registry of window kinds: title key, icon (design-tokens "Icons" table: one feature = one icon everywhere) and which kinds are
 * on Home. The task windows W1–W4 open from Home (Alt+1…4); viewers open from a record (lab test, image, prescription, bill).
 */
export const WINDOW_META: Record<WindowKind, { titleKey: string; icon: IconName }> = {
  'emr-profile': { titleKey: 'emr.w1.title', icon: 'user' },
  'emr-records': { titleKey: 'emr.w2.title', icon: 'route' },
  'emr-encounter': { titleKey: 'emr.w3.title', icon: 'stethoscope' },
  'emr-diagnostics': { titleKey: 'emr.w4.title', icon: 'flask' },
  lab: { titleKey: 'emr.viewer.lab.title', icon: 'flask' },
  radiology: { titleKey: 'emr.viewer.radiology.title', icon: 'image' },
  billing: { titleKey: 'emr.viewer.billing.title', icon: 'receipt' },
  prescription: { titleKey: 'emr.viewer.prescription.title', icon: 'pill' },
  'iam-admin': { titleKey: 'iam.title', icon: 'shield' },
  tariffs: { titleKey: 'tariff.title', icon: 'book' },
};

/** The four task windows on Home, in Alt+1…4 order. Viewers are not on Home. */
export const HOME_CARDS: readonly { kind: WindowKind; key: string; shortcut: number }[] = [
  { kind: 'emr-profile', key: 'w1', shortcut: 1 },
  { kind: 'emr-records', key: 'w2', shortcut: 2 },
  { kind: 'emr-encounter', key: 'w3', shortcut: 3 },
  { kind: 'emr-diagnostics', key: 'w4', shortcut: 4 },
];

/** The identifier a window shows (patient-safety rule: the record is always visible in the title bar and dock). */
function identifier(w: Pick<WindowState, 'kind' | 'params'>): string | undefined {
  return w.kind === 'emr-profile' ? w.params.mrn : w.params.norawat;
}

/** Title bar text: window name + the identifier it shows. */
export function windowTitle(t: Translate, w: Pick<WindowState, 'kind' | 'params'>): string {
  const name = t(WINDOW_META[w.kind].titleKey);
  const id = identifier(w);
  return id ? `${name} · ${id}` : name;
}

/**
 * Short dock label, in two parts: the dock may shorten `name`, but never `id` — the end of an encounter number is what tells
 * two visits apart (patient-safety rule).
 */
export function dockLabel(
  t: Translate,
  w: Pick<WindowState, 'kind' | 'params'>,
): { name: string; id: string | undefined } {
  return { name: t(`${WINDOW_META[w.kind].titleKey}.dock`), id: identifier(w) };
}

export function windowIcon(kind: WindowKind): IconName {
  return WINDOW_META[kind].icon;
}
