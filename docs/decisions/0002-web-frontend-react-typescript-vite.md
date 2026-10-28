# ADR-0002: Web-frontend stack — React + TypeScript + Vite

- Status: accepted (decided by the product owner on 2026-10-28)
- Date: 2026-10-28
- Deciders: Product owner (user)
- Scope: `source/web-frontend/`. (ADR-0001 is reserved for the Khanza CDC approach and is still pending.)

## Context

`source/web-frontend/` replicates the Khanza desktop experience as a browser workspace: top bar with
global search, floating/resizable windows, a bottom dock, an AI-assistant window, tables, forms and a
radiology viewer (see `docs/mockups/` and the Figma file). It talks only to the API gateway/BFF in
`source/backend-services/`. Root `CLAUDE.md` rule 4 requires an ADR before choosing a language/framework,
and `source/web-frontend/CLAUDE.md` (now `design/web-frontend/` for plan and design) said "framework and component library are pending an ADR".

Constraints that matter here: desktop-like, highly interactive UI (window manager, keyboard-first);
hospital LAN deployment likely with limited internet; PHI must never reach URLs, local storage,
analytics or third-party CDNs; UI strings in Bahasa Indonesia via i18n files; design tokens are
framework-agnostic CSS custom properties (see the `design-tokens` skill).

## Options considered

The owner chose the stack; the alternatives below are recorded for the record only.

| Option | Notes |
|---|---|
| **React + TypeScript + Vite (SPA)** — chosen | Large ecosystem and hiring pool; component model suits a window/dock workspace; TypeScript gives typed API/event contracts from `source/shared/`; Vite gives fast dev/build and static output |
| Next.js / other SSR frameworks | Server rendering adds a Node runtime and server-side data paths that PHI would pass through; little benefit for an authenticated, desktop-like app behind the BFF |
| Angular, Vue/Nuxt, Svelte | Viable; not selected |

## Decision

- **UI library:** React.
- **Language:** TypeScript (strict mode).
- **Build/dev tooling:** Vite, producing a **static single-page application** (client-side rendering;
  no SSR) served by the hospital's web server/gateway.

**Not decided by this ADR (still open — ask before choosing, `design/web-frontend/open-questions.md` OQ-01):**
component library (or none, built on the design tokens), router, server-state/data-fetching and global-state
libraries, window-manager approach (own vs library), CSS approach (plain CSS modules vs CSS-in-JS vs utility CSS),
i18n library, form/table libraries, unit/e2e test runners, lint/format config, package manager, Node/React/Vite
versions (pin the then-current stable/LTS releases in the lockfile at project init).

## Consequences (incl. PHI / compliance impact)

- **Secrets:** everything bundled by Vite is public. Only non-secret config may be exposed to the browser
  (`VITE_`-prefixed variables); no DB passwords, BPJS/E-Klaim keys, AI keys or e-sign credentials in the frontend.
  Provide `.env.example` with placeholders only.
- **PHI:** SPA talks to the BFF only; no PHI in URLs/routes, `localStorage`/`sessionStorage`/IndexedDB, analytics,
  error-reporting payloads or source maps. Window titles contain No. RM, so persisted layout must exclude them (OQ-07).
  Clear in-memory caches on logout and idle lock.
- **No external CDNs:** fonts, icons and scripts are self-hosted/bundled (offline-capable hospital network).
- **Authentication tokens:** storage strategy (httpOnly cookie via BFF preferred over JS-readable storage) is a
  security decision to record with the gateway ADR.
- **Supply chain:** the npm dependency tree is a risk surface — lockfile committed, pinned versions, dependency
  audit in CI, minimal dependencies for a clinical app; additions that handle PHI need justification.
- **Production hosting:** the Vite dev server is development-only; production serves the built static assets with
  security headers (CSP, no inline scripts where possible).
- **Testing:** component tests for the design system and e2e tests with synthetic data and mocked APIs remain required
  (`source/web-frontend/CLAUDE.md`); runners to be chosen.
- **Design handoff:** Figma variables map 1:1 to CSS custom properties (`--hms-*`), so tokens stay framework-agnostic.
- **Follow-ups:** scaffold `source/web-frontend/` only after the user asks (PRD is still a stub; Claude may scaffold
  spikes but asks before building features); record the remaining choices above as ADR-0003+ as they are made.
