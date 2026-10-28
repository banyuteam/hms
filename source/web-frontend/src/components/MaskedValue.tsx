import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import type { MaskedText } from '@/api/types';
import { emitAudit } from '@/audit/audit';
import { Icon } from './Icon';
import styles from './MaskedValue.module.css';

/** A reveal lasts 30 s (default of OQ-08, hospital decision pending); the reveal emits an audit event with no PHI in it. */
export const REVEAL_MS = 30_000;

/** PHI value masked by default (root CLAUDE.md rule 2). The eye button reveals it for 30 s and reports an audit event. */
export function MaskedValue({
  field,
  label,
  text,
}: {
  field: string;
  label: string;
  text: MaskedText;
}) {
  const intl = useIntl();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) return undefined;
    const t = setTimeout(() => setRevealed(false), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  const toggle = () => {
    if (!revealed) emitAudit('phi.reveal', field);
    setRevealed((r) => !r);
  };

  return (
    <span className={styles.wrap}>
      <span className={styles.text} aria-live="polite">
        {revealed ? text.value : text.masked}
      </span>
      <button
        type="button"
        className={styles.eye}
        aria-pressed={revealed}
        aria-label={intl.formatMessage(
          { id: revealed ? 'phi.hide' : 'phi.reveal' },
          { field: label },
        )}
        title={intl.formatMessage({ id: revealed ? 'phi.hide' : 'phi.reveal' }, { field: label })}
        onClick={toggle}
      >
        <Icon name={revealed ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </span>
  );
}
