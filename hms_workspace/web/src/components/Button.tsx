import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'ai';
  block?: boolean;
}

const base =
  'type-body-strong inline-flex min-h-control cursor-pointer items-center justify-center gap-8 whitespace-nowrap rounded-md border px-12 py-0 ' +
  'focus-visible:focus-ring disabled:cursor-not-allowed disabled:text-ink-disabled';

// Colour utilities are kept per variant (never repeated in `base`) so no two utilities set the same property.
const variants = {
  primary:
    'border-transparent bg-action text-ink-on-action enabled:hover:bg-action-hover disabled:border-line-subtle disabled:bg-hover',
  secondary:
    'border-line bg-surface text-ink-secondary enabled:hover:bg-hover disabled:border-line-subtle disabled:bg-hover',
  ghost:
    'border-transparent bg-transparent text-ink-link enabled:hover:bg-hover disabled:bg-transparent',
  /** Figma Action Chip, Style=AI: violet outline from the ai/* tokens. */
  ai: 'border-ai-border bg-ai-bg text-ai-fg enabled:hover:border-ai-accent disabled:border-line-subtle disabled:bg-hover',
} as const;

/** Figma component "Button": Style = Primary | Secondary | Ghost | AI, State = Default | Disabled. Native `<button>`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', block, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...props}
      className={cn(base, variants[variant], block && 'w-full', className)}
    />
  );
});
