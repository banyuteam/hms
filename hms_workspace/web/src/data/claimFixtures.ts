import type { ClaimEvaluation, ClaimFinding } from '@/api/claimApi';

/**
 * SYNTHETIC claim-readiness answers for the synthetic visits in `emrFixtures.ts`, in the shape of assistant-v1. Written by
 * hand to match what hms_services returns for those visits; the demo shows them, it never computes them.
 */
function f(
  rule_id: string,
  result: ClaimFinding['result'],
  severity: ClaimFinding['severity'],
  reason: string | null,
  ...fields: string[]
): ClaimFinding {
  return {
    rule_id,
    result,
    severity,
    reason,
    fields,
    human_review: result === 'failed' || result === 'not_evaluated',
  };
}

function evaluation(
  norawat: string,
  findings: ClaimFinding[],
  sources: string[] = [],
): ClaimEvaluation {
  const count = (r: ClaimFinding['result'], s?: ClaimFinding['severity']) =>
    findings.filter((x) => x.result === r && (!s || x.severity === s)).length;
  return {
    evaluation_id: `00000000-0000-4000-8000-${norawat.replace(/\D/g, '').slice(-12).padStart(12, '0')}`,
    status: count('not_evaluated') > 0 ? 'partial' : 'complete',
    evaluated_at: '2026-11-09T10:15:00+07:00',
    rule_set: { id: 'claim-readiness', version: 3 },
    reference: { resource_type: 'encounter', resource_id: norawat },
    applicability: { applies: true, reason: null },
    findings,
    summary: {
      passed: count('passed'),
      failed_error: count('failed', 'error'),
      failed_warning: count('failed', 'warning'),
      not_applicable: count('not_applicable'),
      not_evaluated: count('not_evaluated'),
    },
    data_completeness: {
      complete: sources.length === 0,
      sources_not_connected: sources,
      truncated: [],
    },
  };
}

// Both synthetic BPJS visits have an SEP (`summary.sep` in emrFixtures.ts) of their own service type; the inpatient
// one has its discharge date. The server reads them from bridging_sep.
const SEP = f('sep_present', 'passed', 'error', null, 'summary.sep');
const SEP_TYPE = f(
  'sep_service_type_matches',
  'passed',
  'warning',
  null,
  'summary.sep.service_type',
  'summary.care_setting',
);

export const SYNTHETIC_CLAIM_EVALUATIONS: Readonly<Record<string, ClaimEvaluation>> = {
  // BPJS inpatient stay: everything recorded.
  '2026/10/26/000123': evaluation('2026/10/26/000123', [
    SEP,
    SEP_TYPE,
    f('sep_discharge_date_recorded', 'passed', 'error', null, 'summary.sep.discharged_at'),
    f('primary_diagnosis_coded', 'passed', 'error', null, 'summary.diagnoses'),
    f('discharge_summary_present', 'passed', 'error', null, 'summary.discharge_summary'),
    f(
      'primary_diagnosis_matches_summary',
      'passed',
      'warning',
      null,
      'summary.discharge_summary.main_diagnosis.code',
      'summary.diagnoses',
    ),
    f(
      'doctor_procedures_coded',
      'passed',
      'warning',
      null,
      'summary.coded_procedures',
      'entries.procedure.performed_by',
    ),
    f('length_of_stay_recorded', 'passed', 'error', null, 'entries.room_stay.length_of_stay'),
    f('discharge_status_recorded', 'passed', 'error', null, 'entries.room_stay.discharge_status'),
  ]),
  // BPJS outpatient visit: inpatient-only checks do not apply; no billed doctor action.
  '2026/08/14/000051': evaluation('2026/08/14/000051', [
    SEP,
    SEP_TYPE,
    f(
      'sep_discharge_date_recorded',
      'not_applicable',
      'error',
      'outpatient',
      'summary.sep.discharged_at',
    ),
    f('primary_diagnosis_coded', 'passed', 'error', null, 'summary.diagnoses'),
    f(
      'discharge_summary_present',
      'not_applicable',
      'error',
      'outpatient',
      'summary.discharge_summary',
    ),
    f(
      'primary_diagnosis_matches_summary',
      'not_applicable',
      'warning',
      'outpatient',
      'summary.discharge_summary.main_diagnosis.code',
      'summary.diagnoses',
    ),
    f(
      'doctor_procedures_coded',
      'not_applicable',
      'warning',
      'no_doctor_procedures',
      'summary.coded_procedures',
      'entries.procedure.performed_by',
    ),
    f(
      'length_of_stay_recorded',
      'not_applicable',
      'error',
      'outpatient',
      'entries.room_stay.length_of_stay',
    ),
    f(
      'discharge_status_recorded',
      'not_applicable',
      'error',
      'outpatient',
      'entries.room_stay.discharge_status',
    ),
  ]),
  // Self-pay (UMU): no claim to prepare.
  '2026/11/03/000088': {
    ...evaluation('2026/11/03/000088', []),
    status: 'not_applicable',
    applicability: { applies: false, reason: 'payer_not_claimable' },
  },
};
