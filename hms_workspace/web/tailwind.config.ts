import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

/**
 * Tailwind CSS 3.4 theme. `src/styles/tokens.css` (Figma copy) is the single source of truth for values; this file only exposes
 * those `--hms-*` custom properties as theme keys, so utilities such as `bg-surface`, `text-ink-muted`, `p-12`, `rounded-md`
 * resolve to `var(--hms-*)`. Default palettes/scales are replaced (not extended): only approved tokens generate utilities.
 * Typography roles (`type-*`), `focus-ring`, `bg-wallpaper` and `@container` live in `src/styles/index.css` (@layer utilities).
 */
const space = (n: number) => `var(--hms-space-${n})`;
const size = (name: string) => `var(--hms-size-${name})`;

/** Spacing: key = px value of the token (`p-12` = --hms-space-12). Only the token steps exist. Named chrome sizes too. */
const spacing = {
  0: '0px',
  px: '1px',
  ...Object.fromEntries([2, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64].map((n) => [n, space(n)])),
  topbar: size('topbar'),
  'dock-bar': size('dock'),
  titlebar: size('titlebar'),
  'dock-tab': size('dock-tab'),
  control: size('control'),
  'control-lg': size('control-lg'),
  'icon-sm': size('icon-sm'),
  'icon-md': size('icon-md'),
  'icon-lg': size('icon-lg'),
  'window-min': size('window-min-width'),
  'section-index': size('section-index'),
  'field-label': size('field-label'),
  'home-content': size('home-content'),
  'tile-icon': size('tile-icon'),
  'card-min': size('card-min'),
  'assistant-panel': size('assistant-panel'),
  'viewer-media': size('viewer-media'),
  search: size('search'),
  'search-results': size('search-results'),
};

const color = (name: string) => `var(--hms-color-${name})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Preflight stays off: the screens were designed on browser defaults plus the small reset in index.css.
  theme: {
    // Viewport conditions used by the app (max-width, desktop-first). Custom properties cannot be used in media queries.
    screens: {
      narrow: { max: '1100px' },
      tablet: { max: '900px' },
      phone: { max: '640px' },
    },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      canvas: color('bg-canvas'),
      surface: color('bg-surface'),
      'surface-subtle': color('bg-surface-subtle'),
      dock: color('bg-dock'),
      selected: color('bg-selected'),
      hover: color('bg-hover'),
      viewer: color('bg-viewer'),
      toast: color('bg-toast'),
      'line-subtle': color('border-subtle'),
      line: color('border-default'),
      'line-selected': color('border-selected'),
      'line-focus': color('border-focus'),
      ink: color('text-primary'),
      'ink-secondary': color('text-secondary'),
      'ink-muted': color('text-muted'),
      'ink-disabled': color('text-disabled'),
      'ink-on-action': color('text-on-action'),
      'ink-link': color('text-link'),
      action: color('action-primary'),
      'action-hover': color('action-primary-hover'),
      accent: color('action-accent'),
      'danger-bg': color('status-danger-bg'),
      'danger-fg': color('status-danger-fg'),
      'danger-icon': color('status-danger-icon'),
      'success-bg': color('status-success-bg'),
      'success-fg': color('status-success-fg'),
      'success-icon': color('status-success-icon'),
      'warning-bg': color('status-warning-bg'),
      'warning-fg': color('status-warning-fg'),
      'warning-icon': color('status-warning-icon'),
      'info-bg': color('status-info-bg'),
      'info-fg': color('status-info-fg'),
      'ai-bg': color('ai-bg'),
      'ai-border': color('ai-border'),
      'ai-solid': color('ai-solid'),
      'ai-accent': color('ai-accent'),
      'ai-fg': color('ai-fg'),
      glass: 'var(--hms-glass-bg)',
      'glass-stroke': 'var(--hms-glass-stroke)',
    },
    spacing,
    borderRadius: {
      none: '0px',
      sm: 'var(--hms-radius-sm)',
      md: 'var(--hms-radius-md)',
      lg: 'var(--hms-radius-lg)',
      full: 'var(--hms-radius-full)',
    },
    boxShadow: {
      none: 'none',
      window: 'var(--hms-shadow-window)',
      popover: 'var(--hms-shadow-popover)',
      dock: 'var(--hms-shadow-dock)',
    },
    fontFamily: { base: 'var(--hms-font-base)' },
    // Font sizes come only from the `type-*` roles (index.css); no ad-hoc text-sm/text-lg scale.
    fontSize: {},
    // Z-order tokens (design-tokens skill: canvas 0 · window 10–199 · dock 300 · popover 400 · palette/scrim 500 · toast 600).
    zIndex: {
      auto: 'auto',
      0: '0',
      1: '1',
      2: '2',
      window: 'var(--hms-z-window-base)',
      overlay: '40',
      dock: 'var(--hms-z-dock)',
      popover: 'var(--hms-z-popover)',
      scrim: '500',
      toast: 'var(--hms-z-toast)',
      skip: '1000',
    },
    extend: {
      keyframes: { shimmer: { to: { backgroundPosition: '-200% 0' } } },
      animation: { shimmer: 'shimmer 1.2s linear infinite' },
      minWidth: spacing,
      maxWidth: spacing,
      minHeight: spacing,
      maxHeight: spacing,
    },
  },
  // Replaced by the plugin below (border width utilities that also set the style).
  corePlugins: { preflight: false, borderWidth: false, borderStyle: false },
  plugins: [
    plugin(({ addVariant }) => {
      // Container breakpoint of the remodel WindowPage (tokens.css: 560 compact). Pair with the `@container` utility.
      addVariant('cq-compact', '@container (max-width: 559px)');
    }),
    /*
     * Without preflight, a v3 `border` utility would only set the width (the browser default style is `none`, so nothing shows).
     * Like Tailwind v4, width utilities also set the style through `--tw-border-style` (default solid), and `border-dashed` etc.
     * set that variable, so `border border-dashed` is dashed whatever the utility order.
     */
    plugin(({ matchUtilities, addUtilities, theme }) => {
      const sides: Record<string, string[]> = {
        border: ['border'],
        'border-x': ['border-left', 'border-right'],
        'border-y': ['border-top', 'border-bottom'],
        'border-t': ['border-top'],
        'border-r': ['border-right'],
        'border-b': ['border-bottom'],
        'border-l': ['border-left'],
        'border-s': ['border-inline-start'],
        'border-e': ['border-inline-end'],
      };
      for (const [name, props] of Object.entries(sides)) {
        matchUtilities(
          {
            [name]: (value: string) =>
              Object.fromEntries(
                props.flatMap((p) => [
                  [`${p}-style`, 'var(--tw-border-style, solid)'],
                  [`${p}-width`, value],
                ]),
              ),
          },
          { values: theme('borderWidth'), type: ['line-width', 'length'] },
        );
      }
      addUtilities(
        Object.fromEntries(
          ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none'].map((s) => [
            `.border-${s}`,
            { '--tw-border-style': s, 'border-style': s },
          ]),
        ),
      );
    }),
  ],
} satisfies Config;
