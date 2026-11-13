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
import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/I18nProvider';
import { useHomeActions, type WindowState } from '@/state/home';
import type { Frame } from './frames';
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, type Rect } from './geometry';
import { useCloseWindow } from './windowGuard';

type Mode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Array<Exclude<Mode, 'move'>> = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const KEY_STEP = 16;

const handleBase = 'absolute z-2 touch-none';
const handleStyles: Record<Exclude<Mode, 'move'>, string> = {
  n: 'inset-x-8 -top-[3px] h-6 cursor-ns-resize',
  s: 'inset-x-8 -bottom-[3px] h-6 cursor-ns-resize',
  e: 'inset-y-8 -right-[3px] w-6 cursor-ew-resize',
  w: 'inset-y-8 -left-[3px] w-6 cursor-ew-resize',
  ne: '-top-[4px] -right-[4px] size-12 cursor-nesw-resize',
  nw: '-top-[4px] -left-[4px] size-12 cursor-nwse-resize',
  se: '-right-[4px] -bottom-[4px] size-12 cursor-nwse-resize',
  sw: '-bottom-[4px] -left-[4px] size-12 cursor-nesw-resize',
};
const controlButton =
  'inline-grid size-[28px] cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-ink-muted hover:bg-hover hover:text-ink focus-visible:focus-ring';
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
  const { t } = useI18n();
  const hintId = useId();
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ mode: Mode; sx: number; sy: number; rect: Rect } | null>(null);
  // Latest window state for the pointer handlers (a drag spans several renders).
  const winRef = useRef(win);
  winRef.current = win;
  const { activate, minimize, toggleMaximize, toggleOnTop, setRect, dragOut } = useHomeActions();
  const close = useCloseWindow();
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
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, rect: { ...rect } };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const current = winRef.current;
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
      data-on-top={win.onTop || undefined}
      // overflow-clip, not -hidden: a hidden box can still be scrolled by the browser (find in page, a screen reader's
      // reading cursor, selecting text, scrollIntoView), which slid the title bar and identity strip out of view with no
      // scrollbar to bring them back. A clipped box never scrolls; only the window body and its panes do.
      className="group/win absolute flex flex-col overflow-clip rounded-lg border border-line bg-surface shadow-window focus:outline-none data-[maximized]:rounded-none"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: frame.zIndex }}
      onPointerDownCapture={() => {
        if (!active) activate(win.id);
      }}
    >
      <div
        className="flex h-titlebar flex-none cursor-grab touch-none select-none items-center gap-8 border-b border-line-subtle bg-surface-subtle pl-12 pr-8 focus-visible:-outline-offset-2 active:cursor-grabbing group-data-[active]/win:bg-surface"
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
        <span className="inline-grid size-icon-lg place-items-center rounded-sm bg-ink-disabled text-ink-on-action group-data-[active]/win:bg-action">
          <Icon name={icon} size={16} />
        </span>
        <h2 className="type-title-md m-0 min-w-0 flex-1 truncate text-ink-muted group-data-[active]/win:text-ink">
          {title}
        </h2>
        <span id={hintId} className="sr-only">
          {t(win.mode === 'floating' ? 'window.moveHint' : 'window.tileHint')}
        </span>
        <div className="flex gap-2">
          {(win.mode === 'floating' || win.mode === 'tiled') && (
            <button
              type="button"
              className={cn(controlButton, 'aria-pressed:bg-info-bg aria-pressed:text-info-fg')}
              aria-label={t('window.onTop', { title })}
              aria-pressed={win.onTop}
              onClick={() => toggleOnTop(win.id)}
            >
              <Icon name="pin" size={16} />
            </button>
          )}
          <button
            type="button"
            className={controlButton}
            aria-label={t('window.minimize', { title })}
            onClick={() => minimize(win.id)}
          >
            <Icon name="minus" size={16} />
          </button>
          <button
            type="button"
            className={controlButton}
            aria-label={t(maximized ? 'window.restore' : 'window.maximize', { title })}
            onClick={() => toggleMaximize(win.id)}
          >
            <Icon name={maximized ? 'restore' : 'maximize'} size={16} />
          </button>
          <button
            type="button"
            className={controlButton}
            aria-label={t('window.close', { title })}
            onClick={() => close(win.id)}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
      {!frame.locked &&
        HANDLES.map((h) => (
          <div
            key={h}
            className={cn(handleBase, handleStyles[h])}
            data-handle={h}
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
