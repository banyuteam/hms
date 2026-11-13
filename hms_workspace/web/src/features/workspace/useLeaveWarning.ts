import { useEffect } from 'react';

/**
 * While records are open, reloading or closing the tab asks first (the browser's own "Leave site?" dialog). Windows live
 * in memory only — nothing is stored in the browser — so an accidental F5 would otherwise drop every open window, and
 * in the demo the session too. The browser shows its own fixed text; a page cannot word it.
 */
export function useLeaveWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older Chromium needs returnValue set as well.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}
