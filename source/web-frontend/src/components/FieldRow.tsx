import type { ReactNode } from 'react';
import type { MaskedText } from '@/api/types';
import { MaskedValue } from './MaskedValue';
import styles from './FieldRow.module.css';

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
    <div className={styles.row}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>
        {masked ? (
          <MaskedValue field={fieldKey ?? label} label={label} text={masked} />
        ) : (
          (value ?? '—')
        )}
      </dd>
    </div>
  );
}

export function FieldList({ children }: { children: ReactNode }) {
  return <dl className={styles.list}>{children}</dl>;
}
