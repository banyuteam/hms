import { useId } from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { useAssistantActions } from '@/state/assistant';
import type { AssistantTag } from '@/features/assistant/rules';
import { useCanEdit } from '@/state/auth';

/** Below the compact container width the label stays for screen readers only. */
const compactHidden = 'cq-compact:sr-only';

/**
 * "Ask the assistant" — tags this record/section into the app-shell assistant (Figma Action Chip, Style=AI colours).
 * The assistant is rule-based and is not presented as AI (F-10).
 */
export function AskAssistant({ tag, label }: { tag: AssistantTag; label?: string }) {
  const { t } = useI18n();
  const { tag: add } = useAssistantActions();
  const text = label ?? t('emr.ai.ask');
  return (
    <Button variant="ai" onClick={() => add(tag)} aria-label={text}>
      <Icon name="assistant" size={16} />
      <span className={compactHidden}>{text}</span>
    </Button>
  );
}

/**
 * Doctor-only edit/create affordance. Iteration 2 = UI only, so production builds do not show it (`useCanEdit`). It says
 * so before anyone presses it: visibly unavailable (aria-disabled keeps it focusable, so the reason can be read), with a
 * "Preview" tag and the reason as its description — never a button that looks ready and does nothing. Hidden for the
 * employee role (role-based UI); the backend stays the authority once writes exist.
 */
export function EditAction({ label, icon = 'pencil' }: { label: string; icon?: IconName }) {
  const { t } = useI18n();
  const canEdit = useCanEdit();
  const reasonId = useId();
  if (!canEdit) return null;
  const reason = t('emr.edit.uiOnly');
  return (
    <>
      <Button
        variant="secondary"
        aria-disabled="true"
        aria-describedby={reasonId}
        title={reason}
        className="cursor-not-allowed border-dashed text-ink-muted enabled:hover:bg-surface"
      >
        <Icon name={icon} size={16} />
        {label}
        <span className="type-caption rounded-sm bg-warning-bg px-4 text-warning-fg">
          {t('emr.edit.previewTag')}
        </span>
      </Button>
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
    </>
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
