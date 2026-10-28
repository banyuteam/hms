---
name: design-tokens
description: HMS web-frontend design tokens (colour, type, spacing, radius, size, elevation) and the rules for using them. Use whenever you write or review UI code, CSS, a component, a Figma frame, or a mockup for source/web-frontend, or when a colour/size/spacing value is about to be hard-coded or a new token is proposed.
---

# HMS design tokens

Single vocabulary for the web workspace. Values are **derived from the reference mockup**
(`docs/mockups/hospital-patient-workspace.html`) and normalised so every value is on a scale
and every text/background pair passes WCAG 2.1 AA. The Figma file is the visual source of truth;
`references/tokens.json` (W3C DTCG) and `references/tokens.css` are the machine-readable copies.

- **Figma:** https://www.figma.com/design/yo53y0sVdqxaKNjZquWNom (pages: Cover · Design Tokens · Components · Wireframes · Mockups)
- **Status:** Draft v0.1, 2026-10-28 — Light mode only. Pending user approval together with `design/web-frontend/PRD.md`.
- **Stack:** React + TypeScript + Vite (ADR-0002). **Font, component library, CSS approach, dark mode** are *not* decided — see
  `design/web-frontend/open-questions.md` (OQ-05, OQ-01, OQ-06). Tokens stay framework-agnostic CSS custom properties.

**In code:** `source/web-frontend/src/styles/tokens.css` is a copy of `references/tokens.css` plus the workspace background variables; when tokens change, update Figma → `references/tokens.json`/`tokens.css` → `src/styles/tokens.css` (and run the app + tests).

## Rules (non-negotiable)

1. **Never hard-code** a hex colour, px spacing, radius, font size or shadow in component code
   or Figma. Use a token. If none fits, propose one (see "Changing tokens") — don't invent a literal.
2. **Components bind to semantic tokens** (`color/bg/surface`), never to primitives
   (`slate/0`). Primitives exist only to define semantic tokens.
3. **Colour is never the only signal.** Status pills, abnormal values and the allergy banner
   always carry text (and an arrow/icon where it helps). Danger/success/warning text uses the
   `-fg` token, never the `-icon` token.
4. **Text tokens on text only.** `color/text/*` for text and icons-that-are-text; `color/action/accent`
   and `color/status/*-icon` are for non-text marks (indicator bars, chips, dots) where 3:1 is enough.
5. **Minimum text size 12px** (`text/caption`). 11px (`text/overline`) is allowed only for
   UPPERCASE group headings. The reference mockup's 10px text is not carried over.
6. **4-pt spacing scale only**; no 5/7/9/10/13/15/22 px values like the reference.
7. **Focus is always visible**: 2px `color/border/focus` outline, 2px offset, on every interactive element.
8. Money is integer Rupiah formatted `Rp1.170.000`; decimals use a comma (`37,8 °C`); dates
   `27 Okt 2026`, times 24 h, zone Asia/Jakarta (storage UTC) — formatting is a UI concern, not a token.

## Architecture

Figma variable collections → CSS custom properties (prefix `--hms-`):

| Collection | Modes | Contents |
|---|---|---|
| `Primitives` | Value | Raw palette `slate`, `blue`, `red`, `green`, `amber`, `violet` (AI) — scopes none (hidden) |
| `Color` | Light | Semantic aliases `color/{role}/{variant}` → primitives (roles: bg, border, text, action, status, **ai**) |
| `Space` | Value | `space/{px}` |
| `Radius` | Value | `radius/{sm|md|lg|full}` |
| `Size` | Value | Fixed chrome sizes (`size/topbar`, `size/dock`, …) |
| Text styles | — | `text/*` (Figma styles; fontSize/lineHeight can't be variables in Figma) |
| Effect styles | — | `shadow/*` |

CSS name = Figma name with `/` → `-`, prefixed `--hms-` (e.g. `color/bg/canvas` → `--hms-color-bg-canvas`).
Figma `codeSyntax.WEB` is set to the same `var(--hms-…)` string on every variable.

## Primitives

| Token | Hex | CSS variable |
|---|---|---|
| `slate/0` | `#FFFFFF` | `--hms-slate-0` |
| `slate/25` | `#F7FBFF` | `--hms-slate-25` |
| `slate/50` | `#F4F9FF` | `--hms-slate-50` |
| `slate/100` | `#E7F1FB` | `--hms-slate-100` |
| `slate/200` | `#DCE8F7` | `--hms-slate-200` |
| `slate/300` | `#CBDFF5` | `--hms-slate-300` |
| `slate/400` | `#8FA3C0` | `--hms-slate-400` |
| `slate/500` | `#51688F` | `--hms-slate-500` |
| `slate/600` | `#405A7E` | `--hms-slate-600` |
| `slate/700` | `#2A4468` | `--hms-slate-700` |
| `slate/800` | `#143052` | `--hms-slate-800` |
| `slate/900` | `#132847` | `--hms-slate-900` |
| `slate/950` | `#111E2E` | `--hms-slate-950` |
| `blue/50` | `#E4F1FF` | `--hms-blue-50` |
| `blue/100` | `#CFE5FD` | `--hms-blue-100` |
| `blue/200` | `#B6D5F8` | `--hms-blue-200` |
| `blue/500` | `#0878F9` | `--hms-blue-500` |
| `blue/600` | `#0A62C9` | `--hms-blue-600` |
| `blue/700` | `#084FA3` | `--hms-blue-700` |
| `red/50` | `#FFE6E8` | `--hms-red-50` |
| `red/500` | `#E24852` | `--hms-red-500` |
| `red/700` | `#C0283A` | `--hms-red-700` |
| `green/50` | `#E0F8ED` | `--hms-green-50` |
| `green/500` | `#089563` | `--hms-green-500` |
| `green/700` | `#067A52` | `--hms-green-700` |
| `amber/50` | `#FFF1DC` | `--hms-amber-50` |
| `amber/500` | `#DF7C16` | `--hms-amber-500` |
| `amber/700` | `#9A5204` | `--hms-amber-700` |
| `violet/50` | `#F1F0FE` | `--hms-violet-50` |
| `violet/100` | `#E0DDFB` | `--hms-violet-100` |
| `violet/500` | `#6B65F7` | `--hms-violet-500` |
| `violet/600` | `#5A53E8` | `--hms-violet-600` |
| `violet/700` | `#4F46D8` | `--hms-violet-700` |

## Semantic colour (collection `Color`, mode `Light`)

| Token (Figma) | Alias → value | CSS variable | Use |
|---|---|---|---|
| `color/bg/canvas` | `slate/100` → `#E7F1FB` | `--hms-color-bg-canvas` | Workspace background behind windows |
| `color/bg/surface` | `slate/0` → `#FFFFFF` | `--hms-color-bg-surface` | Windows, cards, inputs, top bar |
| `color/bg/surface-subtle` | `slate/50` → `#F4F9FF` | `--hms-color-bg-surface-subtle` | Table headers, inactive title bars, footers |
| `color/bg/dock` | `slate/25` → `#F7FBFF` | `--hms-color-bg-dock` | Bottom dock |
| `color/bg/selected` | `blue/50` → `#E4F1FF` | `--hms-color-bg-selected` | Active nav item, selected row, active dock tab |
| `color/bg/hover` | `slate/50` → `#F4F9FF` | `--hms-color-bg-hover` | Hover and disabled-control background |
| `color/bg/viewer` | `slate/950` → `#111E2E` | `--hms-color-bg-viewer` | Radiology viewer canvas (dark) |
| `color/bg/toast` | `slate/800` → `#143052` | `--hms-color-bg-toast` | Toast / snackbar |
| `color/border/subtle` | `slate/200` → `#DCE8F7` | `--hms-color-border-subtle` | Dividers, card borders, table rules |
| `color/border/default` | `slate/300` → `#CBDFF5` | `--hms-color-border-default` | Window and input borders |
| `color/border/selected` | `blue/200` → `#B6D5F8` | `--hms-color-border-selected` | Active dock tab / selected-item border |
| `color/border/focus` | `blue/500` → `#0878F9` | `--hms-color-border-focus` | Keyboard focus ring (2px + 2px offset) |
| `color/text/primary` | `slate/900` → `#132847` | `--hms-color-text-primary` | Body text, values |
| `color/text/secondary` | `slate/600` → `#405A7E` | `--hms-color-text-secondary` | Labels, secondary buttons |
| `color/text/muted` | `slate/500` → `#51688F` | `--hms-color-text-muted` | Captions, field labels (≥4.5:1 on canvas) |
| `color/text/disabled` | `slate/400` → `#8FA3C0` | `--hms-color-text-disabled` | Disabled text only (exempt from AA) |
| `color/text/on-action` | `slate/0` → `#FFFFFF` | `--hms-color-text-on-action` | Text on action/primary |
| `color/text/link` | `blue/600` → `#0A62C9` | `--hms-color-text-link` | Links, active tab/nav text |
| `color/action/primary` | `blue/600` → `#0A62C9` | `--hms-color-action-primary` | Primary button fill |
| `color/action/primary-hover` | `blue/700` → `#084FA3` | `--hms-color-action-primary-hover` | Primary button hover/pressed |
| `color/action/accent` | `blue/500` → `#0878F9` | `--hms-color-action-accent` | Non-text accent: tab indicator, chips, icon fills |
| `color/status/danger-bg` | `red/50` → `#FFE6E8` | `--hms-color-status-danger-bg` | Danger pill / allergy banner background |
| `color/status/danger-fg` | `red/700` → `#C0283A` | `--hms-color-status-danger-fg` | Danger text & icons |
| `color/status/danger-icon` | `red/500` → `#E24852` | `--hms-color-status-danger-icon` | Danger non-text marks |
| `color/status/success-bg` | `green/50` → `#E0F8ED` | `--hms-color-status-success-bg` | Success pill background |
| `color/status/success-fg` | `green/700` → `#067A52` | `--hms-color-status-success-fg` | Success text & icons |
| `color/status/success-icon` | `green/500` → `#089563` | `--hms-color-status-success-icon` | Success non-text marks |
| `color/status/warning-bg` | `amber/50` → `#FFF1DC` | `--hms-color-status-warning-bg` | Warning pill background |
| `color/status/warning-fg` | `amber/700` → `#9A5204` | `--hms-color-status-warning-fg` | Warning text & icons |
| `color/status/warning-icon` | `amber/500` → `#DF7C16` | `--hms-color-status-warning-icon` | Warning non-text marks |
| `color/status/info-bg` | `blue/50` → `#E4F1FF` | `--hms-color-status-info-bg` | Info pill background |
| `color/status/info-fg` | `blue/600` → `#0A62C9` | `--hms-color-status-info-fg` | Info text & icons |
| `color/ai/bg` | `violet/50` → `#F1F0FE` | `--hms-color-ai-bg` | AI assistant surfaces: bubbles, context strip, AI pill |
| `color/ai/border` | `violet/100` → `#E0DDFB` | `--hms-color-ai-border` | AI bubble / chip / window outline |
| `color/ai/solid` | `violet/600` → `#5A53E8` | `--hms-color-ai-solid` | AI avatar & solid fills (white icon ≥4.5:1) |
| `color/ai/accent` | `violet/500` → `#6B65F7` | `--hms-color-ai-accent` | AI non-text accent only (white on it = 4.35:1) |
| `color/ai/fg` | `violet/700` → `#4F46D8` | `--hms-color-ai-fg` | AI text & icons on ai/bg or surface |

### Contrast (WCAG 2.1 AA — 4.5:1 text, 3:1 large text / UI)

| Pair | Ratio | Result |
|---|---|---|
| `text/primary` on `bg/surface` | 14.77 | ✔ |
| `text/secondary` on `bg/surface` | 7.04 | ✔ |
| `text/muted` on `bg/surface` / `bg/canvas` | 5.64 / 4.93 | ✔ |
| `text/link` on `bg/surface` / `bg/selected` | 5.83 / 5.09 | ✔ |
| `text/on-action` on `action/primary` | 5.83 | ✔ |
| `status/danger-fg` on `status/danger-bg` | 4.92 | ✔ |
| `status/success-fg` on `status/success-bg` | 4.81 | ✔ |
| `status/warning-fg` on `status/warning-bg` | 5.27 | ✔ |
| `status/info-fg` on `status/info-bg` | 5.09 | ✔ |
| `ai/fg` on `ai/bg` / `bg/surface` | 5.82 / 6.56 | ✔ |
| `text/on-action` on `ai/solid` | 5.47 | ✔ |
| `text/disabled` on `bg/surface` | 2.57 | ✘ allowed — disabled controls are exempt, but never use for information |

Re-check whenever a colour changes (see "Changing tokens").

### What changed from the reference mockup (and why)

| Reference | Here | Why |
|---|---|---|
| `--b:#0878f9` as text/button fill | `action/primary` = `blue/600` `#0A62C9`; `#0878F9` kept as `action/accent` | `#0878F9` on white = 4.15:1 (fails AA for 13px text and for white-on-blue buttons) |
| `--muted:#60769b` | `text/muted` = `#51688F` | `#60769B` on canvas `#E7F1FB` = 4.03:1 |
| `--ink:#132847` | `text/primary` (unchanged) | 14.77:1 |
| `--line:#dce8f7` | `border/subtle` (unchanged) | — |
| window border `#cbdff5` | `border/default` | — |
| red `#e24852` / `#bd3444`, green `#089563` / `#078f60`, orange `#df7c16` as text | `*-fg` = `#C0283A` / `#067A52` / `#9A5204`; originals kept as `*-icon` | 3.98 / 3.83 / 2.99:1 on white |
| `--shadow:0 8px 24px #244d7a2b` | `shadow/window` | unchanged |
| 10–11px text, 5–22px ad-hoc spacing, 5–11px radii | 12px min, 4-pt scale, `radius/sm|md|lg` | density & consistency |

### AI identity colour

Violet marks everything produced by the AI assistant (avatar, bubbles, "Draf AI" pill, context strip) so users can tell machine drafts from record data at a glance. It is **not** a status colour: never use `ai/*` for success/warning/error, and never use it for clinician-authored content. Adapted from the reference's `#6b65f7`, which is 4.35:1 with white — so solid fills use `violet/600`, text uses `violet/700`, and `violet/500` stays non-text.

### Wallpaper, scrim and glass (workspace background)

`assets/brand/wallpaper-calm-hospital.jpg` (1264×848, AI-generated with Figma AI on 2026-10-28; replace with a hospital photo if supplied — OQ-41).
Layers behind the workspace: **Wallpaper** (image, fill) + **scrim** = `color/bg/canvas` at **80%** opacity (keeps text on the canvas AA and windows unchanged).
Ruang Fokus uses a lighter scrim (`color/bg/canvas` @ **25%**) and a *glass* panel: white @ 62% fill + 1px white @ 80% stroke + background blur 24px + `shadow/window`
(CSS: `backdrop-filter: blur(24px)`; provide a solid `color/bg/surface` fallback). Opacity-based layers are not tokens yet — implement as CSS custom properties
`--hms-wallpaper-scrim: 0.8`, `--hms-focus-scrim: 0.25`, `--hms-glass-bg: rgb(255 255 255 / .62)`. Never put text directly on the wallpaper below AA: only on scrim, windows or the glass panel.
`text/display` (64/72, Regular, -1px tracking) is used only for the Ruang Fokus clock.

### Logo (brand asset, not a token)

`Logo` component (Figma page *Brand*): `Type=Mark` (`assets/brand/logo-mark.jpg`, white background, 40px in the top bar)
and `Type=App icon` (`assets/brand/logo-app-icon.jpg`, green background, radius/md). Min size 24px, never recolour/stretch,
put it on a white box when the canvas is coloured. The logo is dark green — **do not use brand green as a UI colour token**
(green is reserved for `status/success-*`; OQ-31). Files are low-res JPGs pending vectors (OQ-32).

## Space

| Token | px |
|---|---|
| `space/2` | 2 |
| `space/4` | 4 |
| `space/6` | 6 |
| `space/8` | 8 |
| `space/12` | 12 |
| `space/16` | 16 |
| `space/20` | 20 |
| `space/24` | 24 |
| `space/32` | 32 |
| `space/48` | 48 |
| `space/64` | 64 |

Layout conventions built from these: card padding `space/16`; window content padding `space/24`;
gap between cards `space/16`; **gap between windows ≥ `space/16`**; **window-to-edge margin ≥ `space/24`**
(the "clear-space" rule); toolbar padding `space/16`; table cell padding `space/12`/`space/16`
(row height 44, dense 32).

## Radius

| Token | px | Use |
|---|---|---|
| `radius/sm` | 4 | Pills, keycaps, icon chips |
| `radius/md` | 8 | Buttons, inputs, cards, dock tabs |
| `radius/lg` | 12 | Windows, tiles, popovers |
| `radius/full` | 999 | Avatars, badges |

## Size

| Token | px | Use |
|---|---|---|
| `size/topbar` | 64 | Top bar height |
| `size/dock` | 56 | Bottom dock height |
| `size/titlebar` | 40 | Window title bar |
| `size/dock-tab` | 40 | Dock tab height |
| `size/control` | 36 | Button / icon-button (desktop) |
| `size/control-lg` | 44 | Touch target (tablet / touch mode) |
| `size/icon-sm` | 16 | Inline / title-bar / close icons |
| `size/icon-md` | 20 | Nav, button, input icons |
| `size/icon-lg` | 24 | Icon grid (master size) |
| `size/window-min-width` | 360 | Minimum window width |

Window default / min sizes (workspace layer, not tokens yet — see OQ-09): min width 360, default
focused window 1180×748 on a 1440×900 viewport; tiled windows 752×748 and 624×(360|372).

## Typography

Font stack: `"Segoe UI", Inter, Arial, sans-serif` in CSS (the reference uses Segoe UI/Arial and
hospital Windows PCs ship Segoe UI); Figma uses **Inter** as a stand-in because Segoe UI isn't
available in Figma. Final choice and licensing = OQ-05.

| Style | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `text/title-lg` | 18 / 26 | Semi Bold (600) | 0 | Patient name, page title |
| `text/title-md` | 14 / 20 | Semi Bold (600) | 0 | Window title, section title |
| `text/heading-sm` | 13 / 18 | Semi Bold (600) | 0 | Card heading |
| `text/body` | 13 / 20 | Regular (400) | 0 | Default text |
| `text/body-strong` | 13 / 20 | Semi Bold (600) | 0 | Emphasis, names in lists |
| `text/caption` | 12 / 16 | Regular (400) | 0 | Labels, meta, helper text |
| `text/caption-strong` | 12 / 16 | Semi Bold (600) | 0 | Pill labels, small emphasis |
| `text/overline` | 11 / 16 | Semi Bold (600) | +0.5px, uppercase | UPPERCASE group headings (only place 11px is allowed) |
| `text/data-lg` | 20 / 28 | Semi Bold (600) | 0 | Vital-sign values |

Numerals: use tabular figures (`font-variant-numeric: tabular-nums`) in tables, vitals and money.

## Elevation

| Style | CSS | Use |
|---|---|---|
| `shadow/window` | `0 8px 24px rgba(36,77,122,.17)` | Floating windows |
| `shadow/popover` | `0 12px 32px rgba(36,77,122,.24)` | Command palette, menus, layout picker |
| `shadow/dock` | `0 -2px 8px rgba(36,77,122,.08)` | Bottom dock (upward) |

## Z-order (proposed, not in Figma)

`canvas 0 · window 10–199 (focus bumps to top) · dock 300 · popover 400 · palette/scrim 500 · toast 600`.
Windows never overlap the top bar or the dock.

## Components that consume tokens

`Button` (Primary/Secondary/Ghost × Default/Disabled), `Status Pill` (Neutral/Success/Danger/Warning/Info/AI),
`Dock Tab` (Home|Module × Default|Active), `Window Titlebar` (Focused|Unfocused), `Nav Item`,
`Tab`, `Card Header`, `Field Row` (Masked), `Vital Tile` (Normal/High/Warning), `Search Field`,
`Action Chip` (AI/Neutral/Disabled), `AI Message Bubble` (User/Assistant), `Status Pill` variant `AI`,
`icon/*` (36 icons, 24px grid). See the Figma "Components" page. Build the code design system in the
same order named in `CLAUDE.md` ("tokens, window, dock tab, card, field grid, table, pill, tab bar").

## Changing tokens

1. Propose the change in `design/web-frontend/open-questions.md` or the PR; if it changes brand colour, font or adds a mode, the user decides.
2. Edit the **Figma variable** first (keep scopes and `codeSyntax.WEB`), then `references/tokens.json`,
   then `references/tokens.css`, then the tables in this file. Bump the status line date.
3. Re-check contrast for every text/background pair touched (formula: WCAG relative luminance;
   `ratio = (L1+0.05)/(L2+0.05)`), and record the numbers in the contrast table.
4. Never delete a token that code uses without a migration note; add the new one and deprecate the old.
5. Adding a framework-specific build (Style Dictionary, Tailwind theme, CSS-in-JS) is an architecture
   choice → needs an ADR first (root `CLAUDE.md`, rule 4).

## Using the tokens in code (framework-agnostic example)

```css
.card { background: var(--hms-color-bg-surface); border: 1px solid var(--hms-color-border-subtle);
        border-radius: var(--hms-radius-md); padding: var(--hms-space-16);
        font: 400 var(--hms-text-body-size)/var(--hms-text-body-line) var(--hms-font-base); }
.pill--danger { background: var(--hms-color-status-danger-bg); color: var(--hms-color-status-danger-fg); }
```
