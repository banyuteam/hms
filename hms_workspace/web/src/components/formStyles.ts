/** Class names shared by every form (sign-in, administration): one look for inputs, labels and field errors. */
export const formStyles = {
  input:
    'h-[40px] w-full rounded-md border border-line bg-surface py-0 text-ink focus:focus-ring disabled:bg-hover disabled:text-ink-disabled',
  field: 'flex flex-col gap-6 [&_label]:type-caption-strong [&_label]:text-ink-secondary',
  errorText: 'm-0 text-[length:var(--hms-text-caption-size)] text-danger-fg',
} as const;
