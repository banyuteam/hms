import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  clampRect,
  defaultRect,
  fitRect,
  slotCount,
  slotRects,
  type Area,
  type LayoutKey,
  type Rect,
} from '@/features/workspace/geometry';

/**
 * Home workspace state: the window manager. Pure reducer + typed actions; in memory only — titles
 * carry identifiers, so nothing here is ever persisted. Wiped on sign-out / idle lock (`useEndSession`).
 *
 * Window kinds: the four EMR task windows (W1–W4), the four viewers and User & Access (IAM administration). Each kind has one blank instance plus one instance per
 * record it is opened for (see `windowId`).
 */
export type WindowKind =
  | 'emr-profile'
  | 'emr-records'
  | 'emr-encounter'
  | 'emr-diagnostics'
  | 'lab'
  | 'radiology'
  | 'billing'
  | 'prescription'
  | 'iam-admin'
  | 'tariffs';
export type WindowMode = 'floating' | 'tiled' | 'maximized' | 'minimized';
export type RestoreMode = 'floating' | 'tiled';

/** Non-PHI by construction: only identifiers the lists already show. Never a name. */
export interface WindowParams {
  mrn?: string;
  /** Encounter number (`no_rawat`) — an identifier, never a name. In memory only. */
  norawat?: string;
  /** Viewer object id (e.g. one lab test or one radiology image) inside the encounter. */
  item?: string;
}

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
  /**
   * "Stay on top": drawn above maximised windows while floating or tiled (e.g. a lab viewer over a maximised record).
   * Kept through minimise, maximise and layout changes; it has no effect while the window itself is maximised.
   */
  onTop: boolean;
  lastUsed: number;
  /** The window this one was opened from (a drill-down such as Records → Prescription); absent = Home or the launcher. */
  openedFrom?: string;
}

export interface HomeState {
  /** Work-area size, kept up to date by <Workspace/>. */
  area: Area;
  layout: LayoutKey;
  /** Dock order. */
  windows: WindowState[];
  activeId: string | null;
  clock: number;
}

export type HomeAction =
  | { type: 'area/resized'; area: Area }
  | { type: 'window/opened'; kind: WindowKind; params: WindowParams; from?: string }
  | { type: 'window/closed'; id: string }
  | { type: 'window/activated'; id: string }
  | { type: 'window/minimized'; id: string }
  | { type: 'window/maximizeToggled'; id: string }
  | { type: 'window/onTopToggled'; id: string }
  | { type: 'window/moved'; id: string; rect: Rect }
  | { type: 'window/draggedOut'; id: string; rect: Rect }
  | { type: 'window/retargeted'; id: string; params: WindowParams }
  | { type: 'layout/changed'; layout: LayoutKey }
  | { type: 'home/shown' }
  | { type: 'session/reset' };

/** Default window sizes (design: records 1120×748; viewers smaller). */
const DEFAULT_SIZE: Partial<Record<WindowKind, { w: number; h: number }>> = {
  'emr-profile': { w: 960, h: 720 },
  'emr-records': { w: 1120, h: 748 },
  'emr-encounter': { w: 1040, h: 748 },
  'emr-diagnostics': { w: 1040, h: 748 },
  prescription: { w: 760, h: 640 },
  'iam-admin': { w: 1120, h: 720 },
  tariffs: { w: 1120, h: 720 },
};

export const initialHomeState: HomeState = {
  area: { width: 1200, height: 700 },
  layout: 'free',
  windows: [],
  activeId: null,
  clock: 1,
};

export function windowId(kind: WindowKind, params: WindowParams = {}): string {
  const key = [params.mrn, params.norawat, params.item].filter(Boolean).join('|');
  return key ? `${kind}:${key}` : kind;
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

/**
 * Dock order for a new window: a drill-down goes right after the window it was opened from and that window's earlier
 * drill-downs, so the windows of one patient and visit stay together instead of trailing at the end of the dock.
 */
function placed(windows: readonly WindowState[], win: WindowState): WindowState[] {
  const at = win.openedFrom ? windows.findIndex((w) => w.id === win.openedFrom) : -1;
  if (at < 0) return [...windows, win];
  const family = new Set([win.openedFrom]);
  let end = at;
  for (let next = windows[end + 1]; next && family.has(next.openedFrom); next = windows[end + 1]) {
    family.add(next.id);
    end += 1;
  }
  return [...windows.slice(0, end + 1), win, ...windows.slice(end + 1)];
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

function minimized(w: WindowState): WindowState {
  return {
    ...w,
    mode: 'minimized',
    previous: w.mode === 'maximized' ? w.previous : (w.mode as RestoreMode),
    previousSlot: w.slot,
    slot: null,
  };
}

function activate(s: HomeState, id: string): HomeState {
  const target = s.windows.find((w) => w.id === id);
  if (!target) return s;
  const base = target.mode === 'minimized' ? restored(target, s.windows, s.layout) : target;
  const windows = s.windows.map((w) =>
    w.id === id ? { ...base, z: s.windows.length + 1, lastUsed: s.clock } : w,
  );
  return { ...s, windows: compactZ(windows), activeId: id, clock: s.clock + 1 };
}

function close(s: HomeState, id: string): HomeState {
  const windows = s.windows.filter((w) => w.id !== id);
  return {
    ...s,
    windows: compactZ(windows),
    activeId: s.activeId === id ? (mostRecent(windows)?.id ?? null) : s.activeId,
  };
}

export function homeReducer(s: HomeState, action: HomeAction): HomeState {
  switch (action.type) {
    case 'area/resized':
      return {
        ...s,
        area: action.area,
        windows: s.windows.map((w) => ({ ...w, rect: fitRect(w.rect, action.area) })),
      };
    case 'window/opened': {
      const id = windowId(action.kind, action.params);
      if (s.windows.some((w) => w.id === id)) return activate(s, id);
      const slot = firstFreeSlot(s.windows, s.layout);
      const floatingCount = s.windows.filter((w) => w.mode === 'floating').length;
      const opener = action.from ? s.windows.find((w) => w.id === action.from) : undefined;
      const win: WindowState = {
        id,
        kind: action.kind,
        params: action.params,
        // T2: a new window takes a free slot, otherwise it floats on top — it never evicts a tile.
        mode: slot !== null ? 'tiled' : 'floating',
        previous: slot !== null ? 'tiled' : 'floating',
        slot,
        previousSlot: null,
        rect: defaultRect(s.area, floatingCount, DEFAULT_SIZE[action.kind]),
        z: s.windows.length + 1,
        lastUsed: s.clock,
        onTop: false,
        openedFrom: opener?.id,
      };
      return { ...s, windows: compactZ(placed(s.windows, win)), activeId: id, clock: s.clock + 1 };
    }
    case 'window/closed':
      return close(s, action.id);
    case 'window/activated':
      return activate(s, action.id);
    case 'window/minimized': {
      const windows = s.windows.map((w) => (w.id === action.id ? minimized(w) : w));
      return {
        ...s,
        windows,
        activeId: s.activeId === action.id ? (mostRecent(windows)?.id ?? null) : s.activeId,
      };
    }
    case 'window/maximizeToggled':
      return {
        ...s,
        windows: s.windows.map((w) => {
          if (w.id !== action.id) return w;
          if (w.mode === 'maximized') return restored(w, s.windows, s.layout);
          if (w.mode === 'minimized') return w;
          // T8: remember where it came from; a tiled window keeps its slot reserved.
          return { ...w, mode: 'maximized', previous: w.mode as RestoreMode };
        }),
      };
    case 'window/onTopToggled':
      return {
        ...s,
        windows: s.windows.map((w) =>
          w.id === action.id && (w.mode === 'floating' || w.mode === 'tiled')
            ? { ...w, onTop: !w.onTop }
            : w,
        ),
      };
    case 'window/moved':
      return {
        ...s,
        windows: s.windows.map((w) =>
          w.id === action.id && w.mode === 'floating'
            ? { ...w, rect: clampRect(action.rect, s.area) }
            : w,
        ),
      };
    case 'window/draggedOut':
      return {
        ...s,
        windows: s.windows.map((w) =>
          w.id === action.id && w.mode === 'tiled'
            ? {
                ...w,
                mode: 'floating',
                previous: 'floating',
                slot: null,
                rect: clampRect(action.rect, s.area),
              }
            : w,
        ),
      };
    case 'window/retargeted': {
      const win = s.windows.find((w) => w.id === action.id);
      if (!win) return s;
      const next = windowId(win.kind, action.params);
      if (next === action.id) return s;
      // Pointing a window at a record that is already open focuses that window instead of duplicating it.
      if (s.windows.some((w) => w.id === next)) return activate(close(s, action.id), next);
      return {
        ...s,
        windows: s.windows.map((w) =>
          w.id === action.id
            ? { ...w, id: next, params: action.params }
            : w.openedFrom === action.id
              ? { ...w, openedFrom: next }
              : w,
        ),
        activeId: s.activeId === action.id ? next : s.activeId,
      };
    }
    case 'layout/changed': {
      const { layout } = action;
      if (layout === 'free') {
        // Tiles become floating windows at the rectangle they had (nothing is lost).
        const rects = s.layout === 'free' ? [] : slotRects(s.layout, s.area);
        const windows = s.windows.map((w): WindowState => {
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
          return w.mode === 'maximized' ? next : { ...next, mode: 'floating' };
        });
        return { ...s, layout, windows };
      }
      // T3: most recently used windows fill the slots in order; the rest float (visible, on top).
      const capacity = slotCount(layout);
      const eligible = s.windows
        .filter((w) => w.mode !== 'minimized')
        .sort((a, b) => b.lastUsed - a.lastUsed);
      const slotOf = new Map(eligible.slice(0, capacity).map((w, i) => [w.id, i]));
      const windows = s.windows.map((w): WindowState => {
        if (w.mode === 'minimized') return { ...w, previousSlot: null };
        const slot = slotOf.get(w.id);
        return slot === undefined
          ? { ...w, mode: 'floating', previous: 'floating', slot: null }
          : { ...w, mode: 'tiled', previous: 'tiled', slot };
      });
      return { ...s, layout, windows };
    }
    case 'home/shown':
      return {
        ...s,
        windows: s.windows.map((w) => (w.mode === 'minimized' ? w : minimized(w))),
        activeId: null,
      };
    case 'session/reset':
      return { ...initialHomeState, area: s.area };
  }
}

export interface HomeActions {
  setArea: (area: Area) => void;
  /** `from`: the window it is opened from — set by <WindowOpenerProvider/> for everything opened inside a window. */
  open: (kind: WindowKind, params?: WindowParams, from?: string) => void;
  close: (id: string) => void;
  /** Focus (and restore) a window — what clicking a dock tab does. */
  activate: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  /** "Stay on top" of maximised windows; floating and tiled windows only. */
  toggleOnTop: (id: string) => void;
  /** Floating windows only; tiled windows get their rectangle from the layout. */
  setRect: (id: string, rect: Rect) => void;
  /** Dragging a tiled window out of its slot → floating (T5). */
  dragOut: (id: string, rect: Rect) => void;
  /** Layout picker (T3). */
  setLayout: (layout: LayoutKey) => void;
  /** "Home": minimise everything, keep dock tabs. */
  showHome: () => void;
  /** Points a window at another record (blank window → searched record). Focuses an existing match instead of duplicating it. */
  retarget: (id: string, params: WindowParams) => void;
  /** Wipes all windows (sign-out). */
  reset: () => void;
}

export function bindHomeActions(dispatch: Dispatch<HomeAction>): HomeActions {
  return {
    setArea: (area) => dispatch({ type: 'area/resized', area }),
    open: (kind, params = {}, from) => dispatch({ type: 'window/opened', kind, params, from }),
    close: (id) => dispatch({ type: 'window/closed', id }),
    activate: (id) => dispatch({ type: 'window/activated', id }),
    minimize: (id) => dispatch({ type: 'window/minimized', id }),
    toggleMaximize: (id) => dispatch({ type: 'window/maximizeToggled', id }),
    toggleOnTop: (id) => dispatch({ type: 'window/onTopToggled', id }),
    setRect: (id, rect) => dispatch({ type: 'window/moved', id, rect }),
    dragOut: (id, rect) => dispatch({ type: 'window/draggedOut', id, rect }),
    setLayout: (layout) => dispatch({ type: 'layout/changed', layout }),
    showHome: () => dispatch({ type: 'home/shown' }),
    retarget: (id, params) => dispatch({ type: 'window/retargeted', id, params }),
    reset: () => dispatch({ type: 'session/reset' }),
  };
}

// State and actions are separate contexts: components that only open/close windows do not re-render on every drag frame.
const HomeStateContext = createContext<HomeState | null>(null);
const HomeActionsContext = createContext<HomeActions | null>(null);

export function HomeProvider({
  children,
  initialState = initialHomeState,
}: {
  children: ReactNode;
  initialState?: HomeState;
}) {
  const [state, dispatch] = useReducer(homeReducer, initialState);
  const actions = useMemo(() => bindHomeActions(dispatch), []);
  return (
    <HomeActionsContext.Provider value={actions}>
      <HomeStateContext.Provider value={state}>{children}</HomeStateContext.Provider>
    </HomeActionsContext.Provider>
  );
}

/**
 * Wraps a window's content: every window opened from inside it is its drill-down, placed next to it in the dock (a
 * maximised opener is handled by `useOpen`). Home, the launcher and the assistant stay outside, so what they open is
 * not a drill-down.
 */
export function WindowOpenerProvider({ id, children }: { id: string; children: ReactNode }) {
  const actions = useHomeActions();
  const value = useMemo<HomeActions>(
    () => ({ ...actions, open: (kind, params, from = id) => actions.open(kind, params, from) }),
    [actions, id],
  );
  return <HomeActionsContext.Provider value={value}>{children}</HomeActionsContext.Provider>;
}

export function useHome(): HomeState {
  const ctx = useContext(HomeStateContext);
  if (!ctx) throw new Error('useHome must be used inside <HomeProvider>');
  return ctx;
}

export function useHomeActions(): HomeActions {
  const ctx = useContext(HomeActionsContext);
  if (!ctx) throw new Error('useHomeActions must be used inside <HomeProvider>');
  return ctx;
}
