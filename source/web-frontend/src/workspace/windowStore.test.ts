import { beforeEach, describe, expect, it } from 'vitest';
import { EDGE_MARGIN, MIN_WINDOW_WIDTH, clampRect, defaultRect } from './geometry';
import { useWindowStore } from './windowStore';

const area = { width: 1440, height: 780 };
const s = () => useWindowStore.getState();

beforeEach(() => {
  s().reset();
  s().setArea(area);
});

describe('geometry', () => {
  it('opens comfortable (not maximised) windows with the clear-space margin', () => {
    const r = defaultRect(area, 0);
    expect(r.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
    expect(r.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
    expect(r.x + r.w).toBeLessThanOrEqual(area.width - EDGE_MARGIN);
    expect(r.y + r.h).toBeLessThanOrEqual(area.height - EDGE_MARGIN);
  });
  it('cascades new windows', () => {
    expect(defaultRect(area, 1).x).toBeGreaterThan(defaultRect(area, 0).x);
  });
  it('clamps inside the area and above the minimum width', () => {
    const r = clampRect({ x: -50, y: 2000, w: 10, h: 10 }, area);
    expect(r.x).toBe(0);
    expect(r.w).toBe(MIN_WINDOW_WIDTH);
    expect(r.y + r.h).toBeLessThanOrEqual(area.height);
  });
});

describe('window store', () => {
  it('opens one window per module and focuses it again instead of duplicating', () => {
    s().open('patients');
    s().open('lab');
    s().open('patients');
    expect(s().windows.map((w) => w.id)).toEqual(['patients', 'lab']);
    expect(s().activeId).toBe('patients');
  });
  it('keeps z-order: activated window is on top', () => {
    s().open('patients');
    s().open('lab');
    s().activate('patients');
    const [p, l] = [s().windows[0]!, s().windows[1]!];
    expect(p.z).toBeGreaterThan(l.z);
  });
  it('minimise keeps the dock tab; activate restores; the next window becomes active', () => {
    s().open('patients');
    s().open('lab');
    s().minimize('lab');
    expect(s().windows).toHaveLength(2);
    expect(s().activeId).toBe('patients');
    s().activate('lab');
    expect(s().windows.find((w) => w.id === 'lab')?.minimized).toBe(false);
    expect(s().activeId).toBe('lab');
  });
  it('close removes the window and hands focus to the top visible one', () => {
    s().open('patients');
    s().open('lab');
    s().close('lab');
    expect(s().windows.map((w) => w.id)).toEqual(['patients']);
    expect(s().activeId).toBe('patients');
    s().close('patients');
    expect(s().activeId).toBeNull();
  });
  it('maximise fills the work area and restore returns to the previous geometry', () => {
    s().open('patients');
    const before = { ...s().windows[0]! };
    s().toggleMaximize('patients');
    expect(s().windows[0]).toMatchObject({
      x: 0,
      y: 0,
      w: area.width,
      h: area.height,
      maximized: true,
    });
    s().toggleMaximize('patients');
    expect(s().windows[0]).toMatchObject({
      x: before.x,
      y: before.y,
      w: before.w,
      h: before.h,
      maximized: false,
    });
  });
  it('resizing the work area re-clamps windows', () => {
    s().open('patients');
    s().setArea({ width: 800, height: 500 });
    const w = s().windows[0]!;
    expect(w.x + w.w).toBeLessThanOrEqual(800);
    expect(w.y + w.h).toBeLessThanOrEqual(500);
  });
  it('showHome minimises everything; reset wipes all state (logout)', () => {
    s().open('patients');
    s().showHome();
    expect(s().windows.every((w) => w.minimized)).toBe(true);
    expect(s().activeId).toBeNull();
    s().reset();
    expect(s().windows).toHaveLength(0);
  });
});
