# Customize Collapsed Sidebar — investigation

> ⚠️ **No license file — all rights reserved.** No source was read while writing
> this document and no code may be copied. Everything below comes from the mod's
> public README, its store listing, and from the `mod.ccs.*` values in the user's
> own profile. See `TRANCE.md` §7.3.

| | |
|---|---|
| **Mod** | Customize Collapsed Sidebar |
| **User's version** | 1.0.5 (installed and enabled in both profiles) |
| **Source** | `Ciuriya/zen-themes` → `Customize Collapsed Sidebar` |
| **License** | **none** — all rights reserved |
| **Verdict** | NATIVE — clean-room |
| **Phase** | 4 |
| **Cluster** | sidebar-tabs |
| **Investigated** | 2026-08-25 |

The README describes it as making the collapsed sidebar "customisable to its
fullest potential", defaulting "everything to the pre-1.13b sizing", and warns
that it "will break when folders are released". Folders have since been
released. This mod is, by its author's own note, on borrowed time — which is a
good argument for absorbing the ten values the user actually set and dropping
the rest of the surface.

## 1. What it actually does

Every behaviour is a size or a margin in the collapsed (icon-only) sidebar,
exposed as a `mod.ccs.*` pref. The user's profile sets exactly ten:

| Pref | User's value | What it controls |
|---|---|---|
| `mod.ccs.sidebar_total_width` | `48px` | Width of the whole collapsed rail |
| `mod.ccs.tab_width` | `36px` | Width of a tab button in the rail |
| `mod.ccs.tab_height` | `36px` | Height of a tab button in the rail |
| `mod.ccs.tab_icon_size` | `16px` | Favicon size in the rail |
| `mod.ccs.tab_outline_size` | `1px` | Selected-tab outline thickness |
| `mod.ccs.tab_outline_offset` | `-1px` | Selected-tab outline inset |
| `mod.ccs.compact_sidebar_top-margin` | `38px` | Space above the rail |
| `mod.ccs.compact_sidebar_bottom_margin` | `0px` | Space below the rail |
| `mod.ccs.remove_sidebar_top_margin` | `true` | Drops Zen's own top margin |
| `mod.ccs.align_sidebar_top_buttons_vertically` | `true` | Stacks the top buttons in a column instead of a row |

- [x] B1 — **Narrower collapsed rail.** Zen's default is 60px
      (`--tab-min-width: 48px` + `--zen-toolbox-padding: 6px` on each side);
      the user runs 48px total.
- [x] B2 — **Smaller tab buttons in the rail** (36 × 36 rather than filling the
      rail width).
- [x] B3 — **Explicit favicon size** in the rail.
- [x] B4 — **Top and bottom margins for the rail**, independent of Zen's.
- [x] B5 — **Top buttons stacked vertically** rather than in a row.
- [ ] B6 — **Selected-tab outline** thickness and offset.
- [ ] B7 — the remaining `mod.ccs.*` knobs the user leaves at default.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 rail width | **Keep** | The user's most visible customisation, and Zen leaves a clean extension point for it (see §6). Default to their 48px. |
| B2 tab button size | **Keep** | Same reasoning. Drives the rail's whole density. |
| B3 favicon size | **Keep** | One token; it is what stops a 36px button looking empty. |
| B4 rail margins | **Keep** | 38px top is a real macOS traffic-light accommodation, not a taste setting. |
| B5 vertical top buttons | **Keep** | Follows from B1: a 48px rail cannot hold a row of buttons. |
| B6 selected-tab outline | **Merged** | Becomes part of Nebula's cohesive state treatment (Phase 3 B5) rather than its own pair of sliders. Trance's selected tab uses `--trance-surface-border` at `--trance-border-width`. |
| B7 the rest | **Drop** | Not set by the user. `TRANCE.md` §8.2: default to drop. |

## 3. What it touches

- **DOM nodes:** `#navigator-toolbox` in its collapsed state,
  `.tabbrowser-tab`, `.tab-icon-image`, `#zen-sidebar-top-buttons`,
  the workspace sections.
- **Zen modules it depends on:** none directly — it works entirely through
  `:root:not([zen-sidebar-expanded="true"])` and Zen's sizing variables.
- **Chrome URLs it injects:** a stylesheet through Sine, generated from the
  `mod.ccs.*` prefs.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Zen declares `--tab-min-width: 48px !important` and `--zen-toolbox-padding: 6px !important` on `:root:not([zen-sidebar-expanded="true"])` (`vertical-tabs.css:697`). Anything overriding those has to use `!important` too, and then fights every other mod that did the same. |
| §3.2 Own `MutationObserver` | No | |
| §3.3 `backdrop-filter` | No | |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | No | |
| §3.6 `setInterval` / `setTimeout` loop | No | |
| §3.7 Load-order race | **Yes** | Its sheet has to be evaluated after Zen's for its overrides to land; through Sine that ordering is not guaranteed. |
| §3.8 Duplicate icons / fonts | No | |

This is the mod with the *fewest* failure modes in Phase 4 and the one whose
single failure mode is hardest to avoid from outside: Zen's collapsed-rail sizing
is `!important`, so an external stylesheet has no non-`!important` way to change
it. Trance does have one — §6.

## 5. Overlap

- **With stock Zen:** all of it. Zen owns collapsed-rail sizing; the mod only
  reparameterises it.
- **With other mods:** SuperPins (15) also sets tab height and favicon size;
  Nebula (10) sets the selected-tab treatment. Three owners for one rail today.
- **Merge target:** `TranceTabStrip` + `trance-tabstrip.css`.

## 6. Trance design

- **Module:** `src/zen/trance/features/tabstrip/TranceTabStrip.mjs`
- **Stylesheet:** `src/zen/trance/styles/trance-tabstrip.css`
- **Base class:** `TranceFeature`
- **Scheduler use:** none.
- **Observer use:** none. The collapsed state is already an attribute on the
  root element (`zen-sidebar-expanded`), so CSS can see it without JS.
- **New tokens:** `--trance-rail-width`, `--trance-rail-tab-size`,
  `--trance-rail-icon-size`, `--trance-rail-margin-top`,
  `--trance-rail-margin-bottom` in `trance-tokens.css`.

**How Trance changes the rail without `!important`.** Zen's collapsed block is:

```css
:root:not([zen-sidebar-expanded="true"]) {
  --tab-min-width: 48px !important;
  --zen-toolbox-padding: 6px !important;
  --zen-toolbox-max-width: calc(var(--tab-min-width) + var(--zen-toolbox-padding) * 2);
}
```

The first two are `!important` and cannot be beaten by an author rule. The third
— the one `#navigator-toolbox` actually consumes for its `min-width`/`max-width`
— is **not**. `TranceTokens` writes `--zen-toolbox-max-width` as an inline custom
property on `:root`, and an inline declaration beats a normal author declaration,
so the rail width follows `trance.tabstrip.rail.width` with no `!important`
anywhere and no fight with Zen. The same route gives Trance `--tab-min-height`,
which Firefox declares normally.

Tab button size, favicon size and the margins are ordinary rules inside
`:root[trance="true"][trance-tabstrip="true"]:not([zen-sidebar-expanded="true"])`,
which out-specifies Zen's normal declarations for those properties.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.tabstrip.rail.enabled` | bool | true | Customise the collapsed sidebar |
| `trance.tabstrip.rail.width` | int | 48 | Collapsed sidebar width |
| `trance.tabstrip.rail.tab-size` | int | 36 | Tab button size |
| `trance.tabstrip.rail.icon-size` | int | 16 | Favicon size |
| `trance.tabstrip.rail.margin-top` | int | 38 | Space above the tab list |
| `trance.tabstrip.rail.margin-bottom` | int | 0 | Space below the tab list |
| `trance.tabstrip.rail.stack-top-buttons` | bool | true | Stack the sidebar's top buttons |

Defaults are the user's own `mod.ccs.*` values, so a fresh Trance profile starts
where their tuned Zen profile ended up.

### Teardown plan

`onDisable()` releases the token bindings — which removes the inline
`--zen-toolbox-max-width` and `--tab-min-height`, restoring Zen's own values
exactly — and removes the `trance-tabstrip-rail` root attribute. Nothing is left
behind, and Zen's `!important` declarations were never touched, so there is
nothing to restore.

## 7. Acceptance criteria

- [x] B1–B5 present, defaulting to the user's current values
- [x] Not one `!important` in the implementation
- [x] Disabled state: no stylesheet, no inline custom property, no attribute
- [x] Expanded sidebar is unaffected — every rule is gated on
      `:not([zen-sidebar-expanded="true"])`
- [x] Attribution in `CREDITS.md`

## 8. Open questions for the user

- The mod's own README says it "will break when folders are released". If the
  rail ever looks wrong around a collapsed folder, that is the boundary this
  reimplementation inherited, and it is now fixable in-tree rather than in a
  stylesheet fighting `!important`.

---

## 8. Revision — 2026-08-25

The rail width default and slider floor are both **60px**, not 48.

60 is Zen's own rail: a 48px tab with 6px of toolbox padding either side. Below
it the macOS traffic lights no longer fit the strip Zen reserves for them on
`#titlebar` and the stacked top buttons begin to clip — so a narrower rail was
not a smaller rail, it was a broken one. The slider's `min` is 60 for the same
reason; the mod's own lower range was reachable only because it never had to
coexist with the window buttons.
