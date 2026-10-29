import { describe, expect, it } from 'vitest';
import { visibleTabCount } from './tabLayout';

const w = (n: number, each: number) => Array.from({ length: n }, () => each);

describe('visibleTabCount (More ▾ overflow, OQ-52)', () => {
  it('shows every tab when all fit and there are no more than the cap', () => {
    expect(visibleTabCount(w(6, 100), 700, 80, 8)).toBe(6);
    expect(visibleTabCount(w(8, 100), 800, 80, 8)).toBe(8);
  });
  it('never shows more than 8 tabs, even on a very wide window', () => {
    expect(visibleTabCount(w(11, 90), 5000, 80, 8)).toBe(8);
  });
  it('shows as many as fit next to the More button when space is short', () => {
    // 534 px: Overview, Medical Record, Encounters, Orders fit with More (Mockup 05)
    expect(
      visibleTabCount([92, 128, 102, 74, 77, 107, 103, 69, 102, 91, 87], 534 - 16, 80, 8),
    ).toBe(4);
    expect(visibleTabCount(w(11, 100), 400, 80, 8)).toBe(3);
  });
  it('keeps at least one tab', () => {
    expect(visibleTabCount(w(11, 300), 100, 80, 8)).toBe(1);
  });
});
