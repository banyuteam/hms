# web-frontend — code instructions

The browser workspace that replicates the Khanza desktop experience as a web app (the code).
Read the root `CLAUDE.md` and `design/web-frontend/PRD.md` first.

## Scope

Implements the design in `design/web-frontend/` (PRD, Figma, tokens, UX skills, open questions) as a
browser app. Talks only to the API gateway / BFF in `source/backend-services/`. Never connects to a database.
Read `design/web-frontend/PRD.md` and `design/web-frontend/CLAUDE.md` for what to build and why.

## Commands (pnpm via corepack)

`pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm format:check` · `pnpm test` · `pnpm build` · `pnpm e2e` — run typecheck, lint, test (and e2e for flows) before calling work done. TypeScript is pinned to 6.x (typescript-eslint does not support 7). Demo login: `demo.dokter` / `Demo#2026`, only when `VITE_DEMO_AUTH=true`; never add real users or secrets.

## Design

Plans, Figma links, tokens and UX rules live in `design/web-frontend/` (skills: `design/web-frontend/.claude/skills/`,
mirrored here via the `.claude/skills` link so they load while coding). Open questions: `design/web-frontend/open-questions.md`.
`src/styles/tokens.css` is a copy of `design/web-frontend/.claude/skills/design-tokens/references/tokens.css` plus the
workspace background variables — update Figma and the design folder first, then this copy.

## Rules

- Stack decided in ADR-0002 and ADR-0003 (`docs/decisions/`): **React + TypeScript (strict) + Vite** static SPA; React Aria Components + CSS Modules on `tokens.css`; own window manager (spike vs dockview first); Zustand; TanStack Query + openapi-typescript/openapi-fetch; React Router (top-level routes only, no patient ids in URLs); FormatJS; Vitest/RTL/MSW/Playwright/axe; ESLint(+jsx-a11y)/Prettier; pnpm. Deferred (ask when needed): tables, forms, charts, radiology viewer. Don't add libraries outside these without asking. Only `VITE_` non-secret config in the bundle; no PHI in storage/URLs/source maps/query cache persistence; no external CDNs.
- The mockup is the visual reference: match its layout, density, colour tokens
  (`--b:#0878f9`, `--line`, `--ink`, `--muted`) and the window/dock model. Copy assets out of
  `docs/mockups/`; don't edit the mockup itself (runtime assets live in `source/web-frontend/assets/`).
- Build a small design system first (tokens, window, dock tab, card, field grid, table, pill,
  tab bar) and compose screens from it.
- Keyboard-first like the desktop app: shortcuts for search, switch window, close window;
  visible focus states; tables navigable by keyboard.
- UI languages: English (default, source of truth) and Bahasa Indonesia (`id`), via FormatJS message catalogs (`en.json`, `id.json`; ADR-0003 Amendments 1 and 3). No hard-coded copy; every new string needs both locales; English = **UI text only** (don't translate backend/clinical data, AI answers, reports or legal/clinical documents); locale saved per browser in `hms.locale` (no PHI); neutral `en` with Indonesian conventions (`27 Oct 2026`, 24 h, `37.8`, `Rp1,170,000`, Rupiah = integer).
- Role-based UI: hide actions the user's role can't perform, but always rely on the backend
  for authorization.
- PHI in the browser: no PHI in URLs, local storage, or analytics; clear caches on logout;
  auto-lock after idle timeout.
- Tests: component tests for the design system, end-to-end tests for core flows using
  synthetic data and mocked APIs.
- **Phase 2 rules** (PRD §8.1): window behaviour (states, tiers, tiles, compact shell) follows `design/web-frontend/window-states.md` — change the doc first, then `windowStore.ts` / `frames.ts` / `geometry.ts` and their tests. Patient data goes **only** through `src/api/patientApi.ts` (synthetic today; the OpenAPI contract in `source/shared/` comes first, OQ-57). Patient Detail navigation (header · tabs with **More ▾** · profile sidebar, one active place) is specified in PRD FR-18 and Figma W10; field lists in `design/web-frontend/patient-profile-fields.md` and `patient-medical-record-fields.md` — don't add fields that are not in the Khanza schema snapshot. Enum values are shown with the English labels in those docs. Verify UI changes in Chrome DevTools against Figma (screenshot, a11y snapshot, Lighthouse), and keep Lighthouse accessibility at 100.
