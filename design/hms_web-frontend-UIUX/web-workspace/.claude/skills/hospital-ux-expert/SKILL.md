---
name: hospital-ux-expert
description: Expert UI/UX guidance and research workflow for the HMS hospital web workspace (multi-window desktop-style UI, bottom dock, clear-space layout, patient-safety and PHI-aware design). Use whenever you design, review, wireframe or build a screen/window/flow for source/hms_web-frontend-UIUX/web-workspace, choose between UX options, write UI copy, or need to research hospital-user needs. Pairs with the design-tokens skill for values.
---

# Hospital UI/UX expert (HMS web workspace)

Role: act as a senior healthcare UX designer for **hospital staff** using a web replacement of the
SIMRS Khanza desktop app. Optimise for **safety, speed of repeat tasks, and calm** — in that order.
Read first: root `CLAUDE.md`, `design/hms_web-frontend-UIUX/web-workspace/CLAUDE.md`, `design/hms_web-frontend-UIUX/web-workspace/PRD.md`, `design/hms_web-frontend-UIUX/web-workspace/open-questions.md`
and the **design-tokens** skill. Visual source: the Figma file linked from `design-tokens/SKILL.md`
and `docs/mockups/ref_hospital-patient-workspace.html` (read-only reference).

> Evidence labels used below: **[Ref]** the reference mockup · **[Req]** the user's stated
> preference · **[Reg]** regulation/rule in `CLAUDE.md` · **[Res]** published research (summarised in
> `references/research-notes.md`, with strength) · **[Assumption]** my judgement, needs validation
> (tracked as an open question). Never present an [Assumption] as a fact.

## 1. Users & context (assumptions until the PRD is approved — OQ-02)

| Role | Main windows | What they need from the UI |
|---|---|---|
| Registration / admission clerk | Patient Management, Patient Detail | Fast search by name/MRN, accurate identity, few clicks |
| Nurse | Patient Detail (vitals, notes, meds) | At-a-glance status, bedside speed, minimal typing, glanceable alerts |
| Physician (DPJP) | Patient Detail, Results, Radiology | Longitudinal view, results with trends, no hunting between screens |
| Lab / radiology staff | Results, Radiology viewer | Queue + result entry (later), image viewer |
| Billing / cashier / finance | Billing & Insurance | Itemised charges, coverage vs patient share, exact Rupiah |
| Medical-records / claims staff | Documents, claim-assistant (later) | Completeness of record, e-sign status, claim risks |

Context facts: shared workstations, interruptions, mixed IT skill, Khanza muscle memory (dense,
keyboard-driven), 24-hour shifts (glare/night), Windows PCs likely [Assumption — OQ-15 asks for a
screen inventory], Indonesian-language UI [Reg: `CLAUDE.md`].

## 2. The workspace model (what the user asked for) [Req]

1. **Workspace-style windows** — floating, draggable, resizable windows on a calm canvas; several
   can be open (multi-window). Each module is a window; one window is focused.
2. **Tabs at the bottom (dock)** — one dock tab per open window, plus a permanent *Beranda* tab and
   a `+` launcher. Click = focus/restore; the tab of a minimised window stays. Dock is the only
   place that lists open windows, so users never "lose" a window.
3. **Clear space** — the canvas stays mostly empty so the user is not overwhelmed. Concretely
   (numbers are [Assumption] to validate — OQ-09, OQ-21):
   - window-to-edge margin ≥ `space/24`, gap between windows ≥ `space/16`;
   - the empty workspace (*Beranda*) shows only: greeting, 6 launch tiles, 3 recent items;
   - at most **4 tiled windows** (product decision 2026-10-28, OQ-46; replaces the earlier 3-window guideline); when the shell is too small to tile, show only the most recently used window
     instead of shrinking everything (extra windows stay open in the dock);
   - windows open at a **comfortable** size, not maximised; content scrolls inside the window;
   - progressive disclosure: summary first, detail on demand; collapse rarely used cards;
   - one primary action per window; secondary actions are ghost/secondary buttons.
3b. **Ruang Fokus (focus/rest area)** — decided: a dedicated calm view (Figma Mockup 08, Wireframe W9) with the hospital-ambience wallpaper,
   big clock/date, optional 5-minute break timer and *Kunci layar*. Windows are **hidden, not closed**; no patient data is shown; Esc/click returns to the
   exact previous layout. It is not a lock: auto-lock keeps running. Entry/idle behaviour: OQ-40. The wallpaper also sits (under an 80% scrim) behind the whole
   workspace — never place text directly on it; use windows, cards or the scrim.
4. **Snap / tile layouts** — Single, 1+1, 1+2, 2×2 from a picker in the dock, or drag to a screen edge.
5. **Keyboard-first** [Ref: CLAUDE.md] — see section 6.

Window anatomy and states: see Figma pages *Wireframes → W1* and *Components → Window Titlebar / Dock Tab*.

## 3. Patient safety rules (highest priority)

- **Identity everywhere.** Every window that shows a patient puts *name-or-initials + No. RM* in
  the title bar **and** the dock tab (`Detail Pasien - 00012346`, short form `Detail 00012346`), and the
  patient header (name, age/sex, status) is visible without scrolling. This is the main defence against
  acting on the wrong chart when several are open [Res: evidence that multiple open records don't
  clearly raise wrong-patient order errors, but errors rise in busy inpatient/ED settings, and
  ID banners/photos look promising — see notes; the open-record limit is OQ-04].
- **Allergies are always visible** in the patient header safety bar (danger pill with text). Never
  hide them behind a tab. [Req/Assumption]
- **Abnormal values** show colour + arrow/flag text (`140/90 ↑`, `↓ Rendah`) — never colour alone.
- **Destructive or irreversible actions** (sign, submit, discard) need a confirm step that restates the patient.
- **Read-only first (Phase 1)** [Reg: strangler-fig, `CLAUDE.md` rule 3]: write actions that exist
  in the reference mockup (Edit, Add medication) are rendered **disabled** with an explanatory tooltip
  until a domain's PRD/ADR makes it writable. Don't hide them silently — users must understand why.
- **Alerts:** keep interruptive alerts for rare, high-severity situations; everything else is passive
  (inline banner/pill). Put the critical info on the top-level, evidence behind a link, allow acting
  from within the alert. No alerting logic exists in Phase 1 — display only [Res: alert-fatigue
  literature; OQ-10].

## 3b. AI assistant panel (reference: `docs/mockups/ref_hms_with_ai_chatbot.html`)

The AI assistant is a normal **window** (own dock tab "Asisten AI", violet identity) that docks to the
right of the patient window (≈ 380px; splitter to resize) — Figma Mockups 06–07, Wireframes W7–W8.
Rules (all [Assumption] pending OQ-23…OQ-28 unless marked):

- **Scope = the open patient only.** A context strip always shows who the AI is reading
  (`Konteks: Siti Nurhaliza · 00012346 — hanya pasien ini`); switching patient clears or re-labels the chat.
- **Everything AI-made is labelled** `Draf AI` (pill) and visually distinct (violet), with the note
  "verifikasi dengan rekam medis" — drafts are never styled like record data. [Ref: mockup footers]
- **Cite sources** under each answer (lab 27 Okt, foto toraks 26 Okt…) with links that open the
  source window (`Lihat hasil lab`, `Lihat radiologi`). [Ref: demo reply says "cite source records"]
- **No silent writes.** `Masukkan ke RM` (insert SOAP into the record) and `Buat order` are
  **disabled in Phase 1** (read-side only) and, once enabled, need explicit clinician review +
  e-signature/authorship; AI text is attributed as AI-assisted. [Reg: rule 3; OQ-25]
- **States to design every time:** first-use (what it can/can't do + example prompts), loading
  (skeleton + sources being read + *Hentikan*), error/unavailable (what happened, *no data was sent*,
  retry / continue without AI, reference code), offline, no-permission.
- **Composer:** attachments and voice input are PHI vectors — keep visible but gated (OQ-27). Quick
  action chips are *prompts*, not commands.
- **Language:** answers follow the language of the clinician's question (decided, OQ-38); chrome follows the UI locale.
- **Interruptions:** the AI never pops up by itself or blocks a task; no AI-generated alerts in Phase 1.
- **Content in mockups is synthetic and must be consistent** with the other windows (the reference's AI
  text says WBC/CRP elevated while its lab window shows normal leukocytes — OQ-29). Never ship a mockup
  whose AI answer contradicts the record next to it.
- **Privacy/regulation:** patient context sent to an AI processor is PHI sharing → ADR + hospital
  approval before any real integration (root `CLAUDE.md` rule 2); mockups never show a vendor claim.

## 4. PHI-aware UI rules [Reg]

- **Mask by default** NIK, No. BPJS, phone, address, e-mail: `3273••••••••0002`, `0813 •••• 6789`.
  A reveal control (eye) unmasks one field for the session view and **emits an audit event**
  (who, what, when, why). Reason prompt: OQ-08.
- No PHI in URLs, `localStorage`, analytics, screenshots or logs. **Window titles/dock tabs contain
  the No. RM**, so persisted layout state must not store titles (OQ-07).
- Auto-lock after idle (timer visible in the dock as `Kunci 14:32`); lock hides all windows; no
  PHI in the lock screen. Timeout value = hospital decision (OQ-12).
- Mockups, tests and screenshots use **synthetic** data only. The names in `docs/mockups/` are demo data.
- Print/export is an audited action; show a confirmation naming the document and patient.

## 5. Layout, density and content

- **Density levels** (OQ-09): *Nyaman* (default, tokens as in Figma: row 44px) and *Ringkas* (row 32px,
  `space/6` cell padding) for power users. Same tokens, different spacing scale — never smaller text.
- **Cards over free forms** on overview tabs: icon + title + (optional) action, `space/16` padding,
  two columns when width ≥ ~960px, one column below. Clinical-first ordering on narrow widths
  (current encounter → vitals → meds → notes → demographics).
- **Tables:** sticky header, left-align text, right-align money/numbers (tabular figures), status as pill
  with text, row hover/selection = `color/bg/selected`, keyboard row navigation, empty/loading/error rows.
- **Forms (later phases):** single column, labels above (or 112px label column in read views),
  inline validation on blur, required marked with text "wajib", never placeholder-as-label.
- **Tabs inside a window:** ≤ 7 visible, rest in an overflow menu; keep the Khanza order
  (Ringkasan, Rekam Medis, Kunjungan, Order, Hasil, Obat, Tindakan, Tagihan, Dokumen, Rencana Perawatan, Rujukan) until research says otherwise (OQ-17).
- **States:** every window needs loading (skeleton, not spinner-only), empty (say what to do),
  error (what happened, retry, correlation id), offline/stale-data and no-permission states.
- **Copy & languages:** English is the default and source language (since 2026-10-28); **Bahasa Indonesia (`id`) is a fully supported second locale** (ADR-0003 Amendments 1 and 3). Plain wording consistent
  with the glossary (SEP, rawat inap, DPJP…) and an EN term per entry; verbs for buttons ("Simpan"/"Save", "Cetak"/"Print"); no exclamation marks; units after values;
  all strings via i18n message IDs (never concatenate sentences — use ICU placeholders/plurals). Language switcher in the top-bar user menu (and lock screen); preference saved per browser. English covers UI text only. EN reference frames: Figma Mockups `EN ·` (Home, Patient Detail, Detail + AI). Design every screen so text can
  grow ~30–40% (pseudo-locale test); no text baked into images/icons. Backend data (names, notes, diagnoses as stored) and legal/clinical documents are not translated (OQ-34).
- **Formats (per locale):** id: `27 Okt 2026`, `Rp1.170.000`, `37,8 °C` · en: `27 Oct 2026`, `Rp1,170,000`, `37.8 °C`; both 24-h time, zone Asia/Jakarta, money integer Rupiah.

## 6. Keyboard & input (proposed — shortcut set is OQ-19)

| Action | Proposal | Note |
|---|---|---|
| Global search / palette | `Ctrl+K` | Must `preventDefault` (browser may use it) |
| Open module N | `Alt+1…4` | Check browser/OS conflicts |
| Switch window | `Ctrl+Tab`-like is **reserved by the browser** → use `Alt+↑/↓` or `Ctrl+Alt+←/→` | TBD |
| Close window | **`Ctrl+W` cannot be overridden in a normal browser tab** | Needs another key or installed-app/kiosk mode (OQ-19) |
| Open result in new window | `Ctrl+Enter` | |
| Tables | `↑/↓` row, `Enter` open, `Home/End` | |
| Escape | Closes palette/menu, never closes a window | |

Visible focus ring everywhere; all pointer actions reachable by keyboard; hit targets ≥ 36px desktop,
≥ 44px in touch mode (`size/control-lg`). Don't rely on hover-only affordances.

## 7. Accessibility baseline [Assumption: WCAG 2.1 AA — OQ-11]

Contrast per `design-tokens` table; text ≥ 12px; zoom to 200% without losing content; colour never the
only signal; semantic landmarks (`banner`, `navigation` = dock, `main`, windows = `dialog`/`region`
with accessible names containing the patient identifier); focus trap only in modal dialogs; announce
window open/close/focus changes politely; respect `prefers-reduced-motion` (window open/minimise
animation ≤ 150 ms, none when reduced).

## 8. Research workflow (use this when asked to "research" or when a UX choice is uncertain)

1. **Frame the question** ("Does limiting to N open patient charts reduce wrong-patient actions?").
2. **Check `design/hms_web-frontend-UIUX/web-workspace/open-questions.md` and `references/research-notes.md`** — don't redo research; extend it.
3. **Search, prefer primary sources** (peer-reviewed studies, AHRQ/ONC/Kemenkes/WHO docs, regulator texts)
   over vendor blogs. Record URL, year, setting, sample size. Search tools are US-skewed: add Indonesian
   queries (`SIMRS`, `rekam medis elektronik`, `Permenkes`) and note that Indonesian evidence may be thin.
4. **Grade the evidence**: *Strong* (RCT/systematic review, comparable setting) · *Moderate* (observational/
   guideline consensus) · *Weak* (single small study, trade press, vendor, expert opinion). Say so in the note.
5. **Separate finding from decision.** A finding goes in the research notes; a *design decision* needs
   either user approval or a documented rationale. If evidence is weak or setting-specific, **add an open
   question with a recommended default** instead of silently deciding.
6. **Never put PHI in research artefacts** (no real screenshots, recordings, or prompts with patient data).
   Usability sessions use synthetic charts; recruiting/consent/ethics = hospital decision (OQ-17).
7. **Validate locally.** Hospital context beats literature: propose a small test (5–8 users per role,
   task-based, SUS + time-on-task + error count) using a Figma prototype before building.

## 9. Review checklist (run before calling a screen done)

- [ ] Uses only tokens (no literals); text/background pairs pass AA; text ≥ 12px.
- [ ] Patient identity visible in title bar, dock tab and header; allergies visible.
- [ ] PHI masked by default; reveal is audited; nothing PHI in URL/storage/logs.
- [ ] Works as: single window · tiled with 2 others · minimised-and-restored · at 360px min window width.
- [ ] Clear-space rules respected; ≤ 1 primary action; empty/loading/error/no-permission states exist.
- [ ] Keyboard path for every action; focus visible; no shortcut conflicts (OQ-19).
- [ ] Write actions disabled with reason while domain is read-only.
- [ ] Copy exists in `id` and `en` message catalogs (no literals); layout survives the pseudo-locale; formats follow section 5 per locale.
- [ ] Anything uncertain is logged in `design/hms_web-frontend-UIUX/web-workspace/open-questions.md` with a recommended default.

## 10. Working with Figma on this project

File: https://www.figma.com/design/yo53y0sVdqxaKNjZquWNom. Pages: Cover · Design Tokens · Components ·
Wireframes (W1–W8) · Mockups (01–07) · Brand (logo component). Rules: build screens from the Components page (instances), bind
fills/strokes/padding/radius to variables, use text/effect styles, name frames `NN Title`, and update the
Cover page + `design-tokens` skill when tokens or components change. Load the Figma `figma-use` skill
before any `use_figma` call. Don't edit `docs/mockups/` — copy instead.
