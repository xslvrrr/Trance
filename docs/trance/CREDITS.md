# Credits

Trance exists because of Zen Browser and the Zen/Sine mod community. Nothing here is a claim of
originality over their ideas — Trance reimplements behaviours so they can live together in one
browser without conflicting.

## Upstream

- **[Zen Browser](https://github.com/zen-browser/desktop)** — Zen OSS Team. MPL-2.0.
  Trance is a fork of Zen. Everything Trance does stands on Zen's work.
- **[Mozilla Firefox](https://hg.mozilla.org/mozilla-central/)** — MPL-2.0.
- **[Sine](https://github.com/CosmoCreeper/Sine)** / **[sineorg/store](https://github.com/sineorg/store)**
  — CosmoCreeper and contributors. The mod ecosystem Trance draws its feature set from, shipped
  preinstalled (ADR-018) and fetched at provisioning time rather than vendored.

## Mods Trance installs rather than reimplements

- **[New Icons](https://github.com/qumeqa/zen-icons)** — qumeqa. Installed by
  `scripts/trance-cosine.py` from the Sine store, at whatever version its author is publishing.
  It is not in this repository and Trance claims nothing over it; the browser simply ships with it
  installed, because a clean-room reimplementation can match its coverage but not its icons
  (ADR-024). Sine's own updater owns it from then on, and uninstalling it is supported — the
  browser's own icons are what you get back, since Trance ships no pack of its own (ADR-039).
- **[Zen Folder Tree Connectors](https://github.com/JustAdumbPrsn/ZenFolderTreeConnectors)** —
  JustAdumbPrsn, GPL-3.0. Installed the same way, for the same reason from the other end of the
  licence spectrum: no rule from it may be copied, so Trance drew its own trunk and elbows in
  phase 4 — and a reimplementation of a drawing is an approximation of it. Trance withdrew that in
  favour of installing the author's own work (ADR-027) and now draws no connectors itself, so
  uninstalling this leaves folders with none.
- **[Zen Library](https://github.com/12th-devs/Zen-Library)** — 12th-devs (JustADumbPrsn),
  unlicensed. Installed the same way, for a different reason: this one is not a drawing, it is a
  finished 7,500-line application that opens a surface of its own and competes with nothing Trance
  owns. Reimplementing it would have removed no conflict and arrived at the same runtime cost
  (ADR-030). Trance builds no library of its own, so uninstalling this leaves none.
- **[Live Calendar](https://github.com/Vertex-Mods/Zen-Live-Calendar)** — Vertex-Mods, unlicensed.
  Installed for the same reason. Phase 7 was going to rebuild it on `TranceScheduler.onWallClock`
  to hold it to one timer wakeup per minute; its one always-armed timer is already a 60-second
  refresh (ADR-030). Setup is manual — it needs your own calendar's secret ICS URL, which nothing
  can provision for you.
- **[Pimp your PiP](https://github.com/zen-browser/theme-store/tree/main/themes/599a1599-e6ab-4749-ab22-de533860de2c)**
  — shldk, unlicensed. The first mod Trance installs from the **Zen theme store** rather than the
  Sine store. Phase 10 was going to reimplement it; it is 88 lines of CSS over the
  Picture-in-Picture player, and Trance loads no stylesheet in that window at all — so there was
  neither a second owner to remove nor a cost to cut, and a rewrite would have been an
  approximation of someone else's drawing (ADR-033). Trance restyles no PiP window of its own, so
  uninstalling this gives you Firefox's player back.

## Mods whose behaviour Trance reimplements

Listed with author, license, and whether any code was adapted. Trance copies code **only** from
MIT and Apache-2.0 sources, with headers and license text retained (see `THIRD-PARTY.md`).

| Mod | Author | License | Code adapted? |
|---|---|---|---|
| Advanced Tab Groups | Vertex-Mods (12th-devs) | MIT | **no** — Phase 4 landed. Investigation found Zen's `zen-folder` and Firefox's own tab-group colour already cover it; Trance adds a colour submenu and a section-style header, both written against the platform |
| Better New Tab Button | themaster5209 | none | no — clean-room. Phase 5 landed: the unlabelled centred plus and its press rotation; the per-component radius sliders were dropped for Trance's single radius scale |
| BetterZenGradientPicker | JustAdumbPrsn | none | no — clean-room, no source read. Phase 8 landed: the lightness slider, translucency, the gradient-angle knob, eight palettes, saved themes and exact hex entry, all added to Zen's own picker rather than replacing it |
| Context Menu Icons | Starry-AXQG | MIT | **withdrawn.** Phase 5 landed its two packs, copied verbatim with the mapping adapted; ADR-039 removed them. Trance ships no icon pack, so nothing from this mod is in the tree any more. Provenance is kept in `THIRD-PARTY.md` |
| Customize Collapsed Sidebar | Ciuriya | none | no — clean-room. Phase 4 landed: the collapsed rail, defaulting to the user's own `mod.ccs.*` values |
| Deta Loading Bar | rasyidrafi | MIT | **no** — Phase 6 landed. Licence permits adapting; nothing was worth adapting. The original is CSS-only because a stylesheet cannot ask how far a page has loaded, and it pays for that with an infinite animation on a layout property. Trance listens to `nsIWebProgressListener` instead |
| Floating Status Bar | AmirhBeigi | none | no — **nothing built.** Phase 6 investigation changed the verdict to ZEN: `zen.theme.styled-status-panel` already does it and is on by default on macOS |
| Hide Extension Name | ch4og | MIT | **no** — Phase 5 landed. The mod is three lines of the most obvious possible CSS; Trance writes the same rule without `!important`. Licence recorded anyway |
| Live Calendar | Vertex-Mods | none | **no — and not reimplemented either.** Phase 7 investigation changed the verdict to PREINSTALL: Trance *installs this mod* from the author's own repository (ADR-030). See the section above |
| **Nebula** | JustADumbPrsn | GPL-3.0 | **no — clean-room, mandatory.** Phase 3 landed: surface layer, no source read |
| New Icons | qumeqa | none | **no — and no longer reimplemented either.** Trance *installs this mod*, from the author's own repository, at provisioning time (ADR-024): a clean-room stroke set can meet the coverage requirement but cannot be these icons, and nothing about an absent licence forbids installing the work the way any user would. Trance's own **Line** fallback pack was withdrawn by ADR-039 — with the mod installed by default it was a second owner nobody was expected to use, and without it the browser's own icons are the fallback |
| Nova UI | qumeqa | none | no — clean-room. Phase 3 landed the `flat` preset's geometry; Phase 5 landed the panel and menu spacing, radius, edges and scrollbars — all from tokens that already existed. Its mute-button visualiser, custom font and essentials flattening were dropped |
| Pimp your PiP | shldk (store-hosted) | none | **no — and not reimplemented either.** Phase 10 investigation changed the verdict to PREINSTALL: Trance *installs this mod* from the Zen theme store (ADR-033). See the section above |
| Render.js | SehajveerSingh2005 | none | no — **nothing built.** Phase 6 investigation changed the verdict to DEFER: all five behaviours duplicate owners Trance has already assigned. Answers TRANCE.md §16 Q8 |
| SuperPins | CosmoCreeper | MIT | **no** — Phase 4 landed. Of eighteen knobs, two survived investigation: sticky pinned tabs (CSS) and lazy pinned tabs (a Firefox pref, surfaced not reimplemented) |
| Tab Closing Bubble Animation | Zylaah | none | no — clean-room. Phase 6 landed: the burst, on `TabClose` rather than a `MutationObserver`, through `TranceMotion` rather than keyframes plus a timer |
| Transparent Zen | sameerasw | none | no — clean-room. Phase 3 landed: the `flat` surface preset |
| Unloaded Tabs | qumeqa | none | no — clean-room. Phase 4 landed: the sole owner of the unloaded-tab appearance, absorbing SuperPins' competing strike-through and dimming knobs |
| Zen Compact Transparent Mode | rasyidrafi | Apache-2.0 | **no** — Phase 3 landed clean-room anyway; adapting was more work than writing it against the token layer |
| Zen Context Menu | KiKaraage | MIT | **no** — Phase 5 landed. Thirty-two hide-toggles dropped; the workspace-colour menu tint kept and written against `--trance-surface-bg` |
| Zen Custom URL Bar | rasyidrafi | Apache-2.0 | **no** — Phase 5 landed. Eight prefs became two; the page-recede effect is written against Trance's duration and blur tokens, the colour and radius work belongs to `TranceSurfaces` |
| **Zen Library** | 12th-devs | none | **no — and not reimplemented either.** Phase 7 investigation changed the verdict to PREINSTALL: Trance *installs this mod* from the author's own repository (ADR-030). See the section above |

## Bundled extensions

Trance installs these from addons.mozilla.org via enterprise policy. It does not redistribute
them and does not modify them.

uBlock Origin (Raymond Hill) · SponsorBlock (Ajay Ramachandran) · Privacy Badger (EFF) ·
Dark Reader (Alexander Shutau) · ClearURLs (Kevin Röbert) · Return YouTube Dislike ·
Zen Internet (sameerasw)

The mechanism, as of Phase 9, is `src/zen/trance/distribution/policies.json`: seven
`ExtensionSettings` entries in `normal_installed` mode, each naming the extension's own
`addons.mozilla.org` download URL. Nothing is vendored, nothing is patched, nothing is frozen at a
version, and none of them is configured on your behalf — no filter list, no theme, no category
selection. `TranceFirstRun` reports, once, which of them arrived (ADR-032).

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
| Pimp your PiP | shldk | not yet | — |

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
