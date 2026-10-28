import { useIntl } from 'react-intl';
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { useNavigate } from 'react-router';
import { endSession } from '@/auth/session';
import { useAuthStore } from '@/auth/authStore';
import { Icon } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import menu from './menu.module.css';
import styles from './TopBar.module.css';

export function UserMenu() {
  const intl = useIntl();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  const name = intl.formatMessage({ id: user.nameKey });
  const role = intl.formatMessage({ id: user.roleKey });
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <DialogTrigger>
      {/* WCAG 2.5.3 Label in Name: the accessible name starts with the visible text (name and role). */}
      <Button
        className={styles.user}
        aria-label={intl.formatMessage({ id: 'topbar.userMenuFull' }, { name, role })}
      >
        {/* Initials are drawn by CSS (data-initials), so they are decoration and not visible *text* that the name must contain. */}
        <span className={styles.avatar} data-initials={initials} aria-hidden="true" />
        <span className={styles.userText}>
          <strong>{name}</strong> <small>{role}</small>
        </span>
        <Icon name="chevronDown" size={16} />
      </Button>
      <Popover placement="bottom end" className={menu.popover}>
        <Dialog aria-label={intl.formatMessage({ id: 'topbar.userMenu' })} className={menu.section}>
          <span className={menu.sectionLabel}>{intl.formatMessage({ id: 'topbar.language' })}</span>
          <LanguageSwitch />
          <hr className={menu.divider} />
          <Button
            className={menu.item}
            onPress={() => {
              endSession('user');
              navigate('/login', { replace: true });
            }}
          >
            <Icon name="logout" size={16} />
            <span className={menu.itemText}>{intl.formatMessage({ id: 'topbar.logout' })}</span>
          </Button>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
