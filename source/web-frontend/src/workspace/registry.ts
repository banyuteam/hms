import type { WindowKind } from './windowStore';

/** Module windows (one instance each). `patient-detail` is opened from a patient, not from a module tile. */
export type WindowType = Exclude<WindowKind, 'patient-detail'>;
export type ModuleKey = WindowType | 'records' | 'claims';

export interface ModuleDef {
  key: ModuleKey;
  /** i18n id prefix: `module.<key>.title|desc` */
  window: boolean;
  icon: 'users' | 'flask' | 'image' | 'receipt' | 'file' | 'clipboard';
  /** Alt+<n> opens the module (tile hint in Figma; browser conflicts tracked in OQ-19). */
  shortcut?: number;
}

/** Tiles on Beranda, in Figma order. `records`/`claims` are "Segera" (not openable yet). */
export const MODULES: readonly ModuleDef[] = [
  { key: 'patients', window: true, icon: 'users', shortcut: 1 },
  { key: 'lab', window: true, icon: 'flask', shortcut: 2 },
  { key: 'radiology', window: true, icon: 'image', shortcut: 3 },
  { key: 'billing', window: true, icon: 'receipt', shortcut: 4 },
  { key: 'records', window: false, icon: 'file' },
  { key: 'claims', window: false, icon: 'clipboard' },
];

export function isWindowType(key: string): key is WindowType {
  return MODULES.some((m) => m.window && m.key === key);
}
