import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KnowledgeRelease } from '@/api/assistantKnowledgeApi';
import { SYNTHETIC_JOURNEYS } from '@/data/emrFixtures';
import { compileKnowledge, normalizeMessage } from './knowledge';
import { reply, type AssistantTag } from './rules';

/** A small release in the server's shape (assistant-v1 KnowledgeRelease). No patient data. */
const RELEASE: KnowledgeRelease = {
  dataset: 'hms-assistant.general-help',
  version: 'test',
  approved_at: '2026-11-10',
  languages: ['id', 'en'],
  intents: [
    {
      tag: 'greeting',
      patterns: ['halo', 'hai', 'selamat pagi'],
      responses: { id: 'Halo!', en: 'Hello!' },
    },
    {
      tag: 'help.claim_readiness',
      patterns: ['apa itu kesiapan klaim', 'what is claim readiness'],
      responses: { id: 'Kesiapan klaim adalah…', en: 'Claim readiness is…' },
    },
    {
      tag: 'out_of_scope',
      patterns: ['resep masakan', 'cuaca hari ini'],
      responses: { id: 'Maaf…', en: 'Sorry…' },
    },
    {
      tag: 'safety.advice_refusal',
      patterns: ['boleh minum obat ini'],
      responses: { id: 'x', en: 'x' },
    },
  ],
};
const k = compileKnowledge(RELEASE);
const j = SYNTHETIC_JOURNEYS[0]!;
const tag: AssistantTag = { id: `enc:${j.no_rawat}`, kind: 'encounter', norawat: j.no_rawat };
const lookup = (nr: string) => (nr === j.no_rawat ? j : undefined);

describe('general-help matching (deterministic)', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalizeMessage('  Selamat   PAGI, Asistén!! ')).toBe('selamat pagi asisten');
  });

  it('strong: the whole message, or a multi-word example inside it; the longest example wins', () => {
    expect(k.strong('Selamat pagi!')?.tag).toBe('greeting');
    expect(k.strong('maaf, apa itu kesiapan klaim ya?')?.tag).toBe('help.claim_readiness');
    expect(k.strong('hai')?.tag).toBe('greeting');
    // A one-word example inside a longer message is only a weak match.
    expect(k.strong('hai tolong ringkas')).toBeUndefined();
    expect(k.weak('hai tolong ringkas')?.tag).toBe('greeting');
    // Whole words only: "haid" is not "hai".
    expect(k.weak('haid')).toBeUndefined();
  });
});

describe('precedence (owner, 2026-11-10: general help on top)', () => {
  const ask = (text: string, tags: AssistantTag[] = [tag]) =>
    reply(text, tags, lookup, undefined, k);

  it('general help comes first: strong, then one-word matches, before everything else', () => {
    expect(ask('apa itu kesiapan klaim')).toMatchObject({
      intent: 'general',
      knowledgeTag: 'help.claim_readiness',
      lines: [{ text: { id: 'Kesiapan klaim adalah…', en: 'Claim readiness is…' } }],
    });
    expect(ask('resep masakan').knowledgeTag).toBe('out_of_scope');
    // A one-word example now beats the record topics too.
    expect(ask('hai, tolong ringkas').knowledgeTag).toBe('greeting');
    expect(ask('hai', []).knowledgeTag).toBe('greeting');
    // A strong match beats a one-word one.
    expect(ask('hai, apa itu kesiapan klaim').knowledgeTag).toBe('help.claim_readiness');
  });

  it('above advice refusal: a help example wins even when the message also asks for advice', () => {
    expect(ask('selamat pagi, obat apa yang sebaiknya?').knowledgeTag).toBe('greeting');
    // The answer is approved static text, never advice; the release's refusal intent still refuses.
    expect(ask('boleh minum obat ini?')).toEqual({
      intent: 'refuse',
      lines: [{ id: 'emr.ai.reply.refuse' }],
    });
  });

  it('without a help example: advice refusal, then the record topics, as before', () => {
    expect(ask('obat apa yang sebaiknya diberikan?').intent).toBe('refuse');
    expect(ask('cek klaim').evaluate).toBe(j.no_rawat);
    expect(ask('resep').intent).toBe('medications');
  });

  it('without a release (none approved, not loaded yet, synthetic build) nothing changes', () => {
    expect(reply('hai', [], lookup).intent).toBe('help');
    expect(reply('apa itu kesiapan klaim', [tag], lookup).evaluate).toBe(j.no_rawat);
    expect(reply('selamat pagi, obat apa yang sebaiknya?', [tag], lookup).intent).toBe('refuse');
  });
});

/**
 * The dataset's held-out `test` sentences, used only to measure (never matched against; hms_services never serves
 * them). The file belongs to hms_services: this test reads it when the workspace has it and skips otherwise.
 */
const DATASET = resolve(
  __dirname,
  '../../../../../hms_services/runtimes/python-workers/assistant/datasets/general-help.seed.json',
);

describe.skipIf(!existsSync(DATASET))('held-out test set of the general-help dataset', () => {
  interface Seed {
    languages: string[];
    intents: {
      tag: string;
      patterns: string[];
      responses: { lang: string; text: string }[];
      context_set: string;
      review: string;
    }[];
    test: { text: string; tag: string }[];
  }
  const seed = JSON.parse(readFileSync(DATASET, 'utf-8')) as Seed;
  // The same selection as the server's release (hms_services assistant/knowledge.go).
  const release: KnowledgeRelease = {
    dataset: 'hms-assistant.general-help',
    version: 'seed',
    approved_at: '',
    languages: seed.languages,
    intents: seed.intents
      .filter(
        (i) =>
          i.review === 'from_app' &&
          i.context_set === '' &&
          seed.languages.every((l) =>
            i.responses.some((r) => r.lang === l && r.text.trim() && !r.text.includes('TODO')),
          ),
      )
      .map((i) => ({
        tag: i.tag,
        patterns: i.patterns,
        responses: Object.fromEntries(i.responses.map((r) => [r.lang, r.text])),
      })),
  };
  const served = new Set(release.intents.map((i) => i.tag));
  const knowledge = compileKnowledge(release);

  it('measures the deterministic matcher (accuracy is reported, and must not fall below the floor)', () => {
    const results = seed.test.map(({ text, tag: expected }) => {
      const r = reply(text, [], () => undefined, undefined, knowledge);
      const ok =
        expected === 'safety.advice_refusal'
          ? r.intent === 'refuse'
          : served.has(expected)
            ? r.intent === 'general' && r.knowledgeTag === expected
            : r.intent !== 'general'; // an intent left out of the release must not be answered by another one
      return { text, expected, got: r.knowledgeTag ?? r.intent, ok };
    });
    const correct = results.filter((r) => r.ok).length;
    // Wrong answers are worse than none: a general-help answer for the wrong intent.
    const wrong = results.filter(
      (r) => !r.ok && r.got !== 'help' && r.got !== 'needTag' && r.got !== r.expected,
    );
    console.info(
      `general-help held-out: ${correct}/${results.length} correct; misses:\n` +
        results
          .filter((r) => !r.ok)
          .map((r) => `  "${r.text}" → ${r.got} (expected ${r.expected})`)
          .join('\n'),
    );
    expect(correct).toBeGreaterThanOrEqual(MIN_CORRECT);
    expect(wrong.length).toBeLessThanOrEqual(MAX_WRONG);
  });
});

// Regression floor, set from the first measurement (2026-11-10). Raise it when the dataset or the matcher improves.
const MIN_CORRECT = 12;
const MAX_WRONG = 0;
