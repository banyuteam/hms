import type { PillStatus } from '@/components/StatusPill';
import type { Translate } from '@/locales/I18nProvider';
import type { ClaimFinding } from '@/api/claimApi';

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
