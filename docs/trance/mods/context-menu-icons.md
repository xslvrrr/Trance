# Context Menu Icons — investigation

| | |
|---|---|
| **Mod** | Context Menu Icons (CMI) |
| **User's version** | 2.7.4.3 |
| **Source** | `Starry-AXQG/Context-Menu-Icons` (Sine store id `Context-Menu-Icons`) |
| **License** | **MIT** — © 2026 Starry |
| **Verdict** | ADAPT |
| **Phase** | 5 |
| **Cluster** | icons |
| **Investigated** | 2026-08-25 |

> MIT. Code and assets **may** be adapted, with attribution and the license text
> retained. See `docs/trance/THIRD-PARTY.md`.

## 1. What it actually does

- [x] B1 — **Puts an icon on every context-menu item.** 288 selector→icon
      assignments covering the page, tab, link, image, media, bookmark and
      extension context menus, plus Zen's own `zenFolderActions` and
      `zenWorkspaceMoreActions` popups.
- [x] B2 — **Ships two complete icon packs**, `FluentUI` (137 glyphs) and
      `ZenUI` (147 glyphs), switched by one pref. This is the single most
      valuable thing in the mod and the reason it is the icon cluster's source.
- [x] B3 — **Restyles the tab context menu** — padding, min-height, radius.
- [x] B4 — **Replaces the native checkbox/radio tick** with its own checkmark
      glyph, so checkable items can carry a real icon in the tick's place.
- [x] B5 — **Auto-hides unavailable menu items.**
- [x] B6 — **"Show more options" folding** — a `.uc.js` that moves configured
      menu ids into a submenu, with a CapsLock+Ctrl+Shift+A hotkey to add the
      hovered item to the fold list.
- [x] B7 — Bookmark-toolbar extras: centre the items, hide bookmark-bar
      furniture, auto-hide the bookmarks bar on hover (JS).

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 icon assignments | **Keep** | This is the cluster. The mapping is adapted (MIT) and regenerated into a Trance stylesheet; see §6. |
| B2 two packs | **Keep** | The user asked for FluentUI as the default with a switch to ZenUI. That is exactly this pref, so Trance ships both packs rather than picking one. |
| B3 tab-menu restyle | **Keep, reduced** | Radius and padding come from `--trance-radius-*` and `--trance-gap-*` — one line each, and consistent with the rest of Trance rather than a second geometry. |
| B4 custom checkmark | **Keep** | Without it a checkable item cannot show its own icon, which would leave visible holes in B1. |
| B5 auto-hide unavailable items | **Drop** | Firefox already disables them; hiding them makes the menu's shape change between invocations, which is worse for muscle memory than a greyed row. |
| B6 fold submenu | **Drop** | A script, a global hotkey and a second configuration source (a CSS variable *or* an `about:config` string). §8.2's default is drop and nothing here argues against it. |
| B7 bookmark-bar extras | **Drop** | Unrelated to icons; the user has no bookmarks toolbar visible. |

## 3. What it touches

- **DOM nodes:** `menuitem`, `menu`, `menupopup`, `.menu-iconic`,
  `.subviewbutton`, `.toolbarbutton-1`, `#contentAreaContextMenu`,
  `#tabContextMenu`, `#zenFolderActions`, `#zenWorkspaceMoreActions`,
  `.panel-subview-body`.
- **Zen modules:** none. It is a stylesheet plus two optional scripts.
- **Chrome URLs it injects:** one stylesheet per pack, plus `CMI-config.css`
  and `global.css`, through Sine; the SVGs are real files, relative-referenced.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes, severely** | Every one of the 288 assignments carries `!important`, because a mod stylesheet has no other way to beat Firefox's own `list-style-image`. Trance ships inside the browser and loads its sheets last as author sheets, so it needs none. |
| §3.2 Own `MutationObserver` | **Yes** (B6, B7 only) | Both dropped. |
| §3.3 `backdrop-filter` | No | |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | No | |
| §3.6 timer loop | No | |
| §3.7 Load-order race | **Yes** | Its `user.js` and `.uc.js` load through Sine's bootloader. |
| §3.8 Duplicate icons / fonts | **Yes — it is the duplication** | Its glyphs overlap New Icons (11), Zen Context Menu (20) and Nova UI (12). Four copies of the same padlock. Resolving that is the whole point of the cluster. |

## 5. Overlap

- **With stock Zen:** Firefox already assigns `list-style-image` to a minority of
  menu items; CMI covers the rest and overrides the ones Firefox does.
- **With other mods:** New Icons (11) does toolbar/panel icons, Zen Context Menu
  (20) does context-menu *layout* and hiding, Nova UI (12) ships a third set.
- **Merge target:** the Trance icon set + `TranceChrome`'s icon sub-feature.

## 6. Trance design

- **Module:** `src/zen/trance/features/chrome/TranceChrome.mjs` (icons
  sub-feature)
- **Stylesheets:** `trance-icons-fluent.css`, `trance-icons-zen.css` —
  **generated**, one per pack, by `scripts/trance-icons.py`
- **Assets:** `src/zen/trance/icons/{fluent,zen}/*.svg`, packaged by a wildcard
  jar entry to `chrome://browser/content/trance-icons/<pack>/`
- **Base class:** `TranceFeature`
- **Scheduler use:** none
- **Observer use:** none — `list-style-image` is a style rule; the style system
  already watches the tree
- **New tokens:** `--trance-menu-icon-size`, `--trance-menu-icon-opacity`

Two decisions worth recording:

1. **One sheet per pack, loaded exclusively.** The alternative — one sheet with
   both packs gated on a root attribute — parses 576 rules to use 288. Because
   `TranceStyles` loads sheets by URL and ref-counts them, switching the pack
   pref unloads one file and loads the other, so the pack you are not using
   costs literally nothing (TRANCE.md §6.5).
2. **The mapping is generated, not hand-maintained.** `scripts/trance-icons.py`
   reads CMI's own `Fluent-icons.css` / `Zen-icons.css`, extracts the
   selector→glyph pairs, strips every `!important`, and re-emits them nested
   under `:root[trance="true"][trance-chrome-icons="true"]`. Re-running it after
   a CMI release is a diff, not a merge.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.chrome.icons.enabled` | bool | `true` | Replace the browser's icons |
| `trance.chrome.icons.pack` | string | `"fluent"` | Icon set — Fluent / Zen |

### Teardown plan

`onDisable()` removes the `trance-chrome-icons` attribute and unloads whichever
pack sheet is loaded. Nothing else was allocated: no observer, no listener, no
DOM.

## 7. Acceptance criteria

- [ ] Every menu item that had an icon under CMI has one under Trance
- [ ] No `!important` in either generated sheet
- [ ] No data-URI icons anywhere — all glyphs are real files (TRANCE.md §3.8)
- [ ] Switching packs unloads the previous sheet, verified through
      `TranceStyles.loadedSheets`
- [ ] Disabled: no sheet loaded, no attribute, no DOM
- [ ] `CREDITS.md` and `THIRD-PARTY.md` record Starry's MIT licence and the
      adaptation

## 8. Open questions for the user

1. CMI's ZenUI pack has 31 glyphs Fluent does not, and Fluent has 22 ZenUI does
   not (mostly folder and tab-group actions). Where a pack is missing a glyph
   Trance falls back to the browser's own icon rather than mixing packs. Confirm
   that is preferable to filling the gaps from the other pack.
