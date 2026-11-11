import { describe, expect, it, vi } from 'vitest';
import { SYNTHETIC_CLAIM_EVALUATIONS } from '@/data/claimFixtures';
import { SYNTHETIC_JOURNEYS } from '@/data/emrFixtures';
import {
  ask,
  claimErrorLines,
  claimLines,
  detectIntent,
  reply,
  subjectOf,
  type AssistantTag,
} from './rules';

const j = SYNTHETIC_JOURNEYS[0]!;
const tag: AssistantTag = { id: `enc:${j.no_rawat}`, kind: 'encounter', norawat: j.no_rawat };
const lookup = (nr: string) => (nr === j.no_rawat ? j : undefined);

describe('rule-based assistant', () => {
  it.each([
    'What dose of furosemide should I give?',
    'Should we stop the bisoprolol?',
    'obat apa yang sebaiknya diberikan?',
    'Diagnose this patient please',
    'boleh minum obat ini?',
    'perlukah dirawat?',
  ])('refuses clinical advice: %s', (q) => {
    expect(detectIntent(q)).toBe('refuse');
    expect(reply(q, [tag], lookup).lines).toEqual([{ id: 'emr.ai.reply.refuse' }]);
  });

  // Catalogue 1.0.1 routing fixes.
  it.each([
    // "medis" (rekam medis, riwayat medis) is not medication.
    ['ringkasan rekam medis pasien ini', 'summary'],
    ['riwayat medis pasien', 'summary'],
    ['obat yang diberikan apa saja', 'medications'],
    ['meds list', 'medications'],
    // Radiology results are not lab results; there is no radiology topic, so the text gets help.
    ['hasil rontgen thorax', 'help'],
    ['x-ray results', 'help'],
    ['hasil lab', 'labs'],
    // The recorded diagnosis is a read-back whatever the word order.
    ['apa diagnosisnya?', 'diagnoses'],
    ['diagnosisnya apa?', 'diagnoses'],
  ])('routes %s to %s', (q, want) => {
    expect(detectIntent(q)).toBe(want);
  });

  it('asks for a tagged record before reading anything', () => {
    expect(reply('summarize', [], lookup).intent).toBe('needTag');
  });

  it('a tagged patient never stands in for a visit: it asks which visit (F-7)', () => {
    const patient: AssistantTag = { id: 'pt:00012345', kind: 'patient', mrn: '00012345' };
    const read = vi.fn(lookup);
    for (const q of ['summarize', 'list the diagnoses', 'kesiapan klaim']) {
      expect(reply(q, [patient], read)).toEqual({
        intent: 'needVisit',
        lines: [{ id: 'emr.ai.reply.needVisit', values: { mrn: '00012345' } }],
      });
    }
    expect(read).not.toHaveBeenCalled();
    // A visit the user tagged is used, whichever was tagged last.
    expect(reply('summarize', [tag, patient], lookup).intent).toBe('summary');
    expect(reply('summarize', [patient, tag], lookup).intent).toBe('summary');
  });

  it('reads back ICD-10 diagnoses in priority order, as stored', () => {
    const r = reply('list the diagnoses', [tag], lookup);
    expect(r.intent).toBe('diagnoses');
    expect(r.lines).toContainEqual({ raw: '1. I50.0 — Congestive heart failure' });
    expect(r.lines.at(-1)).toEqual({ id: 'emr.ai.reply.disclaimer' });
  });

  it('lists only source-flagged lab results', () => {
    const r = reply('hasil lab', [tag], lookup);
    expect(r.lines).toContainEqual({ id: 'emr.ai.reply.labsFlagged', values: { n: 3 } });
  });

  it('hands a claim question to the server for the tagged visit, even before it is loaded here', () => {
    const r = reply('is the BPJS claim ready?', [{ ...tag, norawat: 'x' }], lookup);
    expect(r).toEqual({ intent: 'claim', lines: [], evaluate: 'x' });
    expect(reply('kesiapan klaim', [], lookup).intent).toBe('needTag');
  });

  it('presents the server evaluation as one structured result after its source and rule set', () => {
    const e = SYNTHETIC_CLAIM_EVALUATIONS[j.no_rawat]!;
    expect(claimLines(j.no_rawat, e)).toEqual([
      { id: 'emr.ai.reply.source', values: { norawat: j.no_rawat } },
      { id: 'emr.ai.reply.claimRuleSet', values: { version: 3 } },
      { claim: e },
      { id: 'emr.claim.scope' },
      { id: 'emr.ai.reply.disclaimer' },
    ]);
  });

  it('says when no claim applies, and that nothing was checked when the server failed', () => {
    const none = claimLines('2026/11/03/000088', SYNTHETIC_CLAIM_EVALUATIONS['2026/11/03/000088']!);
    expect(none).toContainEqual({ id: 'emr.claim.notApplicable' });
    expect(none.some((l) => 'claim' in l)).toBe(false);
    expect(claimErrorLines('x', 'forbidden')).toEqual([
      { id: 'emr.ai.reply.source', values: { norawat: 'x' } },
      { id: 'emr.claim.error.forbidden' },
    ]);
  });

  it('says when the tagged visit is not loaded yet', () => {
    expect(reply('summary', [{ ...tag, norawat: 'x' }], lookup).intent).toBe('notLoaded');
  });

  describe('which visit a question is about (F-9)', () => {
    const other: AssistantTag = {
      id: 'enc:2026/08/14/000051',
      kind: 'encounter',
      norawat: '2026/08/14/000051',
    };
    const section: AssistantTag = {
      ...tag,
      id: `${tag.id}:labs`,
      kind: 'section',
      section: 'labs',
    };

    it('several tags of one visit are one visit; the latest tag (and its section) is the subject', () => {
      expect(subjectOf([tag, section])).toEqual({ kind: 'visit', tag: section });
    });

    it('several different visits are never guessed: the user chooses', () => {
      expect(subjectOf([tag, other])).toEqual({ kind: 'ambiguous', visits: 2 });
      expect(reply('summarize', [tag, other], lookup)).toEqual({
        intent: 'chooseVisit',
        lines: [{ id: 'emr.ai.reply.chooseVisit', values: { n: 2 } }],
      });
      expect(subjectOf([tag, other], other.id)).toEqual({ kind: 'visit', tag: other });
      expect(reply('klaim', [tag, other], lookup, other.id).evaluate).toBe(other.norawat);
      // A choice that is no longer tagged does not count.
      expect(subjectOf([tag, other], 'enc:gone').kind).toBe('ambiguous');
    });
  });

  describe('a tagged section gives the topic when the text has none (F-8)', () => {
    const claimSection: AssistantTag = {
      ...tag,
      id: `${tag.id}:claim`,
      kind: 'section',
      section: 'claim',
    };
    const labsSection: AssistantTag = {
      ...tag,
      id: `${tag.id}:labs`,
      kind: 'section',
      section: 'labs',
    };

    it('uses the section topic for text without one', () => {
      expect(reply('is this ok?', [claimSection], lookup)).toEqual({
        intent: 'claim',
        lines: [],
        evaluate: j.no_rawat,
      });
      expect(reply('show me', [labsSection], lookup).intent).toBe('labs');
    });

    it('explicit text still wins, and a section without a topic leaves the help text', () => {
      expect(reply('summarize', [claimSection], lookup).intent).toBe('summary');
      const cppt: AssistantTag = { ...tag, id: `${tag.id}:cppt`, kind: 'section', section: 'cppt' };
      expect(reply('show me', [cppt], lookup).intent).toBe('help');
    });

    it('still refuses advice whatever is tagged', () => {
      expect(reply('what dose should I give?', [claimSection], lookup).intent).toBe('refuse');
    });
  });

  it('a quick-action topic answers like the typed question, without reading text', () => {
    expect(ask('diagnoses', [tag], lookup)).toEqual(reply('list the diagnoses', [tag], lookup));
    expect(ask('claim', [tag], lookup)).toEqual({
      intent: 'claim',
      lines: [],
      evaluate: j.no_rawat,
    });
    expect(ask('labs', [], lookup).intent).toBe('needTag');
  });
});
