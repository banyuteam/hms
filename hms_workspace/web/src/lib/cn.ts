import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's default scale; our theme replaces it with token names (tailwind.config.ts), so the
 * custom keys are declared here. Otherwise e.g. `text-ink-muted` and `type-body` would not be recognised as colour/font-size.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          type: [
            'title-lg',
            'title-md',
            'heading-sm',
            'body',
            'body-strong',
            'caption',
            'caption-strong',
            'overline',
            'data-lg',
            'display',
          ],
        },
      ],
      shadow: [{ shadow: ['window', 'popover', 'dock'] }],
    },
  },
});

/** Compose class names: `clsx` for conditions, `tailwind-merge` so a later utility wins over a conflicting earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
