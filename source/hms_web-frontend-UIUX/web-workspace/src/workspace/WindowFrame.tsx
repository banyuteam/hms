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
import type { Frame } from './frames';
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, type Rect } from './geometry';
import { useWindowStore, type WindowState } from './windowStore';
import styles from './WindowFrame.module.css';

type Mode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Mode[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const KEY_STEP = 16;
/** Pointer travel before a tiled window leaves its slot (T5). */
const DRAG_OUT_THRESHOLD = 6;

interface Props {
  win: WindowState;
  frame: Frame;
  title: string;
  icon: IconName;
  active: boolean;
  children: ReactNode;
}

/** Figma "Window Titlebar" (Focused | Unfocused) + window chrome. Pointer + keyboard operable. */
export function WindowFrame({ win, frame, title, icon, active, children }: Props) {
  const intl = useIntl();
  const hintId = useId();
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ mode: Mode; sx: number; sy: number; rect: Rect } | null>(null);
  const { activate, minimize, toggleMaximize, close, setRect, dragOut } = useWindowStore.getState();
  const { rect } = frame;

  // Move focus into a window when it becomes the active one (dock click, launcher, Alt+n).
  useEffect(() => {
    if (active && !frame.hidden && ref.current && !ref.current.contains(document.activeElement)) {
      ref.current.focus();
    }
  }, [active, frame.hidden]);

  const begin = (mode: Mode, e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || win.mode === 'maximized') return;
    if (mode !== 'move' && frame.locked) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, rect: { ...rect } };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const current = useWindowStore.getState().windows.find((w) => w.id === win.id);
    if (!current) return;
    let { x, y, w, h } = d.rect;
    if (d.mode === 'move') {
      if (current.mode === 'tiled') {
        // T5: a tiled window leaves its slot once the pointer really moves, keeping its current size.
        if (Math.hypot(dx, dy) < DRAG_OUT_THRESHOLD) return;
        dragOut(win.id, d.rect);
      }
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
    // Keyboard move/resize only for free-floating windows; tiles get their rectangle from the layout.
    if (e.target !== e.currentTarget || win.mode !== 'floating') return;
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
      setRect(win.id, {
        ...win.rect,
        w: win.rect.w + dx * KEY_STEP,
        h: win.rect.h + dy * KEY_STEP,
      });
    else
      setRect(win.id, {
        ...win.rect,
        x: win.rect.x + dx * KEY_STEP,
        y: win.rect.y + dy * KEY_STEP,
      });
  };

  const maximized = win.mode === 'maximized';
  return (
    <section
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      hidden={frame.hidden}
      data-active={active || undefined}
      data-maximized={maximized || undefined}
      data-tier={frame.tier}
      className={styles.window}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: frame.zIndex }}
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
          {intl.formatMessage({
            id: win.mode === 'floating' ? 'window.moveHint' : 'window.tileHint',
          })}
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
              { id: maximized ? 'window.restore' : 'window.maximize' },
              { title },
            )}
            onClick={() => toggleMaximize(win.id)}
          >
            <Icon name={maximized ? 'restore' : 'maximize'} size={16} />
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
      {!frame.locked &&
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
