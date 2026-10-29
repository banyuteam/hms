import { create } from 'zustand';
import {
  clampRect,
  defaultRect,
  fitRect,
  slotCount,
  slotRects,
  type Area,
  type LayoutKey,
  type Rect,
} from './geometry';

/** Window kinds. `patient-detail` is multi-instance (one per patient); the others are one per module. */
export type WindowKind = 'patients' | 'lab' | 'radiology' | 'billing' | 'patient-detail';
export type WindowMode = 'floating' | 'tiled' | 'maximized' | 'minimized';
export type RestoreMode = 'floating' | 'tiled';

/** Non-PHI-safe by construction: only an identifier the patient list already shows. Never a name. */
export interface WindowParams {
  mrn?: string;
}

/** State model of `design/hms_web-frontend-UIUX/web-workspace/window-states.md` §2.3. */
export interface WindowState {
  id: string;
  kind: WindowKind;
  params: WindowParams;
  mode: WindowMode;
  /** What to return to from `maximized` / `minimized`. */
  previous: RestoreMode;
  /** Tile slot while `tiled` (kept while maximised so nobody takes it). */
  slot: number | null;
  /** Slot to try again when restoring from minimised. */
  previousSlot: number | null;
  /** Floating geometry, remembered in every mode. */
  rect: Rect;
  /** Stacking rank (1 = bottom). Re-numbered on every change so z-index stays inside the 10–199 token band. */
  z: number;
  lastUsed: number;
}

interface WindowStore {
  /** Work-area size, kept up to date by <Workspace/>. */
  area: Area;
  layout: LayoutKey;
  /** Dock order. */
  windows: WindowState[];
  activeId: string | null;
  clock: number;
  setArea: (area: Area) => void;
  open: (kind: WindowKind, params?: WindowParams) => void;
  close: (id: string) => void;
  /** Focus (and restore) a window — what clicking a dock tab does. */
  activate: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  /** Floating windows only; tiled windows get their rectangle from the layout. */
  setRect: (id: string, rect: Rect) => void;
  /** Dragging a tiled window out of its slot → floating (T5). */
  dragOut: (id: string, rect: Rect) => void;
  /** Layout picker (T3). */
  setLayout: (layout: LayoutKey) => void;
  /** "Home": minimise everything, keep dock tabs. */
  showHome: () => void;
  /** Wipes all state (logout). Titles contain identifiers → never persisted. */
  reset: () => void;
}

/** Default window sizes (design: detail 1180×748; modules use the generic default). */
const DEFAULT_SIZE: Partial<Record<WindowKind, { w: number; h: number }>> = {
  'patient-detail': { w: 1180, h: 748 },
};

const initial = {
  area: { width: 1200, height: 700 } as Area,
  layout: 'free' as LayoutKey,
  windows: [] as WindowState[],
  activeId: null as string | null,
  clock: 1,
};

export function windowId(kind: WindowKind, params: WindowParams = {}): string {
  return kind === 'patient-detail' ? `patient-detail:${params.mrn ?? ''}` : kind;
}

/** Most recently used window that is on screen (not minimised). */
export function mostRecent(windows: readonly WindowState[]): WindowState | null {
  const on = windows.filter((w) => w.mode !== 'minimized');
  if (on.length === 0) return null;
  return on.reduce((a, b) => (b.lastUsed > a.lastUsed ? b : a));
}

function firstFreeSlot(windows: readonly WindowState[], layout: LayoutKey): number | null {
  const n = slotCount(layout);
  const taken = new Set(
    windows.filter((w) => w.mode === 'tiled' || w.mode === 'maximized').map((w) => w.slot),
  );
  for (let i = 0; i < n; i++) if (!taken.has(i)) return i;
  return null;
}

/** Re-numbers `z` 1..n in the current order so z-index never grows past the token band. */
function compactZ(windows: WindowState[]): WindowState[] {
  const order = [...windows].sort((a, b) => a.z - b.z);
  const rank = new Map(order.map((w, i) => [w.id, i + 1]));
  return windows.map((w) => ({ ...w, z: rank.get(w.id) ?? w.z }));
}

/** Restores a window from `minimized` / `maximized` to the mode it came from (T7, T9). */
function restored(w: WindowState, all: readonly WindowState[], layout: LayoutKey): WindowState {
  if (w.mode === 'maximized') {
    return w.previous === 'tiled' && w.slot !== null
      ? { ...w, mode: 'tiled' }
      : { ...w, mode: 'floating', slot: null };
  }
  // T7: back into its old slot if that slot still exists and is free, otherwise floating on top.
  const slot = w.previous === 'tiled' ? w.previousSlot : null;
  const taken = all.some(
    (x) => x.id !== w.id && (x.mode === 'tiled' || x.mode === 'maximized') && x.slot === slot,
  );
  if (slot !== null && layout !== 'free' && slot < slotCount(layout) && !taken) {
    return { ...w, mode: 'tiled', slot };
  }
  return { ...w, mode: 'floating', slot: null };
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  ...initial,
  setArea: (area) =>
    set((s) => ({
      area,
      windows: s.windows.map((w) => ({ ...w, rect: fitRect(w.rect, area) })),
    })),
  open: (kind, params = {}) => {
    const s = get();
    const id = windowId(kind, params);
    if (s.windows.some((w) => w.id === id)) {
      get().activate(id);
      return;
    }
    const slot = firstFreeSlot(s.windows, s.layout);
    const floatingCount = s.windows.filter((w) => w.mode === 'floating').length;
    const win: WindowState = {
      id,
      kind,
      params,
      // T2: a new window takes a free slot, otherwise it floats on top — it never evicts a tile.
      mode: slot !== null ? 'tiled' : 'floating',
      previous: slot !== null ? 'tiled' : 'floating',
      slot,
      previousSlot: null,
      rect: defaultRect(s.area, floatingCount, DEFAULT_SIZE[kind]),
      z: s.windows.length + 1,
      lastUsed: s.clock,
    };
    set({ windows: compactZ([...s.windows, win]), activeId: id, clock: s.clock + 1 });
  },
  close: (id) =>
    set((s) => {
      const windows = s.windows.filter((w) => w.id !== id);
      return {
        windows: compactZ(windows),
        activeId: s.activeId === id ? (mostRecent(windows)?.id ?? null) : s.activeId,
      };
    }),
  activate: (id) =>
    set((s) => {
      const target = s.windows.find((w) => w.id === id);
      if (!target) return s;
      const base = target.mode === 'minimized' ? restored(target, s.windows, s.layout) : target;
      const windows = s.windows.map((w) =>
        w.id === id ? { ...base, z: s.windows.length + 1, lastUsed: s.clock } : w,
      );
      return { windows: compactZ(windows), activeId: id, clock: s.clock + 1 };
    }),
  minimize: (id) =>
    set((s) => {
      const windows = s.windows.map((w) =>
        w.id === id
          ? {
              ...w,
              mode: 'minimized' as const,
              previous: w.mode === 'maximized' ? w.previous : (w.mode as RestoreMode),
              previousSlot: w.slot,
              slot: null,
            }
          : w,
      );
      return {
        windows,
        activeId: s.activeId === id ? (mostRecent(windows)?.id ?? null) : s.activeId,
      };
    }),
  toggleMaximize: (id) =>
    set((s) => {
      const windows = s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.mode === 'maximized') return restored(w, s.windows, s.layout);
        if (w.mode === 'minimized') return w;
        // T8: remember where it came from; a tiled window keeps its slot reserved.
        return { ...w, mode: 'maximized' as const, previous: w.mode as RestoreMode };
      });
      return { windows };
    }),
  setRect: (id, rect) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id && w.mode === 'floating' ? { ...w, rect: clampRect(rect, s.area) } : w,
      ),
    })),
  dragOut: (id, rect) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id && w.mode === 'tiled'
          ? {
              ...w,
              mode: 'floating' as const,
              previous: 'floating' as const,
              slot: null,
              rect: clampRect(rect, s.area),
            }
          : w,
      ),
    })),
  setLayout: (layout) =>
    set((s) => {
      if (layout === 'free') {
        // Tiles become floating windows at the rectangle they had (nothing is lost).
        const rects = s.layout === 'free' ? [] : slotRects(s.layout, s.area);
        const windows = s.windows.map((w) => {
          if (w.mode !== 'tiled' && !(w.mode === 'maximized' && w.previous === 'tiled'))
            return { ...w, previousSlot: null };
          const r = w.slot !== null ? rects[w.slot] : undefined;
          const next: WindowState = {
            ...w,
            slot: null,
            previousSlot: null,
            previous: 'floating',
            rect: r ? clampRect(r, s.area) : w.rect,
          };
          return w.mode === 'maximized' ? next : { ...next, mode: 'floating' as const };
        });
        return { layout, windows };
      }
      // T3: most recently used windows fill the slots in order; the rest float (visible, on top).
      const capacity = slotCount(layout);
      const eligible = s.windows
        .filter((w) => w.mode !== 'minimized')
        .sort((a, b) => b.lastUsed - a.lastUsed);
      const slotOf = new Map(eligible.slice(0, capacity).map((w, i) => [w.id, i]));
      const windows = s.windows.map((w) => {
        if (w.mode === 'minimized') return { ...w, previousSlot: null };
        const slot = slotOf.get(w.id);
        return slot === undefined
          ? { ...w, mode: 'floating' as const, previous: 'floating' as const, slot: null }
          : { ...w, mode: 'tiled' as const, previous: 'tiled' as const, slot };
      });
      return { layout, windows };
    }),
  showHome: () =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.mode === 'minimized'
          ? w
          : {
              ...w,
              mode: 'minimized' as const,
              previous: w.mode === 'maximized' ? w.previous : (w.mode as RestoreMode),
              previousSlot: w.slot,
              slot: null,
            },
      ),
      activeId: null,
    })),
  reset: () => set({ ...initial }),
}));
