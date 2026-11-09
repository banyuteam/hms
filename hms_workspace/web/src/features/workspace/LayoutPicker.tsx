import { Icon } from '@/components/Icon';
import { Popover, popoverStyles, usePopoverClose } from '@/components/Popover';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/I18nProvider';
import { useHome, useHomeActions } from '@/state/home';
import { LAYOUT_KEYS, layoutFits, slotCount, type LayoutKey } from './geometry';

/** Mini preview of each preset (decorative): fixed 40×28 box, tiles drawn with a 2px gap. */
const thumbBase =
  'h-[28px] w-[40px] flex-none gap-2 rounded-sm border border-line-subtle bg-surface-subtle p-2 [&>span]:rounded-[2px] [&>span]:bg-line-selected';
const thumbLayouts: Record<LayoutKey, string> = {
  free: 'relative block [&>span]:absolute [&>span]:inset-[5px_12px_5px_5px] [&>span]:border [&>span]:border-line-selected [&>span]:bg-selected',
  single: 'grid grid-cols-[1fr] grid-rows-[1fr]',
  cols2: 'grid grid-cols-[1fr_1fr] grid-rows-[1fr]',
  main2: 'grid grid-cols-[1.2fr_1fr] grid-rows-[1fr_1fr] [&>span:first-child]:row-[1/3]',
  grid4: 'grid grid-cols-[1fr_1fr] grid-rows-[1fr_1fr]',
};

function LayoutItem({
  layout,
  current,
  tooSmall,
  onPick,
}: {
  layout: LayoutKey;
  current: boolean;
  tooSmall: boolean;
  onPick: (k: LayoutKey) => void;
}) {
  const { t } = useI18n();
  const close = usePopoverClose();
  return (
    <button
      type="button"
      role="menuitemradio"
      tabIndex={-1}
      aria-checked={current}
      aria-disabled={tooSmall || undefined}
      className={popoverStyles.item}
      onClick={() => {
        if (tooSmall) return;
        close();
        onPick(layout);
      }}
    >
      <span className={cn(thumbBase, thumbLayouts[layout])} data-layout={layout} aria-hidden="true">
        {Array.from({ length: Math.max(1, slotCount(layout)) }, (_, i) => (
          <span key={i} />
        ))}
      </span>
      <span className={popoverStyles.itemText}>{t(`layout.${layout}`)}</span>
      {tooSmall ? (
        <span className={popoverStyles.hint}>{t('layout.tooSmall')}</span>
      ) : (
        current && <Icon name="check" size={16} />
      )}
    </button>
  );
}

/** Dock "Layout" button (Figma icon/layout): Free · Single · 1+1 · 1+2 · 2×2. Presets that do not fit the work area are disabled. */
export function LayoutPicker({ className }: { className?: string }) {
  const { t } = useI18n();
  const { layout, area } = useHome();
  const { setLayout } = useHomeActions();
  const label = t('layout.label');

  return (
    <Popover
      label={label}
      placement="top-end"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label={label}
          className={className}
          data-layout-active={layout !== 'free' || undefined}
        >
          <Icon name="layout" />
        </button>
      )}
    >
      {LAYOUT_KEYS.map((k) => (
        <LayoutItem
          key={k}
          layout={k}
          current={k === layout}
          tooSmall={!layoutFits(k, area)}
          onPick={setLayout}
        />
      ))}
    </Popover>
  );
}
