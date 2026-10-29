import { useIntl } from 'react-intl';
import styles from './PlaceholderWindow.module.css';

/** Lab / Radiology / Billing windows are not built yet; this proves the window + dock model. */
export function PlaceholderWindow() {
  const intl = useIntl();
  return <p className={styles.text}>{intl.formatMessage({ id: 'window.placeholder.body' })}</p>;
}
