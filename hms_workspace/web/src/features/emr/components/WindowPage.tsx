import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '@/locales/I18nProvider';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { MenuItem, Popover, popoverStyles as menu } from '@/components/Popover';

export interface SectionDef {
  id: string;
  label: string;
  /** Item count shown next to the label; omitted = no count. */
  count?: number;
}

const SectionIds = createContext<(id: string) => string>((id) => id);
/** DOM id of a section inside the current window (unique per window instance). */
export const useSectionDomId = () => useContext(SectionIds);

/**
 * Scrolls ONLY the window's content pane. `scrollIntoView` also scrolls every scrollable ancestor (window body,
 * work area), which slid the title bar and identity strip out of view.
 */
function scrollToSection(pane: HTMLElement | null, domId: string) {
  const el = document.getElementById(domId);
  if (!pane || !el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  const gap = parseFloat(getComputedStyle(pane).paddingTop) || 0;
  pane.scrollTo?.({ top: Math.max(0, top - gap), behavior: reduce ? 'auto' : 'smooth' });
  el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

/**
 * Remodel window layout (no tab bar, nothing hidden): identity strip · toolbar · vertical section index ·
 * one scrolling page. Below the compact container width the index turns into a "Sections" menu button —
 * never a horizontal bar. Every section stays in the page.
 */
export function WindowPage({
  label,
  identity,
  toolbar,
  sections,
  children,
}: {
  /** Accessible name of the page region (the window title). */
  label: string;
  identity?: ReactNode;
  toolbar?: ReactNode;
  sections: readonly SectionDef[];
  children: ReactNode;
}) {
  const { t } = useI18n();
  const base = useId();
  const domId = useCallback((id: string) => `${base}-sec-${id}`, [base]);
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  const paneRef = useRef<HTMLDivElement>(null);
  const go = (id: string) => {
    setActive(id);
    scrollToSection(paneRef.current, domId(id));
  };
  const navLabel = t('emr.sections');

  return (
    <SectionIds.Provider value={domId}>
      <div
        className="@container flex min-h-0 flex-1 flex-col bg-surface-subtle"
        role="region"
        aria-label={label}
      >
        {identity}
        <div className="flex items-center gap-8 border-b border-line-subtle bg-surface px-16 py-8 cq-compact:px-12 [&:has([data-toolbar-actions]:empty):not(:has([data-sections-menu]))]:hidden">
          {sections.length > 1 && (
            <Popover
              label={navLabel}
              placement="bottom-start"
              trigger={(props) => (
                <button
                  type="button"
                  {...props}
                  data-sections-menu=""
                  className="type-body-strong hidden min-h-control cursor-pointer items-center gap-8 rounded-md border border-line bg-surface px-12 text-ink-secondary focus-visible:focus-ring cq-compact:inline-flex"
                >
                  <Icon name="listChecks" size={16} />
                  <span>{navLabel}</span>
                  <Icon name="chevronDown" size={16} />
                </button>
              )}
            >
              {sections.map((s) => (
                <MenuItem key={s.id} onSelect={() => go(s.id)}>
                  <span className={menu.itemText}>{s.label}</span>
                  {s.count !== undefined && <span className={menu.hint}>{s.count}</span>}
                </MenuItem>
              ))}
            </Popover>
          )}
          <div
            data-toolbar-actions=""
            className="ml-auto flex flex-wrap items-center gap-8 cq-compact:gap-4"
          >
            {toolbar}
          </div>
        </div>
        <div
          className={cn(
            'grid min-h-0 flex-1',
            sections.length > 1
              ? 'grid-cols-[var(--hms-size-section-index)_minmax(0,1fr)] cq-compact:grid-cols-[minmax(0,1fr)]'
              : 'grid-cols-[minmax(0,1fr)]',
          )}
        >
          {sections.length > 1 && (
            <nav
              className="overflow-auto border-r border-line-subtle bg-surface px-8 py-12 cq-compact:hidden"
              aria-label={`${navLabel} · ${label}`}
            >
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${domId(s.id)}`}
                      className="type-body flex min-h-control items-center gap-8 rounded-md px-12 text-ink-secondary no-underline hover:bg-hover focus-visible:-outline-offset-2 aria-[current]:bg-selected aria-[current]:font-semibold aria-[current]:text-ink-link"
                      aria-current={active === s.id ? 'location' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        go(s.id);
                      }}
                    >
                      <span className="min-w-0 flex-1">{s.label}</span>
                      {s.count !== undefined && (
                        <span className="type-caption text-ink-muted [font-variant-numeric:tabular-nums]">
                          {s.count}
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div
            ref={paneRef}
            className="flex min-w-0 flex-col gap-16 overflow-auto pt-16 pr-24 pb-32 pl-24 cq-compact:pt-12 cq-compact:pr-12 cq-compact:pb-24 cq-compact:pl-12"
          >
            {children}
          </div>
        </div>
      </div>
    </SectionIds.Provider>
  );
}
