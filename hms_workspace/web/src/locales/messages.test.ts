import { describe, expect, it } from 'vitest';
import enCommon from './en/common.json';
import enEmr from './en/emr.json';
import idCommon from './id/common.json';
import idEmr from './id/emr.json';
import { dayPart, formatDate, formatTime } from './format';
import { createTranslator } from './I18nProvider';
import { parseMessage } from './icu';
import { DEFAULT_LOCALE, MESSAGES } from './index';
import { formatStored, formatStoredDate, isoStored, parseStored, readStored } from './storedTime';

type Nodes = ReturnType<typeof parseMessage>;
/** Every argument name (including inside plural/select branches) of an ICU message. */
function argNames(nodes: Nodes, out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.kind === 'arg' || n.kind === 'plural' || n.kind === 'select') out.add(n.name);
    if (n.kind === 'plural' || n.kind === 'select')
      for (const b of Object.values(n.branches)) argNames(b, out);
  }
  return out;
}
const placeholders = (s: string) => [...argNames(parseMessage(s))].sort().join(',');

describe('message catalogs (id is the default and fallback, en must mirror it)', () => {
  it('have exactly the same keys per namespace', () => {
    expect(Object.keys(enCommon).sort()).toEqual(Object.keys(idCommon).sort());
    expect(Object.keys(enEmr).sort()).toEqual(Object.keys(idEmr).sort());
  });

  it('never define a key in two namespaces', () => {
    for (const k of Object.keys(idEmr)) expect(k in idCommon, k).toBe(false);
  });

  it('have no empty strings and every message parses', () => {
    for (const [k, v] of [...Object.entries(MESSAGES.id), ...Object.entries(MESSAGES.en)]) {
      expect(v.trim(), k).not.toBe('');
      expect(() => parseMessage(v), k).not.toThrow();
    }
  });

  it('use the same ICU placeholders in both languages', () => {
    for (const k of Object.keys(MESSAGES.id)) {
      expect(placeholders(MESSAGES.en[k] ?? ''), k).toBe(placeholders(MESSAGES.id[k] ?? ''));
    }
  });

  it('define every literal key passed to t() in the source', () => {
    const files = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const used = new Set(
      Object.values(files).flatMap((s) =>
        [...s.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)].map((m) => m[1]!),
      ),
    );
    expect(used.size).toBeGreaterThan(0);
    for (const k of used) expect(k in MESSAGES.id, k).toBe(true);
  });
});

describe('translator', () => {
  it('Indonesian is the default locale', () => expect(DEFAULT_LOCALE).toBe('id'));

  it('formats with values in the active locale', () => {
    expect(createTranslator('en')('login.submit')).toBe('Sign in');
    expect(createTranslator('id')('login.submit')).toBe('Masuk');
    expect(createTranslator('en')('login.notice.idle', { minutes: 1 })).toBe(
      'Your session ended after 1 minute of inactivity.',
    );
  });

  it('falls back en → id → the key itself', () => {
    const en = MESSAGES.en as Record<string, string>;
    const saved = en['login.submit'];
    delete en['login.submit'];
    try {
      expect(createTranslator('en')('login.submit')).toBe('Masuk');
    } finally {
      en['login.submit'] = saved!;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(createTranslator('en')('no.such.key')).toBe('no.such.key');
    spy.mockRestore();
  });
});

describe('formats: neutral English with Indonesian conventions', () => {
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

describe('stored timestamps (hospital local time, no zone conversion)', () => {
  it('parses date and date-time forms and rejects garbage', () => {
    expect(parseStored('2026-10-26 08:30:00')?.hasTime).toBe(true);
    expect(parseStored('2026-10-26')?.hasTime).toBe(false);
    expect(parseStored('undated')).toBeNull();
    expect(parseStored(null)).toBeNull();
  });
  it('rejects the legacy "no date" and impossible dates instead of rolling them over', () => {
    expect(parseStored('0000-00-00')).toBeNull();
    expect(parseStored('0000-00-00 00:00:00')).toBeNull();
    expect(formatStored('0000-00-00 00:00:00', 'en')).toBeNull(); // was "30 Nov 1899 00:00"
    expect(isoStored('0000-00-00')).toBeUndefined();
    expect(parseStored('2026-02-31')).toBeNull();
    expect(parseStored('2026-13-01')).toBeNull();
    expect(parseStored('2026-10-26 24:00:00')).toBeNull();
    expect(parseStored('2024-02-29')?.hasTime).toBe(false); // leap day is real
  });
  it('tells "not recorded" apart from a value that is not a real date', () => {
    for (const absent of [
      null,
      undefined,
      '',
      '  ',
      'undated',
      '0000-00-00',
      '0000-00-00 00:00:00',
      '10:00:00',
    ]) {
      expect(readStored(absent)).toEqual({ kind: 'absent' });
    }
    expect(readStored('2026-10-26 08:30:00').kind).toBe('valid');
    expect(readStored('2026-02-31')).toEqual({ kind: 'invalid', raw: '2026-02-31' });
    expect(readStored(' 26/10/2026 ')).toEqual({ kind: 'invalid', raw: '26/10/2026' });
  });
  it('renders exactly the stored wall time', () => {
    expect(formatStored('2026-10-26T08:30:00', 'en')).toBe('26 Oct 2026 08:30');
    expect(formatStoredDate('2026-10-26 23:59:00', 'id')).toBe('26 Okt 2026');
    expect(formatStored('2026-10-26', 'en')).toBe('26 Oct 2026');
    expect(isoStored('2026-10-26 08:30:00')).toBe('2026-10-26T08:30:00');
    expect(isoStored('2026-10-26')).toBe('2026-10-26');
  });
});
