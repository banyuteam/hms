import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Card.module.css';

/** Figma "Card Header" + card: icon + title + optional text action. Cards live on `bg/surface` with `border/subtle`. */
export function Card({
  title,
  icon,
  action,
  onAction,
  children,
}: {
  title: string;
  icon: IconName;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className={styles.card} aria-label={title}>
      <header className={styles.header}>
        <Icon name={icon} size={16} />
        <h3 className={styles.title}>{title}</h3>
        {action && (
          <button type="button" className={styles.action} onClick={onAction}>
            {action}
          </button>
        )}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
