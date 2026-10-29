import { QueryClient } from '@tanstack/react-query';

/**
 * PHI rules (ADR-0003 D4): short gcTime, no persistence of any kind, cleared on logout and idle lock (`endSession`).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { gcTime: 5 * 60_000, staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
  },
});
