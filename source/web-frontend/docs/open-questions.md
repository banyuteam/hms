# web-frontend — Open questions

- **Source:** design session 2026-10-28 (wireframes, mockups, tokens in Figma
  <https://www.figma.com/design/yo53y0sVdqxaKNjZquWNom>) + research in
  `.claude/skills/hospital-ux-expert/references/research-notes.md`.
- **Status:** all open. Each has a *recommended default* so work can continue; answer or
  override. Decisions that change architecture become ADRs in `docs/decisions/`; decisions that
  belong to the hospital are marked **[Hospital]**. When answered, move to the PRD (§9 / change log).
- Evidence labels: see the hospital-ux-expert skill (Ref / Req / Reg / Res / Assumption).

## Needs your confirmation first

| ID | Question | Recommended default |
|---|---|---|
| OQ-21 | You asked for a "clear-space area to keep the user not bored". I read it as **generous whitespace + a calm, mostly empty canvas** (empty *Beranda*, ≥24px margins, ≤3 visible windows, progressive disclosure). Did you mean that, or a dedicated rest/“focus” area (e.g. a wallpaper/idle zone, focus mode that hides the dock)? | Keep my reading; add an optional *Mode fokus* (hide dock/top bar) later if wanted |
| OQ-01 | **Framework & component library** (ADR needed; `CLAUDE.md` says ask). Windows, dock and tokens are framework-agnostic so far. | Propose 2–3 options with an ADR once the PRD is Approved |
| OQ-03 | The reference mockup has write actions (*Edit*, *+ Add medication*, *Print*). Phase 1 is read-side only. I rendered write actions **disabled** ("Ubah") and kept *Cetak*. OK? | Disabled + tooltip until the domain's PRD/ADR makes it writable |

## Users, scope, environment

| ID | Question | Why it matters | Recommended default |
|---|---|---|---|
| OQ-02 | **[Hospital]** Which roles use the web workspace first, and on what devices (desktop only, bedside tablet, shared PCs)? The reference shows a *Finance & Accounting Manager* viewing clinical data. | Density, touch targets (`size/control-lg` 44px), shortcuts, default windows per role | Desktop-first; touch mode as a later option |
| OQ-15 | Real screen sizes/resolutions of hospital PCs (mockups assume 1440×900; Khanza PCs may be 1366×768 or smaller) and number of monitors. | 3 tiled windows may not fit at 1366px | Design min viewport 1280×720; tile max 2 below 1440px |
| OQ-16 | Which modules ship first and in what order? Mockups include Patient Management, Patient Detail, Lab, Radiology, Billing, plus placeholders *Rekam Medis* and *Asisten Klaim BPJS* ("Segera"). | Scope, empty-state tiles | As listed in `CLAUDE.md` |
| OQ-18 | **[Hospital]** Who may see what (role → window/field visibility)? Includes whether non-clinical staff see clinical notes. Backend enforces; UI only hides. | Role-based UI, masking defaults | Least privilege; hide, don't merely disable, unauthorised windows |
| OQ-20 | Multi-monitor: should a window be poppable to a second screen (`window.open`/Window Management API)? | "Multi-window" in the browser vs real OS windows; PHI/clipboard implications | Out of scope v1; revisit after OQ-19 |

## Safety, PHI and compliance

| ID | Question | Evidence | Recommended default |
|---|---|---|---|
| OQ-04 | Limit the number of simultaneously open **patient** windows? Add patient photo / ID banner? | R3: RCT shows no clear increase from 1→4 open records but higher errors in inpatient/ED; photos/ID alerts promising | Allow multiple; identity in title/dock/header; soft cap of 4 patient windows with a warning; evaluate photo with the hospital |
| OQ-08 | **[Hospital]** PHI masking: which fields are masked by default, who may reveal, is a **reason** required, and how long does a reveal last? Is the **No. RM in the dock tab/title** acceptable on shared screens? | `CLAUDE.md` rule 2; R4 | Mask NIK, No. BPJS, phone, address, e-mail; reveal 30 s per field with audit event; reason prompt for reveal of NIK/No. BPJS |
| OQ-07 | Persisting the window layout per user (position, size, open windows) — titles contain No. RM (PHI) and `CLAUDE.md` forbids PHI in local storage. | Rule | Persist only layout geometry + window *types* server-side per user; restore patient windows only after re-auth, or not at all |
| OQ-12 | **[Hospital]** Idle auto-lock timeout, lock behaviour on shared workstations, fast user switching, session length. Mockups show a placeholder `Kunci 14:32`. | R4 (access control is an audit focus) | 15 min idle; lock hides all windows; re-auth restores layout |
| OQ-10 | Alert policy: which situations may interrupt (allergy conflict, critical lab)? Does any clinical decision support exist in scope? | R1 | Passive display only in Phase 1; define "critical value" banner with clinicians |
| OQ-14 | Radiology viewer: what is the image source (PACS/DICOM, Khanza image files), and what viewer features (zoom, window/level, measurements)? Mockups show a placeholder only. | PHI in images | Needs integration spec in `docs/references/integration-specs/`; placeholder until then |

## Design system and UX

| ID | Question | Recommended default |
|---|---|---|
| OQ-05 | **Font.** Reference uses Segoe UI/Arial; Figma uses Inter (Segoe UI unavailable). Segoe UI is only on Windows; Inter must be self-hosted (no public CDN for PHI apps? — fonts carry no PHI, but offline/LAN-only hospitals may block CDNs). | Self-host Inter (OFL) with Segoe UI first in the stack; confirm |
| OQ-06 | Dark / night / high-contrast mode? Tokens are Light-only (collection `Color` has one mode). | Add Dark mode later by adding a mode to `Color`; do not hard-code light values |
| OQ-09 | Workspace defaults are my assumptions: margin 24, window gap 16, ≤3 visible windows, window sizes (1180×748 focused; 752/624 tiled), density *Nyaman* 44px / *Ringkas* 32px. Need usability testing. | Ship as configurable constants, not hard-coded |
| OQ-11 | Accessibility target: WCAG 2.1 AA assumed. Any Indonesian/hospital requirement, screen-reader need, colour-vision considerations? | AA; test with keyboard and one screen reader |
| OQ-13 | Languages: Bahasa Indonesia only, or also English toggle? Preferred term list (e.g. DPJP, Penjamin, Bangsal) and date/number formats (`27 Okt 2026`, `Rp1.170.000`, `37,8`). | Bahasa only; glossary-driven strings in i18n files |
| OQ-19 | **Shortcuts & delivery shape.** In a normal browser tab `Ctrl+W/T/N/Tab` cannot be overridden, `Ctrl+K` and `Alt+1…` may conflict. Is the app a plain browser tab, an installed PWA (`display: standalone`) or kiosk mode? | Plan for installed PWA/app-mode on hospital PCs; define a shortcut set that avoids reserved keys (see skill §6); close window via × / middle-click / `Alt`-based key |
| OQ-17 | **Usability research plan.** Who tests, with synthetic data, how many users per role, which tasks, success metrics (SUS, time-on-task, errors)? Existing Khanza studies are small/student-based (R5). Also baseline the current Khanza flows. | 5–8 users/role, Figma prototype, 6 core tasks (find patient, read vitals, open lab + billing side-by-side, …) |
| OQ-22 | Reference mockup gaps: `hospital-workspace-wallpaper.png` is referenced but not in `docs/mockups/`; UI copy is English; the avatar/emoji assets are placeholders. I used a solid `bg/canvas` and Bahasa Indonesia. Provide the wallpaper/brand assets if wanted. | Solid canvas (calmer, no PHI risk, better contrast) |

## Deviations I made from the reference (please acknowledge)

1. Primary blue split: `#0878F9` stays as accent; text/button use `#0A62C9` for AA (4.15:1 → 5.83:1).
2. Muted text `#60769B` → `#51688F`; status text colours darkened; minimum text 12px (reference uses 10px).
3. 4-pt spacing and three radii instead of ad-hoc values.
4. Bottom row of fixed sub-windows in the reference became a **tile layout** (1+2) chosen from a picker, so
   the user controls how many windows share the screen (clear space).
5. UI text in Bahasa Indonesia; NIK/phone/address masked with reveal.

## Research still to do

See "R6" in the research notes (touch ergonomics, colour-vision, night mode, DICOM viewer UX, browser window-manager
patterns & ARIA, lock-screen UX, Indonesian accessibility rules, e-signature UX, Indonesian-language Khanza studies).
Verify Permenkes 24/2022 article numbers against the official text before any compliance statement.
