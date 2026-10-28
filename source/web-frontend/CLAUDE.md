# web-frontend — Instructions

The browser workspace that replicates the Khanza desktop experience as a web app.
Read the root `CLAUDE.md` and this folder's `PRD.md` first.

## Scope

- Desktop-like workspace in the browser: top bar with global search (Ctrl+K), a work area of
  movable/resizable windows, and a bottom dock of open windows (see
  `docs/mockups/hospital-patient-workspace.html`).
- Modules as windows: Patient Management, Patient Detail (tabs: Overview, Medical Record,
  Encounters, Orders, Results, Medications, Procedures, Billing, Documents, Care Plan,
  Referrals), Laboratory Results, Radiology Viewer, Billing & Insurance, and later the
  claim-assistant screens.
- Talks only to the API gateway / BFF in `source/backend-services/`. Never connects to a database.

## Rules

- Framework and component library are pending an ADR — ask before choosing.
- The mockup is the visual reference: match its layout, density, colour tokens
  (`--b:#0878f9`, `--line`, `--ink`, `--muted`) and the window/dock model. Copy assets out of
  `docs/mockups/`; don't edit the mockup itself.
- Build a small design system first (tokens, window, dock tab, card, field grid, table, pill,
  tab bar) and compose screens from it.
- Keyboard-first like the desktop app: shortcuts for search, switch window, close window;
  visible focus states; tables navigable by keyboard.
- UI language Bahasa Indonesia, with all strings in i18n files (no hard-coded copy).
- Role-based UI: hide actions the user's role can't perform, but always rely on the backend
  for authorization.
- PHI in the browser: no PHI in URLs, local storage, or analytics; clear caches on logout;
  auto-lock after idle timeout.
- Tests: component tests for the design system, end-to-end tests for core flows using
  synthetic data and mocked APIs.
