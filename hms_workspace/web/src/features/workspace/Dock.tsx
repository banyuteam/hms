import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { StatusPill } from '@/components/StatusPill';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/useNow';
import { formatDate, formatTime } from '@/locales/format';
import { useI18n } from '@/locales/I18nProvider';
import { useRole, useRoleLabelKey } from '@/state/auth';
import { useHome, useHomeActions } from '@/state/home';
import { LayoutPicker } from './LayoutPicker';
import { ModuleMenu } from './ModuleMenu';
import { dockLabel, windowIcon, windowTitle } from './windowMeta';

const tabBase =
  'type-body flex h-dock-tab min-w-[130px] max-w-[260px] cursor-pointer items-center gap-8 rounded-md border border-line-subtle bg-surface py-0 pl-8 text-ink-secondary phone:min-w-0 ' +
  'focus-visible:focus-ring data-[active]:border-line-selected data-[active]:bg-selected data-[active]:font-semibold data-[active]:text-ink-link';
const chip =
  'inline-grid size-icon-lg flex-none place-items-center rounded-sm bg-action text-ink-on-action';
const addButton =
  'inline-grid size-control flex-none cursor-pointer place-items-center rounded-md border border-line bg-surface p-0 text-ink-secondary focus-visible:focus-ring ' +
  'data-[layout-active]:border-line-selected data-[layout-active]:bg-selected data-[layout-active]:text-ink-link';

/** Figma "Dock Tab" (Home | Module × Default | Active) + bottom dock (56px). */
export function Dock() {
  const { t, locale } = useI18n();
  const { windows, activeId } = useHome();
  const { activate, close, showHome } = useHomeActions();
  const now = useNow();
  const role = useRole();
  const roleLabel = useRoleLabelKey();
  const tabsRef = useRef<HTMLUListElement>(null);

  // With many windows the strip scrolls; keep the active tab in view.
  useEffect(() => {
    tabsRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId, windows.length]);

  return (
    <nav
      className="relative z-dock flex h-dock-bar items-center gap-8 border-t border-line bg-dock px-24 shadow-dock phone:px-16"
      aria-label={t('dock.label')}
    >
      <ul
        className="m-0 flex min-w-0 list-none gap-8 overflow-x-auto px-0 py-4 [scrollbar-width:thin]"
        ref={tabsRef}
      >
        <li className="min-w-0 flex-none">
          <button
            type="button"
            className={cn(tabBase, 'pr-12')}
            data-active={activeId === null || undefined}
            aria-current={activeId === null ? 'page' : undefined}
            onClick={showHome}
          >
            <span className={chip}>
              <Icon name="home" size={16} />
            </span>
            <span className="truncate">{t('dock.home')}</span>
          </button>
        </li>
        {windows.map((w) => {
          const title = windowTitle(t, w);
          const isActive = activeId === w.id;
          return (
            <li
              key={w.id}
              className="relative flex min-w-0 flex-none items-center"
              data-active={isActive || undefined}
              data-minimized={w.mode === 'minimized' || undefined}
            >
              <button
                type="button"
                className={cn(tabBase, 'pr-[36px]')}
                data-active={isActive || undefined}
                aria-current={isActive ? 'page' : undefined}
                title={title}
                onClick={() => activate(w.id)}
              >
                <span className={chip}>
                  <Icon name={windowIcon(w.kind)} size={16} />
                </span>
                <DockLabel {...dockLabel(t, w)} />
              </button>
              <button
                type="button"
                className="absolute right-6 grid size-icon-lg cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-ink-muted hover:bg-hover hover:text-ink focus-visible:focus-ring"
                aria-label={t('dock.closeTab', { title })}
                onClick={() => close(w.id)}
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      <ModuleMenu icon="plus" label={t('dock.add')} className={addButton} placement="top-start" />
      <div className="flex-1" />
      {/* The dock states what this role can do (doctor = edit preview in development, otherwise view only). */}
      <span className="phone:hidden">
        <StatusPill status={role === 'doctor' ? 'info' : 'neutral'}>{t(roleLabel)}</StatusPill>
      </span>
      <LayoutPicker className={addButton} />
      <div
        className="ml-8 flex flex-none flex-col items-end whitespace-nowrap leading-[1.3] phone:hidden [&_span]:text-[length:var(--hms-text-caption-size)] [&_span]:text-ink-muted [&_time]:font-semibold"
        aria-label={t('dock.clock')}
      >
        <time dateTime={now.toISOString()}>{formatTime(now, locale)}</time>
        <span>{formatDate(now, locale)}</span>
      </div>
    </nav>
  );
}

/** Name shrinks first; the identifier is never truncated (the tab grows to fit it). */
function DockLabel({ name, id }: { name: string; id: string | undefined }) {
  return (
    <span className="flex min-w-0 items-baseline gap-4">
      <span className="truncate">{name}</span>
      {id && <span className="flex-none [font-variant-numeric:tabular-nums]">{id}</span>}
    </span>
  );
}
