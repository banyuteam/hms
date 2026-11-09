import { Button } from '@/components/Button';

const state = 'flex flex-col items-start gap-12 p-24 text-ink-secondary';

/** Loading placeholder for a query's first load (shimmer + status message). Announced politely to screen readers. */
export function LoadingState({ message }: { message: string }) {
  return (
    <div className={state} role="status" aria-live="polite">
      <div
        className="h-[56px] w-[320px] max-w-full animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--hms-color-bg-hover),var(--hms-color-border-subtle),var(--hms-color-bg-hover))] bg-[length:200%_100%]"
        aria-hidden="true"
      />
      <p>{message}</p>
    </div>
  );
}

/**
 * Failed query. Always distinct from an empty result ("nothing found" must never be shown for "could not load").
 * Pass `onRetry` for retryable failures only; a not-found result is final, so it gets no Retry button.
 */
export function ErrorState({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className={state} role="alert">
      <h2 className="type-title-md m-0 text-ink">{title}</h2>
      <p>{message}</p>
      {onRetry && retryLabel && <Button onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}
