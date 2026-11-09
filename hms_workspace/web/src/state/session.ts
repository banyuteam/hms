import { useCallback } from 'react';
import { isLiveApi } from '@/api/liveApi';
import { clearAudit } from '@/audit/audit';
import { signOut } from '@/auth/authApi';
import { resourceCache } from '@/lib/resource';
import { useAssistantActions } from './assistant';
import { useAuthActions, type LogoutReason } from './auth';
import { useHomeActions } from './home';

/**
 * Ends the session and wipes every in-memory store that could hold session state: windows, assistant chat, the data cache
 * (PHI) and the in-memory audit stub. Used by sign-out, idle lock and a 401 from hms_services.
 * With live data the server session is ended too, except after a 401: the server has already ended it.
 */
export function useEndSession(): (reason: LogoutReason) => void {
  const home = useHomeActions();
  const assistant = useAssistantActions();
  const auth = useAuthActions();
  return useCallback(
    (reason) => {
      if (isLiveApi() && reason !== 'expired') void signOut();
      home.reset();
      assistant.reset();
      resourceCache.clear();
      clearAudit();
      auth.clear(reason);
    },
    [home, assistant, auth],
  );
}
