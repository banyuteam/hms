import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/Button';
import { useModalKeys } from '@/components/useModalKeys';
import { Icon } from '@/components/Icon';
import { useI18n } from '@/locales/I18nProvider';
import { useHome, useHomeActions, type WindowState } from '@/state/home';
import { windowTitle } from './windowMeta';

/** How long "Reopen" stays offered after a window is closed. */
export const REOPEN_MS = 10_000;

interface Guard {
  setDirty: (id: string, dirty: boolean) => void;
  requestClose: (id: string) => void;
}

const GuardContext = createContext<Guard | null>(null);
const WindowIdContext = createContext<string | null>(null);

/** Tells the window's content which window it is in (set by `WindowBody`). */
export function WindowIdProvider({ id, children }: { id: string; children: ReactNode }) {
  return <WindowIdContext.Provider value={id}>{children}</WindowIdContext.Provider>;
}

/**
 * A window's content reports unsaved changes: closing that window then asks first. Cleared when the content unmounts
 * (its edits are gone by then anyway).
 */
export function useReportUnsaved(dirty: boolean): void {
  const id = useContext(WindowIdContext);
  const guard = useContext(GuardContext);
  useEffect(() => {
    if (!id || !guard) return undefined;
    guard.setDirty(id, dirty);
    return () => guard.setDirty(id, false);
  }, [id, guard, dirty]);
}

/** What the close buttons call: asks first when the window has unsaved changes, and offers "Reopen" afterwards. */
export function useCloseWindow(): (id: string) => void {
  const guard = useContext(GuardContext);
  const { close } = useHomeActions();
  return guard?.requestClose ?? close;
}

/**
 * Guards closing windows (dock tab ×, window ×): a window with unsaved changes asks before it is closed (the safe choice
 * has focus), and every close can be undone for a few seconds ("Reopen" opens the same record again; what was typed is
 * not kept, which is why unsaved changes are asked about first).
 */
export function WindowGuardProvider({ children }: { children: ReactNode }) {
  const { windows } = useHome();
  const { close, open } = useHomeActions();
  const dirty = useRef(new Set<string>());
  const [pending, setPending] = useState<WindowState | null>(null);
  const [closed, setClosed] = useState<WindowState | null>(null);
  const windowsRef = useRef(windows);
  windowsRef.current = windows;

  const doClose = useCallback(
    (win: WindowState) => {
      dirty.current.delete(win.id);
      close(win.id);
      setClosed(win);
    },
    [close],
  );

  const guard = useMemo<Guard>(
    () => ({
      setDirty: (id, isDirty) => {
        if (isDirty) dirty.current.add(id);
        else dirty.current.delete(id);
      },
      requestClose: (id) => {
        const win = windowsRef.current.find((w) => w.id === id);
        if (!win) return;
        if (dirty.current.has(id)) setPending(win);
        else doClose(win);
      },
    }),
    [doClose],
  );

  useEffect(() => {
    if (!closed) return undefined;
    const timer = setTimeout(() => setClosed(null), REOPEN_MS);
    return () => clearTimeout(timer);
  }, [closed]);

  return (
    <GuardContext.Provider value={guard}>
      {children}
      {pending && (
        <ConfirmClose
          win={pending}
          onKeep={() => setPending(null)}
          onDiscard={() => {
            setPending(null);
            doClose(pending);
          }}
        />
      )}
      {closed && !pending && (
        <ReopenNotice
          win={closed}
          onReopen={() => {
            open(closed.kind, closed.params);
            setClosed(null);
          }}
          onDismiss={() => setClosed(null)}
        />
      )}
    </GuardContext.Provider>
  );
}

function ConfirmClose({
  win,
  onKeep,
  onDiscard,
}: {
  win: WindowState;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  const title = windowTitle(t, win);
  const titleId = useId();
  const descId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Escape is the safe choice: keep the window and its changes.
  useModalKeys(panelRef, onKeep);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    keepRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="fixed inset-0 z-scrim grid place-items-center px-16 before:absolute before:inset-0 before:bg-canvas before:opacity-[var(--hms-focus-scrim)]">
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative flex w-[min(440px,100%)] flex-col gap-16 rounded-lg border border-line bg-surface p-24 shadow-popover"
      >
        <h2 id={titleId} className="type-title-md m-0 flex items-center gap-8 text-ink">
          <Icon name="alert" size={20} />
          {t('closeGuard.title', { title })}
        </h2>
        <p id={descId} className="type-body m-0 text-ink-secondary">
          {t('closeGuard.message')}
        </p>
        <div className="flex flex-wrap justify-end gap-8">
          <Button variant="secondary" onClick={onDiscard}>
            {t('closeGuard.discard')}
          </Button>
          <Button ref={keepRef} variant="primary" onClick={onKeep}>
            {t('closeGuard.keep')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReopenNotice({
  win,
  onReopen,
  onDismiss,
}: {
  win: WindowState;
  onReopen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      className="type-body fixed bottom-[calc(var(--hms-size-dock)+var(--hms-space-16))] left-1/2 z-toast flex max-w-[calc(100%-var(--hms-space-32))] -translate-x-1/2 items-center gap-12 rounded-lg border border-line bg-surface py-8 pl-16 pr-8 text-ink shadow-popover"
    >
      <span className="min-w-0 truncate">
        {t('closeGuard.closed', { title: windowTitle(t, win) })}
      </span>
      <Button variant="ghost" onClick={onReopen}>
        {t('closeGuard.reopen')}
      </Button>
      <button
        type="button"
        className="grid size-icon-lg flex-none cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-ink-muted hover:bg-hover hover:text-ink focus-visible:focus-ring"
        aria-label={t('closeGuard.dismiss')}
        onClick={onDismiss}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
