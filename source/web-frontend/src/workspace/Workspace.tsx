import { useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import { endSession } from '@/auth/session';
import { idleMinutes, useIdleLogout } from '@/auth/useIdleLogout';
import { Dock } from './Dock';
import { Home } from './Home';
import { MODULES, type WindowType } from './registry';
import { TopBar } from './TopBar';
import { WindowFrame } from './WindowFrame';
import { useWindowStore } from './windowStore';
import { PatientManagementWindow } from './windows/PatientManagementWindow';
import { PlaceholderWindow } from './windows/PlaceholderWindow';
import styles from './Workspace.module.css';
import { useNavigate } from 'react-router';

function WindowBody({ type }: { type: WindowType }) {
  return type === 'patients' ? <PatientManagementWindow /> : <PlaceholderWindow />;
}

/** Figma workspace shell: top bar · wallpaper work area with floating windows · bottom dock. */
export function Workspace() {
  const intl = useIntl();
  const navigate = useNavigate();
  const areaRef = useRef<HTMLDivElement>(null);
  const { windows, activeId, setArea, open } = useWindowStore();

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
        <div className={styles.windows}>
          {windows.map((w) => (
            <WindowFrame
              key={w.id}
              win={w}
              active={activeId === w.id}
              icon={MODULES.find((m) => m.key === w.type)?.icon ?? 'file'}
              title={intl.formatMessage({ id: `module.${w.type}.title` })}
            >
              <WindowBody type={w.type} />
            </WindowFrame>
          ))}
        </div>
      </main>
      <Dock />
    </div>
  );
}
