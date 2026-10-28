# web-frontend — Open questions

- **Source:** design session 2026-10-28 (wireframes, mockups, tokens in Figma
  <https://www.figma.com/design/yo53y0sVdqxaKNjZquWNom>) + research in
  `design/web-frontend/.claude/skills/hospital-ux-expert/references/research-notes.md`.
- **Status:** all open. Each has a *recommended default* so work can continue; answer or
  override. Decisions that change architecture become ADRs in `docs/decisions/`; decisions that
  belong to the hospital are marked **[Hospital]**. When answered, move to the PRD (§9 / change log).
- Evidence labels: see the hospital-ux-expert skill (Ref / Req / Reg / Res / Assumption).

## Needs your confirmation first

| ID | Question | Recommended default |
|---|---|---|
| OQ-21 | **Decided (2026-10-28):** a **dedicated rest/focus area** (*Ruang Fokus*), not only whitespace — with a calm hospital-ambience wallpaper. Figma: Mockup 08, Wireframe W9; wallpaper now also sits behind the workspace (under an 80% canvas scrim). Behaviour details in OQ-40, wallpaper provenance in OQ-41. | Keep whitespace rules (≤3 windows, ≥24px margins) **and** the Ruang Fokus area |
| OQ-01 | **Decided** — React + TypeScript + Vite (ADR-0002) and the supporting-library bundle (ADR-0003, 2026-10-28). Remaining: window-manager spike vs dockview; deferred tables/forms/charts/radiology viewer. | Run the 2-day spike before building the window manager |
| OQ-03 | **Decided (2026-10-28):** write actions (*Ubah*, *+ Tambah obat*, *Masukkan ke RM*, *Buat order*) stay **disabled with an explanatory tooltip** in Phase 1 (read-side); *Cetak* stays enabled. Re-enable per domain only when its PRD/ADR makes it writable. | Keep as decided |

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

## AI assistant (added 2026-10-28, from `docs/mockups/hms-ai-chatbot-workspace.html`)

Figma: Mockups 06–07, Wireframes W7–W8, components *AI Message Bubble*, *Action Chip*, pill `AI`, violet `ai/*` tokens.

| ID | Question | Recommended default |
|---|---|---|
| OQ-23 | **[Hospital] + ADR.** Which AI processor/model, and where does patient context go (on-prem vs external API)? Sending PHI to an external LLM is forbidden without an ADR approving the processor and data-sharing basis (root `CLAUDE.md` rule 2). Also UU PDP basis and patient notice. | No real integration until an ADR is accepted; mockups are processor-agnostic. Prefer on-prem/in-country processing |
| OQ-24 | Clinical-safety scope: is the assistant "information retrieval/summary" only, or may it suggest orders/diagnoses (which may count as clinical decision support / medical-device software)? Who is accountable? | Summaries and drafts only; suggestions framed "untuk ditinjau klinisi"; regulatory classification to be confirmed by hospital/legal |
| OQ-25 | `Masukkan ke RM` and `Buat order` are writes. Allowed when? Authorship/attribution of AI-assisted text, clinician review step, e-signature (PSrE), audit. | Disabled in Phase 1; later insert only as a *draft note* that the clinician edits and signs |
| OQ-26 | Audit & logging: prompts and answers contain PHI. What is stored, for how long, who can read it (Permenkes 24/2022 audit; masked logs per `CLAUDE.md`)? | Audit event per AI request (who, patient, sources read, time) with no prompt/answer text in app logs; transcript retention = hospital decision |
| OQ-27 | Attachments and voice input in the composer: allowed? Which file types, where does speech-to-text run (PHI)? | Shown but gated/disabled until OQ-23 is decided |
| OQ-28 | Panel placement & behaviour: docked-right window vs floating vs bottom drawer; does it follow the focused patient window; one AI chat per patient window or global? What do the *Insight*, *Aksi* and *Riwayat* tabs contain? (Only their names exist in the reference; I did not invent content.) | One AI window bound to the focused patient window; Riwayat = per-patient history; define Insight/Aksi with clinicians |
| OQ-29 | Reference-data inconsistency: the AI summary/SOAP say leukocytes and CRP are elevated (WBC 12.5), while the lab window in the other mockup shows leukocytes 7,8 (normal). I kept the AI wording for fidelity. Which is intended? | Make synthetic fixtures consistent before user testing |
| OQ-30 | Where else is AI offered — global search ("tanya AI"), claim-assistant (#5), per-module? Same panel or separate? | Single AI window reused by modules; claim-assistant decides its own scope in its PRD |

## Brand / logo (added 2026-10-28, from `docs/mockups/logo-1.jpg`, `logo-2.jpg`)

| ID | Question | Recommended default |
|---|---|---|
| OQ-31 | **[Hospital]** The logo is dark green (green cross, "B"), while the reference UI is blue and the system uses green for "success". Keep blue for actions and the logo as the only green element, or re-base the palette on the brand green? | Keep UI blue; logo only in top bar, lock screen, print, app icon. Don't use brand green as a UI token |
| OQ-32 | Both logos are low-resolution JPGs (137px and 447px, no transparency). Please supply vector (SVG/PDF/AI) and an official brand guide (clear space, minimum size, dark-background version). Which file is the app icon / favicon? | Use `logo-1` (white background) as the *Mark* in the top bar and `logo-2` (green background) as *App icon*; replace with vectors before build |
| OQ-33 | Hospital name in the top bar: reference says "Banyumanik 2" with subtitle "Hospital Management System". Is that the official name/wording, and is a Bahasa subtitle wanted? | Keep as in reference |

## English locale (added 2026-10-28)

| ID | Question | Recommended default |
|---|---|---|
| OQ-34 | **Decided (2026-10-28):** English covers **UI text only** (menus, labels, buttons, tabs, status labels, placeholders, system messages, AI-panel chrome). Not translated: backend/Khanza data (names, master data such as ward/poli/doctor names, free-text notes, diagnosis text as stored), AI answers and user prompts, reports/print-outs, code-system names, legal/clinical documents (stay Indonesian). Still open: what language AI answers use (follows the question? fixed Indonesian?), and enumerations that the UI maps from codes (gender, marital status, encounter type) — translated by the UI. | Enumerations mapped by the UI are translated; AI answer language follows the user's prompt language (OQ-38) |
| OQ-35 | **Decided (2026-10-28):** neutral English with Indonesian conventions — date `27 Oct 2026`, 24-hour time, zone Asia/Jakarta, decimal point (`37.8`), thousands comma (`Rp1,170,000`), integer Rupiah. | — |
| OQ-36 | **Decided (2026-10-28):** language preference is saved **per browser** (non-PHI key `hms.locale` in `localStorage`; not tied to the user profile). Default on first visit: browser `Accept-Language` if `en`, otherwise `id`. Consequence: on shared PCs the language follows the browser, not the person — lock/logout does not reset it; confirm that is acceptable (OQ-39). | Keep as decided |
| OQ-37 | **Decided (2026-10-28):** English frames drawn for Home, Patient Detail and Patient Detail + AI Assistant (Figma Mockups page, `EN ·` frames). Others use the pseudo-locale in tests. | — |
| OQ-38 | **Decided (2026-10-28):** AI answers **follow the language of the clinician's question** (Indonesian question → Indonesian answer; English → English). UI chrome follows the UI locale. Drafts inserted into the record (when writes are enabled) are saved in Indonesian unless the clinician chooses otherwise — to confirm in OQ-25. | Keep as decided |
| OQ-39 | **Decided (2026-10-28, on my recommendation):** keep the per-browser language when someone logs out or the screen locks (language is not PHI); show the language switcher on the lock/login screen so the next person can change it in one click. | Keep as decided |

## Ruang Fokus and wallpaper (added 2026-10-28)

| ID | Question | Recommended default |
|---|---|---|
| OQ-40 | Ruang Fokus behaviour (all my proposals): entry by a dock button, `Ctrl+K → "Ruang fokus"`, or idle (10 min → Ruang Fokus, 15 min → lock — timeouts are **[Hospital]**, see OQ-12). Exit with Esc/click. Windows are hidden (not closed); no patient data on screen; auto-lock keeps running. Optional 5-minute break timer and *Kunci layar*. Is the break timer wanted, and should idle auto-enter Ruang Fokus at all (vs going straight to lock)? Does hiding windows count as a privacy screen the hospital accepts? | Manual entry + optional idle entry (off by default); timer optional; never replaces auto-lock |
| OQ-41 | **Wallpaper provenance.** Stock searches (Unsplash, Pexels) gave dark/eerie corridors, galleries or clinical bedrooms; I generated a bright, quiet hospital-lobby image with Figma AI (no people, text, signs or logos; 1264×848). Is an AI-generated image acceptable, or should the hospital supply its own photo (real Banyumanik 2 premises, no identifiable people)? Should users be able to choose a wallpaper (a few presets, no uploads of patient-related images)? | Use this image for now (credit note in repo); hospital photo replaces it later; presets later, no free uploads |
| OQ-42 | Wallpaper readability: it sits under an 80% `bg/canvas` scrim behind windows and 25% in Ruang Fokus. Test at night/low brightness and on low-quality monitors; add a "plain canvas" option for users who find a picture distracting. | Provide a *Latar polos* switch in preferences |

## Authentication and session (added 2026-10-28, from the first scaffold)

| ID | Question | Recommended default |
|---|---|---|
| OQ-43 | **Real sign-in.** The skeleton uses a **static demo account** (`VITE_DEMO_AUTH=true`, credentials public on the login screen, session in memory only). Which identity provider will the hospital use (Khanza users, LDAP/AD, Keycloak/SSO), how is the session held (BFF httpOnly cookie preferred), MFA, password policy, and who may sign in on shared PCs? Needs an ADR together with the gateway/BFF. | BFF-managed httpOnly cookie session; the SPA never sees tokens; replace `src/auth/` internals, keep the route guard and `endSession()` |
| OQ-44 | Demo idle timeout is 15 min (`VITE_IDLE_MINUTES`) and ends the session (stand-in for the lock screen, OQ-12). Should idle go to a lock screen that keeps the layout (re-auth to resume) instead of logging out? | Lock screen first (layout kept in memory), full logout after a longer limit |
| OQ-45 | Reloading the page signs the demo user out (memory-only session) and clears the window layout. Acceptable for a PHI app, or should the BFF cookie session restore the user (and layout types without titles/ids)? | Restore the session via BFF cookie; restore only window types/geometry (OQ-07) |

## Design system and UX

| ID | Question | Recommended default |
|---|---|---|
| OQ-05 | **Font.** Reference uses Segoe UI/Arial; Figma uses Inter (Segoe UI unavailable). Segoe UI is only on Windows; Inter must be self-hosted (no public CDN for PHI apps? — fonts carry no PHI, but offline/LAN-only hospitals may block CDNs). | Self-host Inter (OFL) with Segoe UI first in the stack; confirm |
| OQ-06 | Dark / night / high-contrast mode? Tokens are Light-only (collection `Color` has one mode). | Add Dark mode later by adding a mode to `Color`; do not hard-code light values |
| OQ-09 | Workspace defaults are my assumptions: margin 24, window gap 16, ≤3 visible windows, window sizes (1180×748 focused; 752/624 tiled), density *Nyaman* 44px / *Ringkas* 32px. Need usability testing. | Ship as configurable constants, not hard-coded |
| OQ-11 | Accessibility target: WCAG 2.1 AA assumed. Any Indonesian/hospital requirement, screen-reader need, colour-vision considerations? | AA; test with keyboard and one screen reader |
| OQ-13 | **Decided:** Bahasa Indonesia (default) + English (`en`) — ADR-0003 Amendment 1. Still open: preferred term list for both languages (e.g. DPJP, Penjamin, Bangsal ↔ attending physician, payer/guarantor, ward) and who reviews clinical translations. | Glossary-driven strings (`docs/glossary.md` extended with EN terms); hospital-approved reviewer for clinical wording |
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
6. AI panel: violet identity colour split into `violet/600` (fills) and `violet/700` (text) for AA; AI added as its own dock tab
   (the reference shows the panel but no tab); write actions in the AI answer rendered disabled; "Draf AI" label, sources
   and a patient-context strip added (the reference only has a footer note); AI text translated to Bahasa Indonesia.

## Research still to do

See "R6" in the research notes (touch ergonomics, colour-vision, night mode, DICOM viewer UX, browser window-manager
patterns & ARIA, lock-screen UX, Indonesian accessibility rules, e-signature UX, Indonesian-language Khanza studies).
Verify Permenkes 24/2022 article numbers against the official text before any compliance statement.
