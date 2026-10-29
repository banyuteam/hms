# PRD — web-workspace

- **Status:** Draft  _(Stub → Draft → Approved)_ — awaiting product-owner review
- **Based on draft:** `docs/prd/001-Frontend-Workspace-HMS.md` (received 2026-10-28)
- **Last updated:** 2026-10-28 (draft written from the draft + recorded decisions + the first-skeleton checkpoint)
- **Owner:** Product owner (user)

> **How to read this draft.** The product owner's draft contains five goals and nothing else. This PRD therefore
> contains only (a) those goals, (b) decisions already recorded in ADR-0002/0003 and `open-questions.md`, and (c) what the
> first skeleton in `source/hms_web-frontend-UIUX/web-workspace/` actually does (§4.1, marked *Built*). Everything not covered by one of those
> sources is listed as an open question, **not** invented as a requirement. Until the status is **Approved**, Claude
> may scaffold and run spikes but asks before building features (root `CLAUDE.md`).
>
> Source labels: **[Draft]** product-owner draft · **[Decision]** ADR / recorded decision · **[Built]** present in the
> skeleton · **[Derived]** follows from root/project `CLAUDE.md` rules · **[Proposal]** my suggestion, needs your OK.

## 1. Problem & goals

**Problem.** Khanza is a Java Swing desktop app. Staff work in several windows at once (patient list, patient detail, lab,
billing). The platform being built beside Khanza (strangler-fig) needs a browser front end that keeps that way of working.
*[Derived from the root `CLAUDE.md` and the mockups; the draft does not state a problem.]*

**Goals** *(verbatim intent of the draft, numbering kept)*:

| # | Goal [Draft] | What it means in this project (my reading — please confirm) |
|---|---|---|
| G1 | Solid workflow: plan → design → design review → code → code review → repeat | Matches the delivery loop in the root `CLAUDE.md`; a screen is coded only after its Figma frame is reviewed |
| G2 | Design-token consistency and reusable components | Single token source (`design-tokens` skill → `src/styles/tokens.css`); screens are composed from a small component set |
| G3 | All design documentation in Figma: tokens, components, wireframes, mockups | Figma file `yo53y0sVdqxaKNjZquWNom` is the visual source of truth |
| G4 | UX research across other healthcare management systems worldwide | `hospital-ux-expert` skill and `research-notes.md`; findings labelled by evidence level |
| G5 | End-to-end keep-up of design and frontend code | Figma ↔ tokens ↔ code stay in sync; token changes start in Figma |

**Product scope statement** *[Derived: `design/hms_web-frontend-UIUX/web-workspace/CLAUDE.md`]*: a desktop-like workspace in the browser — top bar with
global search, a work area of movable/resizable windows, a bottom dock of open windows — replicating the Khanza desktop
experience. It talks only to the API gateway/BFF and never to a database.

## 2. Users & roles

Not defined by the draft. The reference mockup shows a *Finance & Accounting Manager* viewing clinical data.
Roles, devices and visibility rules are **open**: OQ-02, OQ-16, OQ-18.
Rule already fixed *[Derived]*: hide actions the user's role cannot perform, but authorisation is always enforced by the backend.

## 3. Scope (in / out)

**In — Phase 1 (read-side)** *[Decision/Derived]*
- Workspace shell: login, top bar, window manager, dock, home.
- Read-only modules as windows. Candidate list from `design/hms_web-frontend-UIUX/web-workspace/CLAUDE.md`: Patient Management, Patient Detail
  (tabs: Overview, Medical Record, Encounters, Orders, Results, Medications, Procedures, Billing, Documents, Care Plan, Referrals),
  Laboratory Results, Radiology Viewer, Billing & Insurance, AI Assistant. **Which ship first and in what order is open (OQ-16).**
- English (default) and Bahasa Indonesia UI text.

**Out (for now)**
- Write actions: *Ubah*, *+ Tambah obat*, *Masukkan ke RM*, *Buat order* stay disabled with an explanatory tooltip; *Cetak* stays enabled (OQ-03, decided). Re-enabled per domain only when that domain's PRD/ADR makes it writable.
- Real authentication (OQ-43, needs an ADR with the gateway/BFF).
- Real AI integration (OQ-23, needs an ADR before any PHI leaves the premises).
- Radiology/DICOM viewer content (OQ-14), multi-monitor pop-out (OQ-20), claim-assistant screens (their own PRD).
- Server-side rendering, native apps.

## 4. Functional requirements

### 4.1 Checkpoint — what the first skeleton already does *(Built; acceptance reviewed in §7)*

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FR-01 | Sign in / sign out with a **static demo account** (`demo.dokter` / `Demo#2026`); credentials exist only when `VITE_DEMO_AUTH=true`; session in memory only | Built | Not authentication (OQ-43). A default production build must not contain the credentials |
| FR-02 | End the session and wipe the window layout on logout and after `VITE_IDLE_MINUTES` of inactivity (default 15) | Built | Stand-in for the lock screen (OQ-12, OQ-44) |
| FR-03 | Route guard: workspace is reachable only when signed in | Built | Top-level routes only; windows are not routes |
| FR-04 | Floating windows: open, focus (z-order), drag, resize from 8 handles, minimise, maximise/restore (double-click titlebar), close; ≥24 px edge margin rule; minimum size 360×240 | Built | One window per module for now |
| FR-05 | Keyboard operation of windows: titlebar focusable; arrows move, Shift+arrows resize (16 px step); focus moves into the window when it becomes active | Built | Further shortcuts (search, switch, close) not built — see FR-12 |
| FR-06 | Bottom dock with one tab per open window; click activates/un-minimises; "Beranda" minimises all and keeps dock tabs | Built | |
| FR-07 | Home screen (Beranda) and module launcher menu; user menu | Built | |
| FR-08 | Manajemen Pasien window with a patient list on **synthetic** data | Built | Lab, Radiology, Billing open as placeholder windows |
| FR-09 | Two UI locales: `en` (default since 2026-10-28) and `id`; switcher on login and user menu; choice saved per browser as `hms.locale` (non-PHI) and kept across logout; first visit is always English | Built | UI text only (OQ-34…39). A test enforces key and placeholder parity between catalogs |
| FR-10 | Formats: date `27 Oct 2026`, 24 h time, zone Asia/Jakarta, decimal point, thousands comma, integer Rupiah (`Rp1,170,000`) | Built (helpers in `src/i18n/format.ts`) | OQ-35 |
| FR-11 | Design system seed: tokens, Button, StatusPill, Logo, Icon, window chrome, dock tab, language switch | Built | Table, tab bar, card, field grid still to build (G2) |

### 4.2 Decided but not built yet

| ID | Requirement | Source |
|---|---|---|
| FR-12 | Keyboard-first: Ctrl+K palette first (incl. layout commands), then direct shortcuts for switch window, close window (key set after OQ-19); visible focus; keyboard-navigable tables | [Derived: `source/hms_web-frontend-UIUX/web-workspace/CLAUDE.md`]; shortcut set depends on delivery shape (OQ-19) |
| FR-13 | **Ruang Fokus**: dedicated focus/rest area with a calm hospital wallpaper; windows hidden, not closed; no patient data on screen | [Decision] OQ-21; behaviour OQ-40 |
| FR-14 | Auto-lock after idle with re-authentication; lock hides all windows | [Derived] + OQ-12/OQ-44 (timeouts are **[Hospital]**) |
| FR-15 | Mask NIK, No. BPJS, phone, address, e-mail by default; reveal rules | [Derived] rule 2; reveal policy is **[Hospital]** (OQ-08) |
| FR-16 | **Tile layout, up to 4 tiles** (presets 1, 1+1, 1+2, 2×2) chosen from a picker; edge margin 24 px, gap 16 px, minimum tile 360×240. Tile sizes follow the shell window while it is maximised; while tiles are active, floating (smaller, non-fullscreen) windows stay on top of the tiles; when the shell window is minimised, tiling is disabled and only the most recently used window is shown | [Decision 2026-10-28] OQ-46 (state names and rules: [`window-states.md`](window-states.md); OQ-47 resolved); picker first, snap later; placeholder for empty slots; free split ratio with soft snap at 50%; layout (types + ratios) remembered per user: OQ-48 |
| FR-17 | AI assistant window (chrome, patient-context strip, "Draf AI" label, sources); AI answer language follows the question | [Decision] OQ-38; integration blocked by OQ-23 |
| FR-18 | **Patient Detail window — three navigation zones, no duplicates:** header (identity + safety bar, always visible) · 11 clinical tabs (Overview, Medical Record, Encounters, Orders, Results, Medications, Procedures, Billing, Documents, Care Plan, Referrals) · sidebar for the patient profile and access only (Personal Information, Contact, Guarantor & Insurance, Family & Emergency, Audit Log). One place is active at a time. Removed sidebar items (Visit History, Appointments, Diagnoses, Problems & History, Allergies, Vital Signs, Medications, Care Plan, Documents) live in the tabs or the header. Tabs that do not fit move under a "More ▾" tab (never more than 8 shown; OQ-52). Four profile pages are designed (Figma W10–W14, mockups 10–13) and the Medical Record tab (W15, mockup 14; fields in [`patient-medical-record-fields.md`](patient-medical-record-fields.md), scope decided in OQ-53: discharge summary lives in Documents; allergy source `alergi_pasien`, OQ-54; open to all roles until RBAC, OQ-55); field mapping verified against the Khanza schema in [`patient-profile-fields.md`](patient-profile-fields.md) | [Decided 2026-10-29] OQ-50, OQ-52; OQ-51 answered |
| FR-19 | Command palette (Ctrl+K) | Field exists, disabled |
| FR-20 | Notifications | Not specified (OQ-10 governs alerts) |
| FR-21 | Role-based visibility of modules/actions | [Derived]; matrix is **[Hospital]** (OQ-18) |

### 4.3 Technical requirements *(from ADR-0002 / ADR-0003)*

- React + TypeScript (strict) + Vite, static SPA; pnpm; versions pinned; lockfile committed.
- React Aria Components + CSS Modules on `--hms-*` tokens; Zustand; TanStack Query + `openapi-typescript`/`openapi-fetch`
  from `source/hms_shared/`; React Router (top-level only); FormatJS.
- Libraries outside the approved bundle require asking first. **Window manager:** own thin manager; the gate spike vs `dockview` was run and kept it (ADR-0003 D1, [report](research/window-manager-spike.md)).

## 5. Non-functional requirements

Security and privacy *[Derived from root `CLAUDE.md` rule 2]*
- No PHI in URLs, local/session storage, IndexedDB, analytics, error reports, source maps or persisted query cache; clear caches on logout and idle lock.
- Only non-secret `VITE_*` configuration in the bundle; `.env.example` holds placeholders. Never log full payloads.
- No third-party CDNs; fonts and icons are bundled.
- Window layout persistence (OQ-07, OQ-45): not persisted today; any future persistence stores geometry and window *types* only.
- Audit events for medical-record reads are emitted by the backend services; the front end passes a correlation id *(to be specified with the gateway contract)*.

Accessibility and UX
- Target WCAG 2.1 AA (assumed — OQ-11); `eslint-plugin-jsx-a11y` and axe in tests; visible focus; colour contrast per tokens.
- English is the default UI language, Bahasa Indonesia the second locale; copy only through message catalogs.

Performance and environment
- Minimum viewport 1280×720 assumed (OQ-15); real hospital screen sizes unknown. A shell too small for the chosen tile preset falls back to single-window mode (OQ-46). No bundle-size budget set yet *(proposal: set one after the first two real modules)*.

Quality
- Component tests for the design system, Vitest unit tests for stores/auth/i18n, Playwright end-to-end tests for core flows with synthetic data and mocked APIs; typecheck, lint, format check, test and e2e must pass before work is called done.

## 6. Data & integrations

- Only the API gateway/BFF in `source/hms_services/domain-services/`; contracts come from `source/hms_shared/` OpenAPI (contracts first, versioned `/v1`).
- Today: **synthetic data only** (`src/data/syntheticPatients.ts`); no network calls.
- AI processor, radiology image source and identity provider are undecided (OQ-23, OQ-14, OQ-43).
- Time stored UTC, displayed Asia/Jakarta; money integer Rupiah.

## 7. Acceptance criteria

*Checkpoint (verifiable today; each item maps to a test, or is marked "manual" until one exists):*

| # | Criterion | Check |
|---|---|---|
| AC-01 | With `VITE_DEMO_AUTH` unset/false, the demo account cannot sign in | `src/auth/auth.test.ts` |
| AC-02 | `pnpm build` output does not contain the demo password | manual: `grep -l "Demo#2026" dist/assets/*.js` returns nothing |
| AC-03 | Logout and idle timeout clear session and window layout | auth + workspace tests |
| AC-04 | Open, focus, minimise, maximise, close and drag/resize keep windows inside the work area and above the minimum size | `windowStore.test.ts`, `Workspace.test.tsx`, e2e |
| AC-05 | A window can be moved and resized by keyboard | e2e / manual |
| AC-06 | `id.json` and `en.json` have identical keys and placeholders | `messages.test.ts` |
| AC-07 | No PHI or secret in storage, URLs or source maps; only `hms.locale` is stored | manual review + `sourcemap: false` |
| AC-08 | `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e` pass | **passed 2026-10-28** (typecheck, lint, format check, 41 unit tests, e2e) after the English-default change |

*Product acceptance (Approved-PRD level)* — to be agreed: task list and success metrics are open (OQ-17).

## 8. Milestones *(proposal — dates are yours to set)*

| # | Milestone | State |
|---|---|---|
| M0 | Decisions (ADR-0002/0003), design v0.1 in Figma, first skeleton | Done |
| M1 | This PRD reviewed and set to Approved | Next (your review) |
| M2 | Window-manager spike (own manager vs `dockview`) → amend ADR-0003 D1 if the result clearly favours dockview | Done 2026-10-28 — does not favour dockview; own manager stays ([report](research/window-manager-spike.md)) |
| M3 | Open questions that block features are answered (see §9 blockers) | In progress — OQ-46…OQ-55 answered; OQ-53/54 remainders moved to Phase 3; blockers listed in §9 |
| M4 | First real module end-to-end (design review → code → code review) | Phase 2 scaffold built (M5); code review pending |
| M5 | **Phase 2 scaffold**: window manager v2 + Patient Detail (Overview, Medical Record, profile pages) on synthetic data | **Done 2026-10-29** — see checkpoint §8.2 |
| M6 | Phase 2 review: your review of the build vs Figma, code review, PRD set to Approved, first commit | Next |
| M7 | Phase 3: Documents tab (discharge summary) and the remaining clinical tabs; OQ-53 / OQ-54 remainders | Planned |

### 8.1 Delivery phases of the web-workspace *(proposal 2026-10-29 — please confirm; "Phase 1/2/3" here are front-end increments, all still read-only)*

| Phase | Scope | State |
|---|---|---|
| **Phase 1** | Shell, demo login, window manager v1 (floating windows, dock), Patient Management window, i18n (`en`, `id`), design tokens | Done (first skeleton) |
| **Phase 2** (scaffold done 2026-10-29; PRD still Draft) | **Window manager v2** per [`window-states.md`](window-states.md): multi-instance windows, window states (floating · tiled · maximized · minimized), tile layouts up to 4 from a dock picker, shell *compact* mode, empty-slot placeholder, drag-out of a tile. **Patient Detail window** per FR-18: header + safety bar, 11 tabs with **More ▾**, profile sidebar (Personal Information, Contact, Guarantor & Insurance, Family & Emergency, Audit Log), **Overview** and **Medical Record** tabs, field masking with audited reveal. Synthetic data behind an API interface (TanStack Query), no backend | **Scaffold built** — checks passed (typecheck, lint, 77 unit tests, 3 e2e, Lighthouse a11y 100); see `source/hms_web-frontend-UIUX/web-workspace/README.md` |
| **Phase 3** | **Documents tab** (with the discharge summary, OQ-53) as the next clinical tab; the remaining clinical tabs (Encounters incl. visit history & appointments, Orders, Results, Medications, Procedures, Billing, Care Plan, Referrals); specialty assessment forms (**OQ-53**, still open); allergy vocabulary labels from real values (**OQ-54**, still open) | Planned |
| Later | Split-handle ratios with soft snap, snap-by-drag, layout persistence per user, direct keyboard shortcuts and the Ctrl+K palette (OQ-19), Ruang Fokus, lock screen, RBAC (OQ-18, OQ-55), real BFF/auth | Not scheduled |

### 8.2 Checkpoint — 2026-10-29 (work paused here)

**Delivered since the first skeleton (2026-10-28)**

| Area | Result |
|---|---|
| Plan & PRD | PRD draft written from the five goals + decisions; phases defined (§8.1); FR-16 (tiles, up to 4) and FR-18 (Patient Detail: header · 11 tabs with **More ▾** · profile sidebar, one active place) specified |
| Design (Figma) | English-by-default file, EN frames removed; Wireframes and Mockups regrouped in horizontal feature rows; new W10 (navigation model), W11–W14 + mockups 10–13 (profile pages), W15 + mockup 14 (Medical Record tab); wallpaper replaced; More ▾ and BPJS class applied |
| Specs | `window-states.md` (states, tiers, transitions T1–T15), `patient-profile-fields.md` and `patient-medical-record-fields.md` (every field checked against the Khanza schema `rsb221022021.sql`), `research/window-manager-spike.md` |
| Decisions recorded | English app default (ADR-0003 Amendment 3); window-manager spike → own manager stays; tile layout (≤4, floating stays on top, compact shell, picker first, free ratio + soft 50% snap, placeholder for empty slots, remember types + ratios per user); sidebar cut from 14 to 5 items (Audit Log stays); English enum labels; BPJS class in Phase 1; discharge summary in Documents; `alergi_pasien` is the allergy source; Medical Record open to all roles until RBAC |
| Code (`source/hms_web-frontend-UIUX/web-workspace/`) | **Window manager v2** (`windowStore`, `geometry`, `frames`, layout picker, empty slots, compact shell, margin-aware re-fit); **Patient Detail window** (header + safety bar, tabs with More ▾ and roving focus, sidebar, Overview, Medical Record, four profile pages, Audit Log, Phase-3 placeholders); Card / Field Row / masked value with audited 30 s reveal; synthetic patient API + TanStack Query (cleared on logout); ~130 new strings in `en` and `id` |
| Verification | typecheck, lint, format clean · **78 unit tests** · **3 e2e** (real Chrome) · production build clean (no demo password, no source maps, no external requests) · Chrome DevTools: Figma 04/05/10–14 matched, keyboard, Indonesian, compact shell, **Lighthouse accessibility 100** |
| Bugs found and fixed on the way | shell grew wider than the viewport with many dock tabs; user button name vs visible text (WCAG 2.5.3); missing favicon; windows touching the screen edge after a resize |

**State of the repository:** everything above is **uncommitted** (≈78 changed or new paths). Suggested commits, one per project: `web-workspace` code · `design/hms_web-frontend-UIUX/web-workspace` docs · shared docs and ADR-0003 (`docs/decisions`, `docs/glossary.md`).

**Open items when work resumes**

1. **Your review** of the Phase 2 build against Figma, and of §8.1 (are the phase definitions right?) → then M6 (PRD Approved).
2. **Real screen sizes (OQ-15 / OQ-56):** your machine is 1280×800 (viewport ≈ 1280×630, below the 1280×720 design minimum); full-screen / installed-app mode (OQ-19) would win back ~140 px.
3. **Data contract (OQ-57):** OpenAPI for the patient-detail read model must be written in `source/hms_shared/` (with `backend-services`) before any real data.
4. **Still open for Phase 3:** specialty assessment forms (OQ-53), allergy vocabulary values (OQ-54), print behaviour (OQ-58); then the Documents tab and the other clinical tabs.
5. **Not built (by decision):** split-handle ratios and snap-by-drag, layout persistence, Ctrl+K palette and direct shortcuts, Ruang Fokus, lock screen, RBAC, real auth.

## 9. Open questions

Full list with recommended defaults: [`open-questions.md`](open-questions.md) (OQ-01 … OQ-58).
Questions that block features, grouped:

- **Scope & roles:** OQ-02, OQ-16, OQ-18 (who uses it, which modules first, who sees what).
- **Hospital policy:** OQ-08 (masking/reveal), OQ-12 (lock timeouts), OQ-10 (alerts).
- **Integrations / ADRs needed:** OQ-43 (identity + BFF session), OQ-23 (AI processor), OQ-14 (radiology source).
- **Environment:** OQ-15 (screen sizes), OQ-19 (browser tab vs installed app — decides the shortcut set).
- **Product owner, for this draft:** (a) Are G1–G5 correctly read in §1? (b) Is §4.2 the intended backlog? (c) Should a problem statement and success metrics be added, since the draft has none?
- **Deferred by product owner (2026-10-28), to discuss now that the window-manager spike is done:** (1) the deferred library choices — data tables, forms and validation, charts, radiology viewer, date handling (ADR-0003 "Defer"); (2) the full check run for this checkpoint (AC-08); (3) the uncommitted `.claude/settings.json` change.

## Change log

- 2026-10-29 — **Medical Record summary drawn in Figma**: wireframe W15, mockup 14 (current encounter, a discharged stay so every section has data) and mockup 16 (all encounters; per-encounter tables for procedures, treatment, discharge plan and signature) redrawn with the seven sections; allergy shown as a pinned note in Clinical notes; scrolled state 16b removed. Section icons added to the `design-tokens` skill (`icon.default.summary-section`). Fixed the scaling of the 9 new icon components (inner frame constraints = SCALE).

- 2026-10-29 — **Decisions on the Medical Record summary** (product owner): seven-section structure confirmed, discharge summary stays in Documents (OQ-64); record signed by the **doctor in charge** only, from `dpjp_ranap` + `verifikasi_dpjp` (OQ-65, still open: verification date and e-signature provider); final diagnosis = `diagnosa_pasien`, lab `keterangan` = free-text result detail (OQ-66). Field doc §2a.1, §2a.2, §2a.7 updated.

- 2026-10-29 — **Medical Record tab restructured into a high-level summary** (product owner): seven sections — Final diagnoses (kept) · Medical history + supporting clinical data (lab, radiology, medication therapy) · Clinical notes (SOAP first, **allergies merged in**, no separate Allergies card) · Procedures & interventions (doctor or nurse) · Treatment and outcomes · Discharge plan / follow-up · Digital signature and date. Fields mapped to the Khanza schema in `patient-medical-record-fields.md` §1 and §2a. New questions OQ-64 (supersedes the four-card decision of OQ-53; Figma W15 and mockups 14, 16, 16b to be redrawn), OQ-65 (signature sources and e-sign provider), OQ-66 (content rules). Also corrected a table name in `encounters-tab-fields.md` (`rujuk`, not `rujuk_keluar`).

- 2026-10-29 — **Medical Record tab, scope "All encounters" designed** (Figma mockup 16 + scrolled state 16b, row "Clinical tabs"; see `patient-medical-record-fields.md` §1a): diagnoses table across encounters, medical history = latest assessment + link, clinical notes grouped by encounter, allergies marked patient-level. New question OQ-63 (earlier assessments, long histories).

- 2026-10-29 — **Default icon per feature** added to the `design-tokens` skill (`tokens.json` → `icon`, SKILL.md → *Icons*): 67 features (windows, clinical tabs, profile sidebar, encounter timeline events, actions, status) mapped to one Lucide icon each. Nine icons added to Figma Components and `Icon.tsx` (layout-dashboard, stethoscope, list-checks, clipboard-check, syringe, route, forward, scissors, phone); mockups updated (Contact → phone, Guarantor & Insurance → shield, doctor visit → stethoscope). Still to sync: 8 icons Figma-only and 4 code-only (listed in SKILL.md).

- 2026-10-29 — **Encounters tab designed** (Figma mockup 15, row "Clinical tabs"; fields and sources in [`encounters-tab-fields.md`](encounters-tab-fields.md)): list of encounters ordered by date (newest first, type filter) beside a detail pane with a registration → discharge timeline of services, each showing unit and doctor. Fields verified against the Khanza schema (`reg_periksa`, `kamar_inap`, `rawat_jl_dr`, `rawat_inap_dr`, `periksa_lab`, `periksa_radiologi`, `resep_obat`, `operasi`). New questions OQ-59…62. Wireframe W16 and the empty/loading/error/open-encounter states are still to draw.

- 2026-10-29 — **Checkpoint recorded (§8.2) and work paused**: milestones M5 (Phase 2 scaffold, done), M6 (Phase 2 review and PRD approval, next) and M7 (Phase 3) added; M3/M4 states updated; margin-aware window re-fit added after the product owner's 1280×800 screen was measured (OQ-56).
- 2026-10-29 — **Phase 2 scaffold built** in `source/hms_web-frontend-UIUX/web-workspace/` (window manager v2 per `window-states.md`; Patient Detail window with Overview, Medical Record, four profile pages, More ▾ tabs, masked fields with audited reveal; layout picker with up to 4 tiles, empty-slot placeholder, compact shell; synthetic patient API with TanStack Query). Verified in Chrome DevTools against Figma 04/05/10–14. Findings: see OQ-56, OQ-57.
- 2026-10-29 — Delivery phases defined (§8.1): **Phase 2** = window manager v2 + Patient Detail window (Overview, Medical Record, profile pages); **Phase 3** = Documents tab and the other clinical tabs, plus the still-open OQ-53 (specialty forms) and OQ-54 (allergy vocabulary). Phase 2 scaffold started in `source/hms_web-frontend-UIUX/web-workspace/`.
- 2026-10-29 — Decided: discharge summary goes in the Documents tab (OQ-53); `alergi_pasien` is the allergy source of truth (OQ-54); the Medical Record tab is open to all users and roles until RBAC is designed, audit event on open kept (OQ-55).
- 2026-10-29 — Medical Record tab designed (Figma W15, mockup 14; row "Clinical tabs"): Diagnoses, Medical history, Clinical notes, Allergies; fields verified against the Khanza schema (`patient-medical-record-fields.md`). New questions OQ-53 (scope, discharge summary), OQ-54 (allergy source), OQ-55 (access and audit).
- 2026-10-29 — Decided: enum values are displayed with English labels (mapping table in `patient-profile-fields.md` §3) and the BPJS class (`bridging_sep.klsrawat`) is in Phase 1; mockups updated ("BPJS class", "Bachelor's (S1)", relationship "Husband"). OQ-51 closed apart from the Indonesian label translations.
- 2026-10-29 — Patient Detail navigation approved (OQ-50: Audit Log stays in the sidebar); "More ▾" overflow tab added to all Patient Detail tab bars (OQ-52); profile fields checked against `rsb221022021.sql` and corrected (blood type without Rh; removed postal code, home phone, participant status, emergency phone, patient share; Family & Emergency = responsible person; guarantor/SEP from `penjab`/`bridging_sep`) — see `patient-profile-fields.md` (OQ-51). Figma wireframes W3, W11–W14 and mockups 04–06, 10–13 updated.
- 2026-10-28 — Patient Detail navigation de-duplicated (FR-18, OQ-50): sidebar reduced from 14 to 5 items (profile pages + Audit Log), the removed items live in the tabs/header; mockups 04–06 updated; new wireframes W10 (navigation model) and W11–W14 and mockups 10–13 for the profile pages (Personal Information, Contact, Guarantor & Insurance, Family & Emergency); Figma pages gained a "Patient profile" row.
- 2026-10-28 — **App default UI language changed to English** (ADR-0003 Amendment 3, OQ-49): `DEFAULT_LOCALE = 'en'`, `<html lang="en">`, no browser-language detection; `en.json` is the source catalog; tests and e2e updated (Indonesian covered by switch-language tests). Root `CLAUDE.md` UI-language line updated. Typecheck, lint, format, 41 unit tests and the e2e flow pass — this also closes the deferred AC-08 run.
- 2026-10-28 — Figma file made English by default (screen titles, labels, annotations, layer names, sample text); the `EN ·` mockup frames were removed; data (patient names, diagnoses, notes, AI answer text) kept as stored. The app's default UI language was changed to English in the same decision round — see the next entry. Wireframe clear-space note updated to 4 tiled windows (OQ-46).
- 2026-10-28 — Tile layout fully decided (OQ-48): picker first / snap later, placeholder for empty slots, free split ratio with soft snap at 50%, Ctrl+K palette first then direct shortcuts, layout remembered per user (types + ratios only); extra windows open floating; previous layout restored when the shell grows. `window-states.md` updated; Indonesian state labels proposed in the glossary.
- 2026-10-28 — Clarified by the product owner: "minimized windows" that stay on top are *floating* (smaller, non-fullscreen) windows; shell size test accepted. Added `window-states.md` (shell / layout / window states, stacking tiers, transitions T1–T15, size rules). OQ-47 resolved.
- 2026-10-28 — Tile-layout decisions recorded (FR-16, OQ-46): up to 4 tiles, floating windows stay on top of the tiles, tiles follow the maximised shell size, shell minimised → tiling off and only the most recently used window shown, margin 24 / gap 16. Interpretation questions in OQ-47; remaining tile choices in OQ-48. The temporary Figma page is kept until these are settled.
- 2026-10-28 — Window-manager spike run (own manager vs `dockview`): own manager stays; M2 closed; `research/window-manager-spike.md` added.
- 2026-10-28 — **Draft written** from `docs/prd/001-Frontend-Workspace-HMS.md` (5 goals), ADR-0002/0003, `open-questions.md` and the first-skeleton checkpoint. Added §4.1 *Built* requirements with acceptance criteria, §4.2 decided-but-not-built list, milestones M0–M4. No requirement added beyond those sources.
- 2026-10-28 — Workspace restructured: this PRD, the skills and the open questions moved to `design/hms_web-frontend-UIUX/web-workspace/` (code stays in `source/hms_web-frontend-UIUX/web-workspace/`).
- 2026-10-28 — First Vite skeleton created (login/logout with a static demo account, window manager, dock, Manajemen Pasien window); scaffold findings in ADR-0003 Amendment 2.
- 2026-10-28 — Product-owner decisions recorded in open questions: Ruang Fokus (OQ-21), write actions disabled in Phase 1 (OQ-03), AI answers follow the question's language (OQ-38), per-browser language kept across logout (OQ-39).
- 2026-10-28 — English scope decided: UI text only, neutral English with Indonesian conventions, preference saved per browser (OQ-34…37).
- 2026-10-28 — English added as a second UI locale (`id` default, `en`), ADR-0003 Amendment 1.
- 2026-10-28 — Approved supporting-library bundle recorded (ADR-0003).
- 2026-10-28 — Technology stack React + TypeScript + Vite (SPA) decided by the product owner; ADR-0002.
