export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Area {
  width: number;
  height: number;
}

/** Clear-space rule (Figma / design-tokens skill): ≥24px to the side edges, ≥16px between windows and below the top bar / above the dock. */
export const EDGE_MARGIN = 24;
export const TILE_GAP = 16;
export const VERTICAL_MARGIN = 16;
export const MIN_WINDOW_WIDTH = 360; // token size/window-min-width
export const MIN_WINDOW_HEIGHT = 240;
export const TITLEBAR_HEIGHT = 40; // token size/titlebar
const CASCADE_STEP = 32;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Keeps a window fully inside the work area and above the minimum size. */
export function clampRect(r: Rect, area: Area): Rect {
  const w = clamp(r.w, MIN_WINDOW_WIDTH, area.width);
  const h = clamp(r.h, MIN_WINDOW_HEIGHT, area.height);
  return { w, h, x: clamp(r.x, 0, area.width - w), y: clamp(r.y, 0, area.height - h) };
}

/**
 * Re-fits a floating window after the work area changed (browser resized, monitor changed): it keeps the clear-space
 * margins (24 px sides, 16 px top/bottom) and shrinks if needed, never below 360×240. Dragging a window flush to an edge is
 * still allowed (`clampRect`); this only runs when the area itself changes.
 */
export function fitRect(r: Rect, area: Area): Rect {
  const iw = area.width - EDGE_MARGIN * 2;
  const ih = area.height - VERTICAL_MARGIN * 2;
  const w = clamp(r.w, MIN_WINDOW_WIDTH, iw);
  const h = clamp(r.h, MIN_WINDOW_HEIGHT, ih);
  return {
    w,
    h,
    x: clamp(r.x, EDGE_MARGIN, EDGE_MARGIN + iw - w),
    y: clamp(r.y, VERTICAL_MARGIN, VERTICAL_MARGIN + ih - h),
  };
}

/**
 * Comfortable (not maximised) default placement. The first window is centred at the design size (Figma 04: 1180×748 at
 * x=130, y=80 on a 1440×900 screen); each further window cascades by 32 px and gets slightly shorter so it never leaves the area.
 */
export function defaultRect(area: Area, openCount: number, size?: { w: number; h: number }): Rect {
  const step = (openCount % 5) * CASCADE_STEP;
  const maxW = area.width - EDGE_MARGIN * 2;
  const maxH = area.height - VERTICAL_MARGIN * 2;
  const w = Math.max(MIN_WINDOW_WIDTH, Math.min(size?.w ?? 1200, maxW - step));
  const h = Math.max(MIN_WINDOW_HEIGHT, Math.min(size?.h ?? 728, maxH - step));
  const x = Math.max(EDGE_MARGIN, Math.round((area.width - w) / 2)) + step;
  return fitRect({ x, y: VERTICAL_MARGIN + step, w, h }, area);
}

export function maximizedRect(area: Area): Rect {
  return { x: 0, y: 0, w: area.width, h: area.height };
}

/* ── Tile layouts (window-states.md §2.2, decided 2026-10-29: up to 4 tiles) ── */

export type TileLayout = 'single' | 'cols2' | 'main2' | 'grid4';
export type LayoutKey = 'free' | TileLayout;
export const TILE_LAYOUTS: readonly TileLayout[] = ['single', 'cols2', 'main2', 'grid4'];
export const LAYOUT_KEYS: readonly LayoutKey[] = ['free', ...TILE_LAYOUTS];
export const SLOT_COUNT: Record<TileLayout, number> = { single: 1, cols2: 2, main2: 3, grid4: 4 };

/** Mockup 05: the large window is 752 of the 1376 px left after the 16 px gap at 1440 px wide. */
const MAIN_RATIO = 752 / 1376;

export function slotCount(layout: LayoutKey): number {
  return layout === 'free' ? 0 : SLOT_COUNT[layout];
}

/** Tile rectangles inside the work area, in slot order. Equal split unless noted (ratios are fixed in Phase 2). */
export function slotRects(layout: TileLayout, area: Area): Rect[] {
  const x = EDGE_MARGIN;
  const y = VERTICAL_MARGIN;
  const iw = area.width - EDGE_MARGIN * 2;
  const ih = area.height - VERTICAL_MARGIN * 2;
  const half = (total: number) => Math.floor((total - TILE_GAP) / 2);
  switch (layout) {
    case 'single':
      return [{ x, y, w: iw, h: ih }];
    case 'cols2': {
      const w = half(iw);
      return [
        { x, y, w, h: ih },
        { x: x + w + TILE_GAP, y, w: iw - w - TILE_GAP, h: ih },
      ];
    }
    case 'main2': {
      const left = Math.round((iw - TILE_GAP) * MAIN_RATIO);
      const right = iw - left - TILE_GAP;
      const h = half(ih);
      return [
        { x, y, w: left, h: ih },
        { x: x + left + TILE_GAP, y, w: right, h },
        { x: x + left + TILE_GAP, y: y + h + TILE_GAP, w: right, h: ih - h - TILE_GAP },
      ];
    }
    case 'grid4': {
      const w = half(iw);
      const h = half(ih);
      const x2 = x + w + TILE_GAP;
      const y2 = y + h + TILE_GAP;
      return [
        { x, y, w, h },
        { x: x2, y, w: iw - w - TILE_GAP, h },
        { x, y: y2, w, h: ih - h - TILE_GAP },
        { x: x2, y: y2, w: iw - w - TILE_GAP, h: ih - h - TILE_GAP },
      ];
    }
  }
}

/** A preset is allowed only when every tile is at least 360×240 (decided 2026-10-29). */
export function layoutFits(layout: LayoutKey, area: Area): boolean {
  if (layout === 'free') return true;
  return slotRects(layout, area).every((r) => r.w >= MIN_WINDOW_WIDTH && r.h >= MIN_WINDOW_HEIGHT);
}

/** The shell is *compact* when the chosen preset no longer fits: tiling pauses and only the most recently used window shows. */
export function isCompact(layout: LayoutKey, area: Area): boolean {
  return layout !== 'free' && !layoutFits(layout, area);
}
