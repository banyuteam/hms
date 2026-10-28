import { useWindowStore } from '@/workspace/windowStore';
import { useAuthStore, type LogoutReason } from './authStore';

/**
 * Ends the session and wipes every in-memory store that could hold session state.
 * When TanStack Query is added, call `queryClient.clear()` here too (ADR-0003 D4).
 */
export function endSession(reason: LogoutReason): void {
  useWindowStore.getState().reset();
  useAuthStore.getState().clear(reason);
}
