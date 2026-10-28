import { useIntl } from 'react-intl';
import { auditEvents } from '@/audit/audit';
import { Card } from '@/components/Card';
import { formatDateTime } from '@/i18n/format';
import { useLocaleStore } from '@/i18n/localeStore';
import styles from './pages.module.css';

/** Phase 2 shows this session's audit events (no patient data in them). The record's backend audit log arrives with the BFF. */
export function AuditLogPage() {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const events = [...auditEvents()].reverse();
  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>{intl.formatMessage({ id: 'detail.profile.audit' })}</h2>
      <p className={styles.caption}>{intl.formatMessage({ id: 'audit.body' })}</p>
      <Card title={intl.formatMessage({ id: 'audit.session' })} icon="eye">
        {events.length === 0 ? (
          <p className={styles.empty}>{intl.formatMessage({ id: 'audit.empty' })}</p>
        ) : (
          <table className={styles.audit}>
            <thead>
              <tr>
                <th scope="col">{intl.formatMessage({ id: 'audit.col.when' })}</th>
                <th scope="col">{intl.formatMessage({ id: 'audit.col.action' })}</th>
                <th scope="col">{intl.formatMessage({ id: 'audit.col.subject' })}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.correlationId}>
                  <td>{formatDateTime(new Date(e.at), locale)}</td>
                  <td>{intl.formatMessage({ id: `audit.action.${e.action}` })}</td>
                  <td>{e.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
