import { useEffect, useMemo, useRef } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router';
import { endSession } from '@/auth/session';
import { idleMinutes, useIdleLogout } from '@/auth/useIdleLogout';
import { Dock } from './Dock';
import { computeFrames } from './frames';
import { Home } from './Home';
import { ModuleMenu } from './ModuleMenu';
import { MODULES, type WindowType } from './registry';
import { TopBar } from './TopBar';
import { WindowFrame } from './WindowFrame';
import { windowIcon, windowTitle } from './windowMeta';
import { useWindowStore, type WindowState } from './windowStore';
import { PatientDetailWindow } from './windows/patient-detail/PatientDetailWindow';
import { PatientManagementWindow } from './windows/PatientManagementWindow';
import { PlaceholderWindow } from './windows/PlaceholderWindow';
import styles from './Workspace.module.css';

function WindowBody({ win }: { win: WindowState }) {
  switch (win.kind) {
    case 'patients':
      return <PatientManagementWindow />;
    case 'patient-detail':
      return <PatientDetailWindow mrn={win.params.mrn ?? ''} />;
    default:
      return <PlaceholderWindow />;
  }
}

/** Figma workspace shell: top bar · wallpaper work area with floating/tiled windows · bottom dock. */
export function Workspace() {
  const intl = useIntl();
  const navigate = useNavigate();
  const areaRef = useRef<HTMLDivElement>(null);
  const windows = useWindowStore((s) => s.windows);
  const activeId = useWindowStore((s) => s.activeId);
  const layout = useWindowStore((s) => s.layout);
  const area = useWindowStore((s) => s.area);
  const setArea = useWindowStore((s) => s.setArea);
  const open = useWindowStore((s) => s.open);

  useIdleLogout(idleMinutes(), () => {
    endSession('idle');
    navigate('/login', { replace: true });
  });

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return undefined;
    const apply = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setArea]);

  // Alt+1…4 opens modules (tile hints). Uses e.code: Alt+digit produces other characters on macOS.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const m = MODULES.find((mod) => mod.window && e.code === `Digit${mod.shortcut}`);
      if (m) {
        e.preventDefault();
        open(m.key as WindowType);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const { frames, compact, emptySlots, slots } = useMemo(
    () => computeFrames(windows, layout, area),
    [windows, layout, area],
  );

  return (
    <div className={styles.shell}>
      <a href="#main-content" className="skip-link">
        {intl.formatMessage({ id: 'a11y.skipToContent' })}
      </a>
      <TopBar />
      <main id="main-content" className={styles.area} ref={areaRef} tabIndex={-1}>
        <div className={styles.homeLayer}>
          <Home />
        </div>
        {compact && (
          <p className={styles.compactNote} role="status">
            {intl.formatMessage({ id: 'layout.compact' })}
          </p>
        )}
        <div className={styles.windows}>
          {emptySlots.map((i) => {
            const r = slots[i];
            return r ? (
              <div
                key={`slot-${i}`}
                className={styles.emptySlot}
                style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                data-slot={i + 1}
              >
                <ModuleMenu
                  icon="plus"
                  label={intl.formatMessage({ id: 'layout.emptySlot' })}
                  text={intl.formatMessage({ id: 'layout.emptySlot' })}
                  className={styles.emptySlotButton}
                />
                <span className={styles.emptySlotHint}>
                  {intl.formatMessage({ id: 'layout.emptySlotHint' }, { n: i + 1 })}
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
                title={windowTitle(intl, w)}
              >
                <WindowBody win={w} />
              </WindowFrame>
            );
          })}
        </div>
      </main>
      <Dock />
    </div>
  );
}
