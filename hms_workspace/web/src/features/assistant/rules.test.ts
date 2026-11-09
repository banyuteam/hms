import { describe, expect, it, vi } from 'vitest';
import { SYNTHETIC_CLAIM_EVALUATIONS } from '@/data/claimFixtures';
import { SYNTHETIC_JOURNEYS } from '@/data/emrFixtures';
import { claimErrorLines, claimLines, detectIntent, reply, type AssistantTag } from './rules';

const j = SYNTHETIC_JOURNEYS[0]!;
const tag: AssistantTag = { id: `enc:${j.no_rawat}`, kind: 'encounter', norawat: j.no_rawat };
const lookup = (nr: string) => (nr === j.no_rawat ? j : undefined);

describe('rule-based assistant', () => {
  it.each([
    'What dose of furosemide should I give?',
    'Should we stop the bisoprolol?',
    'obat apa yang sebaiknya diberikan?',
    'Diagnose this patient please',
  ])('refuses clinical advice: %s', (q) => {
    expect(detectIntent(q)).toBe('refuse');
    expect(reply(q, [tag], lookup).lines).toEqual([{ id: 'emr.ai.reply.refuse' }]);
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

  it('presents the server evaluation finding by finding, and says when it is partial', () => {
    const e = SYNTHETIC_CLAIM_EVALUATIONS[j.no_rawat]!;
    const lines = claimLines(j.no_rawat, e);
    expect(lines.slice(0, 2)).toEqual([
      { id: 'emr.ai.reply.source', values: { norawat: j.no_rawat } },
      { id: 'emr.ai.reply.claimRuleSet', values: { version: 3 } },
    ]);
    expect(lines.filter((l) => 'finding' in l)).toHaveLength(9);
    expect(lines).not.toContainEqual({ id: 'emr.claim.partial' });
    expect(lines.slice(-2)).toEqual([{ id: 'emr.claim.scope' }, { id: 'emr.ai.reply.disclaimer' }]);
    expect(claimLines(j.no_rawat, { ...e, status: 'partial' })).toContainEqual({
      id: 'emr.claim.partial',
    });
  });

  it('says when no claim applies, and that nothing was checked when the server failed', () => {
    const none = claimLines('2026/11/03/000088', SYNTHETIC_CLAIM_EVALUATIONS['2026/11/03/000088']!);
    expect(none).toContainEqual({ id: 'emr.claim.notApplicable' });
    expect(none.some((l) => 'finding' in l)).toBe(false);
    expect(claimErrorLines('x', 'forbidden')).toEqual([
      { id: 'emr.ai.reply.source', values: { norawat: 'x' } },
      { id: 'emr.claim.error.forbidden' },
    ]);
  });

  it('says when the tagged visit is not loaded yet', () => {
    expect(reply('summary', [{ ...tag, norawat: 'x' }], lookup).intent).toBe('notLoaded');
  });
});
