/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
   The title bar is a custom move/resize handle: it is focusable and keyboard-operable (arrows / Shift+arrows,
   described by aria-describedby) and its parent window is role="dialog". */
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useIntl } from 'react-intl';
import { Icon, type IconName } from '@/components/Icon';
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from './geometry';
import { useWindowStore, type WindowState } from './windowStore';
import styles from './WindowFrame.module.css';

type Mode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Mode[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const KEY_STEP = 16;

interface Props {
  win: WindowState;
  title: string;
  icon: IconName;
  active: boolean;
  children: ReactNode;
}

/** Figma "Window Titlebar" (Focused | Unfocused) + window chrome. Pointer + keyboard operable. */
export function WindowFrame({ win, title, icon, active, children }: Props) {
  const intl = useIntl();
  const hintId = useId();
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{
    mode: Mode;
    sx: number;
    sy: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const { activate, minimize, toggleMaximize, close, setRect } = useWindowStore.getState();

  // Move focus into a window when it becomes the active one (dock click, launcher, Alt+n).
  useEffect(() => {
    if (active && ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
  }, [active]);

  const begin = (mode: Mode, e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || win.maximized) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    let { x, y, w, h } = d;
    if (d.mode === 'move') {
      x += dx;
      y += dy;
    } else {
      if (d.mode.includes('e')) w += dx;
      if (d.mode.includes('s')) h += dy;
      if (d.mode.includes('w')) {
        w -= dx;
        x += dx;
      }
      if (d.mode.includes('n')) {
        h -= dy;
        y += dy;
      }
      if (w < MIN_WINDOW_WIDTH) {
        if (d.mode.includes('w')) x -= MIN_WINDOW_WIDTH - w;
        w = MIN_WINDOW_WIDTH;
      }
      if (h < MIN_WINDOW_HEIGHT) {
        if (d.mode.includes('n')) y -= MIN_WINDOW_HEIGHT - h;
        h = MIN_WINDOW_HEIGHT;
      }
    }
    setRect(win.id, { x, y, w, h });
  };
  const end = () => {
    drag.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || win.maximized) return;
    const dir: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const v = dir[e.key];
    if (!v) return;
    e.preventDefault();
    const [dx, dy] = v;
    if (e.shiftKey)
      setRect(win.id, { x: win.x, y: win.y, w: win.w + dx * KEY_STEP, h: win.h + dy * KEY_STEP });
    else
      setRect(win.id, { x: win.x + dx * KEY_STEP, y: win.y + dy * KEY_STEP, w: win.w, h: win.h });
  };

  return (
    <section
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      hidden={win.minimized}
      data-active={active || undefined}
      data-maximized={win.maximized || undefined}
      className={styles.window}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onPointerDownCapture={() => {
        if (!active) activate(win.id);
      }}
    >
      <div
        className={styles.titlebar}
        tabIndex={0}
        role="group"
        aria-label={title}
        aria-describedby={hintId}
        onPointerDown={(e) => begin('move', e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => toggleMaximize(win.id)}
        onKeyDown={onKeyDown}
      >
        <span className={styles.chip}>
          <Icon name={icon} size={16} />
        </span>
        <h2 className={styles.title}>{title}</h2>
        <span id={hintId} className="visually-hidden">
          {intl.formatMessage({ id: 'window.moveHint' })}
        </span>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.control}
            aria-label={intl.formatMessage({ id: 'window.minimize' }, { title })}
            onClick={() => minimize(win.id)}
          >
            <Icon name="minus" size={16} />
          </button>
          <button
            type="button"
            className={styles.control}
            aria-label={intl.formatMessage(
              { id: win.maximized ? 'window.restore' : 'window.maximize' },
              { title },
            )}
            onClick={() => toggleMaximize(win.id)}
          >
            <Icon name={win.maximized ? 'restore' : 'maximize'} size={16} />
          </button>
          <button
            type="button"
            className={styles.control}
            aria-label={intl.formatMessage({ id: 'window.close' }, { title })}
            onClick={() => close(win.id)}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>
      <div className={styles.body}>{children}</div>
      {!win.maximized &&
        HANDLES.map((h) => (
          <div
            key={h}
            className={`${styles.handle} ${styles[`h_${h}`]}`}
            onPointerDown={(e) => begin(h, e)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            aria-hidden="true"
          />
        ))}
    </section>
  );
}
