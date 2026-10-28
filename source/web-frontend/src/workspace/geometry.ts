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

/** Clear-space rule (Figma / design-tokens skill): ≥24px to the edge, ≥16px between windows. */
export const EDGE_MARGIN = 24;
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

/** Comfortable (not maximised) default size, cascaded so new windows never stack exactly. */
export function defaultRect(area: Area, openCount: number): Rect {
  const maxW = area.width - EDGE_MARGIN * 2;
  const maxH = area.height - EDGE_MARGIN * 2;
  const w = Math.min(1200, Math.max(MIN_WINDOW_WIDTH, maxW - CASCADE_STEP * 4));
  const h = Math.min(728, Math.max(MIN_WINDOW_HEIGHT, maxH - CASCADE_STEP * 2));
  const step = (openCount % 5) * CASCADE_STEP;
  return clampRect({ x: EDGE_MARGIN + step, y: EDGE_MARGIN + step, w, h }, area);
}

export function maximizedRect(area: Area): Rect {
  return { x: 0, y: 0, w: area.width, h: area.height };
}
