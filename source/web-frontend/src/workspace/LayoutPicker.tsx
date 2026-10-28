import { useIntl } from 'react-intl';
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { Icon } from '@/components/Icon';
import { LAYOUT_KEYS, layoutFits, slotCount, type LayoutKey } from './geometry';
import { useWindowStore } from './windowStore';
import menu from './menu.module.css';
import styles from './LayoutPicker.module.css';

/** Dock "Layout" button (Figma icon/layout): Free · Single · 1+1 · 1+2 · 2×2. Presets that do not fit the work area are disabled. */
export function LayoutPicker({ className }: { className?: string }) {
  const intl = useIntl();
  const layout = useWindowStore((s) => s.layout);
  const area = useWindowStore((s) => s.area);
  const setLayout = useWindowStore((s) => s.setLayout);
  const label = intl.formatMessage({ id: 'layout.label' });
  const disabledKeys = LAYOUT_KEYS.filter((k) => !layoutFits(k, area));

  return (
    <MenuTrigger>
      <Button
        aria-label={label}
        className={className}
        data-layout-active={layout !== 'free' || undefined}
      >
        <Icon name="layout" />
      </Button>
      <Popover placement="top end" className={menu.popover}>
        <Menu
          className={menu.menu}
          aria-label={label}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[layout]}
          disabledKeys={disabledKeys}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next) setLayout(String(next) as LayoutKey);
          }}
        >
          {LAYOUT_KEYS.map((k) => {
            const text = intl.formatMessage({ id: `layout.${k}` });
            const tooSmall = disabledKeys.includes(k);
            return (
              <MenuItem key={k} id={k} className={menu.item} textValue={text}>
                <span className={styles.thumb} data-layout={k} aria-hidden="true">
                  {Array.from({ length: Math.max(1, slotCount(k)) }, (_, i) => (
                    <span key={i} />
                  ))}
                </span>
                <span className={menu.itemText}>{text}</span>
                {tooSmall ? (
                  <span className={menu.hint}>{intl.formatMessage({ id: 'layout.tooSmall' })}</span>
                ) : (
                  k === layout && <Icon name="check" size={16} />
                )}
              </MenuItem>
            );
          })}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
