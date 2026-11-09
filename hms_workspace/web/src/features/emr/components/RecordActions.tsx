import { useState } from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { useAssistantActions } from '@/state/assistant';
import type { AssistantTag } from '@/features/assistant/rules';
import { useCanEdit } from '@/state/auth';

/** Below the compact container width the label stays for screen readers only. */
const compactHidden = 'cq-compact:sr-only';

/** "Ask AI" — tags this record/section into the app-shell assistant (Figma Action Chip, Style=AI). */
export function AskAi({ tag, label }: { tag: AssistantTag; label?: string }) {
  const { t } = useI18n();
  const { tag: add } = useAssistantActions();
  const text = label ?? t('emr.ai.ask');
  return (
    <Button variant="ai" onClick={() => add(tag)} aria-label={text}>
      <Icon name="sparkles" size={16} />
      <span className={compactHidden}>{text}</span>
    </Button>
  );
}

/**
 * Doctor-only edit/create affordance. Iteration 2 = UI only: pressing it shows that nothing is saved, so production
 * builds do not show it (`useCanEdit`). Hidden for the employee role (role-based UI); the backend stays the authority once
 * writes exist.
 */
export function EditAction({ label, icon = 'pencil' }: { label: string; icon?: IconName }) {
  const { t } = useI18n();
  const canEdit = useCanEdit();
  const [shown, setShown] = useState(false);
  if (!canEdit) return null;
  return (
    <span className="inline-flex items-center gap-8">
      <Button variant="secondary" onClick={() => setShown(true)}>
        <Icon name={icon} size={16} />
        {label}
      </Button>
      <span role="status" className="type-caption text-warning-fg empty:hidden">
        {shown ? t('emr.edit.uiOnly') : ''}
      </span>
    </span>
  );
}

/** Opens a related window (drill-down). */
export function OpenWindow({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant="secondary" onClick={onClick} aria-label={label}>
      <Icon name={icon} size={16} />
      <span className={compactHidden}>{label}</span>
    </Button>
  );
}
