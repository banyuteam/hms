/** Shared class names for the remodel task windows (timeline, claim checks, viewers). */
export const w = {
  timeline: 'm-0 flex list-none flex-col gap-12 p-0',
  moment:
    "relative border-l-2 border-line-selected pl-16 before:absolute before:top-6 before:-left-[7px] before:size-8 before:rounded-full before:bg-accent before:outline before:outline-2 before:outline-surface before:content-['']",
  momentHead: 'type-heading-sm mt-0 mr-0 mb-4 ml-0 text-ink [font-variant-numeric:tabular-nums]',
  note: 'type-caption m-0 text-ink-muted',
  checks:
    'm-0 flex list-none flex-col p-0 [&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-12 [&_li]:border-b [&_li]:border-line-subtle [&_li]:py-8 [&_li]:text-ink [&_li:last-child]:border-b-0',
  stack: 'flex flex-col gap-12',
  columnTitle: 'type-heading-sm mt-0 mr-0 mb-6 ml-0 text-ink',
  /** Title inside an `itemHead` row (no bottom margin). */
  itemTitle: 'type-heading-sm m-0 text-ink',
  flag: 'font-semibold text-danger-fg',
  media:
    'flex min-h-viewer-media flex-col items-center justify-center gap-8 rounded-md bg-viewer p-24 text-center text-ink-disabled [&_p]:m-0',
  doc: 'flex flex-col gap-12 rounded-md border border-line-subtle bg-surface p-24 print:border-0',
  docTitle: 'type-title-lg m-0',
  /** ICD codes: body font with tabular figures (not the browser monospace). */
  code: 'font-semibold tracking-[var(--hms-text-overline-tracking)] [font-variant-numeric:tabular-nums]',
  itemHead: 'flex flex-wrap items-center justify-between gap-8',
} as const;
