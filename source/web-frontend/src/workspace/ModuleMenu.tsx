import { useIntl } from 'react-intl';
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { Icon, type IconName } from '@/components/Icon';
import { MODULES, isWindowType } from './registry';
import { useWindowStore } from './windowStore';
import menu from './menu.module.css';

/** Module launcher (top-bar grid button and the dock "+" button). Same module list as the Beranda tiles. */
export function ModuleMenu({
  icon,
  label,
  className,
}: {
  icon: IconName;
  label: string;
  className?: string;
}) {
  const intl = useIntl();
  const open = useWindowStore((s) => s.open);
  return (
    <MenuTrigger>
      <Button aria-label={label} className={className}>
        <Icon name={icon} />
      </Button>
      <Popover placement="bottom end" className={menu.popover}>
        <Menu
          className={menu.menu}
          aria-label={label}
          disabledKeys={MODULES.filter((m) => !m.window).map((m) => m.key)}
          onAction={(key) => {
            const k = String(key);
            if (isWindowType(k)) open(k);
          }}
        >
          {MODULES.map((m) => (
            <MenuItem
              key={m.key}
              id={m.key}
              className={menu.item}
              textValue={intl.formatMessage({ id: `module.${m.key}.title` })}
            >
              <Icon name={m.icon} size={16} />
              <span className={menu.itemText}>
                {intl.formatMessage({ id: `module.${m.key}.title` })}
              </span>
              {!m.window && (
                <span className={menu.hint}>{intl.formatMessage({ id: 'module.soon' })}</span>
              )}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
