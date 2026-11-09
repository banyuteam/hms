import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { formStyles } from '@/components/formStyles';
import { useI18n } from '@/locales/I18nProvider';
import { iamErrorKey } from './iamErrors';

const schema = z.object({ reason: z.string().trim().max(500, 'iam.reason.tooLong') });
type Values = z.infer<typeof schema>;

/**
 * Inline confirmation for a consequential IAM change (suspend, deactivate, revoke). The reason is required by the server
 * and recorded in the audit trail; `optional` is only for reactivation. Errors stay in the form so nothing is lost.
 */
export function ReasonForm({
  label,
  effect,
  optional = false,
  onConfirm,
  onCancel,
}: {
  /** Accessible name of the form, e.g. "Suspend dr. A". */
  label: string;
  /** What the change does, shown before confirming. */
  effect?: string;
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
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: '' } });

  const onValid = async ({ reason }: Values) => {
    if (!optional && !reason) {
      setError('reason', { message: 'iam.reason.required' });
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
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-8 rounded-md border border-line bg-surface-subtle p-12"
      onSubmit={(e) => void handleSubmit(onValid)(e)}
      noValidate
    >
      {effect && <p className="type-caption m-0 text-ink-secondary">{effect}</p>}
      <div className={formStyles.field}>
        <label htmlFor={`${id}-reason`}>{t(optional ? 'iam.reason.optional' : 'iam.reason')}</label>
        <input
          id={`${id}-reason`}
          className={`${formStyles.input} px-12`}
          maxLength={500}
          disabled={isSubmitting}
          aria-invalid={Boolean(errorKey) || undefined}
          aria-describedby={errorKey ? `${id}-error` : undefined}
          {...register('reason')}
        />
      </div>
      {errorKey && (
        <p id={`${id}-error`} role="alert" className={formStyles.errorText}>
          {t(errorKey)}
        </p>
      )}
      <div className="flex gap-8">
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {t('iam.action.confirm')}
        </Button>
        <Button onClick={onCancel} disabled={isSubmitting}>
          {t('iam.action.cancel')}
        </Button>
      </div>
    </form>
  );
}
