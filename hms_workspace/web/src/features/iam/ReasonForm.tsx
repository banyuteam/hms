import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { formStyles } from '@/components/formStyles';
import { useI18n } from '@/locales/I18nProvider';
import { iamErrorKey } from './iamErrors';

const schema = z.object({ reason: z.string().trim().max(500, 'iam.reason.tooLong') });
type Values = z.infer<typeof schema>;

/**
 * Inline confirmation for a consequential IAM change (suspend, deactivate, reactivate, revoke). It says, visibly, what is
 * about to happen and to whom (`title`), what that does (`effect`), and the button names the action. The reason is
 * required by the server and recorded in the audit trail (`optional` only for reactivation). Focus moves to the reason
 * when the form opens; errors stay in the form so nothing is lost.
 */
export function ReasonForm({
  title,
  effect,
  confirmLabel,
  optional = false,
  onConfirm,
  onCancel,
}: {
  /** What is about to happen, e.g. "Suspend dr. A". Heading and accessible name of the form. */
  title: string;
  /** What the change does, shown before confirming. */
  effect?: string;
  /** The action on the button, e.g. "Suspend" (never a bare "Confirm"). */
  confirmLabel: string;
  optional?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: '' } });

  useEffect(() => setFocus('reason'), [setFocus]);

  const onValid = async ({ reason }: Values) => {
    if (!optional && !reason) {
      setError('reason', { message: 'iam.reason.required' }, { shouldFocus: true });
      return;
    }
    setServerError(null);
    try {
      await onConfirm(reason);
    } catch (e) {
      setServerError(iamErrorKey(e));
    }
  };

  const errorKey = errors.reason?.message ?? serverError;
  const describedBy = [`${id}-hint`, errorKey ? `${id}-error` : null].filter(Boolean).join(' ');
  return (
    <form
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-8 rounded-md border border-line bg-surface-subtle p-12"
      onSubmit={(e) => void handleSubmit(onValid)(e)}
      noValidate
    >
      <h4 id={`${id}-title`} className="type-body-strong m-0 text-ink">
        {title}
      </h4>
      {effect && <p className="type-body m-0 text-ink-secondary">{effect}</p>}
      <div className={formStyles.field}>
        <label htmlFor={`${id}-reason`}>{t(optional ? 'iam.reason.optional' : 'iam.reason')}</label>
        <input
          id={`${id}-reason`}
          className={`${formStyles.input} px-12`}
          maxLength={500}
          disabled={isSubmitting}
          aria-invalid={Boolean(errors.reason) || undefined}
          aria-describedby={describedBy}
          {...register('reason')}
        />
        <span id={`${id}-hint`} className="type-caption text-ink-muted">
          {t('iam.reason.hint')}
        </span>
      </div>
      {errorKey && (
        <p id={`${id}-error`} role="alert" className={formStyles.errorText}>
          {t(errorKey)}
        </p>
      )}
      <div className="flex gap-8">
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {confirmLabel}
        </Button>
        <Button onClick={onCancel} disabled={isSubmitting}>
          {t('iam.action.cancel')}
        </Button>
      </div>
    </form>
  );
}
