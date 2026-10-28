import { useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import { Icon } from '@/components/Icon';
import { StatusPill } from '@/components/StatusPill';
import { formatDate, formatTime } from '@/i18n/format';
import { useLocaleStore } from '@/i18n/localeStore';
import { LayoutPicker } from './LayoutPicker';
import { ModuleMenu } from './ModuleMenu';
import { useNow } from './useNow';
import { dockLabel, windowIcon, windowTitle } from './windowMeta';
import { useWindowStore } from './windowStore';
import styles from './Dock.module.css';

/** Figma "Dock Tab" (Home | Module × Default | Active) + bottom dock (56px). */
export function Dock() {
  const intl = useIntl();
  const locale = useLocaleStore((s) => s.locale);
  const { windows, activeId, activate, close, showHome } = useWindowStore();
  const now = useNow();
  const tabsRef = useRef<HTMLUListElement>(null);

  // With many windows the strip scrolls; keep the active tab in view.
  useEffect(() => {
    tabsRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId, windows.length]);

  return (
    <nav className={styles.dock} aria-label={intl.formatMessage({ id: 'dock.label' })}>
      <ul className={styles.tabs} ref={tabsRef}>
        <li>
          <button
            type="button"
            className={styles.tab}
            data-active={activeId === null || undefined}
            aria-current={activeId === null ? 'page' : undefined}
            onClick={showHome}
          >
            <span className={styles.chip}>
              <Icon name="home" size={16} />
            </span>
            <span className={styles.label}>{intl.formatMessage({ id: 'dock.home' })}</span>
          </button>
        </li>
        {windows.map((w) => {
          const title = windowTitle(intl, w);
          const label = dockLabel(intl, w);
          const isActive = activeId === w.id;
          return (
            <li
              key={w.id}
              className={styles.group}
              data-active={isActive || undefined}
              data-minimized={w.mode === 'minimized' || undefined}
            >
              <button
                type="button"
                className={styles.tab}
                data-active={isActive || undefined}
                aria-current={isActive ? 'page' : undefined}
                title={title}
                onClick={() => activate(w.id)}
              >
                <span className={styles.chip}>
                  <Icon name={windowIcon(w.kind)} size={16} />
                </span>
                <span className={styles.label}>{label}</span>
              </button>
              <button
                type="button"
                className={styles.close}
                aria-label={intl.formatMessage({ id: 'dock.closeTab' }, { title })}
                onClick={() => close(w.id)}
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      <ModuleMenu
        icon="plus"
        label={intl.formatMessage({ id: 'dock.add' })}
        className={styles.add}
      />
      <div className={styles.spacer} />
      <StatusPill status="neutral">{intl.formatMessage({ id: 'dock.mode' })}</StatusPill>
      <LayoutPicker className={styles.add} />
      <div className={styles.clock} aria-label={intl.formatMessage({ id: 'dock.clock' })}>
        <time dateTime={now.toISOString()}>{formatTime(now, locale)}</time>
        <span>{formatDate(now, locale)}</span>
      </div>
    </nav>
  );
}
