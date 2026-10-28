import type { ReactNode } from 'react';
import styles from './StatusPill.module.css';

export type PillStatus = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'ai';

/** Figma component "Status Pill". Colour is never the only signal — always pass a text label. */
export function StatusPill({
  status = 'neutral',
  children,
}: {
  status?: PillStatus;
  children: ReactNode;
}) {
  return <span className={`${styles.pill} ${styles[status]}`}>{children}</span>;
}
