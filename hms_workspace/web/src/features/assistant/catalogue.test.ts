import { describe, expect, it } from 'vitest';
import en from '@/locales/en/emr.json';
import id from '@/locales/id/emr.json';
import raw from './catalogue.json';
import { CATALOGUE, validateCatalogue } from './catalogue';

/** Every message id the catalogue names (claim errors are a prefix + the error kind). */
function replyIds(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && /^emr\.[\w.]+[^.]$/.test(value)) out.push(value);
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => replyIds(v, out));
  return out;
}

const clone = () => JSON.parse(JSON.stringify(raw)) as typeof raw;

describe('assistant catalogue', () => {
  it('the shipped catalogue is valid and its patterns compile', () => {
    expect(validateCatalogue(raw).success).toBe(true);
    expect(CATALOGUE.intentRes.map(([t]) => t)).toEqual([
      'claim',
      'diagnoses',
      'procedures',
      'labs',
      'medications',
      'summary',
    ]);
  });

  it('every reply it names exists in Indonesian and English', () => {
    const ids = replyIds(raw);
    expect(ids.length).toBeGreaterThan(10);
    for (const key of ids) {
      expect(id, key).toHaveProperty([key]);
      expect(en, key).toHaveProperty([key]);
    }
    for (const kind of ['forbidden', 'notFound', 'busy', 'badShape', 'unavailable']) {
      const key = `${CATALOGUE.claim.errorPrefix}${kind}`;
      expect(Object.keys(id)).toContain(key);
      expect(Object.keys(en)).toContain(key);
    }
  });

  it('rejects a format field the record source does not have', () => {
    const c = clone();
    c.answers.topics.diagnoses.rows.format = '{code} — {patientName}';
    const r = validateCatalogue(c);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('{patientName} is not a field of diagnoses');
  });

  it('rejects a topic missing from detection or the buttons, an unknown topic, or other regex flags', () => {
    const missing = clone();
    missing.intents.topics = missing.intents.topics.filter((t) => t.id !== 'labs');
    expect(validateCatalogue(missing).success).toBe(false);

    const unknown = clone();
    (unknown.sectionTopics.map as Record<string, string>).cppt = 'notes';
    expect(validateCatalogue(unknown).success).toBe(false);

    const flags = clone();
    (flags.advice as { flags: string }).flags = 'g';
    expect(validateCatalogue(flags).success).toBe(false);
  });
});
