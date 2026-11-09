import { Icon, type IconName } from '@/components/Icon';
import { MenuItem, Popover, popoverStyles, type Placement } from '@/components/Popover';
import { useI18n } from '@/locales/I18nProvider';
import { useHomeActions } from '@/state/home';
import { HOME_CARDS, WINDOW_META } from './windowMeta';

/** Module launcher (top-bar grid button, dock "+" button, empty tile slot). Same task windows as the Home cards. */
export function ModuleMenu({
  icon,
  label,
  className,
  text,
  placement = 'bottom-end',
}: {
  icon: IconName;
  label: string;
  className?: string;
  /** Visible text next to the icon (empty-slot placeholder); icon-only when omitted. */
  text?: string;
  placement?: Placement;
}) {
  const { t } = useI18n();
  const { open } = useHomeActions();
  return (
    <Popover
      label={label}
      placement={placement}
      trigger={(p) => (
        <button type="button" {...p} aria-label={label} className={className}>
          <Icon name={icon} />
          {text && <span>{text}</span>}
        </button>
      )}
    >
      {HOME_CARDS.map((c) => (
        <MenuItem key={c.kind} onSelect={() => open(c.kind)}>
          <Icon name={WINDOW_META[c.kind].icon} size={16} />
          <span className={popoverStyles.itemText}>{t(WINDOW_META[c.kind].titleKey)}</span>
          <span className={popoverStyles.hint}>Alt+{c.shortcut}</span>
        </MenuItem>
      ))}
    </Popover>
  );
}
