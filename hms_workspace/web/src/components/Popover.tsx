import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export type Placement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';

export interface TriggerProps {
  ref: Ref<HTMLButtonElement>;
  'aria-haspopup': 'menu' | 'dialog';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

export const popoverStyles = {
  surface:
    'fixed z-popover min-w-[240px] rounded-lg border border-line bg-surface p-8 shadow-popover outline-none',
  menu: 'flex flex-col gap-2',
  item:
    'flex w-full cursor-pointer items-center gap-12 rounded-md border-0 bg-transparent px-12 py-8 text-left text-ink-secondary outline-none ' +
    'hover:bg-selected hover:text-ink-link focus:bg-selected focus:text-ink-link ' +
    'aria-disabled:cursor-not-allowed aria-disabled:bg-transparent aria-disabled:text-ink-disabled',
  itemText: 'flex-1 font-semibold',
  hint: 'text-[length:var(--hms-text-caption-size)] text-ink-muted',
  section: 'flex flex-col gap-8 p-4',
  sectionLabel: 'type-overline text-ink-muted uppercase',
  divider: 'mx-0 my-4 h-px border-0 bg-line-subtle',
} as const;

const GAP = 4;
const CloseContext = createContext<() => void>(() => {});

/** Closes the popover that contains the caller (menu items, "Sign out", layout choices). */
export function usePopoverClose(): () => void {
  return useContext(CloseContext);
}

function position(trigger: HTMLElement, placement: Placement): CSSProperties {
  const r = trigger.getBoundingClientRect();
  const [v, h] = placement.split('-') as ['top' | 'bottom', 'start' | 'end'];
  return {
    ...(v === 'bottom' ? { top: r.bottom + GAP } : { bottom: window.innerHeight - r.top + GAP }),
    ...(h === 'end' ? { right: window.innerWidth - r.right } : { left: r.left }),
  };
}

function items(root: HTMLElement | null): HTMLElement[] {
  return root
    ? Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemradio"]'))
    : [];
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Controls Tab can reach inside a dialog panel, in order. */
function focusables(root: HTMLElement | null): HTMLElement[] {
  return root
    ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0,
      )
    : [];
}

/**
 * Trigger + floating panel. `role="menu"`: arrow keys / Home / End move between `MenuItem`s, Tab closes it.
 * `role="dialog"`: free content (language switch, layout choices, "Sign out"); Tab moves between its controls and wraps.
 * Both close on Escape (focus returns to the trigger) and a pointer press outside. Rendered in a portal with fixed coordinates so a window's `overflow: hidden` never clips it.
 */
export function Popover({
  label,
  role = 'menu',
  placement = 'bottom-end',
  trigger,
  className,
  children,
}: {
  label: string;
  role?: 'menu' | 'dialog';
  placement?: Placement;
  trigger: (props: TriggerProps) => ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const focusOnOpen = useRef<'first' | 'last'>('first');

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    focusOnOpen.current = 'first';
    setOpen((o) => !o);
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => triggerRef.current && setStyle(position(triggerRef.current, placement));
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, placement]);

  // Move focus into the panel on open: the first (or last) menu item, else the first focusable element, else the panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const list = items(panel).filter((el) => el.getAttribute('aria-disabled') !== 'true');
    const target =
      role === 'menu'
        ? focusOnOpen.current === 'last'
          ? list[list.length - 1]
          : list[0]
        : panel.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? panel).focus();
  }, [open, role]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const node = e.target as Node;
      if (panelRef.current?.contains(node) || triggerRef.current?.contains(node)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (role !== 'menu') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusOnOpen.current = e.key === 'ArrowUp' ? 'last' : 'first';
      setOpen(true);
    }
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      // A menu closes on Tab (menu convention). A dialog holds free content (language, "Sign out", layout choices), so
      // Tab moves between its controls and wraps around: the panel sits at the end of <body>, so letting Tab leave it
      // would drop focus out of the page and "Sign out" could never be reached from the keyboard (WCAG 2.1.1).
      if (role === 'menu') {
        close(false);
        return;
      }
      const list = focusables(panelRef.current);
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (role !== 'menu') return;
    const list = items(panelRef.current);
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next !== null) {
      e.preventDefault();
      list[next]?.focus();
    }
  };

  const setTriggerRef = useCallback((el: HTMLButtonElement | null) => {
    triggerRef.current = el;
  }, []);

  return (
    <>
      {trigger({
        ref: setTriggerRef,
        'aria-haspopup': role,
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
        onClick: toggle,
        onKeyDown: onTriggerKeyDown,
      })}
      {open &&
        createPortal(
          <CloseContext.Provider value={close}>
            <div
              ref={panelRef}
              id={id}
              role={role}
              aria-label={label}
              tabIndex={-1}
              style={style}
              className={cn(
                popoverStyles.surface,
                role === 'menu' && popoverStyles.menu,
                className,
              )}
              onKeyDown={onPanelKeyDown}
            >
              {children}
            </div>
          </CloseContext.Provider>,
          document.body,
        )}
    </>
  );
}

/** One `role="menuitem"` inside a `Popover role="menu"`. Disabled items stay focusable (aria-disabled) so they can be read. */
export function MenuItem({
  onSelect,
  disabled = false,
  className,
  children,
}: {
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const close = usePopoverClose();
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={cn(popoverStyles.item, className)}
      onClick={() => {
        if (disabled) return;
        close();
        onSelect();
      }}
    >
      {children}
    </button>
  );
}
