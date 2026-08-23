# Third-party code in Trance

Every file in this repository that contains code adapted from a third-party mod, with its
original license. Trance adapts code **only** from MIT and Apache-2.0 sources.

**Never add an entry for a GPL-3.0 or unlicensed source.** See `TRANCE.md` §7.
If you cannot name the license, you cannot use the code.

## Entries

| Trance file | Adapted from | Original author | License | Notes |
|---|---|---|---|---|
| *(none yet — Phase 0)* | | | | |

## Rules for adding an entry

1. The upstream license must be MIT or Apache-2.0, confirmed from a `LICENSE` file in the
   source repository — not from a README badge, not from a marketplace listing.
2. The original copyright header stays in the file, above the Trance header.
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
