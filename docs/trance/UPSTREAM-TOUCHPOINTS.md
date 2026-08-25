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
| 1 | `surfer.json` | `name`, `vendor`, `appId`, `binaryName`, single `brands.trance`, `updateHostname` | 1 | ADR-006, ADR-009 |
| 2 | `configs/common/mozconfig` | `--with-app-basename`, `MOZ_APP_BASENAME`, `--with-distribution-id`, `MOZ_SOURCE_REPO` | 1 | ADR-007 |
| 3 | `configs/branding/release/**` → `configs/branding/trance/**` | Renamed; `configs/branding/twilight/**` deleted | 1 | ADR-006, ADR-008 |
| 4 | `prefs/zen/mods.yaml` | Drop the `zen-browser.app` injection grant | 1 | ADR-006 |
| 5 | `package.json` | `name`, repo/bugs/homepage URLs, `ci` script brand; `locales` script chained onto `import` | 1, 4 | ADR-006, ADR-017 |
| 6 | `README.md` | Rewritten for Trance | 1 | — |
| 7 | `src/browser/base/content/zen-assets.jar.inc.mn` | One `#include` of `src/zen/trance/jar.inc.mn` | 2 | — |
| 8 | `src/zen/common/ZenPreloadedScripts.js` | One import of `TranceCore.mjs`, last in the list | 2 | — |
| 9 | `src/-stylelintrc-js.patch` (`.stylelintrc.js`) | Register the Trance stylelint plugin; enable its 8 rules for `zen/trance/**` | 2 | — |
| 10 | `src/browser/components/preferences/preferences-xhtml.patch` | `about:preferences#trance` nav button + `#include` of `tranceSettings.inc.xhtml` | 2 | ADR-013 |
| 11 | `src/browser/components/preferences/preferences-js.patch` | `register_module("paneTrance", …)` and allow the pane past the SRD section gate | 2 | ADR-013 |
| 12 | `src/zen/tests/moz.build` | One entry: `"trance/browser.toml"` | 2 | — |
| 13 | `src/toolkit/moz-configure.patch` (`toolkit/moz.configure`) | `MOZ_APP_PROFILE`, `MOZ_APP_VENDOR` default, distribution-id default, Linux user appdir | 1 | ADR-014 |
| 14 | `src/browser/moz-configure.patch` (`browser/moz.configure`) | `imply_option("MOZ_APP_VENDOR", "Trance")` | 1 | ADR-014 |

## Planned touchpoints

These are anticipated and pre-approved by `TRANCE.md` §11.3. Move them to the table above when
they actually land.

| File | Planned change | Phase |
|---|---|---|
| `src/zen/moz.build` | Add `"trance"` to `DIRS` — **only when Trance ships C++, XPIDL, an XPCOM manifest or a `resource:///modules/` module.** Not needed for chrome-packaged files (ADR-012) | — |
| `src/zen/ZenComponents.manifest` | `#include trance/TranceComponents.manifest` — same condition (ADR-012) | — |
| ~~`src/zen/common/styles/zen-theme.css`~~ | ~~Single `@import` of `trance.css`~~ — **not needed.** Stylesheets load dynamically so a disabled Trance costs nothing (ADR-010) | — |
| `build/AppDir/distribution/policies.json` | Merge `ExtensionSettings` | 9 |
| `src/zen/tabs/**` or `src/zen/folders/**` | Extension points for the Trance tab strip | 4 |
| `src/zen/urlbar/**` | Extension points for the Trance urlbar treatment | 5 |
| `.github/workflows/**` | Trance CI matrix | 12 |

## Notes on specific files

### `configs/common/mozconfig`
Three of the four Trance changes here have no surfer equivalent — surfer only templates
`${binName}`, `${brandingDir}`, `${appId}` and `${changeset}` into this file, so app basename,
distribution id and source repo have to be edited in place.

- `MOZ_APP_BASENAME` / `--with-app-basename` name the **profile directory**. Changing it is the
  one-way door: existing profiles are orphaned, not migrated.
- `--with-distribution-id` is the first half of the macOS bundle identifier. Gecko computes it as
  `<distribution-id>.<MOZ_MACBUNDLE_ID>`, and surfer writes `MOZ_MACBUNDLE_ID` from `surfer.json`
  `appId` into the generated `browser/branding/<brand>/configure.sh`. So
  `app.trance-browser` + `trance` → `app.trance-browser.trance`.

### `package.json` — the `locales` step
`npm run import` ends with `npm run locales`
(`python3 scripts/copy_language_pack.py en-US`), which copies `locales/en-US/browser/**` into
`engine/browser/locales/en-US/`. Upstream only ran that script from
`scripts/download-language-packs.sh` (CI), so a local tree lost Zen's nine `zen-*.ftl` files on
every `surfer download` / `surfer reset` — and one missing linked `.ftl` makes Fluent yield zero
bundles for the whole document, which blanks every label and every Fluent-provided `<key>` in the
window. See ADR-017.

### `prefs/zen/mods.yaml`
The `zen.injections.match-urls` entry could not simply be deleted:
`src/zen/common/sys/ZenActorsManager.sys.mjs:34` reads it with `getStringPref()` and no fallback,
and splices the result straight into a JSWindowActor `matches` array, so the value must also parse
as a match pattern. Official builds therefore get `https://trance.invalid/*` — syntactically valid,
never resolvable — rather than nothing.

### `.surfer/` (not tracked, but load-bearing)
surfer keeps the active brand in `.surfer/dynamicConfig.brand.json`, which is gitignored. A fresh
clone defaults to `unofficial` and will silently build with Firefox's placeholder branding.
`scripts/trance-env.sh` pins it to `trance` on every sourced shell.

### `src/zen/common/ZenPreloadedScripts.js`
Import order is load-bearing. Trance core modules (`TranceTokens`, `TranceScheduler`,
`TranceObserverHub`, `TranceMotion`) must come **after** Zen's own modules and **before** any
Trance feature module. Custom elements go in the `customZenElements` array, not the `scripts`
array, so they stay lazily created.

### `src/zen/common/styles/zen-theme.css` — not a touchpoint after all
The plan was one `@import` of `trance.css` here. ADR-010 replaced it: `TranceStyles` loads the
sheet through `nsIDOMWindowUtils`, keyed on `trance.enabled`, so a disabled Trance leaves nothing
in the style set. Do not add the `@import` back — it would silently break the Phase 2 acceptance
criterion.

### `.stylelintrc.js`
The Trance plugin lives in a Trance-owned directory (`src/zen/trance/lint/`) and is referenced by
relative path. Because `npm run import` **symlinks** Trance sources into `engine/`, the plugin's
real path is under `src/`, where no `node_modules` chain reaches stylelint — so it resolves
`stylelint` against `process.cwd()` instead of by bare specifier. If lint ever fails with
`Cannot find package 'stylelint'`, that is why.

### `src/browser/components/preferences/preferences.{xhtml,js}`
Zen already patches both, so Trance's changes extend an existing patch rather than creating one.
Regenerate with `npm run export browser/components/preferences/preferences.xhtml` after editing
`engine/`, never by hand-editing the `.patch` file.

The nav button uses literal text and the pane uses literal `label=` attributes: Zen's preference
strings come from downloaded language packs, so there is no in-tree `.ftl` to add ids to
(ADR-013).

### `src/zen/mods/ZenMods.mjs:317`
Hardcodes the theme-store URL:
`https://zen-browser.github.io/theme-store/themes/${modId}/theme.json`
Only change this if ADR-004 is superseded.

### `surfer.json`
`name`, `vendor`, `appId`, `binaryName` are **global**, not per-brand. Changing `appId` orphans
existing profiles — a one-way door. Do it once, in Phase 1.

### `src/toolkit/moz-configure.patch` and `src/browser/moz-configure.patch`
The app identity values `mozconfig` cannot reach. `MOZ_APP_PROFILE` and `MOZ_APP_VENDOR` are
`project_flag`s with `possible_origins=("implied",)`, so `ac_add_options` and environment exports
do nothing for them — see ADR-014 for the full table.

`toolkit/moz-configure.patch` is Zen's own patch that Trance extends; `browser/moz-configure.patch`
is new and one line long. Both are configure-time only: on macOS nothing they change is a
preprocessor define, so a rebuild after touching them regenerates `application.ini` rather than
recompiling the tree.

**Never hand-edit a `.patch` file.** `npm run import` reverses each patch before re-applying it,
using the *current* patch text, so an edited patch fails to reverse and then conflicts on apply.
Edit `engine/<file>` and run `npm run export <file>` instead. To recover from a hand-edit:
`cd engine && git checkout -- <file>` then `npm run import`.
