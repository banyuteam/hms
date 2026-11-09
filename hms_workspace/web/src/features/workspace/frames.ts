import {
  MIN_WINDOW_HEIGHT,
  isCompact,
  maximizedRect,
  slotCount,
  slotRects,
  type Area,
  type LayoutKey,
  type Rect,
} from './geometry';
import { mostRecent, type WindowState } from '@/state/home';

/**
 * Stacking tiers: tile < float < maximised < top. `top` is a floating or tiled window the user set to
 * "stay on top" (`WindowState.onTop`), so it stays visible over a maximised window. The active window is always drawn
 * above every maximised window (but below `top` windows), so focusing one from the dock never leaves it hidden.
 * All inside the 10–199 token band.
 */
export type Tier = 'tile' | 'float' | 'max' | 'top';

export interface Frame {
  rect: Rect;
  /** Not drawn (minimised, or hidden because the shell is compact). The component stays mounted so its state survives. */
  hidden: boolean;
  tier: Tier;
  zIndex: number;
  /** Tiled windows get their rectangle from the layout: no free resize. */
  locked: boolean;
}

export interface Frames {
  frames: Map<string, Frame>;
  /** `shell.compact`: the preset no longer fits, tiling is paused and only the most recently used window shows. */
  compact: boolean;
  /** Slot indexes with no window — drawn as an "Open module…" placeholder (decided 2026-10-29). */
  emptySlots: number[];
  slots: Rect[];
}

const WINDOW_Z = 10;
const TIER_ORDER: Record<Tier, number> = { tile: 0, float: 1, max: 2, top: 4 };
/** The active tiled/floating window: above maximised windows, below "stay on top" ones. */
const ACTIVE_ORDER = 3;
/** Space kept above the single window in compact mode for the "layout paused" note. */
const COMPACT_NOTE_STRIP = 32;

/** What to draw and where, from the store state. Pure, so every layout rule is unit-testable. */
export function computeFrames(
  windows: readonly WindowState[],
  layout: LayoutKey,
  area: Area,
  activeId: string | null = null,
): Frames {
  const frames = new Map<string, Frame>();
  const compact = isCompact(layout, area);

  if (compact) {
    const keep = mostRecent(windows);
    const base = slotRects('single', area)[0] ?? maximizedRect(area);
    const single = {
      ...base,
      y: base.y + COMPACT_NOTE_STRIP,
      h: Math.max(MIN_WINDOW_HEIGHT, base.h - COMPACT_NOTE_STRIP),
    };
    for (const w of windows) {
      const shown = keep?.id === w.id;
      frames.set(w.id, {
        rect: single,
        hidden: !shown,
        tier: 'tile',
        zIndex: WINDOW_Z,
        locked: true,
      });
    }
    return { frames, compact, emptySlots: [], slots: [] };
  }

  const slots = layout === 'free' ? [] : slotRects(layout, area);
  const occupied = new Set<number>();
  for (const w of windows) {
    if (w.mode === 'minimized') {
      frames.set(w.id, {
        rect: w.rect,
        hidden: true,
        tier: 'float',
        zIndex: WINDOW_Z,
        locked: false,
      });
    } else if (w.mode === 'maximized') {
      if (w.slot !== null) occupied.add(w.slot);
      frames.set(w.id, {
        rect: maximizedRect(area),
        hidden: false,
        tier: 'max',
        zIndex: WINDOW_Z,
        locked: true,
      });
    } else if (w.mode === 'tiled' && w.slot !== null && slots[w.slot]) {
      occupied.add(w.slot);
      frames.set(w.id, {
        rect: slots[w.slot]!,
        hidden: false,
        tier: w.onTop ? 'top' : 'tile',
        zIndex: WINDOW_Z,
        locked: true,
      });
    } else {
      frames.set(w.id, {
        rect: w.rect,
        hidden: false,
        tier: w.onTop ? 'top' : 'float',
        zIndex: WINDOW_Z,
        locked: false,
      });
    }
  }
  // z-index = tier first, then the window's stacking rank: consecutive from 10, so tiers never overlap and stay in the band.
  // The active window is lifted only while a maximised window would cover it; otherwise floats stay above tiles.
  const maxShown = [...frames.values()].some((f) => f.tier === 'max' && !f.hidden);
  const order = (w: WindowState) => {
    const tier = frames.get(w.id)!.tier;
    return maxShown && w.id === activeId && (tier === 'tile' || tier === 'float')
      ? ACTIVE_ORDER
      : TIER_ORDER[tier];
  };
  const shown = windows
    .filter((w) => !frames.get(w.id)!.hidden)
    .sort((a, b) => order(a) - order(b) || a.z - b.z);
  shown.forEach((w, i) => {
    frames.set(w.id, { ...frames.get(w.id)!, zIndex: WINDOW_Z + i });
  });
  const emptySlots: number[] = [];
  for (let i = 0; i < slotCount(layout); i++) if (!occupied.has(i)) emptySlots.push(i);
  return { frames, compact, emptySlots, slots };
}
