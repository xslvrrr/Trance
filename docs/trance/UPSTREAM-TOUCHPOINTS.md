# Upstream touchpoints

Every file outside `src/zen/trance/`, `prefs/trance/`, `docs/trance/`, and
`configs/branding/trance/` that Trance modifies. This list is the rebase hot-spot map:
when `git rebase upstream/dev` conflicts, it will be in one of these files.

**Keep this list under ~15 entries.** If a change can be made in a Trance-owned file instead,
make it there. Adding an entry requires a matching ADR in `DECISIONS.md`.

It stands at **36**, twenty-one over budget.

It stood at 26 before Phase 6.9, and 26 was wrong. Four were retired (see "The pref touchpoints,
retired" below) and **ten** were added, every one of which was a file already modified in the tree
and missing from this list: `package-lock.json`, `.gitignore`, the Firefox-155 re-base of an
external patch, the drag-and-drop teardown restore, the three session-store patches, the
`nsPresContext` boosts fast path, the Cocoa window material work, and the macOS entitlement. Most
of them were written before Phase 6 and never recorded; some were written, lost when a working tree
was rebuilt on another machine, and recovered from `engine/` by re-export. A list that is accurate
and far over budget is worth more than a short one that is wrong, and the number only means
anything once it counts everything.

Of the 32: ten are registration points the build system requires to live in a file upstream owns
(a `DIRS` entry, a jar `#include`, a script list, two `moz.configure` files, two preferences-pane
hooks, a stylelint config, a test manifest) plus `surfer.json`, which is what makes the build
Trance at all. Four are brand identity (`configs/common/mozconfig`, `README.md`, `package.json`,
`package-lock.json`) and one is repository hygiene (`.gitignore`). The rest are behavioural or
performance edits inside a Zen patch, each bounded and each with an ADR.

The budget of 15 was set before the fork carried a distribution policy, an onboarding flow, a mod
provisioner, or a performance pass that reaches into layout and the Cocoa widget. It is not
reachable without giving one of those up, and that trade has not been worth making. It remains the
standing goal, not a closed question — and the honest statement of where the fork is, is that it is
twice the size it meant to be.

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

### The pref touchpoints, retired

The settings pass added three touchpoints, and Phase 1 had added a fourth, and all four were *pref
values* inside a file Zen or Firefox already owns: `prefs/zen/mods.yaml`, `prefs/zen/view.yaml`,
`prefs/zen/zen-urlbar.yaml`, `prefs/firefox/urlbar.yaml`.

They were not there by preference. ffprefs sorted every YAML entry by pref name and emitted
duplicates adjacently, so a second definition of a name that was already declared resolved in
`fs::read_dir` order — a different browser on a different machine. A default Trance disagreed with
therefore had to be changed where it was declared.

Phase 6.9 removed the cause rather than the symptom. ffprefs now sorts any file under a `trance/`
directory last and keeps the last declaration of each `(name, condition, type)` — so a re-declaration
in `prefs/trance/` wins deterministically, and the type and condition of the original are preserved
rather than collapsed (ADR-077). All four values moved to `prefs/trance/overrides.yaml`, with the
reasoning that used to sit beside them in four files somebody else owns, and all four upstream files
are byte-identical to `upstream/dev` again.

The rule the new file lives by: **values only**. A pref Trance introduces belongs in the feature's
own `prefs/trance/<feature>.yaml`; `overrides.yaml` may only re-declare a pref an upstream file
already declares.

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
| 4 | `package.json` | `name`, repo/bugs/homepage URLs, `ci` script brand; `locales` script chained onto `import` | 1, 4 | ADR-006, ADR-017 |
| 5 | `README.md` | Rewritten for Trance | 1 | — |
| 6 | `src/browser/base/content/zen-assets.jar.inc.mn` | One `#include` of `src/zen/trance/jar.inc.mn` | 2 | — |
| 7 | `src/zen/common/ZenPreloadedScripts.js` | One import of `TranceCore.mjs`, last in the list | 2 | — |
| 8 | `src/-stylelintrc-js.patch` (`.stylelintrc.js`) | Register the Trance stylelint plugin; enable its 8 rules for `zen/trance/**` | 2 | — |
| 9 | `src/browser/components/preferences/preferences-xhtml.patch` | `about:preferences#trance` nav button + `#include` of `tranceSettings.inc.xhtml` | 2 | ADR-013 |
| 10 | `src/browser/components/preferences/preferences-js.patch` | `register_module("paneTrance", …)` and allow the pane past the SRD section gate | 2 | ADR-013 |
| 11 | `src/zen/tests/moz.build` | One entry: `"trance/browser.toml"` | 2 | — |
| 12 | `src/toolkit/moz-configure.patch` (`toolkit/moz.configure`) | `MOZ_APP_PROFILE`, `MOZ_APP_VENDOR` default, distribution-id default, Linux user appdir | 1 | ADR-014 |
| 13 | `src/browser/moz-configure.patch` (`browser/moz.configure`) | `imply_option("MOZ_APP_VENDOR", "Trance")` | 1 | ADR-014 |
| 14 | `src/zen/moz.build` | One `DIRS` entry: `"trance"`, so the build installs `distribution/policies.json` | 9 | ADR-032 |
| 15 | `build/AppDir/distribution/policies.json` | **Deleted.** Its contents moved into `src/zen/trance/distribution/policies.json`, which every platform now gets. Leaving it would also have broken the AppImage step, which does `mv zen/* $APPDIR/` — `mv` refuses a directory onto a non-empty one of the same name | 9 | ADR-032 |
| 16 | `src/testing/profiles/mochitest/user-js.patch` (`testing/profiles/mochitest/user.js`) | One pref: `toolkit.policies.perUserDir=true`, so the shipped extension policy does not make every mochitest in the tree dial addons.mozilla.org. Zen already patches this file | 9 | ADR-032 |
| 17 | `src/zen/media/ZenMediaController.mjs` | Replaces per-card 1 Hz position intervals and direct window visibility listeners with one activity-aware window ticker; only visible cards update DOM and hidden cards catch up from monotonic elapsed time | 0–6 | ADR-035 |
| 18 | `src/zen/spaces/ZenSpaceManager.mjs` | The workspace cross-fade animates `opacity` on the two background pseudo-elements via `motion.animateMini`, instead of animating the `--zen-background-opacity` custom property. One local array, one replaced `motion.animate` call, one cancel-and-hand-back at the end of the switch | 11 | ADR-038 |
| 19 | `src/zen/common/modules/ZenStartup.mjs` | One `if` around the existing `loadSubScript` of `ZenWelcome.mjs`, so Zen's welcome flow does not start when Trance's onboarding is enabled. Two full-window takeovers cannot share a window. Nothing is added, moved or reordered — with `trance.onboarding.enabled` false the call runs exactly as it did | 13 | ADR-051 |
| 20 | `src/browser/installer/package-manifest-in.patch` (`browser/installer/package-manifest.in`) | Two changes, both about files that were built and then not packaged. Deletes the `#if defined(BUILT_BY_MOZILLA)` around `@RESPATH@/distribution/*` — the flag is set by `--built-by-mozilla` and by nothing else, so no fork's package has ever contained a `distribution/` directory, which is why 0.1.0 shipped with no extension policy at all. Adds `config.js`, `defaults/pref/config-prefs.js` and `trance-cosine/*`, which is the Sine mod manager: it was provisioned into `dist/Trance.app` and the packager reads `dist/bin`, so it was in every development build and no release. Zen already patches this file | 12 | ADR-052, ADR-055 |
| 21 | `src/zen/sessionstore/ZenSessionManager.sys.mjs` | One `if` in `readFile`, after the session file has been read and before anything looks at it, adopting a Zen import staged by onboarding and deleting it. The sidebar object is built before any window exists and its setter is private, so an import has nowhere else to land. With `trance.import.staged` false — which is its default and its state on every startup but the one after an import — the method runs exactly as it did | 13 | ADR-053 |
| 22 | `tools/ffprefs/src/main.rs` | `is_twilight_build` asks whether the brand *is* twilight rather than whether it is anything other than release. Zen ships two brands so the two questions are the same there; Trance ships one, named neither, and fell on the twilight side — so every Trance build ever made shipped the twilight defaults ADR-006 says it does not have. Two lines, plus the unreadable-file fallback flipping with them | 12 | ADR-054 |
| 23 | `src/browser/components/tabbrowser/content/drag-and-drop-js.patch` | Restores the three teardown blocks Zen's patch removed with the dead `_updateTabStylesOnDrag` body: the per-tab `pointerEvents`/`dragtarget`/`small-stack` reset, the drag-label style reset, and the move-together transform reset. The patch is 28 lines *smaller* for it — this touchpoint reduces divergence from Firefox rather than adding to it | 6 | ADR-076 |
| 24 | `src/external-patches/firefox/issue_14710.patch` | Re-based onto the Firefox 156 tree: one trailing context line dropped and one hunk header corrected, so the third-party PiP fix still applies. Zen's own PiP patch now inserts `if (browser.audioMuted) { break; }` immediately after this patch's trailing context, so the two interleave inside one context window and the external patch would no longer reverse-apply out of the finished engine — which is `verify`'s not-reflected failure. No behaviour of the patch changes; `src/external-patches/manifest.json` still names its origin and the manifest pins its bytes | 6 | — |
| 25 | `package-lock.json` | Records the `engines.node` pin `package.json` declares. Written by npm, not by hand | — | — |
| 26 | `src/browser/components/sessionstore/SessionSaver-sys-mjs.patch` | Drops the hunk that replaced upstream's `permanentPrivateBrowsing` guard with `if (false)`. A profile configured never to persist anything is no longer written to disk, and the patch is one hunk smaller | 6 | ADR-079 |
| 27 | `src/browser/components/sessionstore/SessionStartup-sys-mjs.patch` | The same guard on init, and `isAutomaticRestoreEnabled()` returning `!permanentPrivateBrowsing` rather than the constant `true`. Zen's always-restore intent, minus the override of a user's explicit setting | 6 | ADR-079 |
| 28 | `src/browser/components/sessionstore/SessionStore-sys-mjs.patch` | Re-exported against Firefox 156, where `SessionStoreInternal` became the `_SessionStore` class: hunk offsets, blob hashes and the enclosing symbol only, no behaviour change beyond `willAutoRestore` returning `!permanentPrivateBrowsing` rather than the constant `true`. Its three `&& false` conditions are deliberately left in place and recorded in the manifest | 6 | ADR-079 |
| 29 | `src/layout/base/nsPresContext-h.patch` | A tri-state `ZenBoostsActivity` cached on the PresContext, so `nsZenBoostsBackend::ResolveStyleColor` stops walking Document -> BrowsingContext -> Top() plus the native-anonymous ancestry for every style colour in every document. Tri-state rather than a bool because a PresContext can be built for a BrowsingContext that already carries a boost | 11 | ADR-063 |
| 30 | `src/widget/cocoa/nsCocoaWindow-mm.patch` | `ZenWindowMaterialView`'s occlusion states and the power-mode monitor, inside Zen's existing Cocoa window patch. Order-sensitive with the tiled-attribute external patch, which is declared in `ORDER_RULES` | 11 | ADR-061, ADR-078 |
| 31 | `src/security/mac/hardenedruntime/production/firefox-browser-xml.patch` | `com.apple.application-identifier` carries `@TRANCE_APPLE_TEAM_ID@.app.trance-browser.trance` instead of Zen's team and bundle. `scripts/trance-entitlements.py` resolves the placeholder immediately before signing; an unresolved one cannot be mistaken for a working value, which is how the inherited entitlement stayed inert and silent | 12 | — |
| 32 | `.gitignore` | Ignores `WARP.md`, an agent-tool scratch file that lands in the repository root and is not project state | — | — |
| 33 | `src/zen/compact-mode/ZenCompactMode.mjs` | Compact-mode hover timers, animation frames and mutation observers now follow `gZenWindowActivity`; hidden windows clear hover state and reconnect on resume. The Trance fields follow upstream's `_eventListeners` and `_removeHoverFrames` rather than replacing them — in 0.2.0 they replaced them, and the sidebar never initialised | 0–6 | ADR-085 |
| 34 | `src/zen/split-view/ZenViewSplitter.mjs` | Split-pane docshell activation follows `gZenWindowActivity`, suspending linked browsers while the chrome window is hidden and restoring them on resume | 0–6 | — |
| 35 | `src/zen/glance/ZenGlanceManager.mjs` | Glance browser/docshell activity follows `gZenWindowActivity`; cached element previews remain available without re-rendering on resume | 0–6 | — |
| 36 | `src/zen/live-folders/ZenLiveFolder.sys.mjs` | Deferred live-folder network refreshes are gated by `gZenWindowActivity`, so hidden or occluded windows do not fetch | 0–6 | — |

### Phase 0–6 activity migration

- `src/zen/media/ZenMediaController.mjs`: removed each card's `sizemodechange`/`occlusionstatechange` listeners and per-card 1 Hz interval; one activity-aware window ticker updates visible cards, while hidden cards derive elapsed position from monotonic time when shown.
- `src/zen/compact-mode/ZenCompactMode.mjs`: removed direct `sizemodechange`/`deactivate` hover listeners and routed hover timers, animation frames and mutation observers through `gZenWindowActivity`; hidden windows clear stale hover state and resume with one compact-state refresh.
- `src/zen/split-view/ZenViewSplitter.mjs`: replaced direct split-pane docshell activation during activity changes with one activity subscription; panes still render normally when visible and suspend/restores their docshell state with the window.
- `src/zen/glance/ZenGlanceManager.mjs`: replaced direct Glance docshell toggles used for window activity with one subscription; hidden previews suspend and resume from the cached element preview instead of capturing a new one.
- `src/zen/live-folders/ZenLiveFolder.sys.mjs`: gated `DeferredTask` fetch execution with one activity subscription; scheduled refresh cadence and manual refresh semantics remain unchanged when the window is visible.

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

### `zen.injections.match-urls` (now in `prefs/trance/overrides.yaml`)
The entry could not simply be deleted:
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
