# Upstream touchpoints

Every file outside `src/zen/trance/`, `prefs/trance/`, `docs/trance/`, and
`configs/branding/trance/` that Trance modifies. This list is the rebase hot-spot map:
when `git rebase upstream/dev` conflicts, it will be in one of these files.

**Keep this list under ~15 entries.** If a change can be made in a Trance-owned file instead,
make it there. Adding an entry requires a matching ADR in `DECISIONS.md`.

It stands at **23**, eight over budget, and the retirement pass §11.3 wants is still outstanding.

Phase 9 added three, each one line of consequence: #15 is a `DIRS` entry, #16 is a *deletion* (which
can only conflict if upstream edits a file that is no longer there), and #17 is one pref inside a
file Zen already patches (ADR-032).

Phase 11 added two, #18 and #19, and was approved for five to seven. Of Tier A's five, four turned
out not to need a touchpoint and two turned out not to be defects — see ADR-035. The pattern worth
keeping is that the reset layer (`trance-reset.css`) and a default-branch pref claim in the owning
feature between them absorbed every CSS-level and pref-level fix; only a change to upstream
*behaviour* needed the file itself. #19 is Tier B1 (ADR-038), and it is the same pattern read the
other way: the plan expected it to cost two files, and it cost one, because the CSS it would
otherwise have rewritten is still doing a job — it is what the layers fall back to once the
animation ends.

The settings pass added three, #20 to #22, and all three are *one pref value each* inside a file
Zen or Firefox already owns. They are not there by preference. ffprefs sorts every YAML entry by
pref name and emits duplicates adjacently, so a second definition of a name that is already declared
resolves in `fs::read_dir` order — a different browser on a different machine. A default Trance
disagrees with therefore has to be changed where it is declared. Defaults that nobody declares live
in `prefs/trance/browser-defaults.yaml`, which costs no touchpoint at all, and that is where the
history-mode prefs went for exactly this reason. The three here had no such option.

They are also the cheapest kind of conflict to resolve: a rebase conflict on a one-line pref value is
a value to re-apply, not a behaviour to re-derive.

Phase 13 added one, #23, and it is the cheapest shape a behavioural touchpoint comes in: a guard
around a call that is otherwise untouched. Trance's onboarding replaces Zen's welcome rather than
running before or after it, and it has to — `ZenWelcome` hides every child of `#browser` on entry
and restores them in `finish()`, so two takeovers in one window means the second one inherits a
window the first has already rebuilt. The alternative was for `TranceOnboarding` to detect Zen's
flow and wait for it, which is what `TranceFirstRun` does — but waiting is right for a panel that
comes *after* a takeover and wrong for a takeover that has to replace one.

Phase 1's artwork closed without a touchpoint. Everything `scripts/trance-branding.py` writes lands
in `configs/branding/trance/` (#3, already counted) or in `src/zen/trance/icons/`, and the source
art lives in `docs/trance/brand/` — deliberately *not* under `configs/branding/trance/`, because
surfer's branding patch copies every non-`content` entry of that directory with `copyFileSync` and
throws on a subdirectory.

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
| 15 | `src/zen/moz.build` | One `DIRS` entry: `"trance"`, so the build installs `distribution/policies.json` | 9 | ADR-032 |
| 16 | `build/AppDir/distribution/policies.json` | **Deleted.** Its contents moved into `src/zen/trance/distribution/policies.json`, which every platform now gets. Leaving it would also have broken the AppImage step, which does `mv zen/* $APPDIR/` — `mv` refuses a directory onto a non-empty one of the same name | 9 | ADR-032 |
| 17 | `src/testing/profiles/mochitest/user-js.patch` (`testing/profiles/mochitest/user.js`) | One pref: `toolkit.policies.perUserDir=true`, so the shipped extension policy does not make every mochitest in the tree dial addons.mozilla.org. Zen already patches this file | 9 | ADR-032 |
| 18 | `src/zen/media/ZenMediaController.mjs` | Park the 1 Hz position ticker while the window is minimised or fully occluded, and re-derive the position from elapsed wall time on resume. One field, one method, one guard, one teardown | 11 | ADR-035 |
| 19 | `src/zen/spaces/ZenSpaceManager.mjs` | The workspace cross-fade animates `opacity` on the two background pseudo-elements via `motion.animateMini`, instead of animating the `--zen-background-opacity` custom property. One local array, one replaced `motion.animate` call, one cancel-and-hand-back at the end of the switch | 11 | ADR-038 |
| 20 | `prefs/zen/view.yaml` | Two pref values: `zen.view.use-single-toolbar` → `false`, so Trance ships the sidebar-and-toolbar layout, and `zen.view.show-newtab-button-top` → `false`, so the new-tab button stays at the foot of the tab list where the preinstalled mod styles it | — | ADR-044 |
| 21 | `prefs/zen/zen-urlbar.yaml` | One pref value: `zen.urlbar.behavior` → `float`, so the address bar is always the floating panel Trance paints | — | ADR-044 |
| 22 | `prefs/firefox/urlbar.yaml` | One pref value: `browser.search.suggest.enabled` → `true`. The private-window switch is left off | — | ADR-044 |
| 23 | `src/zen/common/modules/ZenStartup.mjs` | One `if` around the existing `loadSubScript` of `ZenWelcome.mjs`, so Zen's welcome flow does not start when Trance's onboarding is enabled. Two full-window takeovers cannot share a window. Nothing is added, moved or reordered — with `trance.onboarding.enabled` false the call runs exactly as it did | 13 | ADR-051 |

## Planned touchpoints

These are anticipated and pre-approved by `TRANCE.md` §11.3. Move them to the table above when
they actually land.

| File | Planned change | Phase |
|---|---|---|
| `src/zen/ZenComponents.manifest` | `#include trance/TranceComponents.manifest` — same condition (ADR-012) | — |
| ~~`src/zen/common/styles/zen-theme.css`~~ | ~~Single `@import` of `trance.css`~~ — **not needed.** Stylesheets load dynamically so a disabled Trance costs nothing (ADR-010) | — |
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

### `src/zen/moz.build` and `build/AppDir/distribution/policies.json`
Phase 9's pair, and they are one change. Trance's enterprise policy has to exist as a real file at
`<install>/distribution/policies.json` before there is a profile, so it cannot be chrome-packaged
(ADR-012's condition) — `src/zen/trance/moz.build` installs it with `FINAL_TARGET_FILES.distribution`
and `src/zen/moz.build` has to list `"trance"` for that file to be traversed at all.

The AppDir copy is deleted rather than merged into, for two reasons. It reached only the Linux
AppImage, so merging would have installed seven extensions on one platform. And the AppImage step
runs `mv zen/* $APPDIR/`: once the packaged tree contains a `distribution/` of its own, `mv` refuses
to move it onto a non-empty directory of the same name, so the two files could not have coexisted.
