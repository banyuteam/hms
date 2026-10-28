# web-frontend

**Requirement:** #3  
**Status:** First skeleton running — Vite + React + TypeScript with design tokens, login/logout (static demo account), a window manager, a bottom dock and one real window (Manajemen Pasien, synthetic data). Stack: ADR-0002 + ADR-0003. PRD still a stub.

The browser workspace that replicates the Khanza desktop screens (windows, dock, patient detail).

| | |
|---|---|
| Plan & design (PRD, Figma, tokens, UX rules) | [`design/web-frontend/`](../../design/web-frontend/) — [`PRD.md`](../../design/web-frontend/PRD.md) (stub; draft: [`docs/prd/001-Frontend-Workspace-HMS.md`](../../docs/prd/001-Frontend-Workspace-HMS.md)) |
| Skills | [`hospital-ux-expert`](../../design/web-frontend/.claude/skills/hospital-ux-expert/SKILL.md), [`design-tokens`](../../design/web-frontend/.claude/skills/design-tokens/SKILL.md) (linked into `.claude/skills` so they load while coding) |
| Design (Figma) | [Wireframes, mockups, components, tokens](https://www.figma.com/design/yo53y0sVdqxaKNjZquWNom) |
| Decisions | [ADR-0002](../../docs/decisions/0002-web-frontend-react-typescript-vite.md), [ADR-0003](../../docs/decisions/0003-web-frontend-library-choices.md) |
| Open questions | [`design/web-frontend/open-questions.md`](../../design/web-frontend/open-questions.md) |
| Claude instructions | [`CLAUDE.md`](CLAUDE.md) |

## How to run

Prerequisites: Node ≥ 24 and pnpm (`corepack enable`, or prefix commands with `corepack`).

```bash
pnpm install
pnpm dev            # http://127.0.0.1:5173  (demo account enabled by .env.development)
pnpm typecheck && pnpm lint && pnpm test
pnpm build          # production bundle in dist/ — demo account NOT included unless VITE_DEMO_AUTH=true
pnpm preview        # serve dist/ on :4173
pnpm e2e            # Playwright (uses installed Google Chrome; see below)
```

### Static demo account (login/logout demo only)

| | |
|---|---|
| Username | `demo.dokter` |
| Password | `Demo#2026` |

- It is **not authentication**: the credentials are fake, public and shown on the login screen. Real sign-in will go through the BFF (separate ADR).
- Enabled only with `VITE_DEMO_AUTH=true` (set in `.env.development` / `.env.e2e`). A default `pnpm build` does **not** contain the credentials (checked: `grep -l "Demo#2026" dist/assets/*.js` finds nothing).
- The session lives **in memory only** (no cookies/localStorage/sessionStorage) → a page reload signs out. Logout (user menu) and the idle timeout (`VITE_IDLE_MINUTES`, default 15) wipe the session **and** the window layout.
- The only browser storage used is `localStorage["hms.locale"]` (`id` | `en`) — language preference per browser, no PHI.

## What is in the skeleton (and where the Figma design lives)

| Figma | Code |
|---|---|
| Tokens (variables, text/effect styles) | `src/styles/tokens.css` (copy of `design/web-frontend/.claude/skills/design-tokens/references/tokens.css`) + wallpaper/scrim/glass vars |
| 09 Login | `src/pages/LoginPage.tsx` |
| 01 Beranda | `src/workspace/Home.tsx` |
| Top bar | `src/workspace/TopBar.tsx`, `UserMenu.tsx`, `ModuleMenu.tsx` |
| Window + Window Titlebar (Focused/Unfocused) | `src/workspace/WindowFrame.tsx` (drag, 8-way resize, min/max/close, keyboard) |
| Dock + Dock Tab | `src/workspace/Dock.tsx` |
| 03 Manajemen Pasien | `src/workspace/windows/PatientManagementWindow.tsx` (synthetic data: `src/data/syntheticPatients.ts`) |
| Button, Status Pill, Logo, ID\|EN switch | `src/components/*` |
| Window manager | `src/workspace/windowStore.ts` (Zustand, one window per module, no persistence), `geometry.ts` (24 px margin rule) |
| i18n (`id` default, `en`) | `src/i18n/` — FormatJS catalogs `messages/id.json`, `en.json` (a test checks key/placeholder parity) |

**Not built yet** (placeholders or omitted on purpose): Detail Pasien, Lab/Radiology/Billing content (open as placeholder windows), Ctrl+K palette (field is disabled), notifications, snap/tile layout picker, AI assistant window, Ruang Fokus, auto-lock screen (idle → logout stands in), dark mode.

## Conventions

- Design tokens only (no hex/px literals in component CSS); see the `design-tokens` skill. CSS Modules, no CSS-in-JS.
- Every UI string comes from `src/i18n/messages/{id,en}.json` (add both). English = UI text only; Khanza/backend data is shown as stored.
- No PHI in code, fixtures, tests, logs or storage. Windows are keyed by module, never by patient, until patient detail exists; no patient identifiers in URLs.
- Only `VITE_*` non-secret values in the bundle (`.env.example` has placeholders). Source maps are off in production builds.
- Keyboard: titlebar focused → arrows move the window, Shift+arrows resize; dock tabs are buttons; Alt+1…4 open modules (browser conflicts: OQ-19).

## Testing notes

- `pnpm test` = Vitest + React Testing Library (+ axe-core, colour-contrast rule off in jsdom). Component tests with React Aria are slow in jsdom (≈ 2 min total).
- `pnpm e2e` runs Playwright against a preview build in mode `e2e` using the locally installed Google Chrome (`channel: 'chrome'`). Playwright's bundled Chromium is not available for macOS 12; in CI run `playwright install chromium` and set `PW_CHANNEL=chromium`.
