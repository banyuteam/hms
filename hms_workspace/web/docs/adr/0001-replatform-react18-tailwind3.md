# ADR-0001 — Re-platform the web workspace onto React 18.3 / Tailwind 3.4 / Context + reducers

|                             |                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                      | PROPOSED (implemented in this repository; awaiting owner review)                                                                                                                                    |
| Date                        | 2026-11-05                                                                                                                                                                                          |
| Project                     | `hms_workspace/web` (Banyumanik 2 EMR remodel)                                                                                                                                                      |
| Supersedes for this project | The predecessor prototype's library choices (React 19, Vite 8, Tailwind 4, React Aria, Zustand, TanStack Query, react-intl, pnpm); that prototype is outside this workspace and is not a dependency |

## Context

The updated project instructions (`CLAUDE.md` §2) pin a different stack and forbid several libraries the predecessor prototype relied on.
The owner asked for a copy of the established work with the same core functionality and the same design system, built on that stack.
Owner decisions (2026-11-05): port the **remodel only** (Home + W1–W4 + viewers + AI assistant; the Phase-1 Patient Management and
tabbed Patient Detail windows are not carried over), **include the dev-only live API adapter**, **keep the existing Figma tokens**
then (same day) **adopt `#264f78` as primary** — see Amendment 1.

## Decision

| Concern               | Predecessor prototype      | hms_workspace                                                    | Notes                                                                                        |
| --------------------- | -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| UI runtime            | React 19.3                 | React 18.3                                                       |                                                                                              |
| Language / build      | TS 6, Vite 8, pnpm         | TS 5.7, Vite 6, npm; `tsc -b && vite build`                      | project references (`tsconfig.app.json`, `tsconfig.node.json`)                               |
| Styling               | Tailwind 4 `@theme inline` | Tailwind 3.4 `tailwind.config.ts` + PostCSS/Autoprefixer         | same `--hms-*` tokens, same utility names (`bg-surface`, `p-12`, `type-body`, `cq-compact:`) |
| Accessible primitives | React Aria Components      | native elements + `components/Popover.tsx` (menu/dialog popover) | keyboard: arrows/Home/End, Escape/Tab/outside close, focus return                            |
| Client state          | Zustand stores             | Context + pure reducers (`src/state/*`)                          | state and actions in separate contexts                                                       |
| Server data           | TanStack Query             | `lib/resource.ts` in-memory cache                                | same result fields; cleared on sign-out; no retries                                          |
| i18n                  | react-intl + JSON          | `src/locales/{id,en}` + ICU subset (`locales/icu.ts`)            | plural/select/`#`/quoting; default **id**                                                    |
| Forms                 | RAC fields + manual checks | React Hook Form + Zod (`zodResolver`)                            |                                                                                              |
| Routing               | `/login`, `/workspace`     | `/login`, `/`, `/:workflow`                                      | slug = window kind only; never an identifier                                                 |

### Tailwind 3 compatibility notes

- Preflight stays **off** (as before). Because v3 `border*` utilities only set the width, the core `borderWidth`/`borderStyle`
  plugins are replaced by a small plugin that also sets `border-style: var(--tw-border-style, solid)` (v4 behaviour);
  `--tw-border-style` is reset per element in `index.css` so it does not inherit.
- The theme **replaces** colours, spacing, radius, shadows, font sizes and z-index with token keys — only approved tokens exist.
  Tailwind 3 silently drops unknown classes, so a class outside the token scale renders nothing (review rule, not a build error).
- `cq-compact:` is a plugin variant (`@container (max-width: 559px)`) paired with the `@container` utility in `index.css`.

## Consequences

- Locale is no longer persisted (`hms.locale` in localStorage is gone): CLAUDE.md §5 allows only the demo device record.
  A reload returns to Indonesian. The **default locale changes from English to Indonesian** (CLAUDE.md §8; the predecessor defaulted to English).
- `@fontsource/inter` is not included (not in the approved stack): the font stack falls back `Segoe UI → Inter (if installed) → Arial`.
- Playwright e2e specs were not ported (no Playwright in the approved stack); Vitest + Testing Library + axe-core (jsdom) remain.
- `lib/resource.ts` is deliberately small: no retries, no window-focus refetch, no request cancellation; a "Load more" failure
  is reported on the page key. Revisit if the hms_services APIs need more.

## Rollback

There is no in-workspace fallback: the predecessor prototype is outside this workspace and is not a rollback target.
Roll back by redeploying the previous `hms_workspace/web` build.

## Amendment 1 — navy primary and live UI test fixes (2026-11-05)

- New primitives `navy/600 #264F78`, `navy/700 #1E3E5E`. `action/primary`, `action/accent`, `text/link`, `status/info-fg` → navy/600;
  `action/primary-hover` → navy/700. `border/focus` stays `blue/500` (focus must stand out from navy selection).
  Contrast: navy/600 on white 8.50, on `bg/selected` 7.41; white on navy/600 8.50, on navy/700 11.02 (all AA).
- Live Chrome test findings fixed: wallpaper scrim missing (`--tw-content` default restored for `::before/::after` with
  preflight off); `<strong>` rendered 700 instead of the 600 token weight; role pill tone differed between Home and dock;
  dock tab truncated the encounter number (identifier now never truncated).
- Figma variables still to be updated to match (tokens skill: Figma first — done in code on owner instruction).

## Amendment 2 — workspace self-containment (2026-11-09)

- References, links and paths to projects outside `hms` (then named `hms-engineering-workspace-v4`) were removed from this project; the predecessor
  is named generically. No decision in this ADR changes.
- The predecessor engine's API snapshot (`docs/api/`) and the moved ADR-0002 stub were deleted; the v4 contracts are in
  `hms_services/contracts/api/`. Leftover code and messages of the earlier Patient Detail screens were removed.
