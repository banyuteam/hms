import { useEffect, useState } from 'react';
import { ApiError } from '@/api/liveApi';
import type { MaskedText } from '@/api/types';
import { reportAudit } from '@/audit/audit';
import { useAuditSubject } from '@/audit/subject';
import { useI18n } from '@/locales/I18nProvider';
import { Icon } from './Icon';

/** A reveal lasts 30 s (default; hospital decision pending); the reveal emits an audit event with no PHI in it. */
export const REVEAL_MS = 30_000;

/**
 * PHI value masked by default. The eye button reveals it for 30 s. With live data the value is fetched from the server only
 * now (`text.reveal`): hms_services authorizes the reveal and records it in the audit trail before answering, and the value
 * is dropped again when it is hidden. With synthetic data the reveal is recorded in memory (field key + the record's
 * identifiers from `AuditSubjectProvider`, never the value). Either way it stays hidden when it could not be recorded.
 */
export function MaskedValue({
  field,
  label,
  text,
}: {
  field: string;
  label: string;
  text: MaskedText;
}) {
  const { t } = useI18n();
  const subject = useAuditSubject();
  // The revealed value lives only in this state, and only while shown.
  const [shown, setShown] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<'phi.auditFailed' | 'phi.revealForbidden' | null>(null);
  const revealed = shown !== null;

  useEffect(() => {
    if (!revealed) return undefined;
    const timer = setTimeout(() => setShown(null), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  const toggle = async () => {
    if (revealed) {
      setShown(null);
      return;
    }
    setPending(true);
    setFailed(null);
    try {
      if (text.reveal) {
        setShown(await text.reveal());
      } else if (await reportAudit('phi.reveal', field, subject)) {
        setShown(text.value);
      } else {
        setFailed('phi.auditFailed');
      }
    } catch (e) {
      setFailed(
        e instanceof ApiError && e.status === 403 ? 'phi.revealForbidden' : 'phi.auditFailed',
      );
    } finally {
      setPending(false);
    }
  };
  const name = t(revealed ? 'phi.hide' : 'phi.reveal', { field: label });

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-8 gap-y-4">
      <span className="min-w-0 [overflow-wrap:anywhere]" aria-live="polite">
        {shown ?? text.masked}
      </span>
      <button
        type="button"
        className="inline-grid size-icon-lg flex-none cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-ink-muted hover:bg-hover hover:text-ink focus-visible:focus-ring disabled:cursor-wait"
        aria-pressed={revealed}
        aria-busy={pending || undefined}
        aria-label={name}
        title={name}
        disabled={pending}
        onClick={() => void toggle()}
      >
        <Icon name={revealed ? 'eyeOff' : 'eye'} size={16} />
      </button>
      {failed && (
        <span role="alert" className="type-caption text-danger-fg">
          {t(failed)}
        </span>
      )}
    </span>
  );
}
