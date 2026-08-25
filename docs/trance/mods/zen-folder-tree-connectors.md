# Zen Folder Tree Connectors — investigation

> ⚠️ **GPL-3.0. No source was read while writing this document and no code may
> ever be copied.** Everything below is a description of *observable behaviour*
> from using the mod and from its public README and demo GIF. That is the
> clean-room boundary: behaviour is a fact about the product, source is not.
> See `TRANCE.md` §7.2.

| | |
|---|---|
| **Mod** | Zen Folder Tree Connectors |
| **User's version** | 2.1 (installed and enabled in the twilight profile) |
| **Source** | `JustAdumbPrsn/ZenFolderTreeConnectors` |
| **License** | **GPL-3.0** |
| **Verdict** | NATIVE — clean-room, mandatory |
| **Phase** | 4 |
| **Cluster** | sidebar-tabs |
| **Investigated** | 2026-08-25 |

One of the two mods Trance is legally required to reimplement rather than adapt
(`TRANCE.md` §7.2). It is also the one where the clean-room constraint produced a
*better* implementation than the original could have had, because Trance can use
an element Zen already puts in the DOM and a mod cannot rely on.

## 1. What it actually does

- [x] B1 — **A vertical trunk line** runs down the inside of an expanded folder,
      from just under the folder's label to its last child.
- [x] B2 — **A horizontal elbow** joins the trunk to each direct child of the
      folder, so a child reads as hanging off the trunk.
- [x] B3 — **Nesting works** — a subfolder gets its own trunk, indented inside
      its parent's.
- [x] B4 — **The lines disappear when the folder is collapsed** and when the
      sidebar is collapsed to the icon rail.
- [ ] B5 — **The lines animate in** as the folder expands.

The README documents no preferences, and none appear in the user's profile. The
mod ships one `.uc.js` and one stylesheet.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 trunk | **Keep** | The point of the mod. Without it a nested folder tree is just indentation, which reads poorly at 14px of indent. |
| B2 elbows | **Keep** | The trunk alone is ambiguous about which rows are children and which are siblings of the folder. |
| B3 nesting | **Keep** | Zen supports subfolders, so anything less is incomplete. Free: the rule is written against the folder's own container, so it applies at every depth without knowing the depth. |
| B4 hidden when collapsed | **Keep** | Not a feature so much as correctness. |
| B5 animate in | **Drop** | A line that draws itself on every folder expand is motion for its own sake, and it would have to be a per-child animation. Zen already animates the container's height; the lines simply arrive with it. |

## 3. What it touches

- **DOM nodes:** `zen-folder`, `zen-folder > .tab-group-container` and its
  children (`tab`, nested `zen-folder`).
- **Zen modules it depends on:** `ZenFolder` / `ZenFolders` — specifically the
  folder markup and the `--zen-folder-indent` variable Zen sets on container
  children.
- **Chrome URLs it injects:** `ZenFolderTreeConnectors.css` plus
  `ZenFolderTreeConnectors.uc.js` into `browser.xhtml`.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Zen writes `margin-inline-start: var(--zen-folder-indent) !important` on container children (`zen-folders.css:51`) and `background: none !important` on `tab::before` inside folders. A mod drawing lines in that space has to fight both. |
| §3.2 Own `MutationObserver` | **Yes** | It ships a script alongside its stylesheet; on a tree whose rows appear and disappear as folders expand, measuring or marking rows is what a script there is for. This is the seventh observer on the tab strip described in `TRANCE.md` §3.2. |
| §3.3 `backdrop-filter` | No | |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | Unknown | |
| §3.6 `setInterval` / `setTimeout` loop | Unknown | |
| §3.7 Load-order race | **Yes** | A `.uc.js` operating on elements `ZenFolders` creates. |
| §3.8 Duplicate icons / fonts | No | |

## 5. Overlap

- **With stock Zen:** Zen indents folder children and draws nothing. The
  `.tab-group-line` element Firefox provides is explicitly disabled by Zen
  (`zen-folders.css:7`).
- **With other mods:** Advanced Tab Groups (1) draws its own rule inside
  `.tab-group-container`; both mods installed means two lines in one gutter.
- **Merge target:** `TranceTabStrip` + `trance-tabstrip.css`.

## 6. Trance design

- **Module:** `src/zen/trance/features/tabstrip/TranceTabStrip.mjs`
- **Stylesheet:** `src/zen/trance/styles/trance-tabstrip.css`
- **Base class:** `TranceFeature`
- **Scheduler use:** none.
- **Observer use:** **none.** This is the notable result of the investigation.
- **New tokens:** `--trance-connector-color`, `--trance-connector-width`,
  `--trance-connector-radius` in `trance-tokens.css`.

**Why Trance needs no script where the mod does.** `nsZenFolder.markup` puts an
empty `<html:div class="zen-tab-group-start"/>` as the first child of every
folder's `.tab-group-container` (`src/zen/folders/ZenFolder.mjs:21`), and
`nsZenWorkspace` puts the same class on a marker in the pinned section
(`ZenSpace.mjs:65`). Nothing in the Zen tree styles that class — a grep across
`src/zen/` finds three references, all of them markup or a filter that skips it.
It is an unused anchor sitting in exactly the place the trunk line belongs.

Trance absolutely-positions that element as the trunk. It stretches to the
container's height for free, it moves with the container, it needs no
measurement, and it disappears with the container when the folder collapses. The
elbows are `::after` pseudo-elements on the container's direct children —
verified free: Zen uses `tab::before` inside folders and Firefox uses `::after`
on `.tab-group-label-container` and on `#tabbrowser-tabs` itself, but not on
`.tabbrowser-tab`.

Nesting (B3) needs no extra rule: the selector is written against
`zen-folder > .tab-group-container`, and a subfolder is a `zen-folder` with its
own container.

Zen's `margin-inline-start: … !important` on container children is not fought.
The trunk is positioned in the margin box that indent creates, which is the
space the indent was always reserving.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.tabstrip.connectors` | bool | true | Draw folder tree lines |

One pref. The mod has none, and splitting "trunk" from "elbows" would produce a
setting nobody wants either half of.

### Teardown plan

`onDisable()` removes the `trance-tabstrip-connectors` root attribute; the
stylesheet is unloaded by `TranceFeature`. `.zen-tab-group-start` returns to
being the unstyled marker Zen created — Trance never modified it, only matched it.

## 7. Acceptance criteria

- [x] B1–B4 present, at every nesting depth
- [x] Zero JavaScript, zero observers, zero timers — the whole feature is CSS
- [x] No source of the GPL-3.0 original read or copied
- [x] Disabled state: no stylesheet, no attribute
- [x] Lines absent in the collapsed rail and in collapsed folders
- [x] Attribution in `CREDITS.md`

## 8. Open questions for the user

- The original animates its lines in (B5); Trance does not. If that turns out to
  be missed, it belongs in Phase 6 with the rest of the motion work, driven by
  `TranceScheduler`, not as a per-row CSS animation here.
