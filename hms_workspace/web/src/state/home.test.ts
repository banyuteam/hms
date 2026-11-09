import { beforeEach, describe, expect, it } from 'vitest';
import { computeFrames } from '@/features/workspace/frames';
import {
  EDGE_MARGIN,
  MIN_WINDOW_WIDTH,
  clampRect,
  defaultRect,
  isCompact,
  layoutFits,
  slotRects,
} from '@/features/workspace/geometry';
import {
  bindHomeActions,
  homeReducer,
  initialHomeState,
  mostRecent,
  windowId,
  type HomeState,
} from './home';

const area = { width: 1440, height: 780 };
let state: HomeState = initialHomeState;
// Synchronous dispatch: the reducer is pure, so the actions can be exercised without React.
const actions = bindHomeActions((action) => {
  state = homeReducer(state, action);
});
const s = () => ({ ...state, ...actions });
const win = (id: string) => state.windows.find((w) => w.id === id)!;

beforeEach(() => {
  state = initialHomeState;
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
  it('computes the main2 tiles at 1440×780: 24 px margin, 16 px gap, 1+2', () => {
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

describe('home reducer — states and transitions', () => {
  it('opens one window per module and focuses it again instead of duplicating (T1)', () => {
    s().open('emr-records');
    s().open('lab');
    s().open('emr-records');
    expect(s().windows.map((w) => w.id)).toEqual(['emr-records', 'lab']);
    expect(s().activeId).toBe('emr-records');
    expect(win('emr-records').mode).toBe('floating');
  });
  it('record windows are multi-instance, one per record (plus one blank window per kind)', () => {
    s().open('emr-profile', { mrn: '00012346' });
    s().open('emr-profile', { mrn: '00012345' });
    s().open('emr-profile', { mrn: '00012346' });
    s().open('emr-profile');
    expect(s().windows.map((w) => w.id)).toEqual([
      'emr-profile:00012346',
      'emr-profile:00012345',
      'emr-profile',
    ]);
    expect(windowId('emr-profile', { mrn: '1' })).toBe('emr-profile:1');
    expect(windowId('lab', { norawat: '2026/10/26/000123', item: 'hb' })).toBe(
      'lab:2026/10/26/000123|hb',
    );
  });
  it('retarget points a blank window at a record, or focuses the existing one instead of duplicating', () => {
    s().open('emr-records');
    s().retarget('emr-records', { norawat: '2026/10/26/000123' });
    expect(s().windows.map((w) => w.id)).toEqual(['emr-records:2026/10/26/000123']);
    expect(s().activeId).toBe('emr-records:2026/10/26/000123');
    s().open('emr-records');
    s().retarget('emr-records', { norawat: '2026/10/26/000123' });
    expect(s().windows.map((w) => w.id)).toEqual(['emr-records:2026/10/26/000123']);
    expect(s().activeId).toBe('emr-records:2026/10/26/000123');
  });
  it('keeps z-order: the activated window is on top and ranks stay small (z-index band)', () => {
    s().open('emr-records');
    s().open('lab');
    s().activate('emr-records');
    expect(win('emr-records').z).toBeGreaterThan(win('lab').z);
    for (let i = 0; i < 50; i++) s().activate(i % 2 ? 'lab' : 'emr-records');
    expect(Math.max(...s().windows.map((w) => w.z))).toBeLessThanOrEqual(s().windows.length);
  });
  it('minimise keeps the dock tab; activate restores; the next window becomes active (T6, T7)', () => {
    s().open('emr-records');
    s().open('lab');
    s().minimize('lab');
    expect(s().windows).toHaveLength(2);
    expect(win('lab').mode).toBe('minimized');
    expect(s().activeId).toBe('emr-records');
    s().activate('lab');
    expect(win('lab').mode).toBe('floating');
    expect(s().activeId).toBe('lab');
  });
  it('close removes the window and hands focus to the most recently used one (T10)', () => {
    s().open('emr-records');
    s().open('lab');
    s().close('lab');
    expect(s().windows.map((w) => w.id)).toEqual(['emr-records']);
    expect(s().activeId).toBe('emr-records');
    s().close('emr-records');
    expect(s().activeId).toBeNull();
  });
  it('maximise fills the work area and restore returns to the previous geometry (T8, T9)', () => {
    s().open('emr-records');
    const before = { ...win('emr-records').rect };
    s().toggleMaximize('emr-records');
    expect(win('emr-records').mode).toBe('maximized');
    const frames = computeFrames(s().windows, s().layout, s().area);
    expect(frames.frames.get('emr-records')).toMatchObject({
      rect: { x: 0, y: 0, w: area.width, h: area.height },
      tier: 'max',
    });
    s().toggleMaximize('emr-records');
    expect(win('emr-records').mode).toBe('floating');
    expect(win('emr-records').rect).toEqual(before);
  });
  it('"stay on top" keeps a window above a maximised one, through minimise and restore', () => {
    s().open('emr-records');
    s().open('lab');
    s().toggleMaximize('emr-records');
    s().activate('emr-records');
    const z = () => {
      const { frames } = computeFrames(s().windows, s().layout, s().area, s().activeId);
      return { records: frames.get('emr-records')!, lab: frames.get('lab')! };
    };
    // Without the rule the active maximised window covers every floating window.
    expect(z().records.zIndex).toBeGreaterThan(z().lab.zIndex);

    s().toggleOnTop('lab');
    expect(win('lab').onTop).toBe(true);
    expect(z().lab).toMatchObject({ tier: 'top' });
    expect(z().lab.zIndex).toBeGreaterThan(z().records.zIndex);
    s().activate('emr-records'); // using the maximised window does not cover it
    expect(z().lab.zIndex).toBeGreaterThan(z().records.zIndex);

    s().minimize('lab');
    s().activate('lab');
    expect(z().lab.zIndex).toBeGreaterThan(z().records.zIndex);

    // A maximised window cannot be set on top; while maximised the rule has no effect.
    s().toggleOnTop('emr-records');
    expect(win('emr-records').onTop).toBe(false);
    s().toggleMaximize('lab');
    expect(z().lab).toMatchObject({ tier: 'max' });
    s().toggleMaximize('lab');
    expect(z().lab).toMatchObject({ tier: 'top' });

    s().toggleOnTop('lab');
    s().activate('emr-records'); // unpinned: using the maximised window covers it again
    expect(z().records.zIndex).toBeGreaterThan(z().lab.zIndex);
  });
  it('the active window is drawn above a maximised one (dock click), below a "stay on top" window', () => {
    s().open('emr-records');
    s().open('lab');
    s().open('radiology');
    s().toggleMaximize('emr-records');
    s().toggleOnTop('radiology');
    s().activate('emr-records');
    const z = (id: string) =>
      computeFrames(s().windows, s().layout, s().area, s().activeId).frames.get(id)!.zIndex;
    expect(z('emr-records')).toBeGreaterThan(z('lab'));
    s().activate('lab'); // e.g. its dock tab
    expect(z('lab')).toBeGreaterThan(z('emr-records'));
    expect(z('radiology')).toBeGreaterThan(z('lab'));
    s().activate('emr-records'); // clicking the maximised window covers it again
    expect(z('emr-records')).toBeGreaterThan(z('lab'));
  });
  it('a tiled window set on top stays above a maximised window; z-index stays in the band', () => {
    for (const k of ['emr-records', 'lab', 'radiology'] as const) s().open(k);
    s().setLayout('cols2');
    const tiled = s().windows.find((w) => w.mode === 'tiled')!.id;
    const other = s().windows.find((w) => w.id !== tiled)!.id;
    s().toggleOnTop(tiled);
    s().toggleMaximize(other);
    s().activate(other);
    const { frames } = computeFrames(s().windows, s().layout, s().area, s().activeId);
    expect(frames.get(tiled)!.zIndex).toBeGreaterThan(frames.get(other)!.zIndex);
    const all = [...frames.values()].filter((f) => !f.hidden).map((f) => f.zIndex);
    expect(new Set(all).size).toBe(all.length);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...all)).toBeLessThan(200);
  });
  it('resizing the work area re-fits floating windows inside the 24/16 px margins (T13)', () => {
    s().open('emr-profile', { mrn: '00012346' });
    s().setArea({ width: 1280, height: 512 }); // e.g. a 1280×800 screen with browser chrome
    const r = win('emr-profile:00012346').rect;
    expect(r.x).toBeGreaterThanOrEqual(24);
    expect(r.y).toBeGreaterThanOrEqual(16);
    expect(r.x + r.w).toBeLessThanOrEqual(1280 - 24);
    expect(r.y + r.h).toBeLessThanOrEqual(512 - 16);
    s().setArea({ width: 800, height: 500 });
    const small = win('emr-profile:00012346').rect;
    expect(small.x + small.w).toBeLessThanOrEqual(800 - 24);
    expect(small.w).toBeGreaterThanOrEqual(360);
  });
  it('showHome minimises everything; reset wipes all state (T14, T15)', () => {
    s().open('emr-records');
    s().showHome();
    expect(s().windows.every((w) => w.mode === 'minimized')).toBe(true);
    expect(s().activeId).toBeNull();
    s().reset();
    expect(s().windows).toHaveLength(0);
    expect(s().layout).toBe('free');
  });
});

describe('home reducer — tile layouts (up to 4 tiles)', () => {
  it('picking a preset tiles the most recently used windows; extra windows float on top (T3)', () => {
    for (const k of ['emr-records', 'lab', 'radiology', 'billing'] as const) s().open(k);
    s().activate('emr-records');
    s().setLayout('cols2');
    const tiled = s().windows.filter((w) => w.mode === 'tiled');
    expect(tiled.map((w) => w.id).sort()).toEqual(['billing', 'emr-records'].sort());
    expect(win('emr-records').slot).toBe(0);
    expect(win('billing').slot).toBe(1);
    expect(win('lab').mode).toBe('floating');
    expect(win('radiology').mode).toBe('floating');
  });
  it('floating windows stay on top of tiles (stacking tiers)', () => {
    for (const k of ['emr-records', 'lab', 'radiology'] as const) s().open(k);
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
    s().open('emr-records');
    s().open('lab');
    s().open('radiology');
    expect(win('emr-records')).toMatchObject({ mode: 'tiled', slot: 0 });
    expect(win('lab')).toMatchObject({ mode: 'tiled', slot: 1 });
    expect(win('radiology').mode).toBe('floating');
  });
  it('supports up to 4 tiles in a 2×2 layout', () => {
    s().setLayout('grid4');
    for (const k of ['emr-records', 'lab', 'radiology', 'billing'] as const) s().open(k);
    expect(s().windows.map((w) => w.slot)).toEqual([0, 1, 2, 3]);
    expect(computeFrames(s().windows, 'grid4', area).emptySlots).toEqual([]);
  });
  it('closing a tile leaves an empty-slot placeholder (decided 2026-10-29)', () => {
    s().setLayout('cols2');
    s().open('emr-records');
    s().open('lab');
    s().close('lab');
    expect(computeFrames(s().windows, s().layout, area).emptySlots).toEqual([1]);
  });
  it('a minimised tile returns to its slot if it is still free, otherwise it floats on top (T7)', () => {
    s().setLayout('cols2');
    s().open('emr-records');
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
    s().open('emr-records');
    const rect = slotRects('cols2', area)[0]!;
    s().dragOut('emr-records', rect);
    expect(win('emr-records')).toMatchObject({ mode: 'floating', slot: null });
    expect(win('emr-records').rect.w).toBe(rect.w);
  });
  it('back to free windows keeps every window, floating where its tile was', () => {
    s().setLayout('cols2');
    s().open('emr-records');
    s().open('lab');
    const second = slotRects('cols2', area)[1]!;
    s().setLayout('free');
    expect(s().windows.every((w) => w.mode === 'floating')).toBe(true);
    expect(win('lab').rect.x).toBe(second.x);
  });
  it('a maximised tile keeps its slot reserved and returns to it (T8, T9)', () => {
    s().setLayout('cols2');
    s().open('emr-records');
    s().toggleMaximize('emr-records');
    expect(computeFrames(s().windows, s().layout, area).emptySlots).toEqual([1]);
    s().toggleMaximize('emr-records');
    expect(win('emr-records')).toMatchObject({ mode: 'tiled', slot: 0 });
  });
});

describe('shell compact mode (T11–T12)', () => {
  it('too small for the preset: tiling pauses and only the most recently used window shows', () => {
    s().setLayout('grid4');
    s().open('emr-records');
    s().open('lab');
    s().activate('emr-records');
    s().setArea({ width: 700, height: 500 });
    const f = computeFrames(s().windows, s().layout, s().area);
    expect(f.compact).toBe(true);
    expect(f.frames.get('emr-records')!.hidden).toBe(false);
    expect(f.frames.get('lab')!.hidden).toBe(true);
    expect(f.emptySlots).toEqual([]);
    expect(mostRecent(s().windows)?.id).toBe('emr-records');
  });
  it('growing again restores the previous layout and window states (T12)', () => {
    s().setLayout('cols2');
    s().open('emr-records');
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
