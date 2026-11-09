import { formStyles } from '@/components/formStyles';

/** Shared class names of the demo and live sign-in forms. */
export const loginStyles = {
  ...formStyles,
  /** Yellow warning box: demo account only (never shown by a live sign-in). */
  banner:
    'flex gap-8 rounded-md bg-warning-bg p-12 text-warning-fg [&_p]:type-caption [&_p]:mb-0 [&_p]:mt-2 [&_p]:text-ink [&_strong]:text-[length:var(--hms-text-caption-strong-size)] [&_svg]:mt-2 [&_svg]:flex-none',
} as const;
