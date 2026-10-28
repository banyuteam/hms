import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';
import en from './messages/en.json';
import id from './messages/id.json';
import { detectInitialLocale, saveLocale } from './locales';
import { dayPart, formatDate, formatTime } from './format';

type Node = ReturnType<typeof parse>[number];
/** Collects every argument name (including inside plural/select branches) from an ICU message. */
function argNames(nodes: Node[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if ('value' in n && typeof n.value === 'string' && n.type !== TYPE.literal) out.add(n.value);
    if (n.type === TYPE.select || n.type === TYPE.plural)
      for (const o of Object.values(n.options)) argNames(o.value, out);
  }
  return out;
}
const placeholders = (s: string) => [...argNames(parse(s))].sort().join(',');

describe('message catalogs (id is the source of truth, en must mirror it)', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(id).sort());
  });
  it('have no empty strings', () => {
    for (const [k, v] of [...Object.entries(id), ...Object.entries(en)])
      expect(v.trim(), k).not.toBe('');
  });
  it('use the same ICU placeholders in both languages', () => {
    for (const k of Object.keys(id)) {
      expect(placeholders((en as Record<string, string>)[k] ?? ''), k).toBe(
        placeholders((id as Record<string, string>)[k] ?? ''),
      );
    }
  });
});

describe('locale detection & storage', () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it('prefers a saved locale', () =>
    expect(detectInitialLocale(store('en'), ['id-ID'])).toBe('en'));
  it('uses English browsers, else Indonesian', () => {
    expect(detectInitialLocale(store(null), ['en-US'])).toBe('en');
    expect(detectInitialLocale(store(null), ['fr-FR'])).toBe('id');
    expect(detectInitialLocale(undefined, [])).toBe('id');
  });
  it('ignores garbage values and survives blocked storage', () => {
    expect(detectInitialLocale(store('xx'), [])).toBe('id');
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(detectInitialLocale(blocked, ['en'])).toBe('en');
    expect(() => saveLocale('en', blocked)).not.toThrow();
  });
});

describe('formats: neutral English with Indonesian conventions (OQ-35)', () => {
  const d = new Date('2026-10-27T03:24:00Z'); // 10:24 in Asia/Jakarta
  it('formats dates and 24-hour time in Asia/Jakarta', () => {
    expect(formatTime(d, 'id')).toBe('10:24');
    expect(formatTime(d, 'en')).toBe('10:24');
    expect(formatDate(d, 'en')).toBe('27 Oct 2026');
    expect(formatDate(d, 'id')).toMatch(/^27 Okt 2026$/);
  });
  it('derives the day part in Jakarta time', () => {
    expect(dayPart(d)).toBe('morning');
    expect(dayPart(new Date('2026-10-27T16:00:00Z'))).toBe('night'); // 23:00 WIB
  });
});
