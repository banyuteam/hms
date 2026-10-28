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
| OQ-01 | **Decided** — React + TypeScript + Vite (ADR-0002) and the supporting-library bundle (ADR-0003, 2026-10-28). Window-manager spike vs dockview **done 2026-10-28 → keep own manager** (`research/window-manager-spike.md`). Remaining: deferred tables/forms/charts/radiology viewer. | Keep the own manager (spike result) |
| OQ-03 | **Decided (2026-10-28):** write actions (*Ubah*, *+ Tambah obat*, *Masukkan ke RM*, *Buat order*) stay **disabled with an explanatory tooltip** in Phase 1 (read-side); *Cetak* stays enabled. Re-enable per domain only when its PRD/ADR makes it writable. | Keep as decided |

## Users, scope, environment

| ID | Question | Why it matters | Recommended default |
|---|---|---|---|
| OQ-02 | **[Hospital]** Which roles use the web workspace first, and on what devices (desktop only, bedside tablet, shared PCs)? The reference shows a *Finance & Accounting Manager* viewing clinical data. | Density, touch targets (`size/control-lg` 44px), shortcuts, default windows per role | Desktop-first; touch mode as a later option |
| OQ-15 | Real screen sizes/resolutions of hospital PCs (mockups assume 1440×900; Khanza PCs may be 1366×768 or smaller) and number of monitors. | 3 tiled windows may not fit at 1366px | Design min viewport 1280×720; tile count is limited by the 360×240 minimum tile size, not by a screen-width rule (OQ-46: up to 4; smaller shell → single window)px |
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

## AI assistant (added 2026-10-28, from `docs/mockups/ref_hms_with_ai_chatbot.html`)

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
| OQ-36 | **Decided (2026-10-28):** language preference is saved **per browser** (non-PHI key `hms.locale` in `localStorage`; not tied to the user profile). Default on first visit: **English** (changed 2026-10-28, ADR-0003 Amendment 3; the browser language is no longer used). Consequence: on shared PCs the language follows the browser, not the person — lock/logout does not reset it; confirm that is acceptable (OQ-39). | Keep as decided |
| OQ-37 | **Superseded 2026-10-28 by OQ-49:** the separate `EN ·` frames were removed; the whole Figma file is now English by default. The Indonesian UI copy lives in `source/web-frontend/src/i18n/messages/id.json`; layout checks for Indonesian use the pseudo-locale in tests. | — |
| OQ-38 | **Decided (2026-10-28):** AI answers **follow the language of the clinician's question** (Indonesian question → Indonesian answer; English → English). UI chrome follows the UI locale. Drafts inserted into the record (when writes are enabled) are saved in Indonesian unless the clinician chooses otherwise — to confirm in OQ-25. | Keep as decided |
| OQ-39 | **Decided (2026-10-28, on my recommendation):** keep the per-browser language when someone logs out or the screen locks (language is not PHI); show the language switcher on the lock/login screen so the next person can change it in one click. | Keep as decided |

## Ruang Fokus and wallpaper (added 2026-10-28)

| ID | Question | Recommended default |
|---|---|---|
| OQ-40 | Ruang Fokus behaviour (all my proposals): entry by a dock button, `Ctrl+K → "Ruang fokus"`, or idle (10 min → Ruang Fokus, 15 min → lock — timeouts are **[Hospital]**, see OQ-12). Exit with Esc/click. Windows are hidden (not closed); no patient data on screen; auto-lock keeps running. Optional 5-minute break timer and *Kunci layar*. Is the break timer wanted, and should idle auto-enter Ruang Fokus at all (vs going straight to lock)? Does hiding windows count as a privacy screen the hospital accepts? | Manual entry + optional idle entry (off by default); timer optional; never replaces auto-lock |
| OQ-41 | **Wallpaper provenance.** **Changed 2026-10-28:** the product owner supplied `docs/mockups/wallpaper.jpg` (5184×3456 photo of a hospital waiting hall); code and Figma now use it (resized to 2560×1706 in `source/web-frontend/assets/brand/`). The earlier image was AI-generated by me and is replaced. Open: (a) **licence/source of the photo** — please confirm we may use it; (b) the photo shows a **real hospital's signage** ("HOSPITAL DE NIÑOS DE LA SANTISIMA TRINIDAD", "TURNOS") above a UI branded *Banyumanik 2* — crop/blur the sign, or replace with a photo of the real premises (no identifiable people)? (c) wallpaper presets later, no free uploads. | Keep as supplied until you decide (b); replace with the hospital's own photo when available; presets later, no free uploads |
| OQ-42 | Wallpaper readability: it sits under an 80% `bg/canvas` scrim behind windows and 25% in Ruang Fokus. Test at night/low brightness and on low-quality monitors; add a "plain canvas" option for users who find a picture distracting. | Provide a *Latar polos* switch in preferences |

## Authentication and session (added 2026-10-28, from the first scaffold)

| ID | Question | Recommended default |
|---|---|---|
| OQ-43 | **Real sign-in.** The skeleton uses a **static demo account** (`VITE_DEMO_AUTH=true`, credentials public on the login screen, session in memory only). Which identity provider will the hospital use (Khanza users, LDAP/AD, Keycloak/SSO), how is the session held (BFF httpOnly cookie preferred), MFA, password policy, and who may sign in on shared PCs? Needs an ADR together with the gateway/BFF. | BFF-managed httpOnly cookie session; the SPA never sees tokens; replace `src/auth/` internals, keep the route guard and `endSession()` |
| OQ-44 | Demo idle timeout is 15 min (`VITE_IDLE_MINUTES`) and ends the session (stand-in for the lock screen, OQ-12). Should idle go to a lock screen that keeps the layout (re-auth to resume) instead of logging out? | Lock screen first (layout kept in memory), full logout after a longer limit |
| OQ-45 | Reloading the page signs the demo user out (memory-only session) and clears the window layout. Acceptable for a PHI app, or should the BFF cookie session restore the user (and layout types without titles/ids)? | Restore the session via BFF cookie; restore only window types/geometry (OQ-07) |

## Tile layout (added 2026-10-28, from the temporary Figma page *TEMP · Tile layout plan*)

| ID | Question | Recommended default |
|---|---|---|
| OQ-46 | **Decided (2026-10-28, product owner):** (a) tile layouts allow **up to 4 tiles** (presets 1, 1+1, 1+2, 2×2) — this replaces the earlier "≤3 visible windows" guideline (OQ-09) and "max 2 tiles below 1440 px" (OQ-15); (b) while a tile layout is active, **floating windows — smaller, non-fullscreen windows you can still see — stay on top of the tiles** ("stay-on-top"); state names and behaviour are in `window-states.md`; (c) **tile sizes follow the shell window's size when the shell is maximised**; (d) when the **shell window is minimised, tiling is disabled** and only the **most recently used window** is shown; (e) **margin 24 px and gap 16 px**, as recommended. | Keep as decided |
| OQ-47 | **Resolved 2026-10-28.** (1) *Stay-on-top*: the product owner's "minimized windows" are **floating** windows (smaller, not fullscreen, visible) that stay above the tiles; hiding to the dock is called **minimized**. (2) *Shell window* = the browser/PWA window; maximised/compact is decided by whether the chosen preset fits at the 360×240 minimum tile size (**accepted**). Details and transition rules: [`window-states.md`](window-states.md). | Keep as decided |
| OQ-48 | **Decided (2026-10-28, product owner):** layout **picker first, snap-by-drag later**; **empty slot = placeholder**; split-handle ratio **free with a soft snap at 50%**; **direct keyboard shortcuts wanted, Ctrl+K palette first** (key set after OQ-19); layout **remembered per user — types + ratios only** (server-side, no titles/ids; OQ-07 answered for layouts). Also approved: extra windows open as floating; previous layout returns when the shell grows. Details: `window-states.md`. | Keep as decided |

## Figma language (added 2026-10-28)

| ID | Question | Recommended default |
|---|---|---|
| OQ-49 | **Decided (2026-10-28, product owner): the Figma file is English by default** — screen titles, labels, annotations, layer/frame names, component sample text and metadata. The `EN ·` mockup frames were removed. Rules applied: **UI text** was translated (using the app's `en.json` terms where they exist; English formats `27 Oct 2026`, `Rp1,170,000`, `37.8`); **data stays as stored** (patient names, diagnoses, drug and ward/poli names, clinical notes, report titles, AI answer text and the sample prompt), consistent with OQ-34/38. Consequence: Figma no longer shows the Indonesian UI; the Indonesian copy is the `id` catalog, and Indonesian text-length/wrapping must be checked in the running app or with the pseudo-locale, not in Figma. **Answered 2026-10-28: the app's default UI language also becomes English** (ADR-0003 Amendment 3; root `CLAUDE.md` updated; code, tests and e2e switched). | Keep as decided |

## Patient Detail navigation and profile pages (added 2026-10-28)

| ID | Question | Recommended default |
|---|---|---|
| OQ-50 | **Decided (2026-10-29, product owner):** the sidebar is cut from 14 to 5 items (Personal Information, Contact, Guarantor & Insurance, Family & Emergency, **Audit Log — stays in the sidebar**); the nine removed items live in the tabs or the header (Visit History and Appointments → Encounters; Diagnoses and Problems & History → Medical Record; Allergies → header safety bar; Vital Signs → Overview; Medications, Care Plan, Documents → their own tabs). Only one place is active at a time; the Overview *Personal Information* card stays as a summary with a "View profile" link. Figma W10, W11–W14, mockups 10–13. | Keep as decided |
| OQ-51 | **Answered 2026-10-29 (schema uploaded).** Every profile field was checked against `docs/references/khanza-schema/rsb221022021.sql`; the mapping is in [`patient-profile-fields.md`](patient-profile-fields.md). Changes made: blood type has no Rh ("O", not "O+"); postal code, home phone, participant class/status and the emergency-contact phone do not exist and were removed; "patient share" moved out (it is Billing); "Family & Emergency" is the *responsible person* (`keluarga`/`*pj` fields, plus `p_jawab` per encounter); guarantor and SEP fields come from `penjab`, `perusahaan_pasien` and `bridging_sep`. **Decided 2026-10-29 (product owner):** enum values are shown with **English labels** (table in `patient-profile-fields.md` §3) and the **BPJS class** is in Phase 1 (read from `bridging_sep.klsrawat`, no live VClaim call; membership validity stays out). Only the Indonesian translations of the labels remain. | Keep as decided |
| OQ-52 | **Decided (2026-10-29, product owner): add a "More ▾" overflow tab.** Rule applied in the mockups: show as many tabs as fit, never more than 8, and put the rest under More ▾ (Documents, Care Plan, Referrals at full width; 4 tabs shown in the tiled window, 6 beside the AI panel). If the active tab lives inside More, More shows its name and stays active (to build). | Keep as decided |

## Medical Record tab (added 2026-10-29)

| ID | Question | Recommended default |
|---|---|---|
| OQ-53 | **Decided (2026-10-29, product owner): the discharge summary (*resume medis*, `resume_pasien_ranap`) goes in the Documents tab** (the next clinical tab — **Phase 3**), not in Medical Record. The Medical Record tab stays with the four cards (Diagnoses, Medical history, Clinical notes, Allergies; Figma W15 / mockup 14). The ~20 specialty assessment forms, observation charts, nutrition notes, immunisation and obstetric history were not discussed and **stay out of Phase 1 and 2** and are an **open question for Phase 3** (the hospital names the forms it needs). | Keep as decided |
| OQ-54 | **Decided (2026-10-29, product owner): `alergi_pasien` is the allergy source of truth** (header chip and the Allergies card). The vocabulary mapping is **Phase 3** work. The older free-text allergy fields are not used. The stored vocabulary of `kategori`, `tipe`, `kriticalitas`, `status_klinis`, `status_verifikasi` is still not defined in the DDL — the English labels in the mockup (Medication, Allergy, High, Active · Confirmed) are placeholders until the values are known (a list of the distinct stored values is enough). | Read the distinct values from a replica and map labels |
| OQ-55 | **Decided (2026-10-29, product owner): for now the Medical Record tab is available to all users and roles; access control comes later with RBAC (OQ-18).** The audit event on every open stays — that is a legal requirement (Permenkes 24/2022, root `CLAUDE.md`), not an access rule. No reason prompt for "All encounters" for now. | Revisit when RBAC is designed |

## Phase 2 scaffold findings (added 2026-10-29)

| ID | Question | Recommended default |
|---|---|---|
| OQ-56 | **Minimum supported screen — real data point (2026-10-29): the product owner's machine is a 1280×800 screen (1280×775 usable, device pixel ratio 2), which leaves a browser viewport of about 1280×630 — below the 1280×720 design minimum.** Windows now re-fit inside the 24/16 px margins whenever the work area changes, and the first window is clamped to the screen. At 1280×630, 2×2 tiles do not fit (needs about 784×528 of work area; here 1280×510) so the shell goes *compact* sooner than on a 1440×900 screen; consider a full-screen/installed-app mode (OQ-19) to win back ~140 px. **Minimum supported screen (original text):** The Chrome check showed the shell was wider than the window once the dock had many tabs (the grid column grew with the dock) — fixed: the shell now shrinks and the dock tabs scroll. Compact mode (tiling pauses below the preset's size) works as decided, but the real PC sizes are still unknown (OQ-15): at 1366×768, 2×2 fits (688×… tiles ≥ 360×240) only above about 784×648 of *work area*. Please send the real resolutions and monitor count. | Design minimum 1280×720; below it only compact mode |
| OQ-57 | **Data contract.** Phase 2 reads synthetic records through `src/api/patientApi.ts`; the types in `src/api/types.ts` mirror what the BFF must supply (fields verified against the Khanza schema). Contracts-first (root `CLAUDE.md`): the OpenAPI spec for the patient-detail read model has to be written in `source/shared/` — with `backend-services` — before any real data. Who drafts it, and does the audit event on record open go through the same API? | Draft `source/shared/openapi/patient-detail.v1` from `types.ts`; audit event emitted server-side per request |
| OQ-58 | **Print.** *Print* is enabled (OQ-03) and currently calls the browser print of the whole page after emitting an audit event. A real patient-record print/PDF needs its own layout, a confirmation naming the patient and document, and an audit event (ux-expert rule). Scope for Phase 3? | Phase 3, together with the Documents tab |

## Design system and UX

| ID | Question | Recommended default |
|---|---|---|
| OQ-05 | **Font.** Reference uses Segoe UI/Arial; Figma uses Inter (Segoe UI unavailable). Segoe UI is only on Windows; Inter must be self-hosted (no public CDN for PHI apps? — fonts carry no PHI, but offline/LAN-only hospitals may block CDNs). | Self-host Inter (OFL) with Segoe UI first in the stack; confirm |
| OQ-06 | Dark / night / high-contrast mode? Tokens are Light-only (collection `Color` has one mode). | Add Dark mode later by adding a mode to `Color`; do not hard-code light values |
| OQ-09 | Workspace defaults are my assumptions: margin 24 and window gap 16 (**confirmed 2026-10-28, OQ-46**), up to 4 tiles (**decided 2026-10-28, OQ-46**; the earlier ≤3 guideline is dropped), window sizes (1180×748 focused; 752/624 tiled), density *Nyaman* 44px / *Ringkas* 32px. Need usability testing. | Ship as configurable constants, not hard-coded |
| OQ-11 | Accessibility target: WCAG 2.1 AA assumed. Any Indonesian/hospital requirement, screen-reader need, colour-vision considerations? | AA; test with keyboard and one screen reader |
| OQ-13 | **Decided:** English (default since 2026-10-28, ADR-0003 Amendment 3) + Bahasa Indonesia (`id`) — Amendment 1. Still open: preferred term list for both languages (e.g. DPJP, Penjamin, Bangsal ↔ attending physician, payer/guarantor, ward) and who reviews clinical translations. | Glossary-driven strings (`docs/glossary.md` extended with EN terms); hospital-approved reviewer for clinical wording |
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
