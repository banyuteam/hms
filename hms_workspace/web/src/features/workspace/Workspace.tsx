import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { isLiveApi, setUnauthorizedHandler } from '@/api/liveApi';
import { fetchSession } from '@/auth/authApi';
import { idleMinutes, useIdleLogout } from '@/auth/useIdleLogout';
import { AssistantPanel } from '@/features/assistant/AssistantPanel';
import { Home } from '@/features/home/Home';
import { useI18n } from '@/locales/I18nProvider';
import { useHome, useHomeActions } from '@/state/home';
import { useEndSession } from '@/state/session';
import { Dock } from './Dock';
import { IdleWarning } from './IdleWarning';
import { WindowGuardProvider } from './windowGuard';
import { computeFrames } from './frames';
import { ModuleMenu } from './ModuleMenu';
import { TopBar } from './TopBar';
import { WindowBody } from './WindowBody';
import { WindowFrame } from './WindowFrame';
import { HOME_CARDS, windowIcon, windowTitle } from './windowMeta';

const emptySlotButton =
  'type-body-strong inline-flex h-control cursor-pointer items-center gap-8 rounded-md border border-line-selected bg-surface px-16 text-ink-link focus-visible:focus-ring';

/** Workspace shell: top bar · wallpaper work area with floating/tiled windows · AI assistant panel · bottom dock. */
export function Workspace() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const areaRef = useRef<HTMLElement>(null);
  const { windows, activeId, layout, area } = useHome();
  const { setArea, open } = useHomeActions();
  const endSession = useEndSession();

  // DEV live API: the server rejected the token (expired or revoked) -> end the session like an idle lock.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      endSession('expired');
      navigate('/login', { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [endSession, navigate]);

  const onIdle = useCallback(() => {
    endSession('idle');
    navigate('/login', { replace: true });
  }, [endSession, navigate]);
  const idle = useIdleLogout(idleMinutes(), onIdle);
  const { stay } = idle;
  // "Stay signed in" also asks the server, which keeps its own idle limit: an answer of "no session" ends it here too.
  const onStay = useCallback(() => {
    stay();
    if (!isLiveApi()) return;
    void fetchSession().then((s) => {
      if (s !== null) return;
      endSession('expired');
      navigate('/login', { replace: true });
    });
  }, [stay, endSession, navigate]);
  const onSignOutNow = useCallback(() => {
    endSession('user');
    navigate('/login', { replace: true });
  }, [endSession, navigate]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return undefined;
    const apply = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setArea]);

  // Alt+1…4 opens the Home task windows. Uses e.code: Alt+digit produces other characters on macOS.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const card = HOME_CARDS.find((c) => e.code === `Digit${c.shortcut}`);
      if (card) {
        e.preventDefault();
        open(card.kind);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const { frames, compact, emptySlots, slots } = useMemo(
    () => computeFrames(windows, layout, area, activeId),
    [windows, layout, area, activeId],
  );

  return (
    <WindowGuardProvider>
      <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[var(--hms-size-topbar)_minmax(0,1fr)_var(--hms-size-dock)] bg-canvas">
        <a
          href="#main-content"
          className="absolute -top-[100px] left-8 z-skip rounded-md bg-surface px-12 py-8 text-ink-link focus:top-8"
        >
          {t('a11y.skipToContent')}
        </a>
        <TopBar />
        <div className="relative flex min-h-0 min-w-0">
          <main
            id="main-content"
            className="relative min-w-0 flex-1 overflow-hidden bg-wallpaper outline-none before:pointer-events-none before:absolute before:inset-0 before:bg-canvas before:opacity-[var(--hms-wallpaper-scrim)]"
            ref={areaRef}
            tabIndex={-1}
          >
            <div className="absolute inset-0 overflow-auto">
              <Home />
            </div>
            {compact && (
              <p
                className="type-caption-strong absolute left-1/2 top-4 z-overlay m-0 max-w-[calc(100%-var(--hms-space-48))] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-warning-bg px-16 py-4 text-warning-fg"
                role="status"
              >
                {t('layout.compact')}
              </p>
            )}
            <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto">
              {emptySlots.map((i) => {
                const r = slots[i];
                return r ? (
                  <div
                    key={`slot-${i}`}
                    className="absolute z-[5] flex flex-col items-center justify-center gap-8 rounded-lg border border-dashed border-line bg-surface-subtle"
                    style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                    data-slot={i + 1}
                  >
                    <ModuleMenu
                      icon="plus"
                      label={t('layout.emptySlot')}
                      text={t('layout.emptySlot')}
                      className={emptySlotButton}
                      placement="bottom-start"
                    />
                    <span className="text-[length:var(--hms-text-caption-size)] text-ink-muted">
                      {t('layout.emptySlotHint', { n: i + 1 })}
                    </span>
                  </div>
                ) : null;
              })}
              {windows.map((w) => {
                const frame = frames.get(w.id);
                if (!frame) return null;
                return (
                  <WindowFrame
                    key={w.id}
                    win={w}
                    frame={frame}
                    active={activeId === w.id}
                    icon={windowIcon(w.kind)}
                    title={windowTitle(t, w)}
                  >
                    <WindowBody win={w} />
                  </WindowFrame>
                );
              })}
            </div>
          </main>
          <AssistantPanel />
        </div>
        <Dock />
        {idle.warning && (
          <IdleWarning secondsLeft={idle.secondsLeft} onStay={onStay} onSignOut={onSignOutNow} />
        )}
      </div>
    </WindowGuardProvider>
  );
}
