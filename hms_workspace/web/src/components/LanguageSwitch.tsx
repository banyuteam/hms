import { LOCALES } from '@/locales';
import { useI18n } from '@/locales/I18nProvider';
import { cn } from '@/lib/cn';

/** ID | EN segmented control (toggle buttons in a labelled group). The choice lives in memory only (CLAUDE.md §5). */
export function LanguageSwitch({ glass = false }: { glass?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div
      role="group"
      aria-label={t('lang.label')}
      className={cn(
        'inline-flex gap-2 rounded-md border p-2',
        glass ? 'border-glass-stroke bg-glass' : 'border-line bg-surface',
      )}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          aria-label={t(`lang.switchTo.${l}`)}
          onClick={() => setLocale(l)}
          className="type-caption-strong cursor-pointer rounded-sm border-0 bg-transparent px-12 py-6 text-ink-secondary focus-visible:focus-ring aria-pressed:bg-surface aria-pressed:text-ink-link aria-pressed:shadow-[0_0_0_1px_var(--hms-color-border-subtle)]"
        >
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}
