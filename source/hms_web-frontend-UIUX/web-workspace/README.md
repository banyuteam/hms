# web-workspace

**Requirement:** #3  
**Status:** **Phase 2 scaffold running** (PRD §8.1) — window manager v2 (window states, tile layouts up to 4, compact shell) and the **Patient Detail** window (header + safety bar, tabs with **More ▾**, profile sidebar, Overview, Medical Record, four profile pages, masked fields with audited reveal), all on synthetic data behind an API interface. Phase 1 (shell, login, Patient Management) is unchanged. English is the default UI language (`id` supported). Stack: ADR-0002 + ADR-0003. PRD is a Draft (awaiting review). Window-manager spike vs dockview done: own manager stays (`spikes/dockview/`, throwaway).

The browser workspace that replicates the Khanza desktop screens (windows, dock, patient detail).

| | |
|---|---|
| Plan & design (PRD, Figma, tokens, UX rules) | [`design/hms_web-frontend-UIUX/web-workspace/`](../../../design/hms_web-frontend-UIUX/web-workspace/) — [`PRD.md`](../../../design/hms_web-frontend-UIUX/web-workspace/PRD.md) (draft; source: [`docs/prd/001-Frontend-Workspace-HMS.md`](../../../docs/prd/001-Frontend-Workspace-HMS.md)) |
| Skills | [`hospital-ux-expert`](../../../design/hms_web-frontend-UIUX/web-workspace/.claude/skills/hospital-ux-expert/SKILL.md), [`design-tokens`](../../../design/hms_web-frontend-UIUX/web-workspace/.claude/skills/design-tokens/SKILL.md) (linked into `.claude/skills` so they load while coding) |
| Design (Figma) | [Wireframes, mockups, components, tokens](https://www.figma.com/design/yo53y0sVdqxaKNjZquWNom) |
| Decisions | [ADR-0002](../../../docs/decisions/0002-web-frontend-react-typescript-vite.md), [ADR-0003](../../../docs/decisions/0003-web-frontend-library-choices.md) |
| Open questions | [`design/hms_web-frontend-UIUX/web-workspace/open-questions.md`](../../../design/hms_web-frontend-UIUX/web-workspace/open-questions.md) |
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

## What is built (and where the Figma design lives)

| Figma | Code |
|---|---|
| Tokens (variables, text/effect styles) | `src/styles/tokens.css` (copy of `design/hms_web-frontend-UIUX/web-workspace/.claude/skills/design-tokens/references/tokens.css`) + wallpaper/scrim/glass vars |
| 09 Login | `src/pages/LoginPage.tsx` |
| 01 Beranda | `src/workspace/Home.tsx` |
| Top bar | `src/workspace/TopBar.tsx`, `UserMenu.tsx`, `ModuleMenu.tsx` |
| Window + Window Titlebar (Focused/Unfocused) | `src/workspace/WindowFrame.tsx` (drag, 8-way resize, min/max/close, keyboard) |
| Dock + Dock Tab | `src/workspace/Dock.tsx` |
| 03 Manajemen Pasien | `src/workspace/windows/PatientManagementWindow.tsx` (synthetic data: `src/data/syntheticPatients.ts`) |
| Button, Status Pill, Logo, ID\|EN switch | `src/components/*` |
| Window manager v2 (`design/hms_web-frontend-UIUX/web-workspace/window-states.md`) | `windowStore.ts` (states `floating · tiled · maximized · minimized`, layouts, multi-instance ids), `geometry.ts` (tile slots, 24/16 px rules, fit test), `frames.ts` (what to draw where: stacking tiers, compact shell, empty slots) |
| Layout picker (dock) + empty slot | `src/workspace/LayoutPicker.tsx`, `Workspace.tsx` ("Open module…" placeholder, "layout paused" note) |
| 04 Patient Detail · 10–13 profile pages · 14 Medical Record · W10 navigation model | `src/workspace/windows/patient-detail/` — `PatientDetailWindow`, `PatientHeader`, `DetailTabs` (+ `tabLayout.ts`), `ProfileSidebar`, `pages/*` |
| Card · Field Row · masked value | `src/components/Card.tsx`, `FieldRow.tsx`, `MaskedValue.tsx` |
| Patient data (synthetic) | `src/api/` — `types.ts`, `syntheticRecords.ts`, `patientApi.ts` (the only door to patient data), `usePatient.ts`, `queryClient.ts` (TanStack Query, cleared on logout); audit stub `src/audit/audit.ts` |
| i18n (`en` default, `id`) | `src/i18n/` — FormatJS catalogs `messages/id.json`, `en.json` (a test checks key/placeholder parity) |

**Not built yet** (placeholders or omitted on purpose): Documents tab and the other clinical tabs ("planned for Phase 3" placeholders), specialty assessment forms, Lab/Radiology/Billing content (placeholder windows), split-handle ratios and snap-by-drag, layout persistence, Ctrl+K palette and direct shortcuts, notifications, AI assistant window, Ruang Fokus, auto-lock screen (idle → logout stands in), dark mode, real BFF/auth, and the OpenAPI contract in `source/hms_shared/` (`src/api/types.ts` stands in).

## Conventions

- Design tokens only (no hex/px literals in component CSS); see the `design-tokens` skill. CSS Modules, no CSS-in-JS.
- Every UI string comes from `src/i18n/messages/{id,en}.json` (add both). English = UI text only; Khanza/backend data is shown as stored.
- No PHI in code, fixtures, tests, logs or storage; all patient data is synthetic. Patient windows are keyed by MRN **in memory only** (never in a URL, storage or the persisted query cache); the query cache and audit stub are cleared on logout. Masked values reveal for 30 s and emit an audit event that contains no PHI.
- Only `VITE_*` non-secret values in the bundle (`.env.example` has placeholders). Source maps are off in production builds.
- Keyboard: titlebar focused → arrows move a *floating* window, Shift+arrows resize; tiled windows get their rectangle from the layout; dock tabs are buttons; Alt+1…4 open modules (browser conflicts: OQ-19); in Patient Detail the tab bar uses roving focus (←/→/Home/End); in Patient Management Enter (or double-click) opens the patient.

## Testing notes

- `pnpm test` = Vitest + React Testing Library (+ axe-core, colour-contrast rule off in jsdom): 77 tests incl. every window transition and layout rule (`windowStore.test.ts`), the tab overflow rule, masking/audit, the layout picker and Patient Detail. Component tests with React Aria are slow in jsdom (≈ 1–2 min total).
- `pnpm e2e` runs Playwright against a preview build in mode `e2e` using the locally installed Google Chrome (`channel: 'chrome'`). Playwright's bundled Chromium is not available for macOS 12; in CI run `playwright install chromium` and set `PW_CHANNEL=chromium`.
