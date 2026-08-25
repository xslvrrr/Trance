# SuperPins — investigation

| | |
|---|---|
| **Mod** | SuperPins |
| **User's version** | 1.7.2 |
| **Source** | `CosmoCreeper/Zen-Themes/SuperPins` (on both the Zen and Sine stores) |
| **License** | **MIT** — code may be adapted with attribution |
| **Verdict** | ADAPT — in practice, nothing worth copying survives §2 |
| **Phase** | 4 |
| **Cluster** | sidebar-tabs |
| **Investigated** | 2026-08-25 |

SuperPins is a settings surface more than a feature: eighteen knobs over the
pinned-tabs and Essentials sections of the sidebar. The interesting question is
not what it can do but which parts the user actually turned on.

**What the user's profile says.** Only four SuperPins prefs are set, and they are
set in both profiles:

```
mod.superpins.essentials.grid-count = "1"
mod.superpins.pins.grid-count       = "1"
mod.superpins.pins.active-bg        = ""
uc.superpins.border                 = "none"
```

All four are *opt-outs*. `grid-count = 1` is a single column — the grid, which is
the mod's headline feature, is switched off. `active-bg = ""` and
`border = "none"` remove the mod's own decoration. The mod is installed and
almost entirely disabled, which is exactly the pattern `TRANCE.md` §8.2 warns to
expect.

> Note: the SuperPins prefs are present in both profiles but the mod is no longer
> in either `sine-mods/mods.json`. The prefs are residue from an earlier install.
> They are still the best available evidence of intent and are treated as such.

## 1. What it actually does

- [x] B1 — **Grid layout for pinned tabs**, icon-only, like Essentials.
- [x] B2 — **Auto-grow**: pins and Essentials stretch to fill their row.
- [x] B3 — **Lazy pinned tabs**: pinned tabs load when first used rather than all
      at startup.
- [x] B4 — **Sticky pins**: the pinned section stays at the top while the normal
      tab list scrolls under it.
- [x] B5 — **Strike-through on unloaded tabs.**
- [ ] B6 — **Dimming of unloaded tabs** (separate knob from B5).
- [ ] B7 — **Geometry knobs**: pins/Essentials width, margin, tab height, favicon
      size, corner rounding, borders, backgrounds, transparency, column limit.
- [ ] B8 — **Essentials position** — move Essentials to the bottom of the sidebar.
- [ ] B9 — **Workspace-indicator knobs**: hide, centre, move to top/bottom, size.
- [ ] B10 — **Separator display**: three-way control over the pinned/normal rule.
- [ ] B11 — **Active-pin background** override.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 grid layout | **Drop** | User decision 2026-08-25, confirming `grid-count = 1`. Zen's Essentials grid already exists for the case where a grid is wanted. |
| B2 auto-grow | **Drop** | Only meaningful with B1. |
| B3 lazy pinned tabs | **Keep — as configuration** | This is Firefox's `browser.sessionstore.restore_pinned_tabs_on_demand`. Trance surfaces the platform pref in its settings page; it does not reimplement session restore. |
| B4 sticky pins | **Keep** | Genuinely useful with many pins, and it is three CSS declarations on a section Zen already gives its own class. |
| B5 strike-through | **Drop** | Overlaps Unloaded Tabs (18), which the user also runs and which does the same job with opacity instead. Two treatments for one state is the duplication this project removes. See `docs/trance/mods/unloaded-tabs.md`. |
| B6 dimming | **Merged** | Owned by the unloaded-tab state, not by the pins feature. |
| B7 geometry knobs | **Drop** | Trance's token layer sets this geometry once, coherently, for the whole chrome (`--trance-radius-*`, `--trance-gap-*`). Eighteen per-element sliders is the settings sprawl §6.6 exists to prevent. |
| B8 Essentials at the bottom | **Drop** | Not in the user's prefs; a large layout change for one preference. |
| B9 workspace-indicator knobs | **Drop** | Not in the user's prefs. |
| B10 separator display | **Zen** | Zen already has `.pinned-tabs-container-separator` with a `hide-separator` attribute. |
| B11 active-pin background | **Drop** | User set it to empty. Nebula's cohesive state treatment (Phase 3 B5) covers it. |

Two behaviours survive: B3 as a settings entry for an existing platform pref, and
B4 as CSS. That is the whole of SuperPins in Trance.

## 3. What it touches

- **DOM nodes:** `.zen-workspace-pinned-tabs-section`,
  `.zen-essentials-container`, `#zen-essentials`,
  `.pinned-tabs-container-separator`, `.zen-current-workspace-indicator`,
  `.tabbrowser-tab[pinned]`, `.tab-icon-image`.
- **Zen modules it depends on:** `ZenPinnedTabManager`, `nsZenWorkspace`'s
  section markup.
- **Chrome URLs it injects:** a stylesheet and a `.uc.js` through Sine/Zen mods.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Every knob is an override of a Zen declaration on the same element; Zen writes many of those `!important`, so the mod must too. |
| §3.2 Own `MutationObserver` | **Yes** | On the pinned section, to re-apply grid classes as pins are added and removed. |
| §3.3 `backdrop-filter` | Partial | The transparency knob adds one over the Essentials container — a fourth blurred region on top of the surface cluster's three. |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | No | |
| §3.6 `setInterval` / `setTimeout` loop | No | |
| §3.7 Load-order race | **Yes** | Its layout depends on Zen having built the workspace sections first. |
| §3.8 Duplicate icons / fonts | No | |

## 5. Overlap

- **With stock Zen:** Essentials already is a grid with auto-fit columns
  (`.zen-essentials-container`, `vertical-tabs.css:1117`); the pinned/normal
  separator already exists with its own hide attribute; pinned-tab lifecycle is
  `ZenPinnedTabManager`'s.
- **With Firefox:** B3 is `browser.sessionstore.restore_pinned_tabs_on_demand`.
- **With other mods:** B5/B6 overlap Unloaded Tabs (18) exactly; B7 overlaps
  Customize Collapsed Sidebar (5) on tab height and favicon size; B1 overlaps
  Zen's own Essentials grid.
- **Merge target:** `TranceTabStrip` + `trance-tabstrip.css`.

## 6. Trance design

- **Module:** `src/zen/trance/features/tabstrip/TranceTabStrip.mjs`
- **Stylesheet:** `src/zen/trance/styles/trance-tabstrip.css`
- **Base class:** `TranceFeature`
- **Scheduler use:** none.
- **Observer use:** none of its own. B4 is CSS; B3 is a platform pref.
- **New tokens:** none. Sticky pins reuse `--trance-surface-bg`.

B4 is `position: sticky` on `.zen-workspace-pinned-tabs-section` plus a `z-index`
above the scrolling normal-tabs section. It is applied only when the sidebar is
expanded — in the collapsed rail the pinned section is already at the top of a
list short enough not to scroll, and a sticky element there would fight the
collapsed-rail layout.

B3 is a checkbox in `about:preferences#trance` bound directly to
`browser.sessionstore.restore_pinned_tabs_on_demand`. Trance does not mirror it
into a `trance.*` pref: mirroring a platform pref creates two owners for one
piece of state, which is the whole failure this project is about.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.tabstrip.pins.sticky` | bool | true | Keep pinned tabs visible while scrolling |
| `browser.sessionstore.restore_pinned_tabs_on_demand` | bool | *(platform default)* | Load pinned tabs only when you use them |

### Teardown plan

`onDisable()` removes the `trance-tabstrip-pins-sticky` root attribute; the
stylesheet is unloaded by `TranceFeature`. The platform pref is left exactly as
the user set it.

## 7. Acceptance criteria

- [x] B3 reachable from `about:preferences#trance`, bound to the platform pref
- [x] B4 present when the sidebar is expanded, absent when collapsed
- [x] No grid layout, no second set of geometry sliders
- [x] Disabled state: no stylesheet, no attribute, no listener
- [x] Attribution in `CREDITS.md`; no code copied, so no `THIRD-PARTY.md` entry

## 8. Open questions for the user

- None. Grid scope confirmed 2026-08-25 ("drop the grid").
