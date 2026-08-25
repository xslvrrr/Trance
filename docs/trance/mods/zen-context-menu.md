# Zen Context Menu — investigation

| | |
|---|---|
| **Mod** | Zen Context Menu |
| **User's version** | 3.1 |
| **Source** | `KiKaraage/ZenMods` → `Zen-context-menu/` (Zen store) |
| **License** | **MIT** |
| **Verdict** | ADAPT |
| **Phase** | 5 |
| **Cluster** | icons |
| **Investigated** | 2026-08-25 |

## 1. What it actually does

- [x] B1 — **Thirty-two "hide this menu item" toggles.** One pref each:
      separators, bookmark, mute tab, new tab, move tab, container tab, send to
      device, close tab, close multiple, ask chatbot, search, search in private,
      translate, print selection, image options, audio/video options, check
      spelling, select all text, select all tabs, reload tab, duplicate tab,
      unload actions, inspect, save link, screenshot, this-frame, pin, back /
      forward / reload / bookmark.
- [x] B2 — **Hides all icons** (the inverse of Context Menu Icons), with a
      "restore back all icons" escape hatch and a separate toggle for extension
      icons.
- [x] B3 — **Applies the Zen workspace gradient and accent colour** to context
      menus, tab previews and notification popups.
- [x] B4 — **Reorders the tab context menu** for "ergonomics".
- [x] B5 — **Prioritises "Copy Clean Link"**, hiding the plain Copy Link behind
      a hover trigger area.
- [x] B6 — Windows-specific margin fixes for checkboxes and extension menus.
- [x] B7 — Requires `widget.macos.native-context-menus = false` to work at all
      on macOS, and says so in its own preference list.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 hide toggles | **Drop, all thirty-two** | This is the knob explosion TRANCE.md §8.2 exists to refuse. Thirty-two prefs, each hiding one row, is a configuration surface larger than the menu it configures — and every one of them changes the menu's shape, so no two Trance installs would have the same muscle memory. Firefox already hides items that do not apply to the target. |
| B2 hide all icons | **Drop** | Directly contradicts the cluster's purpose. Turning Trance's icon sub-feature off is the same setting, minus one owner. |
| B3 gradient / accent on menus | **Keep** | This is genuinely good and it is already most of the way built: `--trance-surface-bg` and `--trance-accent` exist, menus are the natural fourth consumer of the surface tokens, and it costs one rule. Trance's version tints; it does not add a blur surface (the budget is spent — TRANCE.md §3.3). |
| B4 tab-menu reorder | **Drop** | Reordering a platform menu by stylesheet `order` breaks keyboard navigation, which follows DOM order, not visual order. |
| B5 Copy Clean Link | **Drop** | Depends on a hover-revealed trigger area, and Zen ships its own copy-link handling. |
| B6 Windows margins | **Drop** | Trance's target is macOS arm64 for v1.0 (TRANCE.md §16 Q9). Revisit with the platform. |
| B7 native-menu opt-out | **Keep as an opt-in pref, off by default** | `widget.macos.native-context-menus` defaults to `true` (verified in `StaticPrefList.yaml`) and Zen does not override it, so on macOS the page and tab context menus are drawn by AppKit and **no stylesheet can put an icon in them**. Turning it off gets the icons and loses the platform menu — its accessibility behaviour, its feel, its native scrolling. That is a real trade with no right answer, so Trance neither forces it nor hides it: `trance.chrome.icons.macos-emulated-menus` is off by default, and when on, `TranceChrome` claims the platform pref and restores the user's value on disable, exactly as `TranceSurfaces` does with `zen.theme.acrylic-elements` (ADR-011). Recorded as ADR-020. |

## 3. What it touches

- **DOM nodes:** `#contentAreaContextMenu`, `#tabContextMenu`,
  `#toolbar-context-menu`, `menupopup`, `menuitem`, `menuseparator`,
  `.tab-preview-*`, `#zen-toast-container`.
- **Zen modules:** none directly; consumes `--zen-primary-color` and Zen's
  gradient variables.
- **Chrome URLs it injects:** one 28 KB stylesheet through Zen's own mods
  system.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | It and Context Menu Icons (4) are in direct opposition on the same selectors — one adds icons, the other removes them — and the winner is load-order dependent. This is TRANCE.md §3.1's example in the wild. |
| §3.2 Own `MutationObserver` | No | Pure CSS. |
| §3.3 `backdrop-filter` | **Yes** | For the gradient treatment on menus. Trance tints without blurring. |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | No | |
| §3.6 timer loop | No | |
| §3.7 Load-order race | **Yes** | Against mod 4, above. |
| §3.8 Duplicate icons / fonts | Indirect | It removes icons others add. |

## 5. Overlap

- **With stock Zen:** Zen already tints popups from the space gradient in
  `zen-popup.css`; B3 extends it to native-drawn menus.
- **With other mods:** total conflict with Context Menu Icons (4).
- **Merge target:** `TranceChrome` — B3 only.

## 6. Trance design

- **Module:** `TranceChrome` (menus sub-feature)
- **Stylesheet:** `trance-chrome.css`
- **Scheduler use:** none
- **Observer use:** none
- **New tokens:** none — reuses `--trance-surface-bg`, `--trance-accent`

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.chrome.menus.tint` | bool | `true` | Tint menus with the space colour |
| `trance.chrome.icons.macos-emulated-menus` | bool | `false` | Use emulated context menus on macOS so they can carry icons |

Thirty-two hide-toggles become zero. One preference replaces the one behaviour
worth keeping, and one names the platform trade honestly instead of taking it
silently.

### Teardown plan

Remove the `trance-chrome-menus` attribute, and restore
`widget.macos.native-context-menus` to the value the user had if it was claimed.
The stylesheet is shared with the rest of `TranceChrome` and is unloaded when
the whole feature is.

## 7. Acceptance criteria

- [ ] Menus pick up the space accent without a fourth blur surface
- [ ] `widget.macos.native-context-menus` is untouched at the default settings,
      and restored exactly on disable when it has been claimed
- [ ] No hide-toggle prefs exist
- [ ] `CREDITS.md` records KiKaraage's MIT licence

## 8. Open questions for the user

1. Thirty-two hide-toggles are dropped. If any specific menu item is genuinely
   in the way every day, say which and it becomes a rule in `trance-chrome.css`
   — but as a Trance decision with a reason, not a pref.
2. With `trance.chrome.icons.macos-emulated-menus` off (the default), icons land
   on everything the browser draws itself — panels, the app menu, Zen's folder
   and space menus, the bookmarks menu — but **not** on the page and tab context
   menus, which macOS draws. Turning it on gets those two and gives up the
   native menu. Which way round do you want it?
