# Window-manager spike — own manager vs `dockview`

- **Date:** 2026-10-28 · **Gate:** ADR-0003 D1 · **Owner:** product owner decides · **Status:** result ready for review
- **Code:** `source/hms_web-frontend-UIUX/web-workspace/spikes/dockview/` (throwaway; own `package.json`, not part of the app build) — `probe.mjs` is the
  repeatable check, `probe-result.json` the raw output (synthetic titles only).
- **Versions:** `dockview-react` 8.7.1 (MIT, depends on `dockview` → `dockview-core`; React 16.8–19 peer), Chrome via Playwright, React 19.3.1.
  Note: in v8 the package named `dockview` is framework-agnostic; the React binding is **`dockview-react`**.

## Method and limits (read first)

I built a small dockview app (two panels tabbed in one group, one floating group), then ran an automated probe in real Chrome against the five
criteria that ADR-0003 names. The "own manager" column is the current skeleton in `src/workspace/`, judged from its code and its existing tests, not
re-measured. **This was hours, not the two days the ADR allowed**, so it is a screen, not a full evaluation. Not tested: custom tab/header
components (to match the Figma *Window Titlebar*), `fromJSON` layout restore, arrow-key navigation inside the tablist, drag-to-dock behaviour, popout
windows, screen readers, behaviour under 3+ floating groups.

## Results

| Criterion (ADR-0003) | `dockview` 8.7.1 (measured) | Own manager (skeleton) |
|---|---|---|
| **Keyboard operation** | Tabs are focusable and in a sensible Tab order. A floating group **cannot be moved or resized by keyboard**: focusing its tab and pressing arrows / Shift+arrows left the rectangle unchanged (120,80,482×322 before and after). Pointer drag of the floating titlebar works. | Titlebar is focusable; arrows move and Shift+arrows resize in 16 px steps, focus moves into the window on activate (`WindowFrame.tsx`, covered by tests). Ctrl+K / switch / close shortcuts still to build. |
| **Tokens / styling** | 126 distinct `--dv-*` CSS variables; our theme class overrode `--dv-background-color` as expected. Its header is a tab strip plus action area, not our Figma titlebar + bottom-dock model, so expect custom tab/header components and CSS overrides. Adds a 134 kB stylesheet (10.5 kB gzip). | Direct: CSS Modules on `--hms-*`; matches the Figma window, titlebar and dock tab one to one. |
| **Tile layouts** | **Strong.** Two `addPanel({position:{referencePanel,direction}})` calls produced a working split grid (720×450 / 720×900 / 720×450 at 1440×900) with sashes. | **Not built** (FR-16). Needs a layout model and snap/tile picker; this is our main cost. |
| **Serialise without PHI** | `toJSON()` writes every panel's **title and params verbatim**. A title such as `RM 000123 · Pasien Uji` appears in the JSON. Safe only if titles/params are kept generic (type + id) and real titles are rendered from memory, or the JSON is filtered before saving. | Nothing is persisted. Store holds window *type* and geometry only; titles come from the module registry (OQ-07 compatible). |
| **a11y semantics** | **Better out of the box:** `role=tablist/tab/tabpanel` with `aria-selected`/`aria-controls`, groups as `region`, floating groups as `role=dialog aria-modal=false`, plus a built-in ARIA live region. Caveat: `aria-label` of tabs, groups and dialogs is the panel title, so a PHI-bearing title also reaches assistive tech and the DOM. | `role=dialog aria-modal=false` windows, focusable titlebar with `aria-describedby` hint; no tablist semantics (not needed for independent windows). Smaller surface, needs an a11y review (ADR-0003 consequence). |

Other findings that matter to the decision:

- **No minimise.** The group/panel API exposes maximise, float, popout and layout events but nothing to minimise a window to a dock. Our "bottom dock of
  independent windows" (Figma, mockup) would still be our code, built on top of dockview, so its saving is smaller than it first looks.
- **Weight.** About **+394 kB JS (+90 kB gzip)** over a React-only baseline (613.7 kB vs 219.5 kB; gzip 159.1 vs 68.6 kB), plus the CSS above. The current
  app's whole JS bundle is 508 kB. Relevant to OQ-15 (older hospital PCs).
- **Popout to a real browser window exists** (`addPopoutGroup`), which our own manager does not have. This only matters if OQ-20 (second monitor) is
  brought into scope; PHI and clipboard questions come with it.
- **Model mismatch.** Dockview's unit is a *tab group*; ours is an *independent window with a dock tab*. We could force one window per group, but then
  we use little of what dockview offers while paying its weight.

## Recommendation

**Keep the own thin manager (ADR-0003 D1, option A). Do not switch.** The ADR's rule is "switch only if the spike clearly favours dockview"; it does not.
Dockview wins on tiling and on built-in ARIA roles, but loses on keyboard operation of floating windows (a stated priority: criterion 1 of the ADR is
accessibility and keyboard), on fit with the dock model (no minimise), on weight, and it carries a PHI-in-serialisation risk we would have to guard.

Suggested follow-ups for the own manager (not decided — for the product owner):
1. Build the tile layout (FR-16) as the next window-manager task; use the grid result above as a behavioural reference (split by direction, sashes).
2. Add `role`/live-region announcements for window open/close/focus (dockview's built-in live region is the thing to copy).
3. Revisit dockview only if OQ-20 (popout to a second monitor) becomes required, or if tile layouts prove much costlier than estimated.

No ADR amendment is needed because the decision did not change; a short spike-result note is added to ADR-0003.

## Reproduce

```bash
cd source/hms_web-frontend-UIUX/web-workspace/spikes/dockview
corepack pnpm install --ignore-workspace && corepack pnpm exec vite build
corepack pnpm exec vite preview --port 5199 --host 127.0.0.1 &
node probe.mjs          # needs Google Chrome; prints the JSON summarised above
```
