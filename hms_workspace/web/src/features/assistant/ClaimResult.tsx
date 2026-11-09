import type { ClaimEvaluation, ClaimFinding } from '@/api/claimApi';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { StatusPill, type PillStatus } from '@/components/StatusPill';
import { formatTime } from '@/locales/format';
import { useI18n } from '@/locales/I18nProvider';
import { useAssistantActions } from '@/state/assistant';
import { useHomeActions } from '@/state/home';
import {
  CLAIM_GROUPS,
  claimCounts,
  findingSections,
  groupFindings,
  viewFinding,
  type ClaimGroup,
} from './claimView';

const COUNT_TONES: [key: keyof ReturnType<typeof claimCounts>, pill: PillStatus][] = [
  ['toFix', 'danger'],
  ['toCheck', 'warning'],
  ['notChecked', 'neutral'],
  ['passed', 'success'],
];

function FindingRow({ finding }: { finding: ClaimFinding }) {
  const { t } = useI18n();
  const v = viewFinding(t, finding);
  const where = findingSections(finding);
  return (
    <li className="flex flex-col gap-2 border-b border-ai-border py-4 last:border-b-0">
      <span className="flex items-center justify-between gap-8">
        <span>{v.label}</span>
        <StatusPill status={v.pill}>{v.state}</StatusPill>
      </span>
      {v.note && <span className="type-caption text-ink-muted">{v.note}</span>}
      {where.length > 0 && finding.result !== 'passed' && finding.result !== 'not_applicable' && (
        <span className="type-caption text-ink-muted">
          {t('emr.claim.where', { sections: where.map((k) => t(k)).join(', ') })}
        </span>
      )}
    </li>
  );
}

function Group({ group, findings }: { group: ClaimGroup; findings: ClaimFinding[] }) {
  const { t } = useI18n();
  if (findings.length === 0) return null;
  const review = findings.some((f) => f.human_review);
  const rows = (
    <ul className="m-0 flex list-none flex-col p-0">
      {findings.map((f) => (
        <FindingRow key={f.rule_id} finding={f} />
      ))}
    </ul>
  );
  const title = t(`emr.claim.group.${group}`, { n: findings.length });
  // What needs no work is folded away; what needs work is always open.
  if (group === 'passed' || group === 'notApplicable')
    return (
      <details className="flex flex-col gap-2">
        <summary className="type-caption-strong cursor-pointer text-ai-fg">{title}</summary>
        {rows}
      </details>
    );
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="type-caption-strong m-0 text-ai-fg">{title}</h3>
      {review && <p className="type-caption m-0 text-ink-muted">{t('emr.claim.humanReview')}</p>}
      {rows}
    </section>
  );
}

/**
 * The server's claim-readiness evaluation in the assistant: the counts, then the findings grouped by what needs work,
 * with where to look in the Records window. The next steps only navigate (open Records) or ask the server again; the
 * assistant changes nothing in the record.
 */
export function ClaimResult({ evaluation: e }: { evaluation: ClaimEvaluation }) {
  const { t, locale } = useI18n();
  const { open } = useHomeActions();
  const { recheck } = useAssistantActions();
  const norawat = e.reference.resource_id;
  const counts = claimCounts(e);
  const groups = groupFindings(e.findings);
  const checked = new Date(e.evaluated_at);
  const truncated = e.data_completeness.truncated.length;
  const notConnected = e.data_completeness.sources_not_connected.length;

  return (
    <li className="flex flex-col gap-8">
      <ul
        className="m-0 flex list-none flex-wrap gap-4 p-0"
        aria-label={t('emr.claim.countsLabel')}
      >
        {COUNT_TONES.filter(([k]) => counts[k] > 0).map(([k, pill]) => (
          <li key={k}>
            <StatusPill status={pill}>{t(`emr.claim.count.${k}`, { n: counts[k] })}</StatusPill>
          </li>
        ))}
      </ul>
      {CLAIM_GROUPS.map((g) => (
        <Group key={g} group={g} findings={groups[g]} />
      ))}
      {e.status === 'partial' && <p className="type-caption m-0">{t('emr.claim.partial')}</p>}
      {(truncated > 0 || notConnected > 0) && (
        <p className="type-caption m-0 text-ink-muted">
          {[
            truncated > 0 && t('emr.claim.truncatedN', { n: truncated }),
            notConnected > 0 && t('emr.claim.notConnectedN', { n: notConnected }),
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
      <p className="type-caption m-0 text-ink-muted [font-variant-numeric:tabular-nums]">
        {t('emr.claim.checkedAt', { time: formatTime(checked, locale) })}
      </p>
      <span className="flex flex-wrap gap-8">
        <Button variant="secondary" onClick={() => open('emr-records', { norawat })}>
          <Icon name="clipboard" size={16} />
          {t('emr.claim.openRecords')}
        </Button>
        <Button variant="ghost" onClick={() => recheck(norawat)}>
          <Icon name="refresh" size={16} />
          {t('emr.claim.recheck')}
        </Button>
      </span>
    </li>
  );
}
