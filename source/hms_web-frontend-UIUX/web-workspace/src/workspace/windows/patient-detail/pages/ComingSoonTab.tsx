import { useIntl } from 'react-intl';
import { Card } from '@/components/Card';
import styles from './pages.module.css';

/** Tabs planned for Phase 3 (PRD §8.1): the window, header and the built tabs keep working. */
export function ComingSoonTab({ title }: { title: string }) {
  const intl = useIntl();
  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>{title}</h2>
      <Card title={intl.formatMessage({ id: 'detail.comingSoon.title' })} icon="clock">
        <p className={styles.empty}>
          {intl.formatMessage({ id: 'detail.comingSoon.body' }, { tab: title })}
        </p>
      </Card>
    </div>
  );
}
