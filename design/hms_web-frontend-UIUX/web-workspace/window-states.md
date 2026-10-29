# web-workspace — window, shell and layout states

- **Status:** Decisions approved by the product owner 2026-10-28 (document still a draft until the PRD is approved) · **Date:** 2026-10-28 · **Covers:** PRD FR-04…FR-06, FR-16; OQ-46, OQ-47, OQ-48
- **Source of the rules:** product-owner decisions of 2026-10-28 (tile layout, stay-on-top, shell size) — marked **[Decided]**.
  Items first proposed by me and then approved are marked **[Decided 2026-10-28]**. Nothing here is built yet beyond what §7 says.

## 1. Vocabulary (why this document exists)

"Minimised" was used for two different things. From now on:

| Term | Meaning | Visible? | Product-owner wording |
|---|---|---|---|
| **floating** | A smaller, non-fullscreen window you can see and move, above the tiles | yes | what was called "minimized windows" that "stay on top" |
| **minimized** | Hidden into the dock; only its dock tab shows | no | classic minimise |
| **maximized** | One window fills the work area | yes | "fullscreen window mode" |
| **tiled** | Window occupying a slot of the active tile layout | yes | tile |

State names are English identifiers (code, docs, Figma layer names). User-facing labels for tooltips and screen readers go through the
message catalogs (`en` default, `id`) — the Indonesian wording is to be added to the glossary, not invented here.

## 2. Three levels of state

```
shell      →  layout mode  →  window state (per window)
(size)        (how windows      (what each window is doing)
              are arranged)
```

### 2.1 Shell state — the browser/PWA window that holds top bar + work area + dock
| State | Condition | Effect |
|---|---|---|
| `shell.maximized` **[Decided + accepted 2026-10-28]** | Viewport large enough to hold the chosen preset at the minimum tile size 360×240 with margin 24 / gap 16 / 16 px above and below the work area (see §5) | Tiling available; tile sizes are computed from the shell's current size |
| `shell.compact` **[Decided + accepted]** (the "minimised shell") | Viewport too small for the chosen preset | **Tiling disabled.** Only the **most recently used (MRU)** window is shown; all other windows stay open but hidden (dock tabs remain); layout choice and states are remembered in memory |
| OS-minimised / tab hidden | `document.visibilityState = "hidden"` | A page cannot detect it as "minimised". No layout change; the idle timer keeps running (FR-02). Nothing special to build |

### 2.2 Layout mode — chosen by the user from the picker **[Decided 2026-10-28: picker first, snap-by-drag later]**
| Mode | Meaning | Slots |
|---|---|---|
| `free` | No tile layout. Windows are floating/maximized/minimized as today | — |
| `tiled(single)` | One tile filling the area (same look as one maximised window, but inside margins) | 1 |
| `tiled(cols2)` | Two columns, 1+1 | 2 |
| `tiled(main2)` | One large + two stacked, 1+2 (Mockup 05) | 3 |
| `tiled(grid4)` | 2×2 | 4 |
| `single` (derived) | Forced while `shell.compact`; not selectable | 1 (MRU only) |

**Maximum 4 tiles [Decided].** The layout mode only changes when the user picks another preset or the shell crosses the size threshold in §5.

### 2.3 Window state — one value per open window
| State | Position/size owned by | Stacking tier | Dock tab | Notes |
|---|---|---|---|---|
| `tiled` | the layout (slot rectangle) | **tile tier** (base) | yes, shown as open | Cannot be dragged freely; dragging it out turns it `floating`. Has minimise, maximise, close |
| `floating` | the window (x, y, w, h ≥ 360×240, inside work area) | **float tier — above the tile tier ("stay-on-top") [Decided]** | yes | Free drag / 8-way resize / keyboard move & resize (existing behaviour) |
| `maximized` | the work area (fills it) | **top window tier** | yes | One at a time. Restores to the state it came from (`tiled` slot or `floating` rectangle) |
| `minimized` | none (hidden) | — | yes, shown as minimised | Remembers `previous` = `tiled(slot)` or `floating(rect)` for restore |
| `closed` | — | — | no | Not stored |

### 2.4 Split handles and shortcuts **[Decided 2026-10-28]**
- **Ratio:** free dragging with a **soft snap at 50%** (magnet within about ±16 px of the middle, released by dragging past it). Minimum tile 360×240 always wins. Keyboard: focus a handle, arrows = 16 px, Home = 50%.
- **Shortcuts:** direct keyboard shortcuts **are wanted**; the **Ctrl+K command palette comes first** ("Layout: two columns", "Move to left/right slot", "Show Beranda"). The actual key set is chosen after OQ-19 (browser tab vs installed app) so it avoids reserved keys.
- **Entry:** layout **picker first**; snap-by-drag comes later.

## 3. Stacking tiers (bottom → top)

1. Wallpaper + scrim
2. **Tile tier** — all `tiled` windows (never overlap each other)
3. **Float tier — `floating` windows. They stay on top of tiles [Decided].** Among floating windows, order by recency of focus.
4. `maximized` window (covers tiers 2–3 while it is maximised)
5. Top bar, dock, popovers, command palette (Ctrl+K), Ruang Fokus, lock screen / re-auth

## 4. Transitions

`MRU` = most recently used. "Free slot" = a slot of the active preset with no window.

| # | Event | From → To | Rule |
|---|---|---|---|
| T1 | Open a module (layout `free`) | closed → `floating` | Comfortable default size, cascaded (existing behaviour); focus moves into it |
| T2 | Open a module (tiled layout) | closed → `tiled` if a free slot exists, else `floating` | **[Decided 2026-10-28]** the new window never evicts a tile |
| T3 | Pick a preset in the picker | any visible → `tiled` | **[Decided 2026-10-28]** MRU windows fill slots in order; windows beyond the preset's capacity become `floating` (still visible, on top) — not minimised, not closed |
| T4 | Drag a `floating` window to a slot / screen edge (snap) | `floating` → `tiled` | Snap-by-drag is a later phase (decided: picker first); drops into the nearest slot, replacing nothing if empty, swapping if occupied |
| T5 | Drag a `tiled` window out of its slot | `tiled` → `floating` | Keeps current size, clamped to ≥360×240; the slot becomes free |
| T6 | Minimise | `tiled` / `floating` / `maximized` → `minimized` | Store `previous`; a freed tile slot shows an empty-slot placeholder ("Open module…") **[Decided 2026-10-28]** |
| T7 | Restore from dock tab | `minimized` → `previous` | If `previous` was a tile slot that is now taken → `floating` on top; focus the window |
| T8 | Maximise | `tiled` / `floating` → `maximized` | Store `previous`; the layout stays in memory, covered |
| T9 | Un-maximise (button or double-click titlebar) | `maximized` → `previous` | |
| T10 | Close | any → `closed` | Frees the slot — it shows the placeholder; focus goes to the next window by recency |
| T11 | Shell resizes and crosses the §5 threshold downward | `shell.maximized` → `shell.compact` | **[Decided]** tiling off; show only the MRU window (hidden others keep their state); announce "Layout paused: window too small" |
| T12 | Shell resizes back above the threshold | `shell.compact` → `shell.maximized` | **[Decided 2026-10-28]** previous layout and window states are restored |
| T13 | Shell resizes but stays `shell.maximized` | — | **[Decided]** tile rectangles are recomputed from the shell size (ratios kept, minimums win); `floating` windows are clamped into the work area |
| T14 | "Beranda" / show home | all → `minimized` | Existing behaviour (`showHome`) |
| T15 | Logout, idle timeout or lock | all → `closed` | Layout and states wiped (FR-02); only the per-browser language remains |

## 5. Size rules for `shell.maximized`

- Work area = viewport − top bar (64) − dock (56); content inset **24 px** at the sides, **16 px** above and below, **16 px** between tiles (confirmed 2026-10-28).
- A preset is allowed only if every tile is ≥ 360×240. Minimum shell sizes: `tiled(single)` ≥ 408×392; `cols2` ≥ 784×392; `main2` and `grid4` ≥ 784×648.
  Formula: width ≥ 2×24 + (cols−1)×16 + cols×360; height ≥ 64 + 56 + 2×16 + (rows−1)×16 + rows×240.
- Example at 1440×900: area 1392×748 → `grid4` tiles 688×366; `main2` 752|624 × 748 / 366+366 (Mockup 05).
- Below the minimum for the chosen preset → `shell.compact` (T11). **[Decided, accepted]**

## 6. Persistence, accessibility and tests

- **Persistence (OQ-07) [Decided 2026-10-28: remember per user]:** per user and server-side, **only** layout mode, split ratios and window *type* (+ state/slot). **No titles, no No. RM, no patient ids.** In-memory only today.
- **Accessibility:** every window is `role=dialog aria-modal=false`; state changes are announced through one live region ("Lab Results — floating", "Layout paused: window too small"); tile slots expose position ("slot 2 of 3"); floating windows over tiles must not trap focus; Tab order follows stacking tier (float tier first, then tiles), Alt+n still switches windows.
- **Tests (when built):** transition table T1–T15 as unit tests on the store; "floating renders above tiled" (DOM order / z-index); shell resize across the threshold (T11–T13); no-PHI check on the serialised layout; Playwright flow: pick preset → drag out → minimise → restore → shrink window.

## 7. Mapping to today's code (`source/hms_web-frontend-UIUX/web-workspace/src/workspace/windowStore.ts`)

| Model | Skeleton today |
|---|---|
| `floating` | default for every window (no flag) |
| `maximized` | `maximized: true` + `restore` rectangle |
| `minimized` | `minimized: true` |
| `tiled`, layout mode, `shell.compact`, `previous` state, float/tile tiers | **not built** — new store fields: `layout`, `slot`, `previous`; shell size check in `setArea` |
| Existing `z` counter | stays; tiers are separate stacking contexts (tile tier < float tier) |

## 8. Decisions (all approved 2026-10-28)

1. Extra windows beyond the free slots open as `floating` (visible, on top) — T2/T3.
2. Empty slot after a tile is minimised or closed: **placeholder** (not neighbours growing) — T6/T10.
3. Previous layout and window states return when the shell grows above the threshold — T12.
4. Picker first, snap later · split ratio free with soft snap at 50% · direct shortcuts wanted, Ctrl+K palette first (keys after OQ-19) · layout remembered per user (types + ratios only).
5. Glossary: Indonesian labels for the state names added to `docs/glossary.md` as **proposed** wording — please correct any term.
