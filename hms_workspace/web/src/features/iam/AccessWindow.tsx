import { useRef, useState, type KeyboardEvent } from 'react';
import { isLiveApi } from '@/api/liveApi';
import { ErrorState } from '@/components/QueryState';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/I18nProvider';
import { useAuth, usePermission } from '@/state/auth';
import { PERMISSIONS } from './iamApi';
import { RolesPanel } from './RolesPanel';
import { UsersPanel } from './UsersPanel';

type Tab = 'users' | 'roles';
const TABS: readonly Tab[] = ['users', 'roles'];

/**
 * "User & Access" window (`/access`): IAM administration through hms_services (iam-admin-v1, ADR-SVC-002). Everything is
 * scoped and authorized by the server; the permissions read here only decide which controls are offered. Holds no PHI.
 */
export function AccessWindow({ winId }: { winId: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  const [announcement, setAnnouncement] = useState('');
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ users: null, roles: null });
  const can = {
    usersManage: usePermission(PERMISSIONS.usersManage),
    assignmentsManage: usePermission(PERMISSIONS.assignmentsManage),
  };
  const canManageRoles = usePermission(PERMISSIONS.rolesManage);

  if (!isLiveApi() || !user) {
    return <ErrorState title={t('iam.title')} message={t('iam.liveOnly')} />;
  }

  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next =
      TABS[(TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const id = (part: string) => `${winId}-${part}`;

  return (
    <div className="flex min-h-0 flex-col gap-16 p-16">
      <div
        role="tablist"
        aria-label={t('iam.title')}
        className="flex gap-8 border-b border-line-subtle"
      >
        {TABS.map((k) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[k] = el;
            }}
            type="button"
            role="tab"
            id={id(`tab-${k}`)}
            aria-selected={tab === k}
            aria-controls={id(`panel-${k}`)}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            onKeyDown={onKeyDown}
            className={cn(
              'type-body-strong -mb-px cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-12 py-8 text-ink-secondary focus-visible:focus-ring',
              tab === k && 'border-line-focus text-ink-link',
            )}
          >
            {t(`iam.tab.${k}`)}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div
        role="tabpanel"
        id={id(`panel-${tab}`)}
        aria-labelledby={id(`tab-${tab}`)}
        className="min-h-0"
      >
        {tab === 'users' ? (
          <UsersPanel
            me={user.id}
            facilityId={user.facilityId}
            can={can}
            announce={setAnnouncement}
          />
        ) : (
          <RolesPanel canManage={canManageRoles} announce={setAnnouncement} />
        )}
      </div>
    </div>
  );
}
