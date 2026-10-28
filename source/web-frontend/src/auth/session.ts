import { queryClient } from '@/api/queryClient';
import { clearAudit } from '@/audit/audit';
import { useWindowStore } from '@/workspace/windowStore';
import { useAuthStore, type LogoutReason } from './authStore';

/**
 * Ends the session and wipes every in-memory store that could hold session state.
 * Includes the TanStack Query cache (PHI) and the in-memory audit stub (ADR-0003 D4).
 */
export function endSession(reason: LogoutReason): void {
  useWindowStore.getState().reset();
  queryClient.clear();
  clearAudit();
  useAuthStore.getState().clear(reason);
}
