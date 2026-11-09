import { isLiveApi } from '@/api/liveApi';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { useI18n } from '@/locales/I18nProvider';
import { ModuleMenu } from './ModuleMenu';
import { topBar } from './topBarStyles';
import { UserMenu } from './UserMenu';

const kbd =
  'type-caption-strong font-base rounded-sm border border-line-subtle bg-surface-subtle px-6 py-2 phone:hidden';

/**
 * Figma top bar (64px): brand · global search (placeholder) · notifications · launcher · user.
 * The search and notification placeholders do nothing yet, so only dev builds show them.
 */
export function TopBar() {
  const { t } = useI18n();
  return (
    <header className="relative z-dock flex h-topbar items-center gap-24 border-b border-line-subtle bg-surface px-24 phone:gap-12 phone:px-16">
      <div className="flex items-center gap-12">
        <Logo size={40} />
        <div className="flex flex-col phone:hidden">
          <strong className="type-title-md">{t('app.name')}</strong>
          <small className="type-overline uppercase text-ink-muted narrow:hidden">
            {t('app.subtitle')}
          </small>
        </div>
      </div>
      {/* Dev builds only: a production build served with hms_services is always live data. */}
      {isLiveApi() && import.meta.env.DEV && (
        <span
          role="status"
          className="type-caption-strong whitespace-nowrap rounded-full bg-warning-bg px-12 py-4 text-warning-fg"
        >
          {t('topbar.liveApi')}
        </span>
      )}
      {import.meta.env.DEV && (
        <div
          role="search"
          className="flex h-[40px] max-w-search flex-1 items-center gap-8 rounded-md border border-line bg-surface px-12 text-ink-muted phone:min-w-0"
          title={t('topbar.search.soon')}
        >
          <Icon name="search" />
          <input
            disabled
            className="min-w-0 flex-1 border-0 bg-transparent outline-0 placeholder:text-ink-muted"
            placeholder={t('topbar.search.placeholder')}
            aria-label={t('topbar.search.placeholder')}
          />
          <kbd className={kbd}>Ctrl</kbd>
          <kbd className={kbd}>K</kbd>
        </div>
      )}
      <div className="flex-1 phone:hidden" />
      <div className="ml-auto flex items-center gap-12 phone:gap-8">
        {import.meta.env.DEV && (
          <button
            type="button"
            disabled
            aria-label={t('topbar.notifications')}
            className={topBar.iconButton}
          >
            <Icon name="bell" />
          </button>
        )}
        <ModuleMenu icon="grid" label={t('topbar.launcher')} className={topBar.iconButton} />
        <UserMenu />
      </div>
    </header>
  );
}
