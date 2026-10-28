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
import { mostRecent, type WindowState } from './windowStore';

/** Stacking tiers (window-states.md §3): tile < float ("stay on top") < maximised. All inside the 10–199 token band. */
export type Tier = 'tile' | 'float' | 'max';

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

const TILE_Z = 10;
const FLOAT_Z = 20;
const MAX_Z = 150;
/** Space kept above the single window in compact mode for the "layout paused" note. */
const COMPACT_NOTE_STRIP = 32;

/** What to draw and where, from the store state. Pure, so every layout rule is unit-testable. */
export function computeFrames(
  windows: readonly WindowState[],
  layout: LayoutKey,
  area: Area,
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
        zIndex: TILE_Z,
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
        zIndex: FLOAT_Z,
        locked: false,
      });
    } else if (w.mode === 'maximized') {
      if (w.slot !== null) occupied.add(w.slot);
      frames.set(w.id, {
        rect: maximizedRect(area),
        hidden: false,
        tier: 'max',
        zIndex: MAX_Z + w.z,
        locked: true,
      });
    } else if (w.mode === 'tiled' && w.slot !== null && slots[w.slot]) {
      occupied.add(w.slot);
      frames.set(w.id, {
        rect: slots[w.slot]!,
        hidden: false,
        tier: 'tile',
        zIndex: TILE_Z,
        locked: true,
      });
    } else {
      frames.set(w.id, {
        rect: w.rect,
        hidden: false,
        tier: 'float',
        zIndex: FLOAT_Z + w.z,
        locked: false,
      });
    }
  }
  const emptySlots: number[] = [];
  for (let i = 0; i < slotCount(layout); i++) if (!occupied.has(i)) emptySlots.push(i);
  return { frames, compact, emptySlots, slots };
}
