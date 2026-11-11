import { useEffect, type RefObject } from 'react';

/**
 * Keyboard of a small modal dialog: Escape calls `onEscape`; Tab and Shift+Tab wrap around the dialog's buttons so focus
 * never leaves it. Listens on the document while the dialog is mounted.
 */
export function useModalKeys(panel: RefObject<HTMLElement | null>, onEscape: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const buttons = Array.from(panel.current?.querySelectorAll('button') ?? []);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel, onEscape]);
}
