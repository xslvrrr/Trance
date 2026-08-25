# Credits

Trance exists because of Zen Browser and the Zen/Sine mod community. Nothing here is a claim of
originality over their ideas — Trance reimplements behaviours so they can live together in one
browser without conflicting.

## Upstream

- **[Zen Browser](https://github.com/zen-browser/desktop)** — Zen OSS Team. MPL-2.0.
  Trance is a fork of Zen. Everything Trance does stands on Zen's work.
- **[Mozilla Firefox](https://hg.mozilla.org/mozilla-central/)** — MPL-2.0.
- **[Sine](https://github.com/CosmoCreeper/Sine)** / **[sineorg/store](https://github.com/sineorg/store)**
  — CosmoCreeper and contributors. The mod ecosystem Trance draws its feature set from.

## Mods whose behaviour Trance reimplements

Listed with author, license, and whether any code was adapted. Trance copies code **only** from
MIT and Apache-2.0 sources, with headers and license text retained (see `THIRD-PARTY.md`).

| Mod | Author | License | Code adapted? |
|---|---|---|---|
| Advanced Tab Groups | Vertex-Mods (12th-devs) | MIT | **no** — Phase 4 landed. Investigation found Zen's `zen-folder` and Firefox's own tab-group colour already cover it; Trance adds a colour submenu and a section-style header, both written against the platform |
| Better New Tab Button | themaster5209 | none | no — clean-room. Phase 5 landed: the unlabelled centred plus and its press rotation; the per-component radius sliders were dropped for Trance's single radius scale |
| BetterZenGradientPicker | JustAdumbPrsn | none | no — clean-room |
| Context Menu Icons | Starry-AXQG | MIT | **yes** — Phase 5 landed. Both icon packs are copied verbatim and the selector→glyph mapping is adapted by `scripts/trance-icons.py`. See `THIRD-PARTY.md`. Its item-hiding, menu-folding script and bookmark-bar extras were dropped |
| Customize Collapsed Sidebar | Ciuriya | none | no — clean-room. Phase 4 landed: the collapsed rail, defaulting to the user's own `mod.ccs.*` values |
| Deta Loading Bar | rasyidrafi | MIT | **no** — Phase 6 landed. Licence permits adapting; nothing was worth adapting. The original is CSS-only because a stylesheet cannot ask how far a page has loaded, and it pays for that with an infinite animation on a layout property. Trance listens to `nsIWebProgressListener` instead |
| Floating Status Bar | AmirhBeigi | none | no — **nothing built.** Phase 6 investigation changed the verdict to ZEN: `zen.theme.styled-status-panel` already does it and is on by default on macOS |
| Hide Extension Name | ch4og | MIT | **no** — Phase 5 landed. The mod is three lines of the most obvious possible CSS; Trance writes the same rule without `!important`. Licence recorded anyway |
| Live Calendar | Vertex-Mods | none | no — clean-room |
| **Nebula** | JustADumbPrsn | GPL-3.0 | **no — clean-room, mandatory.** Phase 3 landed: surface layer, no source read |
| New Icons | qumeqa | none | no — clean-room. Phase 5 landed: its *coverage requirement* — that the icon set reaches the toolbar, panels and the site-information panel — met from the MIT packs. No asset or rule came from this mod |
| Nova UI | qumeqa | none | no — clean-room. Phase 3 landed the `flat` preset's geometry; Phase 5 landed the panel and menu spacing, radius, edges and scrollbars — all from tokens that already existed. Its mute-button visualiser, custom font and essentials flattening were dropped |
| Pimp your PiP | (store-hosted) | unknown | no — clean-room |
| Render.js | SehajveerSingh2005 | none | no — **nothing built.** Phase 6 investigation changed the verdict to DEFER: all five behaviours duplicate owners Trance has already assigned. Answers TRANCE.md §16 Q8 |
| SuperPins | CosmoCreeper | MIT | **no** — Phase 4 landed. Of eighteen knobs, two survived investigation: sticky pinned tabs (CSS) and lazy pinned tabs (a Firefox pref, surfaced not reimplemented) |
| Tab Closing Bubble Animation | Zylaah | none | no — clean-room. Phase 6 landed: the burst, on `TabClose` rather than a `MutationObserver`, through `TranceMotion` rather than keyframes plus a timer |
| Transparent Zen | sameerasw | none | no — clean-room. Phase 3 landed: the `flat` surface preset |
| Unloaded Tabs | qumeqa | none | no — clean-room. Phase 4 landed: the sole owner of the unloaded-tab appearance, absorbing SuperPins' competing strike-through and dimming knobs |
| Zen Compact Transparent Mode | rasyidrafi | Apache-2.0 | **no** — Phase 3 landed clean-room anyway; adapting was more work than writing it against the token layer |
| Zen Context Menu | KiKaraage | MIT | **no** — Phase 5 landed. Thirty-two hide-toggles dropped; the workspace-colour menu tint kept and written against `--trance-surface-bg` |
| Zen Custom URL Bar | rasyidrafi | Apache-2.0 | **no** — Phase 5 landed. Eight prefs became two; the page-recede effect is written against Trance's duration and blur tokens, the colour and radius work belongs to `TranceSurfaces` |
| Zen Folder Tree Connectors | JustAdumbPrsn | GPL-3.0 | **no — clean-room, mandatory.** Phase 4 landed: trunk and elbows in CSS alone, no source read. The original ships a `.uc.js`; Trance styles `.zen-tab-group-start`, an anchor Zen already puts in every folder |
| **Zen Library** | 12th-devs | none | no — clean-room |

## Bundled extensions

Trance installs these from addons.mozilla.org via enterprise policy. It does not redistribute
them and does not modify them.

uBlock Origin (Raymond Hill) · SponsorBlock (Ajay Ramachandran) · Privacy Badger (EFF) ·
Dark Reader (Alexander Shutau) · ClearURLs (Kevin Röbert) · Return YouTube Dislike ·
Zen Internet (sameerasw)

## Relicensing outreach

Twelve of the mods above have no license file, which means all rights reserved. We reimplement
rather than copy. If an author is willing to license their work (MIT or MPL-2.0), we would much
rather adapt and credit than rebuild. Status tracked here:

| Mod | Author | Contacted | Outcome |
|---|---|---|---|
| Zen Library | 12th-devs | not yet | — |
| Nova UI | qumeqa | not yet | — |
| New Icons | qumeqa | not yet | — |
| Live Calendar | Vertex-Mods | not yet | — |
| Transparent Zen | sameerasw | not yet | — |

## Investigation notes

Behaviour is documented in `docs/trance/mods/<id>.md` before any code is written
(`TRANCE.md` §8.2). For the GPL-3.0 and unlicensed mods those documents describe *observable
behaviour only* — no source was read while writing them, which is what keeps the
reimplementation clean-room rather than merely uncopied.

Landed so far: `nebula.md`, `transparent-zen.md`, `zen-compact-transparent-mode.md`,
`nova-ui.md` (both portions), `advanced-tab-groups.md`, `superpins.md`,
`customize-collapsed-sidebar.md`, `unloaded-tabs.md`, `zen-folder-tree-connectors.md`,
`context-menu-icons.md`, `zen-context-menu.md`, `new-icons.md`,
`better-new-tab-button.md`, `hide-extension-name.md`, `zen-custom-urlbar.md`,
`deta-loading-bar.md`, `tab-closing-bubble.md`, `floating-status-bar.md`, `render-js.md`.

Two of those investigations ended with the verdict changed and no code written — Floating Status
Bar to `ZEN`, Render.js to `DEFER`. That is the process working: §8.2 exists so that the decision
to build is made against what a mod actually does, not against its presence in a list.
