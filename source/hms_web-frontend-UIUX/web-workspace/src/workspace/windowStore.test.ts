import { beforeEach, describe, expect, it } from 'vitest';
import { computeFrames } from './frames';
import {
  EDGE_MARGIN,
  MIN_WINDOW_WIDTH,
  clampRect,
  defaultRect,
  isCompact,
  layoutFits,
  slotRects,
} from './geometry';
import { mostRecent, useWindowStore, windowId } from './windowStore';

const area = { width: 1440, height: 780 };
const s = () => useWindowStore.getState();
const win = (id: string) => s().windows.find((w) => w.id === id)!;

beforeEach(() => {
  s().reset();
  s().setArea(area);
});

describe('geometry', () => {
  it('opens comfortable (not maximised) windows with the clear-space margin', () => {
    const r = defaultRect(area, 0);
    expect(r.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
    expect(r.x + r.w).toBeLessThanOrEqual(area.width - EDGE_MARGIN);
    expect(r.y + r.h).toBeLessThanOrEqual(area.height - 16);
  });
  it('keeps cascaded windows inside the 24/16 px margins on a 1280×512 work area', () => {
    for (let i = 0; i < 4; i++) {
      const r = defaultRect({ width: 1280, height: 512 }, i, { w: 1180, h: 748 });
      expect(r.x + r.w).toBeLessThanOrEqual(1280 - 24);
      expect(r.y + r.h).toBeLessThanOrEqual(512 - 16);
      expect(r.x).toBeGreaterThanOrEqual(24);
    }
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
  it('computes the Mockup 05 tiles at 1440×780: 24 px margin, 16 px gap, 1+2', () => {
    const [big, a, b] = slotRects('main2', area);
    expect(big).toEqual({ x: 24, y: 16, w: 752, h: 748 });
    expect(a).toMatchObject({ x: 792, y: 16, w: 624 });
    expect(b!.y).toBe(a!.y + a!.h + 16);
    expect(b!.y + b!.h).toBe(764);
  });
  it('2×2 gives four equal tiles that never overlap', () => {
    const t = slotRects('grid4', area);
    expect(t).toHaveLength(4);
    expect(new Set(t.map((r) => r.w)).size).toBeLessThanOrEqual(2);
    expect(t[0]!.x + t[0]!.w + 16).toBe(t[1]!.x);
    expect(t[0]!.y + t[0]!.h + 16).toBe(t[2]!.y);
  });
  it('a preset fits only when every tile is at least 360×240 (decided 2026-10-29)', () => {
    expect(layoutFits('grid4', area)).toBe(true);
    expect(layoutFits('grid4', { width: 784, height: 528 })).toBe(true);
    expect(layoutFits('grid4', { width: 783, height: 528 })).toBe(false);
    expect(layoutFits('grid4', { width: 784, height: 527 })).toBe(false);
    expect(layoutFits('cols2', { width: 784, height: 300 })).toBe(true);
    expect(layoutFits('free', { width: 100, height: 100 })).toBe(true);
    expect(isCompact('grid4', { width: 700, height: 500 })).toBe(true);
    expect(isCompact('free', { width: 700, height: 500 })).toBe(false);
  });
});

describe('window store — states and transitions (window-states.md)', () => {
  it('opens one window per module and focuses it again instead of duplicating (T1)', () => {
    s().open('patients');
    s().open('lab');
    s().open('patients');
    expect(s().windows.map((w) => w.id)).toEqual(['patients', 'lab']);
    expect(s().activeId).toBe('patients');
    expect(win('patients').mode).toBe('floating');
  });
  it('patient windows are multi-instance, one per patient', () => {
    s().open('patient-detail', { mrn: '00012346' });
    s().open('patient-detail', { mrn: '00012345' });
    s().open('patient-detail', { mrn: '00012346' });
    expect(s().windows.map((w) => w.id)).toEqual([
      'patient-detail:00012346',
      'patient-detail:00012345',
    ]);
    expect(windowId('patient-detail', { mrn: '1' })).toBe('patient-detail:1');
  });
  it('keeps z-order: the activated window is on top and ranks stay small (z-index band)', () => {
    s().open('patients');
    s().open('lab');
    s().activate('patients');
    expect(win('patients').z).toBeGreaterThan(win('lab').z);
    for (let i = 0; i < 50; i++) s().activate(i % 2 ? 'lab' : 'patients');
    expect(Math.max(...s().windows.map((w) => w.z))).toBeLessThanOrEqual(s().windows.length);
  });
  it('minimise keeps the dock tab; activate restores; the next window becomes active (T6, T7)', () => {
    s().open('patients');
    s().open('lab');
    s().minimize('lab');
    expect(s().windows).toHaveLength(2);
    expect(win('lab').mode).toBe('minimized');
    expect(s().activeId).toBe('patients');
    s().activate('lab');
    expect(win('lab').mode).toBe('floating');
    expect(s().activeId).toBe('lab');
  });
  it('close removes the window and hands focus to the most recently used one (T10)', () => {
    s().open('patients');
    s().open('lab');
    s().close('lab');
    expect(s().windows.map((w) => w.id)).toEqual(['patients']);
    expect(s().activeId).toBe('patients');
    s().close('patients');
    expect(s().activeId).toBeNull();
  });
  it('maximise fills the work area and restore returns to the previous geometry (T8, T9)', () => {
    s().open('patients');
    const before = { ...win('patients').rect };
    s().toggleMaximize('patients');
    expect(win('patients').mode).toBe('maximized');
    const frames = computeFrames(s().windows, s().layout, s().area);
    expect(frames.frames.get('patients')).toMatchObject({
      rect: { x: 0, y: 0, w: area.width, h: area.height },
      tier: 'max',
    });
    s().toggleMaximize('patients');
    expect(win('patients').mode).toBe('floating');
    expect(win('patients').rect).toEqual(before);
  });
  it('resizing the work area re-fits floating windows inside the 24/16 px margins (T13)', () => {
    s().open('patient-detail', { mrn: '00012346' });
    s().setArea({ width: 1280, height: 512 }); // e.g. a 1280×800 screen with browser chrome
    const r = win('patient-detail:00012346').rect;
    expect(r.x).toBeGreaterThanOrEqual(24);
    expect(r.y).toBeGreaterThanOrEqual(16);
    expect(r.x + r.w).toBeLessThanOrEqual(1280 - 24);
    expect(r.y + r.h).toBeLessThanOrEqual(512 - 16);
    s().setArea({ width: 800, height: 500 });
    const small = win('patient-detail:00012346').rect;
    expect(small.x + small.w).toBeLessThanOrEqual(800 - 24);
    expect(small.w).toBeGreaterThanOrEqual(360);
  });
  it('showHome minimises everything; reset wipes all state (T14, T15)', () => {
    s().open('patients');
    s().showHome();
    expect(s().windows.every((w) => w.mode === 'minimized')).toBe(true);
    expect(s().activeId).toBeNull();
    s().reset();
    expect(s().windows).toHaveLength(0);
    expect(s().layout).toBe('free');
  });
});

describe('window store — tile layouts (up to 4 tiles)', () => {
  it('picking a preset tiles the most recently used windows; extra windows float on top (T3)', () => {
    for (const k of ['patients', 'lab', 'radiology', 'billing'] as const) s().open(k);
    s().activate('patients');
    s().setLayout('cols2');
    const tiled = s().windows.filter((w) => w.mode === 'tiled');
    expect(tiled.map((w) => w.id).sort()).toEqual(['billing', 'patients'].sort());
    expect(win('patients').slot).toBe(0);
    expect(win('billing').slot).toBe(1);
    expect(win('lab').mode).toBe('floating');
    expect(win('radiology').mode).toBe('floating');
  });
  it('floating windows stay on top of tiles (stacking tiers)', () => {
    for (const k of ['patients', 'lab', 'radiology'] as const) s().open(k);
    s().setLayout('cols2');
    const { frames } = computeFrames(s().windows, s().layout, s().area);
    const tile = Math.max(
      ...s()
        .windows.filter((w) => w.mode === 'tiled')
        .map((w) => frames.get(w.id)!.zIndex),
    );
    const float = Math.min(
      ...s()
        .windows.filter((w) => w.mode === 'floating')
        .map((w) => frames.get(w.id)!.zIndex),
    );
    expect(float).toBeGreaterThan(tile);
    expect(Math.max(...[...frames.values()].map((f) => f.zIndex))).toBeLessThan(200);
  });
  it('a new window takes a free slot, otherwise it floats and never evicts a tile (T2)', () => {
    s().setLayout('cols2');
    s().open('patients');
    s().open('lab');
    s().open('radiology');
    expect(win('patients')).toMatchObject({ mode: 'tiled', slot: 0 });
    expect(win('lab')).toMatchObject({ mode: 'tiled', slot: 1 });
    expect(win('radiology').mode).toBe('floating');
  });
  it('supports up to 4 tiles in a 2×2 layout', () => {
    s().setLayout('grid4');
    for (const k of ['patients', 'lab', 'radiology', 'billing'] as const) s().open(k);
    expect(s().windows.map((w) => w.slot)).toEqual([0, 1, 2, 3]);
    expect(computeFrames(s().windows, 'grid4', area).emptySlots).toEqual([]);
  });
  it('closing a tile leaves an empty-slot placeholder (decided 2026-10-29)', () => {
    s().setLayout('cols2');
    s().open('patients');
    s().open('lab');
    s().close('lab');
    expect(computeFrames(s().windows, s().layout, area).emptySlots).toEqual([1]);
  });
  it('a minimised tile returns to its slot if it is still free, otherwise it floats on top (T7)', () => {
    s().setLayout('cols2');
    s().open('patients');
    s().open('lab');
    s().minimize('lab');
    s().activate('lab');
    expect(win('lab')).toMatchObject({ mode: 'tiled', slot: 1 });
    s().minimize('lab');
    s().open('radiology'); // takes the free slot 1
    s().activate('lab');
    expect(win('lab').mode).toBe('floating');
  });
  it('dragging a tile out makes it floating at its current size (T5)', () => {
    s().setLayout('cols2');
    s().open('patients');
    const rect = slotRects('cols2', area)[0]!;
    s().dragOut('patients', rect);
    expect(win('patients')).toMatchObject({ mode: 'floating', slot: null });
    expect(win('patients').rect.w).toBe(rect.w);
  });
  it('back to free windows keeps every window, floating where its tile was', () => {
    s().setLayout('cols2');
    s().open('patients');
    s().open('lab');
    const second = slotRects('cols2', area)[1]!;
    s().setLayout('free');
    expect(s().windows.every((w) => w.mode === 'floating')).toBe(true);
    expect(win('lab').rect.x).toBe(second.x);
  });
  it('a maximised tile keeps its slot reserved and returns to it (T8, T9)', () => {
    s().setLayout('cols2');
    s().open('patients');
    s().toggleMaximize('patients');
    expect(computeFrames(s().windows, s().layout, area).emptySlots).toEqual([1]);
    s().toggleMaximize('patients');
    expect(win('patients')).toMatchObject({ mode: 'tiled', slot: 0 });
  });
});

describe('shell compact mode (T11–T12)', () => {
  it('too small for the preset: tiling pauses and only the most recently used window shows', () => {
    s().setLayout('grid4');
    s().open('patients');
    s().open('lab');
    s().activate('patients');
    s().setArea({ width: 700, height: 500 });
    const f = computeFrames(s().windows, s().layout, s().area);
    expect(f.compact).toBe(true);
    expect(f.frames.get('patients')!.hidden).toBe(false);
    expect(f.frames.get('lab')!.hidden).toBe(true);
    expect(f.emptySlots).toEqual([]);
    expect(mostRecent(s().windows)?.id).toBe('patients');
  });
  it('growing again restores the previous layout and window states (T12)', () => {
    s().setLayout('cols2');
    s().open('patients');
    s().open('lab');
    s().setArea({ width: 500, height: 500 });
    expect(computeFrames(s().windows, s().layout, s().area).compact).toBe(true);
    s().setArea(area);
    const f = computeFrames(s().windows, s().layout, s().area);
    expect(f.compact).toBe(false);
    expect(f.frames.get('lab')).toMatchObject({ hidden: false, tier: 'tile' });
    expect(win('lab')).toMatchObject({ mode: 'tiled', slot: 1 });
  });
});
