/* eslint-disable jsx-a11y/no-static-element-interactions --
   The wrapper only delegates ArrowLeft/Right/Home/End to the real <button role="tab"> elements inside it (roving focus). */
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useIntl } from 'react-intl';
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { Icon } from '@/components/Icon';
import menu from '../../menu.module.css';
import { MAX_VISIBLE_TABS, TAB_IDS, type TabId } from './sections';
import { visibleTabCount } from './tabLayout';
import styles from './DetailTabs.module.css';

/** Matches `gap: var(--hms-space-4)` in the stylesheet. */
const TAB_GAP = 4;

/** Figma "Tab" bar: clinical tabs, overflow under "More ▾"; no tab is active while a profile page is open. */
export function DetailTabs({
  active,
  onSelect,
  panelId,
}: {
  active: TabId | null;
  onSelect: (id: TabId) => void;
  panelId: string;
}) {
  const intl = useIntl();
  const barRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(MAX_VISIBLE_TABS);

  const label = (id: TabId) => intl.formatMessage({ id: `detail.tab.${id}` });

  useLayoutEffect(() => {
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return undefined;
    const apply = () => {
      const widths = [...measure.querySelectorAll<HTMLElement>('[data-measure-tab]')].map(
        (el) => el.offsetWidth + TAB_GAP,
      );
      const more = measure.querySelector<HTMLElement>('[data-measure-more]')?.offsetWidth ?? 0;
      setCount(visibleTabCount(widths, bar.clientWidth, more, MAX_VISIBLE_TABS));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => ro.disconnect();
    // Labels change with the locale, so measure again then.
  }, [intl.locale]);

  const visible = TAB_IDS.slice(0, count);
  const hidden = TAB_IDS.slice(count);
  const activeHidden = active !== null && hidden.includes(active);
  const moreLabel = intl.formatMessage({ id: 'detail.tabs.more' });

  // Roving tabindex: arrows move between the visible tabs; the first one is the tab stop when none is active.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End')
      return;
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"], [data-more]')];
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
  };

  return (
    <div className={styles.wrap}>
      <div ref={barRef} className={styles.bar} onKeyDown={onKeyDown}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label={intl.formatMessage({ id: 'detail.tabs.label' })}
        >
          {visible.map((id, i) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              className={styles.tab}
              aria-selected={active === id}
              aria-controls={active === id ? panelId : undefined}
              tabIndex={
                active === id ||
                (active === null && i === 0) ||
                (active !== null && i === 0 && activeHidden)
                  ? 0
                  : -1
              }
              data-active={active === id || undefined}
              onClick={() => onSelect(id)}
            >
              {label(id)}
            </button>
          ))}
        </div>
        {hidden.length > 0 && (
          <MenuTrigger>
            <Button
              className={styles.tab}
              data-more=""
              data-active={activeHidden || undefined}
              aria-label={moreLabel}
            >
              {activeHidden && active ? label(active) : moreLabel}
              <Icon name="chevronDown" size={16} />
            </Button>
            <Popover placement="bottom end" className={menu.popover}>
              <Menu
                className={menu.menu}
                aria-label={moreLabel}
                onAction={(key) => onSelect(String(key) as TabId)}
              >
                {hidden.map((id) => (
                  <MenuItem key={id} id={id} className={menu.item} textValue={label(id)}>
                    <span className={menu.itemText}>{label(id)}</span>
                  </MenuItem>
                ))}
              </Menu>
            </Popover>
          </MenuTrigger>
        )}
      </div>
      {/* Off-screen copy used only to measure real tab widths (all labels, plus the More button). */}
      <div ref={measureRef} className={styles.measure} aria-hidden="true">
        {TAB_IDS.map((id) => (
          <span key={id} data-measure-tab className={styles.tab}>
            {label(id)}
          </span>
        ))}
        <span data-measure-more className={styles.tab}>
          {moreLabel}
          <Icon name="chevronDown" size={16} />
        </span>
      </div>
    </div>
  );
}
