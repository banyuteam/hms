# PRD — web-frontend

- **Status:** Stub — not written yet  _(Stub → Draft → Approved)_ — a technology decision has been recorded (see §5.1)
- **Based on draft:** `docs/prd/001-Frontend-Workspace-HMS.md` (received 2026-10-28; not yet converted into this PRD)
- **Last updated:** 2026-10-28 (technology decision added)
- **Owner:** Product owner (user)

> Until this PRD is Approved, Claude may scaffold and run spikes but asks before building
> features. See the "PRD and skill workflow" in the root `CLAUDE.md`.

## 1. Problem & goals
## 2. Users & roles
## 3. Scope (in / out)
## 4. Functional requirements
## 5. Non-functional requirements (security, performance, availability, audit)

### 5.1 Technology stack — **decided** (ADR-0002, ADR-0003; 2026-10-28)

| Layer | Decision | Source |
|---|---|---|
| UI library | **React** | Product owner |
| Language | **TypeScript** (strict) | Product owner |
| Build / dev tooling | **Vite** — static single-page application (client-side rendering, no SSR) | Product owner |

Supporting libraries (ADR-0003, approved by the product owner):

| Area | Decision |
|---|---|
| Window manager | Own thin manager (pointer events + store); 2-day spike vs `dockview` gates the commitment |
| Components | React Aria Components (headless) + our CSS; fallback Base UI |
| Styling | CSS Modules + `tokens.css` (`--hms-*`) |
| Server state / API | TanStack Query + `openapi-typescript` / `openapi-fetch` from `source/shared/` OpenAPI |
| Client state | Zustand |
| Routing | React Router, top-level only (windows are not routes; no patient ids in URLs) |
| i18n | FormatJS / `react-intl` (ICU); locales **Bahasa Indonesia (`id`, default) + English (`en`)** — ADR-0003 Amendment 1 |
| Testing & quality | Vitest, React Testing Library, MSW, Playwright, axe; ESLint (+ `jsx-a11y`), Prettier; TS strict |
| Package manager | pnpm; versions pinned at scaffold (React, Vite, TypeScript, Node LTS) |

Full rationale and consequences: [`docs/decisions/0002-web-frontend-react-typescript-vite.md`](../../docs/decisions/0002-web-frontend-react-typescript-vite.md).

Requirements that follow from the decision (derived from root/project `CLAUDE.md`, not new scope):
- The app talks only to the API gateway/BFF; it never connects to a database.
- Only non-secret configuration reaches the browser bundle (Vite `VITE_` variables are public); `.env.example` holds placeholders only.
- No PHI in URLs/routes, local/session storage, IndexedDB, analytics, error reports or source maps; clear in-memory caches on logout and idle lock.
- No third-party CDNs; fonts, icons and scripts are bundled/self-hosted.
- Design tokens are consumed as CSS custom properties (`--hms-*`, see the `design-tokens` skill).
- UI strings come from i18n message catalogs in **Bahasa Indonesia (default) and English**; no hard-coded copy; CI checks missing/extra keys; users can switch language in the top-bar user menu; the choice is saved per browser (`hms.locale`, non-PHI). **English covers UI text only** — backend clinical data, AI answers, reports/print-outs and legal/clinical documents are not translated. Neutral English with Indonesian conventions (`27 Oct 2026`, 24 h, Asia/Jakarta, `37.8`, `Rp1,170,000`; Rupiah stays integer).
- Dependency lockfile committed and dependencies audited.

Still **open** (decide when the feature is built; leanings in ADR-0003 "Defer"): data tables/grid, forms & validation, charts,
radiology viewer, date handling, auth/session storage (gateway ADR).
Persisted client state and the TanStack Query cache must never hold PHI; the cache is cleared on logout and idle lock.

## 6. Data & integrations
## 7. Acceptance criteria
## 8. Milestones
## 9. Open questions

See [`open-questions.md`](open-questions.md) (OQ-01 … OQ-33). Design references: Figma file
<https://www.figma.com/design/yo53y0sVdqxaKNjZquWNom>; skills `hospital-ux-expert` and `design-tokens`.

## Change log

- 2026-10-28 — Workspace restructured: this PRD, the skills and the open questions moved to `design/web-frontend/` (code stays in `source/web-frontend/`).
- 2026-10-28 — First Vite skeleton created (login/logout with a static demo account, window manager, dock, Manajemen Pasien window); scaffold findings in ADR-0003 Amendment 2. No functional requirements added (draft still not provided).
- 2026-10-28 — Product-owner decisions recorded in open questions: Ruang Fokus (focus/rest area) with calm hospital wallpaper (OQ-21), write actions disabled in Phase 1 (OQ-03), AI answers follow the question's language (OQ-38), per-browser language kept across logout (OQ-39). No functional requirements added to this PRD yet (draft still not provided).
- 2026-10-28 — English scope decided: UI text only, neutral English with Indonesian conventions, preference saved per browser; EN frames in Figma (OQ-34…37).
- 2026-10-28 — English added as a second UI locale (`id` default, `en`), ADR-0003 Amendment 1; §5.1 updated.
- 2026-10-28 — §5.1 extended with the approved supporting-library bundle (ADR-0003).
- 2026-10-28 — Added §5.1 Technology stack: React + TypeScript + Vite (SPA), decided by the product owner; recorded as ADR-0002.
  Added pointers in §9. No functional requirements added (PRD draft still not provided).
