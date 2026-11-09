import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Popover, popoverStyles, usePopoverClose } from '@/components/Popover';
import { useI18n } from '@/locales/I18nProvider';
import { displayName, useAuth } from '@/state/auth';
import { useEndSession } from '@/state/session';
import { topBar } from './topBarStyles';

function SignOutButton() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const endSession = useEndSession();
  const close = usePopoverClose();
  return (
    <button
      type="button"
      className={popoverStyles.item}
      onClick={() => {
        close();
        endSession('user');
        navigate('/login', { replace: true });
      }}
    >
      <Icon name="logout" size={16} />
      <span className={popoverStyles.itemText}>{t('topbar.logout')}</span>
    </button>
  );
}

export function UserMenu() {
  const { t } = useI18n();
  const { user } = useAuth();
  if (!user) return null;
  const name = displayName(user, t);
  const role = t(user.roleKey);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <Popover
      label={t('topbar.userMenu')}
      role="dialog"
      placement="bottom-end"
      className={popoverStyles.section}
      trigger={(p) => (
        // WCAG 2.5.3 Label in Name: the accessible name starts with the visible text (name and role).
        <button
          type="button"
          {...p}
          className={topBar.user}
          aria-label={t('topbar.userMenuFull', { name, role })}
        >
          {/* Initials are drawn by CSS (data-initials), so they are decoration, not visible text. */}
          <span className={topBar.avatar} data-initials={initials} aria-hidden="true" />
          <span className={topBar.userText}>
            <strong>{name}</strong> <small>{role}</small>
          </span>
          <Icon name="chevronDown" size={16} />
        </button>
      )}
    >
      <span className={popoverStyles.sectionLabel}>{t('topbar.language')}</span>
      <LanguageSwitch />
      <hr className={popoverStyles.divider} />
      <SignOutButton />
    </Popover>
  );
}
