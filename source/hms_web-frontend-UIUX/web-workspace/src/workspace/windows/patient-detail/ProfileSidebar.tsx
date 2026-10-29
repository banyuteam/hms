import { useIntl } from 'react-intl';
import { Icon, type IconName } from '@/components/Icon';
import type { ProfileId } from './sections';
import styles from './ProfileSidebar.module.css';

const GROUPS: ReadonlyArray<{
  id: 'info' | 'record';
  items: ReadonlyArray<{ id: ProfileId; icon: IconName }>;
}> = [
  {
    id: 'info',
    items: [
      { id: 'personal', icon: 'user' },
      { id: 'contact', icon: 'users' },
      { id: 'guarantor', icon: 'receipt' },
      { id: 'family', icon: 'heart' },
    ],
  },
  { id: 'record', items: [{ id: 'audit', icon: 'eye' }] },
];

/** Figma "Sidebar Nav Item": profile pages + Audit Log only (the other nine old items live in the tabs/header — OQ-50). */
export function ProfileSidebar({
  active,
  onSelect,
}: {
  active: ProfileId | null;
  onSelect: (id: ProfileId) => void;
}) {
  const intl = useIntl();
  return (
    <nav className={styles.nav} aria-label={intl.formatMessage({ id: 'detail.nav.label' })}>
      {GROUPS.map((g) => (
        <section key={g.id} className={styles.group} aria-labelledby={`nav-group-${g.id}`}>
          <h3 id={`nav-group-${g.id}`} className={styles.heading}>
            {intl.formatMessage({ id: `detail.nav.group.${g.id}` })}
          </h3>
          <ul className={styles.list}>
            {g.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.item}
                  data-active={active === item.id || undefined}
                  aria-current={active === item.id ? 'page' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <Icon name={item.icon} size={20} />
                  <span>{intl.formatMessage({ id: `detail.profile.${item.id}` })}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
