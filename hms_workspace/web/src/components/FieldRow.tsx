import type { ReactNode } from 'react';
import type { MaskedText } from '@/api/types';
import { MaskedValue } from './MaskedValue';

/** Figma "Field Row" (label / value; `Masked=True` adds the reveal control). Use inside <FieldList>. */
export function FieldRow({
  label,
  value,
  masked,
  fieldKey,
}: {
  label: string;
  value?: ReactNode;
  /** PHI field: shows the mask and an audited reveal control. */
  masked?: MaskedText;
  fieldKey?: string;
}) {
  return (
    <div className="grid grid-cols-[var(--hms-size-field-label)_minmax(0,1fr)] items-start gap-12 cq-compact:grid-cols-[minmax(0,1fr)] cq-compact:gap-2">
      <dt className="m-0 text-[length:var(--hms-text-caption-size)] leading-[var(--hms-text-body-line)] text-ink-muted">
        {label}
      </dt>
      <dd className="type-body m-0 min-w-0 text-ink [font-variant-numeric:tabular-nums] [overflow-wrap:anywhere]">
        {masked?.value ? (
          <MaskedValue field={fieldKey ?? label} label={label} text={masked} />
        ) : (
          (value ?? '—')
        )}
      </dd>
    </div>
  );
}

export function FieldList({ children }: { children: ReactNode }) {
  return <dl className="m-0 flex flex-col gap-12">{children}</dl>;
}
