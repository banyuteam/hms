import type { PillStatus } from '@/components/StatusPill';
import type { Translate } from '@/locales/I18nProvider';
import type { ClaimEvaluation, ClaimFinding } from '@/api/claimApi';

/** Result groups in display order: what needs work first, what could not be checked next, then the rest. */
export const CLAIM_GROUPS = ['attention', 'notChecked', 'passed', 'notApplicable'] as const;
export type ClaimGroup = (typeof CLAIM_GROUPS)[number];

/** Groups the findings, keeping the server's order inside a group; failed errors come before failed warnings. */
export function groupFindings(
  findings: readonly ClaimFinding[],
): Record<ClaimGroup, ClaimFinding[]> {
  const failed = findings.filter((f) => f.result === 'failed');
  return {
    attention: [
      ...failed.filter((f) => f.severity === 'error'),
      ...failed.filter((f) => f.severity !== 'error'),
    ],
    notChecked: findings.filter((f) => f.result === 'not_evaluated'),
    passed: findings.filter((f) => f.result === 'passed'),
    notApplicable: findings.filter((f) => f.result === 'not_applicable'),
  };
}

/**
 * Records-window sections (their title keys) that hold a finding's fields. `fields` are paths into the
 * clinical-timeline-v1 response (assistant-v1); a path this table does not know names no section.
 */
const FIELD_SECTIONS: readonly [prefix: string, titleKey: string][] = [
  ['summary.sep', 'emr.sep.title'],
  ['summary.discharge_summary', 'emr.discharge.title'],
  ['summary.diagnoses', 'emr.dx.title'],
  ['summary.coded_procedures', 'emr.px.title'],
  ['entries.procedure', 'emr.px.title'],
  ['entries.room_stay', 'emr.w2.stay'],
  ['summary.care_setting', 'emr.w2.stay'],
];

/** The section title keys to look in for a finding, first field first, without repeats. */
export function findingSections(f: ClaimFinding): string[] {
  const keys: string[] = [];
  for (const field of f.fields) {
    const hit = FIELD_SECTIONS.find(([p]) => field === p || field.startsWith(`${p}.`));
    if (hit && !keys.includes(hit[1])) keys.push(hit[1]);
  }
  return keys;
}

export interface ClaimCounts {
  toFix: number;
  toCheck: number;
  passed: number;
  notChecked: number;
}

/** The server's summary counts, in the UI's terms. */
export function claimCounts(e: ClaimEvaluation): ClaimCounts {
  return {
    toFix: e.summary.failed_error,
    toCheck: e.summary.failed_warning,
    passed: e.summary.passed,
    notChecked: e.summary.not_evaluated,
  };
}

/** Rule ids of claim-readiness the UI has labels for. Anything else is shown as an unknown check, never as passed. */
const KNOWN_RULES = new Set([
  'sep_present',
  'sep_service_type_matches',
  'sep_discharge_date_recorded',
  'primary_diagnosis_coded',
  'discharge_summary_present',
  'primary_diagnosis_matches_summary',
  'doctor_procedures_coded',
  'length_of_stay_recorded',
  'discharge_status_recorded',
]);

/** Why a check could not be done (shown under its label). */
const KNOWN_REASONS = new Set([
  'care_setting_unknown',
  'prerequisite_failed',
  'section_truncated',
  'source_not_connected',
]);

export interface FindingView {
  label: string;
  state: string;
  pill: PillStatus;
  /** Why it was not checked, when the server says. */
  note?: string;
}

/** How one server finding reads in the UI: label, state text and pill tone (text always carries the meaning). */
export function viewFinding(t: Translate, f: ClaimFinding): FindingView {
  if (!KNOWN_RULES.has(f.rule_id))
    return {
      label: t('emr.claim.rule.unknown'),
      state: t('emr.claim.state.unknown'),
      pill: 'neutral',
    };
  const label = t(`emr.claim.rule.${f.rule_id}`);
  switch (f.result) {
    case 'passed':
      return { label, state: t('emr.claim.state.passed'), pill: 'success' };
    case 'failed':
      return {
        label,
        state: t(f.reason === 'mismatch' ? 'emr.claim.state.mismatch' : 'emr.claim.state.missing'),
        pill: f.severity === 'error' ? 'danger' : 'warning',
      };
    case 'not_applicable':
      return { label, state: t('emr.claim.state.notApplicable'), pill: 'neutral' };
    case 'not_evaluated':
      return {
        label,
        state: t(
          f.reason === 'source_not_connected'
            ? 'emr.claim.state.unavailable'
            : 'emr.claim.state.notEvaluated',
        ),
        pill: 'neutral',
        ...(f.reason && KNOWN_REASONS.has(f.reason)
          ? { note: t(`emr.claim.reason.${f.reason}`) }
          : {}),
      };
  }
}
