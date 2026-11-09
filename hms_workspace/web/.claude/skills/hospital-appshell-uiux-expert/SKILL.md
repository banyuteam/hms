---
name: hospital-appshell-uiux-expert
description: Expert UI/UX guidance and research workflow for the HMS hospital web workspace (multi-window desktop-style UI, bottom dock, clear-space layout, patient-safety and PHI-aware design). Use whenever you design, review, wireframe or build a screen/window/flow for the web workspace (hms_workspace/web), choose between UX options, write UI copy, or need to research hospital-user needs. Pairs with the design-tokens skill for values.
---

# Hospital UI/UX expert (HMS web workspace)

Role: act as a senior healthcare UX designer for **hospital staff** using a web replacement of the
SIMRS Khanza desktop app. Optimise for **safety, speed of repeat tasks, and calm** — in that order.
Read first: root `CLAUDE.md`, `hms_workspace/CLAUDE.md`, `hms_workspace/web/CLAUDE.md`
and the **design-tokens** skill. Visual source: the Figma file linked from `design-tokens/SKILL.md`.

> Evidence labels used below: **[Ref]** the original reference mockup (not held in this workspace) · **[Req]** the user's stated
> preference · **[Reg]** regulation/rule in a `CLAUDE.md` (cited by section) · **[Res]** published research (summarised in
> `references/research-notes.md`, with strength) · **[Assumption]** my judgement, needs validation
> (tracked as an open question). Never present an [Assumption] as a fact.

## 1. Users & context (assumptions until the requirements are approved)

| Role | Main windows | What they need from the UI |
|---|---|---|
| Registration / admission clerk | Patient Management, Patient Detail | Fast search by name/MRN, accurate identity, few clicks |
| Nurse | Patient Detail (vitals, notes, meds) | At-a-glance status, bedside speed, minimal typing, glanceable alerts |
| Physician (DPJP) | Patient Detail, Results, Radiology | Longitudinal view, results with trends, no hunting between screens |
| Lab / radiology staff | Results, Radiology viewer | Queue + result entry (later), image viewer |
| Billing / cashier / finance | Billing & Insurance | Itemised charges, coverage vs patient share, exact Rupiah |
| Medical-records / claims staff | Documents, claim-assistant (later) | Completeness of record, e-sign status, claim risks |

Context facts: shared workstations, interruptions, mixed IT skill, Khanza muscle memory (dense,
keyboard-driven), 24-hour shifts (glare/night), Windows PCs likely [Assumption — a screen inventory is
an open question], Indonesian-language UI [Reg: `CLAUDE.md` §8].

## 2. The workspace model (what the user asked for) [Req]

1. **Workspace-style windows** — floating, draggable, resizable windows on a calm canvas; several
   can be open (multi-window). Each module is a window; one window is focused.
2. **Tabs at the bottom (dock)** — one dock tab per open window, plus a permanent *Beranda* tab and
   a `+` launcher. Click = focus/restore; the tab of a minimised window stays. Dock is the only
   place that lists open windows, so users never "lose" a window.
3. **Clear space** — the canvas stays mostly empty so the user is not overwhelmed. Concretely
   (**numbers** are [Assumption] to validate):
   - window-to-edge margin ≥ `space/24`, gap between windows ≥ `space/16`;
   - the empty workspace (*Beranda*) shows only: greeting, 6 launch tiles, 3 recent items;
   - at most **4 tiled windows** (product decision 2026-10-28; replaces the earlier 3-window guideline; implemented in `src/features/workspace/geometry.ts`); when the shell is too small to tile, show only the most recently used window
     instead of shrinking everything (extra windows stay open in the dock);
   - windows open at a **comfortable** size, not maximised; content scrolls inside the window;
   - progressive disclosure: summary first, detail on demand; collapse rarely used cards;
   - one primary action per window; secondary actions are ghost/secondary buttons.
3b. **Ruang Fokus (focus/rest area)** — decided: a dedicated calm view (Figma Mockup 08, Wireframe W9) with the hospital-ambience wallpaper,
   big clock/date, optional 5-minute break timer and *Kunci layar*. Windows are **hidden, not closed**; no patient data is shown; Esc/click returns to the
   exact previous layout. It is not a lock: auto-lock keeps running. Entry/idle behaviour: open question. The wallpaper also sits (under an 80% scrim) behind the whole
   workspace — never place text directly on it; use windows, cards or the scrim.
4. **Snap / tile layouts** — Single, 1+1, 1+2, 2×2 from a picker in the dock, or drag to a screen edge.
5. **Keyboard-first** [Reg: `CLAUDE.md` §4, §10] — see section 7.

Window anatomy and states: see Figma pages *Wireframes → W1* and *Components → Window Titlebar / Dock Tab*.

## 3. Electronic Medical Records (highest priority)

Detailed EMR data requirements and workflows are not yet specified in this workspace (open question); until they are, apply the rules in this skill to EMR windows. The electronic medical records will be most important and very basic information that will be use across non-clinical and clinical users. This part will later combined with chatbot and AI assistant features.

## 4. AI chatbot

The AI assistant is a normal **window** (own dock tab "Asisten AI", violet identity) that docks to the
right of the patient window (≈ 380px; splitter to resize) — Figma Mockups 06–07, Wireframes W7–W8.
Rules (all [Assumption], still open questions, unless marked):

- **Scope = the open patient only.** A context strip always shows who the AI is reading
  (`Konteks: Siti Nurhaliza · 00012346 — hanya pasien ini`); switching patient clears or re-labels the chat.
- **Everything AI-made is labelled** `Draf AI` (pill) and visually distinct (violet), with the note
  "verifikasi dengan rekam medis" — drafts are never styled like record data. [Ref: footers]
- **Cite sources** under each answer (lab 27 Okt, foto toraks 26 Okt…) with links that open the
  source window (`Lihat hasil lab`, `Lihat radiologi`). [Ref: demo reply says "cite source records"]
- **No silent writes.** `Masukkan ke RM` (insert SOAP into the record) and `Buat order` are
  **disabled in Phase 1** (read-side only) and, once enabled, need explicit clinician review +
  e-signature/authorship; AI text is attributed as AI-assisted. [Reg: root `CLAUDE.md` §6]
- **States to design every time:** first-use (what it can/can't do + example prompts), loading
  (skeleton + sources being read + *Hentikan*), error/unavailable (what happened, *no data was sent*,
  retry / continue without AI, reference code), offline, no-permission.
- **Composer:** attachments and voice input are PHI vectors — keep visible but gated (open question). Quick
  action chips are *prompts*, not commands.
- **Language:** answers follow the language of the clinician's question (decided); chrome follows the UI locale.
- **Interruptions:** the AI never pops up by itself or blocks a task; no AI-generated alerts in Phase 1.
- **Content in mockups is synthetic and must be consistent** with the other windows (the reference mockup's AI
  text says WBC/CRP elevated while its lab window shows normal leukocytes). Never ship a mockup
  whose AI answer contradicts the record next to it.
- **Privacy/regulation:** patient context sent to an AI processor is PHI sharing → ADR + hospital
  approval before any real integration (root `CLAUDE.md` §6, §9, §11); mockups never show a vendor claim.

## 5. PHI-aware UI rules [Reg]

- **Mask by default** NIK, No. BPJS, phone, address, e-mail: `3273••••••••0002`, `0813 •••• 6789`.
  A reveal control (eye) unmasks one field for the session view and **emits an audit event**
  (who, what, when, why). Reason prompt: open question.
- No PHI in URLs, `localStorage`, analytics, screenshots or logs. **Window titles/dock tabs contain
  the No. RM**, so layout state must never be persisted with titles (`CLAUDE.md` §5: appshell state is not persisted at all).
- Auto-lock after idle (timer visible in the dock as `Kunci 14:32`); lock hides all windows; no
  PHI in the lock screen. Timeout value = hospital decision.
- Mockups, tests and screenshots use **synthetic** data only. Names in mockups and fixtures are demo data.
- Print/export is an audited action; show a confirmation naming the document and patient.

## 6. Layout, density and content

- **Density levels** [Assumption]: *Nyaman* (default, tokens as in Figma: row 44px) and *Ringkas* (row 32px,
  `space/6` cell padding) for power users. Same tokens, different spacing scale — never smaller text.
- **Cards over free forms** on overview tabs: icon + title + (optional) action, `space/16` padding,
  two columns when width ≥ ~960px, one column below. Clinical-first ordering on narrow widths
  (current encounter → vitals → meds → notes → demographics).
- **Tables:** sticky header, left-align text, right-align money/numbers (tabular figures), status as pill
  with text, row hover/selection = `color/bg/selected`, keyboard row navigation, empty/loading/error rows.
- **Forms (later phases):** single column, labels above (or 112px label column in read views),
  inline validation on blur, required marked with text "wajib", never placeholder-as-label.
- **Tabs inside a window:** ≤ 7 visible, rest in an overflow menu; keep the Khanza order
  (Ringkasan, Rekam Medis, Kunjungan, Order, Hasil, Obat, Tindakan, Tagihan, Dokumen, Rencana Perawatan, Rujukan) until research says otherwise.
- **States:** every window needs loading (skeleton, not spinner-only), empty (say what to do),
  error (what happened, retry, correlation id), offline/stale-data and no-permission states.
- **Copy & languages:** **Bahasa Indonesia (`id`) is the default locale** and English (`en`) is a fully supported second locale (`docs/adr/0001-replatform-react18-tailwind3.md`, Consequences). Plain wording consistent
  with the glossary (SEP, rawat inap, DPJP…) and an EN term per entry; verbs for buttons ("Simpan"/"Save", "Cetak"/"Print"); no exclamation marks; units after values;
  all strings via i18n message IDs (never concatenate sentences — use ICU placeholders/plurals). Language switcher in the top-bar user menu (and lock screen); preference saved per browser. English covers UI text only. EN reference frames: Figma Mockups `EN ·` (Home, Patient Detail, Detail + AI). Design every screen so text can
  grow ~30–40% (pseudo-locale test); no text baked into images/icons. Backend data (names, notes, diagnoses as stored) and legal/clinical documents are not translated [Assumption].
- **Formats (per locale):** id: `27 Okt 2026`, `Rp1.170.000`, `37,8 °C` · en: `27 Oct 2026`, `Rp1,170,000`, `37.8 °C`; both 24-h time, zone Asia/Jakarta, money integer Rupiah.

## 7. Keyboard & input (proposed — the shortcut set is an open question)

| Action | Proposal | Note |
|---|---|---|
| Global search / palette | `Ctrl+K` | Must `preventDefault` (browser may use it) |
| Open module N | `Alt+1…4` | Check browser/OS conflicts |
| Switch window | `Ctrl+Tab`-like is **reserved by the browser** → use `Alt+↑/↓` or `Ctrl+Alt+←/→` | TBD |
| Close window | **`Ctrl+W` cannot be overridden in a normal browser tab** | Needs another key or installed-app/kiosk mode |
| Open result in new window | `Ctrl+Enter` | |
| Tables | `↑/↓` row, `Enter` open, `Home/End` | |
| Escape | Closes palette/menu, never closes a window | |

Visible focus ring everywhere; all pointer actions reachable by keyboard; hit targets ≥ 36px desktop,
≥ 44px in touch mode (`size/control-lg`). Don't rely on hover-only affordances.

## 8. Accessibility baseline [Assumption: WCAG 2.1 AA]

Contrast per `design-tokens` table; text ≥ 12px; zoom to 200% without losing content; colour never the
only signal; semantic landmarks (`banner`, `navigation` = dock, `main`, windows = `dialog`/`region`
with accessible names containing the patient identifier); focus trap only in modal dialogs; announce
window open/close/focus changes politely; respect `prefers-reduced-motion` (window open/minimise
animation ≤ 150 ms, none when reduced).

## 9. Research workflow (use this when asked to "research" or when a UX choice is uncertain)

1. **Frame the question** ("Does limiting to N open patient charts reduce wrong-patient actions?").
2. **Check `references/research-notes.md` and the open questions marked in this skill** — don't redo research; extend it.
3. **Search, prefer primary sources** (peer-reviewed studies, AHRQ/ONC/Kemenkes/WHO docs, regulator texts)
   over vendor blogs. Record URL, year, setting, sample size. Search tools are US-skewed: add Indonesian
   queries (`SIMRS`, `rekam medis elektronik`, `Permenkes`) and note that Indonesian evidence may be thin.
4. **Grade the evidence**: *Strong* (RCT/systematic review, comparable setting) · *Moderate* (observational/
   guideline consensus) · *Weak* (single small study, trade press, vendor, expert opinion). Say so in the note.
5. **Separate finding from decision.** A finding goes in the research notes; a *design decision* needs
   either user approval or a documented rationale. If evidence is weak or setting-specific, **add an open
   question with a recommended default** instead of silently deciding.
6. **Never put PHI in research artefacts** (no real screenshots, recordings, or prompts with patient data).
   Usability sessions use synthetic charts; recruiting/consent/ethics = hospital decision.
7. **Validate locally.** Hospital context beats literature: propose a small test (5–8 users per role,
   task-based, SUS + time-on-task + error count) using a Figma prototype before building.

## 10. Review checklist (run before calling a screen done)

- [ ] Uses only tokens (no literals); text/background pairs pass AA; text ≥ 12px.
- [ ] Patient identity visible in title bar, dock tab and header; allergies visible.
- [ ] PHI masked by default; reveal is audited; nothing PHI in URL/storage/logs.
- [ ] Works as: single window · tiled (up to 4 windows) · minimised-and-restored · at 360px min window width.
- [ ] Clear-space rules respected; ≤ 1 primary action; empty/loading/error/no-permission states exist.
- [ ] Keyboard path for every action; focus visible; no shortcut conflicts.
- [ ] Write actions disabled with reason while domain is read-only.
- [ ] Copy exists in `id` and `en` message catalogs (no literals); layout survives the pseudo-locale; formats follow section 6 per locale.
- [ ] Anything uncertain is visibly marked as an open question ([Assumption]) with a recommended default.

## 11. Working with Figma on this project

File: https://www.figma.com/design/yo53y0sVdqxaKNjZquWNom. Pages: Cover · Design Tokens · Components ·
Wireframes (W1–W8) · Mockups (01–07) · Brand (logo component). Rules: build screens from the Components page (instances), bind
fills/strokes/padding/radius to variables, use text/effect styles, name frames `NN Title`, and update the
Cover page + `design-tokens` skill when tokens or components change. Load the Figma `figma-use` skill
before any `use_figma` call. Don't edit the Figma reference mockups — copy instead.