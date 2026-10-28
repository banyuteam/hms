import { useIntl } from 'react-intl';
import { Button } from 'react-aria-components';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { ModuleMenu } from './ModuleMenu';
import { UserMenu } from './UserMenu';
import styles from './TopBar.module.css';

/** Figma top bar (64px): brand · global search (placeholder) · notifications · launcher · user. */
export function TopBar() {
  const intl = useIntl();
  return (
    <header className={styles.top}>
      <div className={styles.brand}>
        <Logo size={40} />
        <div className={styles.brandText}>
          <strong>{intl.formatMessage({ id: 'app.name' })}</strong>
          <small>{intl.formatMessage({ id: 'app.subtitle' })}</small>
        </div>
      </div>
      <div
        role="search"
        className={styles.search}
        title={intl.formatMessage({ id: 'topbar.search.soon' })}
      >
        <Icon name="search" />
        <input
          disabled
          className={styles.searchInput}
          placeholder={intl.formatMessage({ id: 'topbar.search.placeholder' })}
          aria-label={intl.formatMessage({ id: 'topbar.search.placeholder' })}
        />
        <kbd className={styles.key}>Ctrl</kbd>
        <kbd className={styles.key}>K</kbd>
      </div>
      <div className={styles.spacer} />
      <div className={styles.actions}>
        <Button
          isDisabled
          aria-label={intl.formatMessage({ id: 'topbar.notifications' })}
          className={styles.iconButton}
        >
          <Icon name="bell" />
        </Button>
        <ModuleMenu
          icon="grid"
          label={intl.formatMessage({ id: 'topbar.launcher' })}
          className={styles.iconButton}
        />
        <UserMenu />
      </div>
    </header>
  );
}
