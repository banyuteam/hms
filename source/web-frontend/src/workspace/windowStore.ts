import { create } from 'zustand';
import {
  EDGE_MARGIN,
  clampRect,
  defaultRect,
  maximizedRect,
  type Area,
  type Rect,
} from './geometry';
import type { WindowType } from './registry';

export interface WindowState extends Rect {
  /** One window per module (id === type) until multi-instance windows (e.g. patient detail) exist. */
  id: WindowType;
  type: WindowType;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Geometry to return to after un-maximising. */
  restore: Rect | null;
}

interface WindowStore {
  /** Work-area size, kept up to date by <Workspace/>. */
  area: Area;
  windows: WindowState[];
  activeId: WindowType | null;
  nextZ: number;
  setArea: (area: Area) => void;
  open: (type: WindowType) => void;
  close: (id: WindowType) => void;
  /** Focus (and un-minimise) a window — what clicking a dock tab does. */
  activate: (id: WindowType) => void;
  minimize: (id: WindowType) => void;
  toggleMaximize: (id: WindowType) => void;
  setRect: (id: WindowType, rect: Rect) => void;
  /** "Beranda": minimise everything, keep dock tabs. */
  showHome: () => void;
  /** Wipes all state (logout). Layout/titles may contain identifiers → never persisted. */
  reset: () => void;
}

const initial = { area: { width: 1200, height: 700 }, windows: [], activeId: null, nextZ: 10 };

function topVisible(windows: WindowState[]): WindowType | null {
  const visible = windows.filter((w) => !w.minimized);
  if (visible.length === 0) return null;
  return visible.reduce((a, b) => (b.z > a.z ? b : a)).id;
}

export const useWindowStore = create<WindowStore>((set, get) => ({
  ...initial,
  setArea: (area) =>
    set((s) => ({
      area,
      windows: s.windows.map((w) =>
        w.maximized ? { ...w, ...maximizedRect(area) } : { ...w, ...clampRect(w, area) },
      ),
    })),
  open: (type) => {
    const s = get();
    if (s.windows.some((w) => w.id === type)) {
      get().activate(type);
      return;
    }
    const rect = defaultRect(s.area, s.windows.length);
    const win: WindowState = {
      id: type,
      type,
      ...rect,
      z: s.nextZ,
      minimized: false,
      maximized: false,
      restore: null,
    };
    set({ windows: [...s.windows, win], activeId: type, nextZ: s.nextZ + 1 });
  },
  close: (id) =>
    set((s) => {
      const windows = s.windows.filter((w) => w.id !== id);
      return { windows, activeId: s.activeId === id ? topVisible(windows) : s.activeId };
    }),
  activate: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: false, z: s.nextZ } : w)),
      activeId: id,
      nextZ: s.nextZ + 1,
    })),
  minimize: (id) =>
    set((s) => {
      const windows = s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w));
      return { windows, activeId: s.activeId === id ? topVisible(windows) : s.activeId };
    }),
  toggleMaximize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          const back = clampRect(w.restore ?? defaultRect(s.area, 0), s.area);
          return { ...w, ...back, maximized: false, restore: null };
        }
        return {
          ...w,
          ...maximizedRect(s.area),
          maximized: true,
          restore: { x: w.x, y: w.y, w: w.w, h: w.h },
        };
      }),
    })),
  setRect: (id, rect) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id && !w.maximized ? { ...w, ...clampRect(rect, s.area) } : w,
      ),
    })),
  showHome: () =>
    set((s) => ({ windows: s.windows.map((w) => ({ ...w, minimized: true })), activeId: null })),
  reset: () => set({ ...initial }),
}));

export { EDGE_MARGIN };
