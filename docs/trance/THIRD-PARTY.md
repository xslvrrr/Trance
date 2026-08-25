# Third-party code in Trance

Every file in this repository that contains code adapted from a third-party mod, with its
original license. Trance adapts code **only** from MIT and Apache-2.0 sources.

**Never add an entry for a GPL-3.0 or unlicensed source.** See `TRANCE.md` §7.
If you cannot name the license, you cannot use the code.

## Entries

| Trance file | Adapted from | Original author | License | Notes |
|---|---|---|---|---|
| `src/zen/trance/icons/fluent/*.svg` (137 files) | Context Menu Icons, `CMI/FluentUI/` | Starry (`Starry-AXQG`) | MIT · [text](licenses/MIT-Starry-AXQG.txt) | Assets copied verbatim. Only the file names changed, normalised to kebab-case for `TranceIcons` (`TabGroup-add` → `tab-group-add`, `unloadTab` → `unload-tab`, `folder_sync_convert` → `folder-sync-convert`). |
| `src/zen/trance/icons/zen/*.svg` (147 files) | Context Menu Icons, `CMI/ZenUI/` | Starry (`Starry-AXQG`) | MIT · [text](licenses/MIT-Starry-AXQG.txt) | As above. |
| `src/zen/trance/styles/trance-icons-fluent.css` | Context Menu Icons, `CMI/FluentUI/Fluent-icons.css` | Starry (`Starry-AXQG`) | MIT · [text](licenses/MIT-Starry-AXQG.txt) | **Generated** by `scripts/trance-icons.py` from the upstream file. The selector→glyph mapping is adapted; nothing else is. Modifications: every `!important` removed (banned by `TRANCE.md` §6.2 rule 1 and unnecessary for an author sheet loaded last); relative `url()` rewritten to `chrome://browser/content/trance-icons/fluent/`; assignments pointing at the browser's own `chrome://` glyphs dropped as no-ops; assignments for elements belonging to the mod itself or to other mods dropped; assignments with no matching glyph in this pack dropped; all rules nested under `:root[trance][trance-chrome-icons]`. |
| `src/zen/trance/styles/trance-icons-zen.css` | Context Menu Icons, `CMI/ZenUI/Zen-icons.css` | Starry (`Starry-AXQG`) | MIT · [text](licenses/MIT-Starry-AXQG.txt) | As above, for the ZenUI pack. |

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
   both are satisfied by that order. See any file in
   `src/zen/trance/icons/` for the exact shape.

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
