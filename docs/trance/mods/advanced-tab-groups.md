# Advanced Tab Groups — investigation

| | |
|---|---|
| **Mod** | Advanced Tab Groups (BETA) |
| **User's version** | 3.5.1 (installed and enabled in both the release and twilight profiles) |
| **Source** | `Vertex-Mods/Advanced-Tab-Groups` (Sine store id `advanced-tab-groups`) |
| **License** | **MIT** — © 2025 12th-devs. Code may be adapted with attribution |
| **Verdict** | ADAPT — but see §5: most of it is now stock Zen |
| **Phase** | 4 |
| **Cluster** | sidebar-tabs |
| **Investigated** | 2026-08-25 |

This is the only Phase 4 mod whose license permits copying, and it is also the one
with the largest overlap with stock Zen. It was written in May 2025, when Zen had
no folders at all; Zen 1.21 ships `zen-folder` (`src/zen/folders/`), which is the
same idea done natively. What survives is a short list of things Zen's folders
still do not do.

**User decision, 2026-08-25:** *full ATG parity*. The investigation below found
that "full parity" is much cheaper than it looks — see §6.

## 1. What it actually does

- [x] B1 — **Named, collapsible groups of tabs in the vertical tab strip.**
- [x] B2 — **A colour per group.** Chosen from a swatch row; the label, the group
      line and the collapsed pill all take the colour.
- [x] B3 — **An icon per group** — an emoji picker, or a chosen favicon.
- [x] B4 — **"Arc-style" group rendering** (opt-in pref): the group reads as a
      titled section with a coloured rule rather than as a pill.
- [x] B5 — **A collapsed group still shows its selected tab**, so the active tab
      never disappears when you collapse the group it is in.
- [ ] B6 — **A group context menu** (`#advanced-tab-groups-context-menu`) with
      rename / change colour / ungroup / close.
- [ ] B7 — **A "grain" texture overlay** on the group container (opt-in).
- [ ] B8 — **Forces `browser.tabs.groups.enabled`** so that Firefox's tab-group
      machinery is on in Zen.

Prefs it exposes: `browser.tabs.groups.enabled` (forced true),
`browser.tabs.groups.arc-style`, `browser.tabs.groups.allow-emojis`.
The user's profile sets **none** of them — the mod runs entirely at defaults, so
arc-style and emoji icons are off in practice.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 groups | **Zen** | `zen-folder` is this, natively, with subfolders, drag-and-drop, spaces and session restore that the mod never had. Trance styles Zen's, it does not add a second grouping system. |
| B2 colour per group | **Keep** | The one genuinely missing capability. Cheap — see §6. |
| B3 icon per group | **Zen** | Zen already ships `context_zenFolderChangeIcon` in `#zenFolderActions` (`tab-context-zen-edit-icon`) and `nsZenFolder.iconURL`. Trance does not build a second picker. |
| B4 arc-style | **Keep** | Pure CSS on Zen's existing label container. One pref, zero runtime cost when off. |
| B5 collapsed group keeps its selected tab | **Zen** | Zen's `folder-active` / `has-active` mechanism already does this, and does it across nested folders, which ATG cannot. |
| B6 own context menu | **Drop** | Zen owns `#zenFolderActions`. Trance adds one item to it rather than shipping a parallel menu. |
| B7 grain texture | **Drop** | A full-size decorative overlay per group for a texture effect. Exactly the kind of always-on compositing this project exists to remove. |
| B8 forces `browser.tabs.groups.enabled` | **Drop** | Zen already depends on it. Nothing to force. |

"Full parity" therefore means B2 + B4 in Trance, with B1/B3/B5 satisfied by Zen
and B6/B7/B8 deliberately dropped. Nothing the user can see is lost.

## 3. What it touches

- **DOM nodes:** `tab-group:not([split-view-group])`,
  `.tab-group-label-container`, `.tab-group-label`, `.tab-group-icon-container`,
  `.tab-group-icon`, `.tab-group-container`, `.tab-close-button`, and a
  `.grain` element it injects per group.
- **Zen modules it depends on:** none directly — it predates `ZenFolders` and
  targets Firefox's `MozTabbrowserTabGroup` underneath it.
- **Chrome URLs it injects:** `advanced-tab-groups.uc.js` (1,658 lines) into
  `browser.xhtml`, plus `userChrome.css` through Sine.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Restyles `.tab-group-label-container` and `.tab-group-container`, which Zen's `zen-folders.css` also owns. Two owners, one element. |
| §3.2 Own `MutationObserver` | **Yes** | Watches the tab strip to attach its icon container and grain element to newly created groups. |
| §3.3 `backdrop-filter` | No | |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | No | |
| §3.6 `setInterval` / `setTimeout` loop | Partial | Deferred re-application after group changes. |
| §3.7 Load-order race | **Yes** | A `.uc.js` injected into `browser.xhtml` that patches elements Zen's own components create; whichever runs second wins. |
| §3.8 Duplicate icons / fonts | **Yes** | Its own group-icon glyphs alongside Zen's folder icon and New Icons (11). |

## 5. Overlap

- **With stock Zen:** near-total. `zen-folder extends MozTabbrowserTabGroup`,
  supports nesting, live folders, per-space folders, an icon picker, a context
  menu, and collapsed-with-active-tab. ATG is the 2025 answer to a problem Zen
  has since solved in-tree.
- **With Firefox:** tab-group colour is **already a platform feature**.
  `MozTabbrowserTabGroup.color` (`engine/browser/components/tabbrowser/content/tabgroup.js:260`)
  writes `--tab-group-color` and friends as inline custom properties, the palette
  lives in `engine/browser/themes/shared/tabbrowser/tab.tokens.css`, and
  `TabGroupState.sys.mjs:73` persists the colour across restarts. Zen sets
  `folder.color = "zen-workspace-color"` on creation
  (`src/zen/folders/ZenFolders.mjs:700`) — a sentinel with no matching token, so
  today the property is set and nothing consumes it.
- **With other mods:** Zen Folder Tree Connectors (22) draws inside the same
  `.tab-group-container`; SuperPins (15) restyles the pinned section above it.
- **Merge target:** `TranceTabStrip` + `trance-tabstrip.css`.

## 6. Trance design

- **Module:** `src/zen/trance/features/tabstrip/TranceTabStrip.mjs`
- **Stylesheet:** `src/zen/trance/styles/trance-tabstrip.css`
- **Base class:** `TranceFeature`
- **Scheduler use:** none.
- **Observer use:** one `observeMutations("zen-folder", …, { childList: true, attributes: true, attributeFilter: ["trance-folder-color"] })`
  subscription, shared with the rest of the tab strip. This is *the* tab-strip
  subscription in the Phase 4 acceptance criteria — connectors, unloaded state
  and the collapsed rail are all attribute- or CSS-driven and add none.
- **New tokens:** `--trance-folder-tint`, `--trance-folder-tint-strong`,
  `--trance-folder-stroke` in `trance-tokens.css`.

**B2, colour per folder — no new storage.** Trance sets Firefox's native
`folder.color` to one of the nine platform codes. The platform writes the inline
custom properties, the platform's own palette resolves them, and
`TabGroupState` persists them. Trance's only additions are a
`trance-folder-color` attribute (so the CSS can distinguish a real colour from
Zen's `zen-workspace-color` sentinel, whose token does not exist) and a
**Folder colour** submenu appended to Zen's existing `#zenFolderActions` popup at
runtime — appended, not patched into `popups.inc`, so no upstream touchpoint and
so a disabled feature leaves no menu item behind.

**B4, arc-style — CSS only**, gated on `trance.tabstrip.folders.arc-style`.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.tabstrip.folders.colors` | bool | true | Colour-code folders |
| `trance.tabstrip.folders.arc-style` | bool | false | Section-style folder headers |

### Teardown plan

`onDisable()` removes the appended `#zenFolderActions` submenu, removes every
`trance-folder-color` attribute, and drops the mutation subscription. The
underlying `folder.color` is **not** reset: it is Firefox state, not Trance
state, and destroying it on a pref flip would lose the user's choices.

## 7. Acceptance criteria

- [x] B2 and B4 present; B1/B3/B5 verified as covered by Zen
- [x] No second grouping system, no second context menu, no second icon picker
- [x] Disabled state: no stylesheet, no menu item, no attribute, no subscription
- [x] Colour survives a restart without Trance owning any storage
- [x] Attribution in `CREDITS.md`; no code copied, so no `THIRD-PARTY.md` entry

## 8. Open questions for the user

- Nothing outstanding. Scope was confirmed 2026-08-25 ("full ATG parity"), and
  the investigation reduced that to two behaviours because Zen and Firefox
  already supply the rest.
