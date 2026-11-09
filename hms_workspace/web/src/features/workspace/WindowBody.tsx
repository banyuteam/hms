import { DiagnosticsWindow } from '@/features/emr/windows/DiagnosticsWindow';
import { EncounterWindow } from '@/features/emr/windows/EncounterWindow';
import { ProfileWindow } from '@/features/emr/windows/ProfileWindow';
import { RecordsWindow } from '@/features/emr/windows/RecordsWindow';
import { ViewerWindow } from '@/features/emr/windows/ViewerWindow';
import { AccessWindow } from '@/features/iam/AccessWindow';
import { TariffWindow } from '@/features/tariffs/TariffWindow';
import type { WindowState } from '@/state/home';

/** Content of one window. `key={win.id}` resets local state when a window is pointed at another record. */
export function WindowBody({ win }: { win: WindowState }) {
  const { mrn, norawat, item } = win.params;
  switch (win.kind) {
    case 'emr-profile':
      return <ProfileWindow key={win.id} winId={win.id} mrn={mrn} />;
    case 'emr-records':
      return <RecordsWindow key={win.id} winId={win.id} norawat={norawat} />;
    case 'emr-encounter':
      return <EncounterWindow key={win.id} winId={win.id} norawat={norawat} />;
    case 'emr-diagnostics':
      return <DiagnosticsWindow key={win.id} winId={win.id} norawat={norawat} />;
    case 'lab':
    case 'radiology':
    case 'billing':
    case 'prescription':
      return (
        <ViewerWindow key={win.id} winId={win.id} kind={win.kind} norawat={norawat} item={item} />
      );
    case 'iam-admin':
      return <AccessWindow key={win.id} winId={win.id} />;
    case 'tariffs':
      return <TariffWindow key={win.id} winId={win.id} />;
  }
}
