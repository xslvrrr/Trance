# Third-party code in Trance

Every file in this repository that contains code adapted from a third-party mod, with its
original license. Trance adapts code **only** from MIT and Apache-2.0 sources.

**Never add an entry for a GPL-3.0 or unlicensed source.** See `TRANCE.md` §7.
If you cannot name the license, you cannot use the code.

Not every Trance asset is adapted from something. `src/zen/trance/icons/*.svg` — four glyphs the
theme picker needs and the browser has none of, plus the brand mark — are original work and have no
entry below because there is nothing to attribute.

The same goes for everything in `configs/branding/trance/` as of 2026-08-27. It was Zen's raster set
until then, as a deliberate placeholder (ADR-008), and it is now generated in full from
`docs/trance/brand/mark-{black,white}.png` — original artwork — by `scripts/trance-branding.py`
(ADR-050). Nothing Zen drew ships any more, which is what `TRANCE.md` §7.4 required before any
distribution.

**Removed 2026-08-27 (ADR-039).** Trance used to ship three icon packs, two of them vendored from
Context Menu Icons under MIT. They are gone: `src/zen/trance/icons/{line,fluent,zen}/`, the three
generated `trance-icons-*.css` and both generator scripts. Their rows are struck from the table
below rather than silently dropped, because "what was once in this tree" is the question this file
exists to answer.

## Not in this repository: mods the provisioner installs

`scripts/trance-cosine.py` installs five mods into the profile at provisioning time, from their own
distributions, exactly as their own installers would. **Nothing from any of them is in this tree**,
so none is a third-party-code entry and Trance makes no licence claim over them — the same
arrangement Sine itself is under (see that script's header).

They are here on three different arguments, and each one has to be made in full, because §1's "not
a mod manager" is otherwise back on the table.

**Two are a licence question**, from opposite ends of the spectrum: what each ships is a *drawing*,
and its licence is what stops Trance shipping that drawing. A clean-room reimplementation can meet
the requirement and cannot be the thing itself.

**Two are a value question**: each opens a surface of its own, owns no element Trance owns, and
already costs about what a rewrite would have cost — so reimplementing would have removed no
conflict and bought no frames (ADR-030).

**One had neither**: 88 lines of CSS over a window Trance has no stylesheet in, so there was nothing
to conflict with and nothing to trim (ADR-033).

**And one was a third of a mod**: Trance kept the unlabelled plus and refused the radius sliders,
which left the new-tab button with two owners and a user with part of what they installed (ADR-049).

| Mod | Author | Licence | Why |
|---|---|---|---|
| New Icons (`new-icons`, Sine store) | qumeqa (`qumeqa/zen-icons`) | **none** | §7.3 forbids copying its assets or reproducing its look. It does not forbid *installing* it. ADR-024 |
| Zen Folder Tree Connectors (`ZenFolderTreeConnectors`, Sine store) | JustAdumbPrsn | **GPL-3.0** | §7.2 forbids copying any rule from it. It does not forbid *installing* it. Trance reimplemented the connectors in phase 4 and withdrew that in favour of this. ADR-027 |
| Zen Library (`zen-library`, Sine store) | 12th-devs (JustADumbPrsn) | **none** | 7,500 lines with no interval, no `MutationObserver` and no infinite animation, opening a surface nothing in Trance competes for. A rewrite would have cost weeks and arrived at the same price. ADR-030 |
| Live Calendar (`zen-live-calendar`, Sine store) | Vertex-Mods | **none** | One always-armed timer, a 60-second ICS refresh — the exact wakeup budget phase 7's own acceptance criterion set for its replacement. ADR-030 |
| Pimp your PiP (`599a1599-…`, **Zen theme store**) | shldk | **none** | 88 lines of CSS over `chrome://global/content/pictureinpicture/player.xhtml`. Every Trance sheet is loaded into `browser.xhtml`, and the one exception is a user sheet for `about:` pages, so Trance owns nothing this mod touches. ADR-033 |
| Better New Tab button (`bada16c1-…`, **neither store**) | themaster5209 (`themaster5209/zen-better-new-tab-button`) | **none** | §7.3 forbids copying anything from it. It does not forbid *installing* it. Trance reimplemented one of its three behaviours in phase 5 and withdrew that in favour of this, so the button has one owner again. Published to no marketplace: the provisioner installs it from the repository, which is how Sine installs one too. ADR-049 |

A seventh entry in `PREINSTALLED_MODS` needs an argument of its own, in this table, before it is
added.

## Entries

| Trance file | Adapted from | Original author | License | Notes |
|---|---|---|---|---|
| `src/zen/trance/images/wave-light.png` | [`sameerasw/my-internet`](https://github.com/sameerasw/my-internet) `wave-light.png` | sameerasw | **none stated — see the note below** | Shipped verbatim as the default value of `trance.surface.newtab.logo`, so that a first run with no network still has a mark. Not adapted and not the basis of anything Trance draws. |

> **`wave-light.png` is an unresolved licensing question, not a settled one.**
>
> The repository it comes from states no licence, which means all rights reserved, which means
> shipping the file in a release is redistribution without permission. That is a *different* and
> weaker position than the six preinstalled mods above: those are downloaded from their authors'
> own distributions at provisioning time and never enter this tree, which is exactly why TRANCE.md
> §7.3 permits installing them and forbids copying them.
>
> It is in the tree because the alternative is worse in a way that matters at runtime: fetching the
> default mark over the network means a first run with no connection has no mark, and it means the
> chrome making an outbound request for a decoration.
>
> Before v1.0 this needs one of: written permission from the author, replacement with artwork Trance
> owns, or the default reverting to the empty string. Removing it costs one line in
> `prefs/trance/surfaces.yaml` and one file — nothing else in the tree reads it, and every setting
> around it keeps working with a mark of the user's own choosing.

Every other entry this table has ever carried was an icon-pack file; all four were removed by
ADR-039. See below.

### Removed from the tree

Kept for provenance. Nothing listed here is in this repository any more.

| Trance file | Adapted from | Original author | License | Removed |
|---|---|---|---|---|
| `src/zen/trance/icons/fluent/*.svg` (137 files) | Context Menu Icons, `CMI/FluentUI/` | Starry (`Starry-AXQG`) | MIT · [text](licenses/MIT-Starry-AXQG.txt) | ADR-039 — assets were copied verbatim with names normalised to kebab-case |
| `src/zen/trance/icons/zen/*.svg` (147 files) | Context Menu Icons, `CMI/ZenUI/` | Starry (`Starry-AXQG`) | MIT · [text](licenses/MIT-Starry-AXQG.txt) | ADR-039 |
| `src/zen/trance/styles/trance-icons-fluent.css` | Context Menu Icons, `CMI/FluentUI/Fluent-icons.css` | Starry (`Starry-AXQG`) | MIT · [text](licenses/MIT-Starry-AXQG.txt) | ADR-039 — generated mapping, every `!important` stripped |
| `src/zen/trance/styles/trance-icons-zen.css` | Context Menu Icons, `CMI/ZenUI/Zen-icons.css` | Starry (`Starry-AXQG`) | MIT · [text](licenses/MIT-Starry-AXQG.txt) | ADR-039 |

### Investigated under a permissive licence, but not adapted

Source was read — which the licence permits — and the conclusion was that
writing it against Trance's token layer was less work than porting. Recorded
here so a later reader does not have to re-derive that no code moved.

| Mod | Author | License | Where it landed |
|---|---|---|---|
| Zen Context Menu | KiKaraage | MIT · [text](licenses/MIT-KiKaraage.txt) | `trance-chrome.css`, menu tint only — 32 of its 35 behaviours were dropped (`docs/trance/mods/zen-context-menu.md` §2) |
| Hide Extension Name | ch4og | MIT · [text](licenses/MIT-ch4og.txt) | `trance-chrome.css` — the mod is three lines of the most obvious possible CSS; Trance's version is the same rule without `!important` |
| Zen Custom URL Bar | rasyidrafi | Apache-2.0 · [text](licenses/Apache-2.0-rasyidrafi.txt) | `trance-chrome.css`, the focus dim only; the colour and radius work belongs to `TranceSurfaces`' overlay region |
| Zen Compact Transparent Mode | rasyidrafi | Apache-2.0 · [text](licenses/Apache-2.0-rasyidrafi.txt) | `trance-surfaces.css`, as the `compact` preset (Phase 3) |

## Rules for adding an entry

1. The upstream license must be MIT or Apache-2.0, confirmed from a `LICENSE` file in the
   source repository — not from a README badge, not from a marketplace listing.
2. The original copyright header stays in the file.

   **Ordering exception, added 2026-08-25.** `npm run lc` (surfer's
   `license-check`) reads only the **first five lines** of a file, so the MPL
   boilerplate has to come first or the file fails the check. Put the MPL block
   at the top and the original notice immediately below it, in the same comment.
   Redistributing an MIT file under the MPL is what MIT's grant of the right to
   sublicense allows, and retaining the original notice is what it requires —
   both are satisfied by that order.

   Do **not** reach for surfer's `# Ignore license in this file` token instead.
   Its regex carries the `g` flag and is reused across files, so `lastIndex`
   persists between calls and the token matches on roughly every other file.
   Measured: 142 of 284 vendored icons failed with it.
3. Apache-2.0 sources: preserve any `NOTICE` content and note modifications.
4. Copy the full license text into `docs/trance/licenses/<spdx>-<author>.txt` if it is not
   already there.
5. Add the row above and a row in `CREDITS.md`.

## Template header for an adapted file

```js
/*
 * Copyright (c) <year> <original author>
 * SPDX-License-Identifier: MIT
 *
 * Adapted from <mod name> (<url>) for Trance.
 * Modifications: <what changed and why>
 */

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
```
