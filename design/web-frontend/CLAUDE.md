# web-frontend — plan & design instructions

How Claude works on the **plan and design** of the browser workspace (PRD, Figma, tokens, UX
research, open questions). For the **code**, see `source/web-frontend/CLAUDE.md`.
Read the root `CLAUDE.md` and this folder's `PRD.md` first.

## What lives here

- `PRD.md` (final PRD), `open-questions.md` (every undecided UX/technical question, with a recommended default).
- `.claude/skills/hospital-ux-expert/` (UX rules + research workflow) and `.claude/skills/design-tokens/`
  (tokens + `tokens.json` / `tokens.css`).
- Figma file: https://www.figma.com/design/yo53y0sVdqxaKNjZquWNom (Cover · Design Tokens · Components ·
  Wireframes W1–W9 · Mockups 01–09 · Brand; all UI text in English by default, see OQ-49). The Figma file is the visual source of truth.
- User inputs that drive the design stay in `docs/` (mockups, PRD drafts, references). Never edit them.

## Scope (what the product is)

- Desktop-like workspace in the browser: top bar with global search (Ctrl+K), a work area of
  movable/resizable windows, and a bottom dock of open windows (see
  `docs/mockups/ref_hospital-patient-workspace.html` and `docs/mockups/ref_hms_with_ai_chatbot.html`).
- Modules as windows: Patient Management, Patient Detail (header + clinical tabs + profile sidebar, see PRD FR-18; tabs: Overview, Medical Record,
  Encounters, Orders, Results, Medications, Procedures, Billing, Documents, Care Plan,
  Referrals), Laboratory Results, Radiology Viewer, Billing & Insurance, AI Assistant, and later the
  claim-assistant screens.
- Talks only to the API gateway / BFF in `source/backend-services/`. Never connects to a database.

## Design rules

- Workflow: plan → design (Figma) → design review → code (`source/web-frontend/`) → code review → repeat.
  Keep Figma, tokens (`design-tokens` skill) and code in sync; changes to a token start in Figma.
- Use the `hospital-ux-expert` skill for UX decisions/research and `design-tokens` for every
  colour/size/spacing value. Unresolved questions go in `open-questions.md` with a recommended default.
- Tokens refine the reference mockup's (AA contrast, 4-pt scale); where they differ, the
  token skill wins on values, the mockup still wins on layout and the window/dock model.
- Build screens from Figma components (instances) bound to variables; never hard-code hex/px.
- Mockups use synthetic data only; PHI masked by default; write actions disabled in Phase 1.
- UI language: English default + Bahasa Indonesia (UI text only), see ADR-0003 Amendments 1 and 3. The Figma file is English by default (OQ-49).
- Role-based UI: hide actions the user's role can't perform, but always rely on the backend for authorization.
- Load the Figma `figma-use` skill before any `use_figma` call.
