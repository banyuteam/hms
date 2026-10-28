import type { IntlShape } from 'react-intl';
import type { IconName } from '@/components/Icon';
import { MODULES } from './registry';
import type { WindowState } from './windowStore';

/** Title bar text. Patient windows carry the MRN (Figma: "Patient Detail - 00012346") — patient safety rule. */
export function windowTitle(intl: IntlShape, w: Pick<WindowState, 'kind' | 'params'>): string {
  return w.kind === 'patient-detail'
    ? intl.formatMessage({ id: 'window.patientDetail.title' }, { mrn: w.params.mrn ?? '' })
    : intl.formatMessage({ id: `module.${w.kind}.title` });
}

/** Short dock label (Figma dock tab: "Detail 00012346"). */
export function dockLabel(intl: IntlShape, w: Pick<WindowState, 'kind' | 'params'>): string {
  return w.kind === 'patient-detail'
    ? intl.formatMessage({ id: 'window.patientDetail.dock' }, { mrn: w.params.mrn ?? '' })
    : windowTitle(intl, w);
}

export function windowIcon(kind: WindowState['kind']): IconName {
  if (kind === 'patient-detail') return 'user';
  return MODULES.find((m) => m.key === kind)?.icon ?? 'file';
}
