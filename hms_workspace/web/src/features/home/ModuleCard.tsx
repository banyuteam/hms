import { Icon, type IconName } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { useI18n } from '@/locales/I18nProvider';

const rowAreas = "[grid-template-areas:'top_title_verb'_'top_desc_verb']";
const rowAreasCompact = "cq-compact:[grid-template-areas:'top_title'_'top_desc'_'top_verb']";

/** Home card (remodel of the Beranda tile): one task window. `tone="ai"` uses the ai/* tokens. */
export function ModuleCard({
  icon,
  title,
  description,
  shortcut,
  verb,
  tone = 'default',
  layout = 'tile',
  onOpen,
}: {
  icon: IconName;
  title: string;
  description: string;
  /** Alt+<n> hint. */
  shortcut?: number;
  /** Verb under the title (e.g. "Open"). */
  verb: string;
  tone?: 'default' | 'ai';
  /** `row` = full-width, one line (icon · text · verb) — used for the AI card under the task tiles. */
  layout?: 'tile' | 'row';
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const ai = tone === 'ai';
  const row = layout === 'row';
  return (
    <button
      type="button"
      className={cn(
        'type-body cursor-pointer rounded-lg border text-left text-ink focus-visible:focus-ring',
        ai
          ? 'border-ai-border bg-ai-bg hover:border-ai-accent'
          : 'border-line-subtle bg-surface hover:border-line-selected',
        row
          ? cn(
              'grid size-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-16 gap-y-2 px-16 py-12 cq-compact:grid-cols-[auto_minmax(0,1fr)]',
              rowAreas,
              rowAreasCompact,
            )
          : 'flex size-full flex-col gap-8 p-16',
      )}
      data-tone={tone}
      data-layout={layout}
      onClick={onOpen}
    >
      <span className={cn('flex items-center justify-between', row && '[grid-area:top]')}>
        <span
          className={cn(
            'inline-grid size-tile-icon place-items-center rounded-md',
            ai ? 'bg-surface text-ai-fg' : 'bg-selected text-ink-link',
          )}
        >
          <Icon name={icon} />
        </span>
        {shortcut !== undefined && (
          <kbd className="type-caption font-base text-ink-muted">
            {t('module.shortcut', { n: shortcut })}
          </kbd>
        )}
      </span>
      <strong className={cn('type-title-md', row && '[grid-area:title]')}>{title}</strong>
      <span className={cn('type-caption flex-1 text-ink-muted', row && '[grid-area:desc]')}>
        {description}
      </span>
      <span
        className={cn(
          'type-caption-strong inline-flex items-center gap-4',
          ai ? 'text-ai-fg' : 'text-ink-link',
          row && '[grid-area:verb]',
        )}
      >
        {verb}
        <Icon name="chevronRight" size={16} />
      </span>
    </button>
  );
}
