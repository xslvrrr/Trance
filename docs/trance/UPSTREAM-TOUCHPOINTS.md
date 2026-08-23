# Upstream touchpoints

Every file outside `src/zen/trance/`, `prefs/trance/`, `docs/trance/`, and
`configs/branding/trance/` that Trance modifies. This list is the rebase hot-spot map:
when `git rebase upstream/dev` conflicts, it will be in one of these files.

**Keep this list under ~15 entries.** If a change can be made in a Trance-owned file instead,
make it there. Adding an entry requires a matching ADR in `DECISIONS.md`.

Mark every change in-place:

```js
// >>> TRANCE
…
// <<< TRANCE
```
```css
/* >>> TRANCE */
…
/* <<< TRANCE */
```
```yaml
# >>> TRANCE
…
# <<< TRANCE
```

---

## Current touchpoints

| # | File | Change | Phase | ADR |
|---|---|---|---|---|
| — | *(none yet — Phase 0)* | | | |

## Planned touchpoints

These are anticipated and pre-approved by `TRANCE.md` §11.3. Move them to the table above when
they actually land.

| File | Planned change | Phase |
|---|---|---|
| `src/zen/moz.build` | Add `"trance"` to `DIRS` | 2 |
| `src/zen/ZenComponents.manifest` | `#include trance/TranceComponents.manifest` | 2 |
| `src/zen/common/ZenPreloadedScripts.js` | Import Trance core modules, then features, in order | 2 |
| `src/zen/common/styles/zen-theme.css` | Single `@import` of `chrome://browser/content/trance-styles/trance.css` | 2 |
| `surfer.json` | `name`, `vendor`, `appId`, `binaryName`, `brands.trance`, `updateHostname` | 1 |
| `prefs/zen/mods.yaml` | Replace `zen-browser.app` injection URL | 1 |
| `README.md` | Rewrite for Trance | 1 |
| `build/AppDir/distribution/policies.json` | Merge `ExtensionSettings` | 9 |
| `src/zen/tabs/**` or `src/zen/folders/**` | Extension points for the Trance tab strip | 4 |
| `src/zen/urlbar/**` | Extension points for the Trance urlbar treatment | 5 |
| `.github/workflows/**` | Trance CI matrix | 12 |

## Notes on specific files

### `src/zen/common/ZenPreloadedScripts.js`
Import order is load-bearing. Trance core modules (`TranceTokens`, `TranceScheduler`,
`TranceObserverHub`, `TranceMotion`) must come **after** Zen's own modules and **before** any
Trance feature module. Custom elements go in the `customZenElements` array, not the `scripts`
array, so they stay lazily created.

### `src/zen/common/styles/zen-theme.css`
Marked `*` in `jar.inc.mn` — it is **preprocessed**. `#ifdef`/`@VAR@` syntax is available;
plain CSS comments are still fine. Only one `@import` line goes here; everything else cascades
from `trance.css`.

### `src/zen/mods/ZenMods.mjs:317`
Hardcodes the theme-store URL:
`https://zen-browser.github.io/theme-store/themes/${modId}/theme.json`
Only change this if ADR-004 is superseded.

### `surfer.json`
`name`, `vendor`, `appId`, `binaryName` are **global**, not per-brand. Changing `appId` orphans
existing profiles — a one-way door. Do it once, in Phase 1.
