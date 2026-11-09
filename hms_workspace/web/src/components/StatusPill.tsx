import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

export type PillStatus = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'ai';

const base =
  'type-caption-strong inline-flex items-center [font-variant-numeric:normal] whitespace-nowrap rounded-sm border px-8 py-4';

const tones: Record<PillStatus, string> = {
  neutral: 'border-line-subtle bg-hover text-ink-secondary',
  success: 'border-transparent bg-success-bg text-success-fg',
  danger: 'border-transparent bg-danger-bg text-danger-fg',
  warning: 'border-transparent bg-warning-bg text-warning-fg',
  info: 'border-transparent bg-info-bg text-info-fg',
  ai: 'border-ai-border bg-ai-bg text-ai-fg',
};

/** Figma component "Status Pill". Colour is never the only signal — always pass a text label. */
export function StatusPill({
  status = 'neutral',
  children,
}: {
  status?: PillStatus;
  children: ReactNode;
}) {
  return <span className={cn(base, tones[status])}>{children}</span>;
}
