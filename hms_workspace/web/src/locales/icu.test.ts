import { describe, expect, it } from 'vitest';
import { formatMessage, parseMessage } from './icu';

describe('ICU subset formatter', () => {
  it('replaces simple arguments and formats numbers per locale', () => {
    expect(formatMessage('Hello {name}', { name: 'Siti' })).toBe('Hello Siti');
    expect(formatMessage('{n} items', { n: 1234 }, 'id-ID')).toBe('1.234 items');
    expect(formatMessage('{n} items', { n: 1234 }, 'en-GB')).toBe('1,234 items');
  });

  it('leaves a missing argument visible instead of crashing', () => {
    expect(formatMessage('Hi {name}')).toBe('Hi {name}');
  });

  it('picks plural branches: exact =N first, then the plural category, # is the number', () => {
    const msg = '{n, plural, =0 {none} one {# day} other {# days}}';
    expect(formatMessage(msg, { n: 0 }, 'en-GB')).toBe('none');
    expect(formatMessage(msg, { n: 1 }, 'en-GB')).toBe('1 day');
    expect(formatMessage(msg, { n: 2500 }, 'en-GB')).toBe('2,500 days');
    // Indonesian has only "other".
    expect(formatMessage(msg, { n: 1 }, 'id-ID')).toBe('1 days');
  });

  it('selects by value with an other fallback', () => {
    const msg = '{sex, select, male {M} female {F} other {?}}';
    expect(formatMessage(msg, { sex: 'female' })).toBe('F');
    expect(formatMessage(msg, { sex: 'x' })).toBe('?');
  });

  it('supports nesting and arguments inside branches', () => {
    const msg =
      '{part, select, morning {Good morning, {name}: {n, plural, one {# task} other {# tasks}}} other {Hi {name}}}';
    expect(formatMessage(msg, { part: 'morning', name: 'A', n: 3 }, 'en-GB')).toBe(
      'Good morning, A: 3 tasks',
    );
    expect(formatMessage(msg, { part: 'night', name: 'A', n: 3 })).toBe('Hi A');
  });

  it('honours apostrophe quoting', () => {
    expect(formatMessage("Don't panic")).toBe("Don't panic");
    expect(formatMessage("It''s {x}", { x: 'ok' })).toBe("It's ok");
    expect(formatMessage("Use '{braces}' literally")).toBe('Use {braces} literally');
    expect(formatMessage("{n, plural, other {'#' is # }}", { n: 2 }, 'en-GB')).toBe('# is 2 ');
  });

  it('rejects malformed or unsupported messages', () => {
    expect(() => parseMessage('{unclosed')).toThrow(/ICU/);
    expect(() => parseMessage('stray }')).toThrow(/ICU/);
    expect(() => parseMessage('{n, plural, one {x}}')).toThrow(/other/);
    expect(() => parseMessage('{d, date, short}')).toThrow(/unsupported/);
    expect(() => parseMessage("'{never closed")).toThrow(/quote/);
  });
});
