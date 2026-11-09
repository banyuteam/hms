import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useRef, useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import type { ClaimFinding } from '@/api/claimApi';
import {
  COMMENT_MAX,
  commentOf,
  EXPECTED,
  feedbackApi,
  feedbackErrorKind,
  FINDING_REASONS,
  HELPFULNESS,
  type FeedbackBody,
  type FeedbackErrorKind,
  type Helpfulness,
} from '@/api/feedbackApi';
import { Button } from '@/components/Button';
import { formStyles } from '@/components/formStyles';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/I18nProvider';

/**
 * Optional feedback on a claim-readiness answer (ADR-SVC-008): a problem with one finding, or how useful the answer was.
 * Never asked for, never blocking. States are honest: "sent" only after the server stored it; a failure says nothing was
 * saved and offers Try again; demo data sends nothing and says so. Sending never changes the result on screen.
 */
type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'demo' }
  | { kind: 'error'; error: FeedbackErrorKind };

function useSubmit() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const last = useRef<FeedbackBody | null>(null);
  const submit = async (body: FeedbackBody) => {
    last.current = body;
    setStatus({ kind: 'sending' });
    try {
      const out = await feedbackApi.submit(body);
      setStatus({ kind: out.kind === 'demo' ? 'demo' : 'sent' });
    } catch (e) {
      setStatus({ kind: 'error', error: feedbackErrorKind(e) });
    }
  };
  const retry = () => {
    if (last.current) void submit(last.current);
  };
  return { status, submit, retry };
}

function StatusLine({ status, onRetry }: { status: Status; onRetry: () => void }) {
  const { t } = useI18n();
  const text =
    status.kind === 'sending'
      ? t('emr.fb.sending')
      : status.kind === 'sent'
        ? t('emr.fb.sent')
        : status.kind === 'demo'
          ? t('emr.fb.demo')
          : status.kind === 'error'
            ? t(`emr.fb.error.${status.error}`)
            : '';
  return (
    <span className="flex flex-wrap items-center gap-8">
      <span
        role="status"
        className={cn(
          'type-caption empty:hidden',
          status.kind === 'error' ? 'text-danger-fg' : 'text-ink-muted',
        )}
      >
        {text}
      </span>
      {status.kind === 'error' && status.error !== 'forbidden' && status.error !== 'notFound' && (
        <Button variant="ghost" onClick={onRetry}>
          {t('emr.fb.retry')}
        </Button>
      )}
    </span>
  );
}

/** The optional comment, with its counter and the reminder to leave patient details out. */
function CommentField({
  id,
  length,
  registration,
  error,
  disabled,
}: {
  id: string;
  length: number;
  registration: UseFormRegisterReturn;
  error?: string;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={formStyles.field}>
      <label htmlFor={`${id}-comment`}>{t('emr.fb.comment')}</label>
      <textarea
        id={`${id}-comment`}
        rows={2}
        maxLength={COMMENT_MAX}
        disabled={disabled}
        className="type-body resize-none rounded-md border border-line bg-surface p-8 text-ink focus:focus-ring"
        aria-describedby={`${id}-hint`}
        aria-invalid={Boolean(error) || undefined}
        {...registration}
      />
      <span id={`${id}-hint`} className="type-caption flex justify-between gap-8 text-ink-muted">
        <span>{t('emr.fb.commentHint')}</span>
        <span className="[font-variant-numeric:tabular-nums]">
          {t('emr.fb.commentCount', { n: length, max: COMMENT_MAX })}
        </span>
      </span>
      {error && (
        <p role="alert" className={formStyles.errorText}>
          {t(error)}
        </p>
      )}
    </div>
  );
}

const comment = z.string().max(COMMENT_MAX, 'emr.fb.commentTooLong');
const findingSchema = z.object({
  reason: z.enum(FINDING_REASONS, { errorMap: () => ({ message: 'emr.fb.reasonRequired' }) }),
  comment,
});
type FindingValues = z.infer<typeof findingSchema>;

/** "Report a problem" on one finding: a reason and an optional comment. */
export function FindingFeedback({
  evaluationId,
  finding,
  label,
}: {
  evaluationId: string;
  finding: ClaimFinding;
  /** The finding's label, for accessible names. */
  label: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const { status, submit, retry } = useSubmit();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FindingValues>({
    resolver: zodResolver(findingSchema),
    defaultValues: { comment: '' },
  });

  if (status.kind === 'sent' || status.kind === 'demo')
    return <StatusLine status={status} onRetry={retry} />;
  if (!open)
    return (
      <span>
        <Button
          variant="ghost"
          aria-expanded={false}
          aria-label={t('emr.fb.reportFor', { label })}
          onClick={() => setOpen(true)}
        >
          {t('emr.fb.report')}
        </Button>
      </span>
    );

  const sending = status.kind === 'sending';
  const onValid = (v: FindingValues) =>
    submit({
      evaluation_id: evaluationId,
      rule_id: finding.rule_id,
      result: finding.result,
      reason: v.reason,
      comment: commentOf(v.comment),
    });
  return (
    <form
      aria-label={t('emr.fb.reportFor', { label })}
      className="flex flex-col gap-8 rounded-md border border-ai-border bg-surface p-8"
      onSubmit={(e) => void handleSubmit(onValid)(e)}
      noValidate
    >
      <fieldset className="m-0 flex flex-col gap-4 border-0 p-0" disabled={sending}>
        <legend className="type-caption-strong mb-4 p-0 text-ink-secondary">
          {t('emr.fb.reasonLegend')}
        </legend>
        {FINDING_REASONS.map((r) => (
          <label key={r} className="type-body flex items-center gap-8">
            <input type="radio" value={r} {...register('reason')} />
            {t(`emr.fb.reason.${r}`)}
          </label>
        ))}
        {errors.reason?.message && (
          <p role="alert" className={formStyles.errorText}>
            {t(errors.reason.message)}
          </p>
        )}
      </fieldset>
      <CommentField
        id={id}
        length={watch('comment').length}
        registration={register('comment')}
        error={errors.comment?.message}
        disabled={sending}
      />
      <span className="flex flex-wrap items-center gap-8">
        <Button type="submit" variant="primary" disabled={sending}>
          {t('emr.fb.send')}
        </Button>
        <Button
          disabled={sending}
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          {t('emr.fb.cancel')}
        </Button>
        <StatusLine status={status} onRetry={retry} />
      </span>
    </form>
  );
}

const answerSchema = z.object({ expected: z.enum(EXPECTED).nullable().optional(), comment });
type AnswerValues = z.infer<typeof answerSchema>;

/** "Was this answer useful?" under a claim-readiness answer; partly or not useful may say what was expected. */
export function AnswerFeedback({ evaluationId }: { evaluationId: string }) {
  const { t } = useI18n();
  const id = useId();
  const [choice, setChoice] = useState<Helpfulness | null>(null);
  const { status, submit, retry } = useSubmit();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AnswerValues>({
    resolver: zodResolver(answerSchema),
    defaultValues: { expected: null, comment: '' },
  });

  if (status.kind === 'sent' || status.kind === 'demo')
    return <StatusLine status={status} onRetry={retry} />;
  const sending = status.kind === 'sending';

  const choose = (h: Helpfulness) => {
    setChoice(h);
    // Useful needs nothing more: send at once.
    if (h === 'helpful') void submit({ evaluation_id: evaluationId, helpfulness: h });
  };
  const onValid = (v: AnswerValues) =>
    submit({
      evaluation_id: evaluationId,
      helpfulness: choice ?? 'not_helpful',
      expected: v.expected ?? undefined,
      comment: commentOf(v.comment),
    });

  return (
    <div className="flex flex-col gap-8">
      <div
        className="flex flex-wrap items-center gap-4"
        role="group"
        aria-label={t('emr.fb.answerQuestion')}
      >
        <span className="type-caption text-ink-secondary">{t('emr.fb.answerQuestion')}</span>
        {HELPFULNESS.map((h) => (
          <Button
            key={h}
            variant="ghost"
            aria-pressed={choice === h}
            disabled={sending}
            onClick={() => choose(h)}
          >
            {t(`emr.fb.helpfulness.${h}`)}
          </Button>
        ))}
      </div>
      {choice && choice !== 'helpful' && (
        <form
          aria-label={t('emr.fb.answerFor')}
          className="flex flex-col gap-8 rounded-md border border-ai-border bg-surface p-8"
          onSubmit={(e) => void handleSubmit(onValid)(e)}
          noValidate
        >
          <fieldset className="m-0 flex flex-col gap-4 border-0 p-0" disabled={sending}>
            <legend className="type-caption-strong mb-4 p-0 text-ink-secondary">
              {t('emr.fb.expectedLegend')}
            </legend>
            {EXPECTED.map((x) => (
              <label key={x} className="type-body flex items-center gap-8">
                <input type="radio" value={x} {...register('expected')} />
                {t(`emr.fb.expected.${x}`)}
              </label>
            ))}
          </fieldset>
          <CommentField
            id={id}
            length={watch('comment').length}
            registration={register('comment')}
            error={errors.comment?.message}
            disabled={sending}
          />
          <span className="flex flex-wrap items-center gap-8">
            <Button type="submit" variant="primary" disabled={sending}>
              {t('emr.fb.send')}
            </Button>
            <StatusLine status={status} onRetry={retry} />
          </span>
        </form>
      )}
      {choice === 'helpful' && <StatusLine status={status} onRetry={retry} />}
    </div>
  );
}
