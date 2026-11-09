/** Shared class names for the top bar and its user menu. */
export const topBar = {
  iconButton:
    'inline-grid size-control cursor-pointer place-items-center rounded-md border border-line bg-surface p-0 text-ink-secondary ' +
    'disabled:cursor-not-allowed disabled:bg-hover disabled:text-ink-disabled focus-visible:focus-ring',
  user: 'flex cursor-pointer items-center gap-8 rounded-md border-0 bg-transparent px-8 py-4 text-left text-ink focus-visible:focus-ring',
  avatar:
    'inline-grid size-[36px] place-items-center rounded-full bg-selected text-[length:var(--hms-text-caption-strong-size)] leading-none font-semibold text-ink-link before:content-[attr(data-initials)]',
  userText:
    'flex flex-col narrow:hidden [&_small]:text-[length:var(--hms-text-caption-size)] [&_small]:text-ink-muted [&_strong]:font-semibold',
} as const;
