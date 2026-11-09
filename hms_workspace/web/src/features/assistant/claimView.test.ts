import { describe, expect, it } from 'vitest';
import type { ClaimFinding } from '@/api/claimApi';
import { SYNTHETIC_CLAIM_EVALUATIONS } from '@/data/claimFixtures';
import { claimCounts, findingSections, groupFindings } from './claimView';

const f = (
  rule_id: string,
  result: ClaimFinding['result'],
  severity: ClaimFinding['severity'],
  ...fields: string[]
): ClaimFinding => ({
  rule_id,
  result,
  severity,
  reason: null,
  fields,
  human_review: result === 'failed' || result === 'not_evaluated',
});

describe('claim result view', () => {
  it('groups findings: failed errors, then failed warnings, then not checked, passed, not applicable', () => {
    const g = groupFindings([
      f('a', 'passed', 'error'),
      f('b', 'failed', 'warning'),
      f('c', 'not_evaluated', 'error'),
      f('d', 'failed', 'error'),
      f('e', 'not_applicable', 'error'),
      f('g', 'failed', 'error'),
    ]);
    expect(g.attention.map((x) => x.rule_id)).toEqual(['d', 'g', 'b']);
    expect(g.notChecked.map((x) => x.rule_id)).toEqual(['c']);
    expect(g.passed.map((x) => x.rule_id)).toEqual(['a']);
    expect(g.notApplicable.map((x) => x.rule_id)).toEqual(['e']);
  });

  it('maps field paths to the Records sections to look in, first field first, once each', () => {
    expect(
      findingSections(
        f(
          'x',
          'failed',
          'warning',
          'summary.discharge_summary.main_diagnosis.code',
          'summary.diagnoses',
        ),
      ),
    ).toEqual(['emr.discharge.title', 'emr.dx.title']);
    expect(
      findingSections(
        f('x', 'failed', 'warning', 'summary.coded_procedures', 'entries.procedure.performed_by'),
      ),
    ).toEqual(['emr.px.title']);
    expect(findingSections(f('x', 'failed', 'error', 'summary.sep.discharged_at'))).toEqual([
      'emr.sep.title',
    ]);
    // An unknown path names no section; a prefix must match whole path segments.
    expect(findingSections(f('x', 'failed', 'error', 'summary.unknown', 'summary.sepx'))).toEqual(
      [],
    );
  });

  it('takes the counts from the server summary, never recomputes them', () => {
    const e = SYNTHETIC_CLAIM_EVALUATIONS['2026/10/26/000123']!;
    expect(claimCounts({ ...e, summary: { ...e.summary, failed_error: 4 } })).toMatchObject({
      toFix: 4,
    });
    expect(claimCounts(e)).toEqual({
      toFix: e.summary.failed_error,
      toCheck: e.summary.failed_warning,
      passed: e.summary.passed,
      notChecked: e.summary.not_evaluated,
    });
  });
});
