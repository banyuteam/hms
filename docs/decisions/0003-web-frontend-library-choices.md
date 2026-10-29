# ADR-0003: Web-frontend library choices (React + TypeScript + Vite)

- Status: **accepted** 2026-10-28 — product owner approved the recommended bundle (D1 starts with an own thin window manager, gated by a 2-day spike vs dockview)
- Date: 2026-10-28
- Deciders: Product owner (user)
- Builds on: ADR-0002 (React + TypeScript + Vite SPA). Closes open question OQ-01 in `design/hms_web-frontend-UIUX/web-workspace/open-questions.md`.

## Context

ADR-0002 fixed React + TypeScript + Vite but left the supporting libraries open. The app is a desktop-like
workspace (floating windows, bottom dock, tiling, Ctrl+K palette, AI window), keyboard-first, read-only in Phase 1,
PHI-sensitive, Bahasa Indonesia primary at the time of writing (English added in Amendment 1; **English became the default in Amendment 3**), and built on the `--hms-*` CSS design tokens.

**Selection criteria** (in priority order): 1) accessibility & keyboard support (WCAG 2.1 AA target, OQ-11);
2) PHI safety (no storage/URL leakage, CSP-friendly, no external CDNs, small dependency surface);
3) fit with the window/dock model and our tokens; 4) maintenance health & licence (MIT/Apache/ISC only);
5) team familiarity and hiring; 6) bundle size on hospital PCs (OQ-15).

**Evidence caveat:** the web searches behind this ADR returned mostly blog posts and aggregator pages. Version numbers and
"maintenance health" claims below are **leads to verify on npm/GitHub at scaffold time**, not facts.
Observed (unverified): Vite 8.x and React 19.x were reported as current, with conflicting React minor versions (19.2 vs 19.3).

## Decisions needed now (block scaffolding)

For each: options → trade-offs → **recommendation**. Mark your choice in the "Decision" column (or write another).

### D1. Window manager (the most product-specific item)
Needs: floating windows (drag/resize/z-order/minimise/maximise), snap & tile layouts (1, 1+1, 1+2, 2×2), dock tab per window,
keyboard-operable, state persisted without PHI (OQ-07), AI window docking.

| Option | Pros | Cons |
|---|---|---|
| **A. Build our own thin manager** (pointer events + a small store; optionally a drag/resize primitive such as `react-rnd`/`re-resizable`) | Exactly matches our dock/tile model; full control of keyboard & ARIA; no heavy dependency | We own the complexity (focus management, snapping, edge cases) — est. a few weeks |
| B. `dockview` (docking layout with floating panels and popout windows) | Docking, floating groups, popouts, serialisable layout; reportedly actively maintained, zero dependencies | Its tab-group/dock model differs from our *bottom dock of independent windows*; a11y/keyboard needs verification; styling must be bent to tokens |
| C. `flexlayout-react` / `react-mosaic` (tiling) | Good tiling | Tiling-first; weaker for free-floating overlapping windows |
| D. `react-rnd` alone | Simplest draggable/resizable window | No snap/tile/dock logic; reportedly slower release cadence |

**Recommendation:** **A**, using a headless drag/resize primitive only if it saves time; run a **2-day spike** comparing A vs B against
{keyboard operation, tokens/styling, tile layouts, serialise-without-PHI, a11y semantics} before committing. Default if no spike: A.

### D2. Component foundation (accessible primitives)
| Option | Pros | Cons |
|---|---|---|
| **A. Headless primitives + our CSS on tokens** — React Aria Components, Base UI, or Radix UI | Best a11y/keyboard; no visual lock-in; tokens map directly; small | We style every component (we already designed them in Figma) |
| B. shadcn/ui (copies components built on Radix/Base UI, usually with Tailwind) | Fast start; code is ours | Pulls in Tailwind conventions; generic look; we'd re-skin everything |
| C. Full kit: MUI / Ant Design / Mantine | Many ready components (tables, dates, forms) | Heavy; visual language fights the Figma design; theming indirection from our tokens; bundle size |
| D. Fully custom (no primitives) | Zero deps | Re-implements menus/dialogs/comboboxes/date pickers — high a11y risk |

Within A: **React Aria Components** is reported to have the most thorough accessibility and i18n/date handling (more code per component);
**Base UI** is the newer MIT option reported as stable 1.0 in 2026; **Radix UI** has the largest ecosystem (some sources raise
ownership/maintenance concerns — verify). **Recommendation:** **A with React Aria Components** (accessibility first); fallback Base UI.

### D3. Styling
| Option | Pros | Cons |
|---|---|---|
| **A. CSS Modules + `tokens.css` custom properties** | Zero runtime, CSP-friendly (no inline style injection), maps 1:1 to Figma tokens, simple | Less ergonomic variants; discipline needed |
| B. Tailwind CSS (tokens mapped in theme) | Fast, consistent utilities | Class soup; must keep theme in sync with `tokens.json`; second source of truth |
| C. vanilla-extract / Panda (build-time CSS-in-JS) | Typed tokens, zero runtime | Extra build tooling |
| D. Runtime CSS-in-JS (styled-components, Emotion) | Familiar | Runtime cost; CSP/inline-style issues; maintenance concerns |

**Recommendation:** **A** (revisit C if typed variants become painful).

### D4. Server state / API client
| Option | Notes |
|---|---|
| **A. TanStack Query + typed client generated from `source/hms_shared/` OpenAPI (`openapi-typescript` + `openapi-fetch`)** | Caching, retries, abort, devtools; types come from the contract-first specs. **Must** set short `gcTime`, never persist the cache (no `persistQueryClient`), and `queryClient.clear()` on logout/idle lock (PHI) |
| B. SWR | Lighter, fewer features |
| C. RTK Query | Good if Redux is chosen anyway |
| D. Plain `fetch` + hooks | No dependency; re-invents caching/cancellation |

**Recommendation:** **A**.

### D5. Client (UI) state
| Option | Notes |
|---|---|
| **A. Zustand** (small store for window manager, dock, palette, preferences) | Tiny, store outside React tree helps window manager; avoid `persist` middleware for anything with PHI |
| B. Redux Toolkit | Heavier, strong devtools/conventions |
| C. React Context + `useReducer` only | No dependency; re-render pitfalls for window drag |

**Recommendation:** **A** (state keeps window *types/geometry* only; titles and patient ids are derived at render time).

### D6. Routing
| Option | Notes |
|---|---|
| **A. React Router (declarative/library mode) for top level only** (`/login`, `/workspace`, `/lock`) — windows are *not* routes | Keeps patient identifiers out of URLs by design |
| B. TanStack Router | Typed routes; more machinery than needed |
| C. No router, custom view state | Possible; but login/lock/deep error pages are easier with a router |

**Recommendation:** **A**; module windows are opened via the window store, never via URL params.

### D7. i18n (Bahasa Indonesia, strings in files)
| Option | Notes |
|---|---|
| **A. FormatJS / `react-intl`** (ICU messages, extraction CLI, built on `Intl`) | Standards-based plural/number/date for `id-ID` |
| B. `react-i18next` | Largest ecosystem, flexible |
| C. Lingui | Compile-time catalogs, small runtime |

**Recommendation:** **A** (any of the three is acceptable; pick by team familiarity).

### D8. Testing & quality
**Recommendation (bundle):** Vitest + React Testing Library (component tests), **MSW** (mock API, synthetic data only), **Playwright** (e2e), **axe**
(`@axe-core/playwright` + `vitest-axe`) for accessibility checks, ESLint (`typescript-eslint`, `react-hooks`, **`jsx-a11y`**) + Prettier,
TypeScript `strict` + `noUncheckedIndexedAccess`. Storybook (or Ladle) for the design system: optional — recommend yes once components exist.
Alternatives: Jest instead of Vitest (slower with Vite), Cypress instead of Playwright, Biome instead of ESLint+Prettier (faster, but no `jsx-a11y` parity — check).

### D9. Package manager & versions
| Option | Notes |
|---|---|
| **A. pnpm** | Strict dependency resolution, fast, lockfile; needs install on Windows dev PCs |
| B. npm | Zero extra tooling; fine |
| C. Yarn | Fine; no advantage here |

**Recommendation:** **pnpm** (npm is acceptable). Versions: pin the then-current **stable** React, Vite, TypeScript and **Node LTS** in the lockfile and `engines`
at scaffold time after checking npm/release notes; commit the lockfile; run a dependency audit in CI.

## Defer (decide when the feature is built — not blocking)

| Topic | Leading options | Notes |
|---|---|---|
| Data tables / grids | **Semantic `<table>` + TanStack Table** (sort/filter), **TanStack Virtual** only for long lists; keyboard grid pattern implemented in our component. Alternative: AG Grid Community (built-in virtualization/keyboard, ~150 KB, enterprise upsell) | Tables need roving-tabindex keyboard navigation either way |
| Forms & validation (Phase 2+, writes) | React Hook Form + Zod | Don't install while Phase 1 is read-only |
| Charts (lab trends) | Recharts or visx (ECharts if heavy) | Follow the `dataviz` guidance; accessible tables as fallback |
| Radiology viewer | Cornerstone3D/OHIF vs OpenSeadragon vs plain image | Depends on the image source (OQ-14) |
| Icons | `lucide-react` (ISC) — same set as the Figma icons; import per icon | Self-bundled |
| Fonts | `@fontsource/inter` (self-hosted, OFL) with Segoe UI first in the stack | OQ-05 |
| Date/time | `Intl` + `date-fns` or `Temporal` polyfill; display Asia/Jakarta, store UTC | |
| Auth/session | BFF-managed httpOnly cookie sessions | Gateway ADR, not this one |

## Recommended bundle (one-click approval)

React Aria Components (headless, our CSS) · CSS Modules + `tokens.css` · own window manager (after a 2-day spike vs dockview) ·
Zustand · TanStack Query + openapi-typescript/openapi-fetch · React Router (top-level only) · FormatJS · Vitest + RTL + MSW + Playwright + axe ·
ESLint (+ jsx-a11y) + Prettier · pnpm · lucide-react · Storybook later.

## Consequences if the recommended bundle is accepted
- Minimal dependency surface; no runtime CSS-in-JS; tokens stay the single styling source.
- More hand-built UI than with a full kit → slower first screens, but matches the Figma design exactly and keeps a11y control.
- Window manager and keyboard model become our own code → needs tests and an a11y review; spike first.
- PHI: TanStack Query cache cleared on logout/lock; no persisted stores with PHI; URLs carry no patient identifiers.

## Decision (product owner, 2026-10-28)

Approved: **the recommended bundle, unchanged.** Window manager: start from the own thin manager.

| Item | Decision | Date |
|---|---|---|
| D1 Window manager | Own thin manager (pointer events + store). **Gate:** 2-day spike vs `dockview` on keyboard operation, tokens/styling, tile layouts, PHI-free serialisation, a11y semantics; switch only if the spike clearly favours dockview (then amend this ADR) | 2026-10-28 |
| D2 Component foundation | React Aria Components (headless) styled with our CSS; fallback Base UI | 2026-10-28 |
| D3 Styling | CSS Modules + `tokens.css` custom properties | 2026-10-28 |
| D4 Server state / API client | TanStack Query + `openapi-typescript`/`openapi-fetch` from `source/hms_shared/`; short `gcTime`, no persistence, clear on logout/lock | 2026-10-28 |
| D5 Client state | Zustand (no PHI in persisted state) | 2026-10-28 |
| D6 Routing | React Router, top-level routes only; windows are not routes, no patient ids in URLs | 2026-10-28 |
| D7 i18n | FormatJS / `react-intl` (ICU). Locales: **`en` (default since Amendment 3) and `id`** — see Amendments 1 and 3 | 2026-10-28 |
| D8 Testing & quality | Vitest + React Testing Library + MSW + Playwright + axe; ESLint (+ `jsx-a11y`) + Prettier; TS `strict` + `noUncheckedIndexedAccess`; Storybook later | 2026-10-28 |
| D9 Package manager & versions | pnpm; pin current stable React/Vite/TypeScript + Node LTS at scaffold after checking npm/release notes; lockfile committed; dependency audit in CI | 2026-10-28 |

Deferred items (tables, forms, charts, radiology viewer, icons/fonts/date details, auth) keep the leanings above and are confirmed when built.

## Amendment 1 — English locale (product owner, 2026-10-28)

The product owner asked to add English as a second UI language. Bahasa Indonesia stays the **primary/default** language (root `CLAUDE.md`) — *superseded by Amendment 3: English is now the default*.

- **Locales:** `id` (Bahasa Indonesia) and `en` (English); *default and fallback were `id` here — now `en`, see Amendment 3*. Nothing else in v1; the setup must make adding a locale a data-only change.
- **Library:** unchanged — FormatJS/`react-intl` already covers ICU plural/select, `Intl` number/date/list formatting and per-locale message catalogs.
- **Message catalogs:** `src/i18n/messages/id.json` and `en.json` (*`en.json` is the source of truth since Amendment 3*); stable explicit message IDs (`window.patientDetail.title`), a description for each message
  for translators; extraction via the FormatJS CLI; **CI fails on missing/extra keys, unused keys and un-translated `en` strings**; a pseudo-locale (`en-XA`-style, long accented text) is used in dev/tests to catch truncation and hard-coded strings.
- **Lint:** `eslint-plugin-formatjs` (no literal strings in JSX, enforce ICU syntax and IDs) alongside `jsx-a11y`.
- **Selection & storage (decided by the product owner):** the language preference is stored **per browser** in a non-PHI `localStorage` key `hms.locale` (not in the user profile). First visit: browser `Accept-Language` if `en`, else `id` (*superseded: first visit is now always `en`, Amendment 3*). Switcher in the user menu of the top bar (and on the lock screen); set `<html lang>` on change.
- **Formats (decided: neutral English with Indonesian conventions):** dates `27 Okt 2026` (id) / `27 Oct 2026` (en), 24-hour time, zone Asia/Jakarta (UTC stored); decimals `37,8` (id) vs `37.8` (en);
  money is integer Rupiah shown `Rp1.170.000` (id) vs `Rp1,170,000` (en) — never floats, never another currency symbol. Locale tag `en` (no regional variant).
- **Scope (decided by the product owner): English covers the UI text only.** **What is NOT translated:** data coming from Khanza/the backend (patient names, addresses, free-text clinical notes, drug names as entered, diagnosis text as stored),
  identifiers, ICD codes. Code-system *display names* may be shown in English only where the source provides them (WHO ICD-10 is English) — decision with clinicians (OQ-34). AI answers, user prompts and reports/print-outs are outside the i18n scope (OQ-38).
- **Legal/clinical documents** (consent, resume medis, e-sign documents, claim documents) stay in Bahasa Indonesia regardless of UI locale unless the hospital says otherwise (OQ-34).
- **Consequences:** every UI string needs an `id` and an `en` entry (translation effort and review by a hospital-approved translator for clinical terms); layouts must tolerate
  text-length differences (English is usually shorter, German-style expansion is not expected, but test with the pseudo-locale); ~~Figma has EN variants of Home, Patient Detail and Patient Detail + AI Assistant (Mockups page)~~ — *update 2026-10-28:* the EN variants were removed and the whole Figma file is English by default (OQ-49); Indonesian text length is checked with the pseudo-locale and in the running app.

## Amendment 2 — scaffold findings (2026-10-28)

Recorded while creating the first Vite project (`source/hms_web-frontend-UIUX/web-workspace/`); versions are what `npm` resolved that day and are pinned exactly in `package.json` / `pnpm-lock.yaml`:
React 19.3.1, Vite 8.3.5, react-router 8.5.0, react-aria-components 1.22.1, zustand 5.0.16, react-intl 12.1.5, Vitest 5.0.5, Playwright 1.64, ESLint 10.13, pnpm 12.15 (via corepack), Node 24 LTS.

- **TypeScript is pinned to 6.0.3, not 7.0.x.** `typescript-eslint` 8.72 refuses to run on TypeScript 7 ("does not support TS 7.0"); until it supports ≥ 7.1 we stay on 6.x so ESLint (incl. `jsx-a11y`) keeps working. Re-evaluate when typescript-eslint supports TS 7.
- **Playwright's bundled Chromium is unavailable on macOS 12**; e2e runs with the installed Google Chrome (`channel: 'chrome'`); CI should install Chromium.
- `eslint-plugin-formatjs` (no literal strings in JSX) is **not installed yet** (ESLint 10 compatibility unchecked); catalog parity is enforced by a unit test instead.
- Demo authentication is a stand-in only (static account behind `VITE_DEMO_AUTH`), see `source/hms_web-frontend-UIUX/web-workspace/README.md`.

## Amendment 3 — English is the default UI language (product owner, 2026-10-28)

The product owner decided that **English is the default UI language of the app** (and, separately, of the Figma file — OQ-49). Bahasa Indonesia stays a fully supported second locale.

- **Default and fallback:** `DEFAULT_LOCALE = 'en'`; `IntlProvider defaultLocale="en"`; `<html lang="en">`.
- **First visit:** the saved `hms.locale` choice if present, otherwise `en`. The browser `Accept-Language` is **no longer used** (an Indonesian-language browser now also starts in English). Detection can be re-added later if the hospital wants it.
- **Catalogs:** `en.json` is the source of truth; `id.json` is the Indonesian translation. The parity test still requires identical keys and placeholders.
- **Unchanged:** per-browser storage and its PHI-free key, the switcher (login screen and user menu), formats per locale, "English/Indonesian covers UI text only" (Amendment 1), and legal/clinical documents staying in Bahasa Indonesia.
- **Consequences:** Indonesian copy and text-length need review in the running app or with the pseudo-locale (Figma is English); tests and the Playwright locale (`en-US`) were switched to English-by-default, with Indonesian covered by "switch language" tests; the root `CLAUDE.md` UI-language line was updated by the product owner's decision.

## Amendment 4 — Phase 2 scaffold findings (2026-10-29)

Recorded while scaffolding Phase 2 (PRD §8.1). No decision above changed.

- **TanStack Query 5.105.0 added** (already approved in D4). `queryClient`: `gcTime` 5 min, `retry: false`, no persistence; `endSession()` clears it together with the in-memory audit stub. MSW and `openapi-fetch` are *not* added yet — there is no BFF/OpenAPI contract (OQ-57); `src/api/patientApi.ts` is the only door to patient data and is replaced when the contract exists.
- **Own window manager (D1) confirmed in use:** states `floating · tiled · maximized · minimized`, up to 4 tiles, compact shell, stacking tiers inside the token band (z-index 10–199 via re-numbered ranks), as specified in `design/hms_web-frontend-UIUX/web-workspace/window-states.md`. `dockview` stays out.
- **Layout bug found in Phase 1 code:** the workspace grid column grew with the dock's content (many open windows made the whole shell wider than the viewport). Fixed with `grid-template-columns: minmax(0, 1fr)` and a scrolling tab strip.
- **Accessibility:** Lighthouse (Chrome DevTools) accessibility 100 after fixing *label in name* on the user button (WCAG 2.5.3).
- `eslint-plugin-formatjs` is still not installed; key parity is enforced by `messages.test.ts` (now ~310 keys).

## Spike result — window manager (2026-10-28)

The D1 gate spike against `dockview-react` 8.7.1 was run (time-boxed to hours, see the report). Result: it does **not** clearly favour dockview
(floating windows are not keyboard-movable/resizable, no minimise for our dock model, +394 kB JS, titles serialised verbatim), so **D1 stays: own thin
manager**. No change to the decision above. Report: `design/hms_web-frontend-UIUX/web-workspace/research/window-manager-spike.md`; code: `source/hms_web-frontend-UIUX/web-workspace/spikes/dockview/`.

## Sources (unverified secondary results — check primary docs)
- Headless libraries overview: <https://www.greatfrontend.com/blog/top-headless-ui-libraries-for-react-in-2026> · <https://designrevision.com/alternatives/radix-ui> · <https://www.pkgpulse.com/guides/react-aria-vs-radix-primitives-2026>
- Window/dock libraries: <https://dockview.dev/> · <https://www.npmjs.com/package/flexlayout-react> · <https://github.com/bokuweb/react-rnd> · <https://github.com/nomcopter/react-mosaic>
- Tables: <https://tanstack.com/table/latest/docs/guide/virtualization> · <https://www.pkgpulse.com/guides/tanstack-table-vs-ag-grid-vs-react-data-grid-2026>
- Versions seen: <https://releasealert.dev/github/vitejs/vite> · <https://tech-insider.org/fr/react-tutoriel-19-2-app-production-13-etapes-2026/>
