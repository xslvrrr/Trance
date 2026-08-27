# Trance decision log

Append-only. Newest at the bottom. One entry per decision that a future session would
otherwise re-litigate. Anything here supersedes `TRANCE.md` if they conflict — and if that
happens, update `TRANCE.md` too.

Format:

```
## ADR-NNN — Title
**Date:** YYYY-MM-DD · **Status:** accepted | superseded by ADR-MMM
**Context:** why this came up
**Decision:** what we do
**Consequences:** what this costs / forecloses
```

---

## ADR-001 — Fork lineage reconstructed from upstream/dev rather than a tag

**Date:** 2026-08-24 · **Status:** accepted

**Context:** The local source drop had no `.git`. It matched `zen-browser/desktop` at
`upstream/dev` HEAD (`ed0a6fd`), byte-identical across every tracked path, rather than the
`1.21.15b` release tag.

**Decision:** `git init`, add `upstream` remote, point `main` at `ed0a6fd`. Track `dev`, not
release tags.

**Consequences:** Trance follows Zen's development branch. Faster access to fixes, more churn,
and rebases must be frequent (weekly) or they get expensive. Release-tag stability is available
later by branching from a tag if we ever want a slower channel.

---

## ADR-002 — Reimplement mod features natively instead of bundling mods

**Date:** 2026-08-24 · **Status:** accepted

**Context:** The user's pain (visual artifacts, power drain) is structural: N independent
stylesheets, N observers, N blur layers, N timers. Bundling the mods preserves all of it.
Separately, 2 of 23 mods are GPL-3.0 and 12 have no license at all.

**Decision:** Trance reimplements the *behaviours* in Trance-owned source under
`src/zen/trance/`, on a shared foundation layer (tokens, scheduler, observer hub). No third-party
mod code is vendored except from MIT/Apache-2.0 sources, with attribution.

**Consequences:** Much more work up front. Visual fidelity to the originals is approximate, not
pixel-exact. In exchange: conflicts are impossible by construction, the power budget is
enforceable, licensing is clean, and there is one upstream sync surface instead of 23.

---

## ADR-003 — Extensions installed via enterprise policy, not vendored XPIs

**Date:** 2026-08-24 · **Status:** accepted

**Context:** Five of the seven required extensions are GPL/LGPL. Vendoring their XPIs into an
MPL-2.0 distribution creates licensing entanglement and freezes their versions.

**Decision:** Ship `distribution/policies.json` with `ExtensionSettings` entries using
`installation_mode: normal_installed` and AMO `install_url`s.

**Consequences:** First run needs network. Extensions auto-update from AMO and remain
user-removable. No third-party binaries in the repo. A first-run status panel is required so a
failed install is visible rather than silent.

---

## ADR-004 — Zen's native mods system stays in place

**Date:** 2026-08-24 · **Status:** accepted

**Context:** `src/zen/mods/` is upstream code (JS + C++ + IDL + actors). Removing it would
significantly widen the upstream diff surface for no functional gain.

**Decision:** Keep it untouched and functional. Mods that Trance reimplements are simply not
installed by default, and the first-run panel explains that Trance's built-ins replace them.

**Consequences:** Users can still install Zen mods and thereby recreate the exact conflicts
Trance exists to solve. Acceptable — it is their browser. Document the risk, do not block it.

---

## ADR-005 — Host on the existing public fork `xslvrrr/Trance`

**Date:** 2026-08-24 · **Status:** accepted

**Context:** The original intent was a private repo. Two things made that expensive:

- GitHub cannot convert a fork to private, and `xslvrrr/Trance` was already a public fork of
  `zen-browser/desktop` — the source this working copy came from.
- Pushing Zen's full 6,951-commit history (5.6 GB) to a *fresh* repo over HTTPS fails: GitHub
  returns HTTP 500 on packs above roughly a thousand commits, so it needs ~30 sequential chunked
  pushes. SSH would avoid this, but there is no key on the machine and the `gh` token lacks
  `admin:public_key`.

A fork already shares GitHub's object store with its parent, so pushing there uploads only the
new commits.

**Decision:** `origin` = `https://github.com/xslvrrr/Trance.git`, default branch `main`.
Accept public visibility during pre-branding development.

**Consequences:**
- Pushes are effectively instant for as long as Trance's own diff stays small.
- The repo is public while it still carries Zen branding. Acceptable for now, but **Phase 1
  branding is on the critical path** for anything resembling a release or promotion — see §7.4.
- Being a GitHub fork, the PR UI defaults its base to `zen-browser/desktop`. Check the base
  branch on every PR.
- `xslvrrr/trance-browser` (private, ~1.5k commits of partial history) is now an unused
  leftover. Delete it when convenient — it holds nothing unique.

---

## ADR-006 — One brand, `trance`; `release` and `twilight` are gone

**Date:** 2026-08-24 · **Status:** accepted

**Context:** Zen ships two brands, `release` and `twilight`, each with its own
`configs/branding/<brand>/` asset set and its own entry in `surfer.json` `brands`. surfer resolves
`--with-branding=browser/branding/${brand}` and `--enable-update-channel=${brand}` from the active
brand key. `TRANCE.md` §16 Q2 left the channel question open; §13 Phase 1 nonetheless names
`brands.trance`, and `CLAUDE.md` requires brand assets to live in `configs/branding/trance/`.

**Decision:** A single brand, `trance`. `configs/branding/release/` renamed to
`configs/branding/trance/`; `configs/branding/twilight/` deleted; `surfer.json` `brands` reduced to
one `trance` entry with `displayVersion: "0.1.0"` and `github.repo: xslvrrr/Trance`.
`package.json`'s `ci` script now passes `--brand trance`. The `zen-browser.app` injection grant in
`prefs/zen/mods.yaml` goes at the same time — Trance owns no domain and must not hand a privileged
actor surface to one it does not control.

**Consequences:**
- There is no twilight-equivalent pre-release channel. If one is wanted later, it is a new
  `brands.<name>` entry plus a branding directory — cheap to add, so deferring costs nothing.
- Every workflow in `.github/workflows/` passes `--brand release` or `--brand twilight` and will
  fail against this config. Those are Zen's release pipelines, unusable for Trance anyway
  (Zen's secrets, Zen's repos, Zen's signing). Phase 12 replaces them wholesale; until then
  CI is expected to be red and is not a gate.
- The `.surfer/` brand pin is gitignored, so a fresh clone silently falls back to `unofficial`
  branding. `scripts/trance-env.sh` sets it; anyone not sourcing that script gets a Firefox-branded
  build and will be confused.

---

## ADR-007 — App identity is edited into `configs/common/mozconfig`

**Date:** 2026-08-24 · **Status:** accepted

**Context:** `surfer.json` covers display names, `appId` and `binaryName`, but not
`MOZ_APP_BASENAME`, `--with-distribution-id`, or `MOZ_SOURCE_REPO`. Zen hardcodes all three to Zen
values in `configs/common/mozconfig`, and surfer only substitutes `${binName}`, `${brandingDir}`,
`${appId}` and `${changeset}` into that file. Left alone, a Trance build would keep Zen's profile
directory and a `app.zen-browser.*` macOS bundle identifier.

**Decision:** Edit the four values in place, inside `>>> TRANCE` / `<<< TRANCE` markers:
`--with-app-basename=Trance`, `MOZ_APP_BASENAME=Trance`,
`--with-distribution-id=app.trance-browser`, `MOZ_SOURCE_REPO=https://github.com/xslvrrr/Trance`.
Bundle id resolves to `app.trance-browser.trance`.

**Consequences:**
- **One-way door, now taken.** The profile directory moves out of the Zen tree; any profile from
  a pre-Phase-1 Trance dev build is orphaned, not migrated. This must not be repeated.
- `configs/common/mozconfig` becomes a rebase hot spot. It is a small, stable file upstream, so
  conflicts should be rare and trivially resolvable.
- The `$HOME/.zen-keys/` API-key paths further down the file were deliberately left alone — they
  are developer-local and not user-visible.

---

## ADR-008 — Zen's icon art stays as a development placeholder

**Date:** 2026-08-24 · **Status:** accepted

**Context:** `TRANCE.md` §7.4 requires original branding before any public distribution, and
§13 Phase 1 acceptance says no Zen wordmark or logo ships. The user has no Trance artwork yet and
asked to keep the existing icons for now.

**Decision:** `configs/branding/trance/` keeps Zen's logo/icon raster set (`logo*.png`,
`firefox.ic*`, `*.ico`, `about-logo*`, `VisualElements_*`, `PrivateBrowsing_*`, installer art)
unchanged as a local development placeholder. The two files that carry the *wordmark* —
`content/about-wordmark.svg` (about dialog) and `content/firefox-wordmark.svg`
(about:privatebrowsing) — are replaced now with plain type reading "Trance", because those are the
only brand assets whose content is literally the word "Zen" and they are the most visible.

**Consequences:**
- Phase 1 acceptance is met for names, wordmarks, profile and bundle identity, but **not** for
  iconography. The icon replacement is outstanding and blocks Phase 12.
- The build shows Zen's circular logo with a "Trance" wordmark next to it. Expected, not a bug.
- The replacement wordmarks use system type via SVG `<text>`, not outlined paths. Fine for a
  placeholder; real artwork should ship outlines so rendering does not depend on installed fonts.

---

## ADR-009 — Auto-update off, `updateHostname` on a reserved `.invalid` host

**Date:** 2026-08-24 · **Status:** accepted, provisional — revisit in Phase 12

**Context:** `surfer.json` `updateHostname` is required (it becomes `MOZ_APPUPDATE_HOST` and is
baked into `application.ini`), but there is no Trance update server and `TRANCE.md` §16 Q3 is
undecided. surfer's own fallback is `localhost:7648`, which is worse: it can be hijacked by
anything listening locally. Separately, surfer hardcodes `zen-browser.app` release-note and
what's-new URLs into the generated `browser/branding/<brand>/pref/firefox-branding.js`, which is
not a file Trance can edit.

**Decision:** `updateHostname: "updates.trance.invalid"` — `.invalid` is reserved by RFC 2606 and
can never resolve. `prefs/trance/branding.yaml` turns off `app.update.auto`,
`app.update.background.scheduling.enabled` and `app.update.checkInstallTime`, and overrides the
zen-browser.app URLs to point at `github.com/xslvrrr/Trance/releases`.

**Consequences:**
- No update checks, so no failing background requests and no update error UI.
- The override works because `browser/defaults/preferences/firefox-branding.js` sorts before
  `firefox.js`, and `firefox.js` is what `#include`s the ffprefs-generated `zen.js`. If that
  ordering ever changes upstream, the Zen URLs come back — check it after a Firefox base bump.
- Phase 12 must choose for real between a MAR feed on GitHub releases, a hosted update server, or
  permanently manual downloads.

---

## ADR-010 — Trance stylesheets load dynamically, not via `@import` from `zen-theme.css`

**Date:** 2026-08-24 · **Status:** accepted

**Context:** `TRANCE.md` §6.1 and §11.3 anticipated a single `@import` of `trance.css` added to
`src/zen/common/styles/zen-theme.css`, listed as a planned upstream touchpoint. But §6.5 and the
Phase 2 acceptance criteria require that with `trance.enabled=false` **zero Trance stylesheets are
loaded**. A static `@import` cannot satisfy that: the rules are parsed, matched and kept in the
style set whether or not Trance is doing anything, and the only way to "disable" them would be a
guard selector — which is hiding, not zero cost.

**Decision:** `TranceStyles` loads `chrome://browser/content/trance-styles/trance.css` through
`nsIDOMWindowUtils.loadSheetUsingURIString(…, AUTHOR_SHEET)` when `trance.enabled` is true, and
removes it with `removeSheetUsingURIString` when the pref is flipped off. Feature stylesheets are
loaded the same way by `TranceFeature`, keyed on each feature's own pref. `zen-theme.css` is not
touched.

**Consequences:**
- The zero-cost guarantee is real and checkable: `windowUtils` reports exactly which sheets are
  loaded, and `TranceStyles.loadedSheets` exposes Trance's own list.
- Pref flips are live and symmetric with no restart, including for individual features.
- AUTHOR-level dynamic sheets sort after the document's own linked stylesheets, so Trance wins
  equal-specificity ties against Zen without `!important` — which is what makes §6.2 rule 1
  enforceable rather than aspirational.
- One fewer upstream touchpoint. `zen-theme.css` is removed from the planned list.
- Cost: Trance's tokens are not available to `about:` pages, only to browser windows. That is
  correct for now (Trance styles chrome, not content) but means `about:preferences#trance` ships
  its own small stylesheet instead of consuming the token layer.

---

## ADR-011 — `TranceSurfaces` owns `zen.theme.acrylic-elements` while it is enabled

**Date:** 2026-08-24 · **Status:** accepted

**Context:** Zen's `zen-compact-mode.css` applies
`backdrop-filter: blur(42px) saturate(110%) brightness(0.25) contrast(100%) !important` to
`.zen-toolbar-background`, gated on `zen.theme.acrylic-elements`. Trance's surface layer owns the
toolbar region and enforces a budget of one blur surface per region (`TRANCE.md` §3.3). Two owners
for one element is the exact failure mode Trance exists to remove — and because Zen's declaration
carries `!important`, an author-level Trance rule cannot win, while adding `!important` to fight it
is forbidden by §6.2 rule 1.

**Decision:** While `trance.surface.enabled` is true, `TranceSurfaces` sets
`zen.theme.acrylic-elements` to false, remembering the previous value and restoring it exactly on
disable. It does nothing if the pref is already false.

**Consequences:**
- One owner per region, without a CSS specificity arms race, and fully reversible.
- Writing to an upstream pref from Trance code is a precedent. It is acceptable here because the
  pref is a *blur budget* switch and Trance owns the blur budget. It should not be extended to
  prefs that express user intent about behaviour rather than about rendering cost.
- In practice this is usually a no-op: `zen.theme.acrylic-elements` is `@IS_TWILIGHT@`, and Trance
  has a single non-twilight brand, so it defaults to false (ADR-006).
- If a user deliberately turns Zen acrylic back on with Trance surfaces enabled, Trance will not
  fight them a second time — the pref is claimed once, at enable.

---

## ADR-012 — `src/zen/trance/` needs no `moz.build` and no `Components.manifest`

**Date:** 2026-08-24 · **Status:** accepted

**Context:** `TRANCE.md` §5.3 and §11.3 listed `src/zen/moz.build` (`DIRS += "trance"`) and
`src/zen/ZenComponents.manifest` (`#include trance/TranceComponents.manifest`) as planned upstream
touchpoints for Phase 2.

**Decision:** Neither is needed yet, so neither is added. A `moz.build` entry is only required for
directories that contribute to the build graph — XPIDL, C++ sources, `EXTRA_JS_MODULES`, XPCOM
manifests. Trance's Phase 2 and Phase 3 output is entirely chrome-packaged files, which reach the
build through `jar.inc.mn`. Several Zen feature directories (`tabs/`, `folders/`, `kbs/`,
`welcome/`, `media/`, `split-view/`, …) are in exactly the same position and are likewise absent
from `src/zen/moz.build` `DIRS`.

The only packaging touchpoint is one `#include` line in
`src/browser/base/content/zen-assets.jar.inc.mn`.

**Consequences:**
- Two fewer upstream touchpoints, and `src/zen/moz.build` — a file Zen edits every time it adds a
  feature — stays out of Trance's rebase hot-spot list.
- The moment Trance needs a chrome-process service, an actor, a `.sys.mjs` module resolved through
  `resource:///modules/`, or any C++, both files come back. Add them then, and move them into the
  live touchpoint table at that point.

---

## ADR-013 — `about:preferences#trance` ships with literal English labels, not Fluent ids

**Date:** 2026-08-24 · **Status:** accepted, revisit in Phase 12

**Context:** Zen's preference strings (`pane-zen-looks-title`, and every label in
`zenLooksAndFeel.inc.xhtml`) resolve from Zen's downloaded language packs, not from anything in
this tree. There is no in-tree `.ftl` a Trance string could be added to, and creating a Trance
localisation pipeline is a Phase 12 concern.

**Decision:** `tranceSettings.inc.xhtml` uses literal `label="…"` attributes and literal text
nodes. `moz-page-nav-button` renders its children through a `<slot>`, so the nav entry works with
plain text and no `data-l10n-id`.

**Consequences:**
- The pane exists and is fully usable from Phase 2 onward, which is what the roadmap asks for.
- Trance's settings are English-only until Phase 12 adds a real `.ftl` and a locale story.
- Migration later is mechanical: replace `label="X"` with `data-l10n-id`, one string at a time.

---

## ADR-014 — App identity lives in two configure files, not in `mozconfig`

**Date:** 2026-08-24 · **Status:** accepted

**Context:** Phase 1 recorded the profile directory as moved to Trance. It was not: a Phase 3
smoke run showed the build still reading
`~/Library/Application Support/zen/Profiles/…`, i.e. sharing a profile root with an installed Zen.
Three identity values turned out to be unreachable from `configs/common/mozconfig`:

- `MOZ_APP_PROFILE` and `MOZ_APP_VENDOR` are declared with `project_flag(...)`, whose options have
  `possible_origins=("implied",)`. They cannot be set from the environment or from `ac_add_options`
  at all — only from a configure default or an `imply_option`. Zen had already patched
  `toolkit/moz.configure` to default them to `zen` / `Zen Team`.
- `MOZ_APP_VENDOR` additionally has `imply_option("MOZ_APP_VENDOR", "Mozilla")` in
  `browser/moz.configure`, which beats any default. That is why the vendor read `Mozilla` even
  though `surfer.json` says `Trance`: `surfer.json`'s `vendor` never reaches `MOZ_APP_VENDOR`.
- The Linux user application directory (`--with-user-appdir`) defaults from a function in
  `toolkit/moz.configure` that Zen changed to `zen`.

**Decision:** identity that `mozconfig` cannot express is set in the configure files:

| Value | Where | From | To |
|---|---|---|---|
| `MOZ_APP_PROFILE` | `src/toolkit/moz-configure.patch` | `zen` | `Trance` |
| `MOZ_APP_VENDOR` default | `src/toolkit/moz-configure.patch` | `Zen Team` | `Trance` |
| `--with-distribution-id` default | `src/toolkit/moz-configure.patch` | `app.zen-browser` | `app.trance-browser` |
| Linux user appdir | `src/toolkit/moz-configure.patch` | `zen` | `trance` |
| `MOZ_APP_VENDOR` implied | `src/browser/moz-configure.patch` (**new**) | `Mozilla` | `Trance` |

`configs/common/mozconfig` keeps what it can express: app name, app basename, distribution id,
source repo.

**Consequences:**
- **The one-way door of §13 Phase 1 is now actually taken.** macOS profiles move from
  `~/Library/Application Support/zen/` to `~/Library/Application Support/Trance/`. Nothing is
  deleted — the old directory stays exactly where it is, and an installed Zen keeps using it —
  but a Trance dev build gets a fresh profile and does not see the old one.
- Trance dev builds stop writing into an installed Zen's profile root, which they had been doing.
- One new upstream touchpoint, `src/browser/moz-configure.patch`, for a single line.
- `MOZ_APP_REMOTINGNAME` resolves to `trance-trance` (app name plus update channel, and the
  channel is `trance` per ADR-006). Harmless — it is the Linux WM class and the `-P` remoting
  name — but worth renaming if a second channel ever appears.
- `MOZ_APP_UA_NAME` stays `Firefox` on purpose: the User-Agent must keep saying Firefox or site
  compatibility breaks. That is not a branding leak.
- **Editing a `.patch` file by hand breaks `npm run import`.** surfer applies each patch as
  `git apply -R` (failure ignored) then `git apply`. If the patch text changed since it was last
  applied, the reverse silently fails and the forward apply then conflicts. Recover with
  `cd engine && git checkout -- <file>` and re-run `npm run import`. Prefer editing `engine/` and
  running `npm run export <file>`.

---

## ADR-015 — Trance overrides Zen's `!important` sizing by re-declaring variables on the consuming element

**Date:** 2026-08-25 · **Status:** accepted

**Context:** Phase 4 has to resize the collapsed sidebar rail (Customize Collapsed Sidebar,
mod 5). Zen's collapsed block is:

```css
:root:not([zen-sidebar-expanded="true"]) {
  --tab-min-width: 48px !important;
  --zen-toolbox-padding: 6px !important;
  --zen-toolbox-max-width: calc(var(--tab-min-width) + var(--zen-toolbox-padding) * 2);
}
```

An author `!important` declaration beats a normal author declaration *and* a normal inline one,
so neither a Trance stylesheet rule nor `TranceTokens.set()` can change the first two from
`:root`. Every mod in this cluster answered that with `!important` of its own, which is how five
mods ended up in an arms race over one rail (`TRANCE.md` §3.1). Adding an `important` priority to
`TranceTokens.set()` would have made Trance the sixth combatant and would have broken §6.2 rule 1
in spirit while passing its lint.

**Decision:** re-declare the variables on the element that *consumes* them, not on `:root`.
`trance-tabstrip.css` writes `--zen-toolbox-max-width`, `--tab-min-width` and `--tab-min-height`
on `#navigator-toolbox` in its collapsed state. Custom properties inherit; a declaration on the
element overrides the inherited value outright, and importance on an ancestor's declaration has
no say in that comparison. Zen's `!important` is left standing and simply never reaches the
element that matters.

Note this only works because `--zen-toolbox-max-width` — the value `#navigator-toolbox` actually
reads for its `min-width`/`max-width` — is declared **normally**. Custom properties substitute at
computed-value time on the element they are declared on, so overriding `--tab-min-width` further
down could not have changed a `--zen-toolbox-max-width` computed at `:root`.

**Consequences:**
- Phase 4 contains no `!important`, asserted by `browser_trance_tabstrip.js`.
- The technique is general and is the preferred answer whenever Zen marks a variable
  `!important`: find the consumer, redeclare there. Reach for a pref-owned override
  (ADR-011) only when there is no consumer to redeclare on.
- It is fragile in one specific way: if Zen ever moves the `max-width` computation onto `:root`
  itself, the override stops applying and Phase 4's rail silently reverts to Zen's sizing. The
  rail-width test would still pass — it checks the token, not the layout — so this is on the
  upstream-rebase checklist, not the test suite.

---

## ADR-016 — Folder colour uses Firefox's tab-group colour, not a Trance store

**Date:** 2026-08-25 · **Status:** accepted

**Context:** The user asked for full Advanced Tab Groups parity (mod 1). Its distinguishing
feature is a colour per group, which reads like it needs a persistent per-folder store, a
migration path and a picker UI — the largest single chunk of Phase 4.

**Decision:** use the platform. `zen-folder extends MozTabbrowserTabGroup`, whose `color` setter
(`engine/browser/components/tabbrowser/content/tabgroup.js:260`) writes `--tab-group-color` and
five sibling custom properties inline; the palette resolves in
`browser/themes/shared/tabbrowser/tab.tokens.css`; and `TabGroupState.sys.mjs:73` persists the
code across restarts. Trance adds exactly two things: a `trance-folder-color` attribute so its
stylesheet can tell a real colour from Zen's `zen-workspace-color` sentinel (whose token does not
exist anywhere in the tree), and a **Folder colour** submenu appended to Zen's own
`#zenFolderActions` popup at runtime.

The submenu is appended from `TranceTabStrip.onEnable()` rather than added to
`src/browser/base/content/zen-panels/popups.inc`. That costs no upstream touchpoint and means a
pref-disabled feature leaves no dead menu item behind, which `popups.inc` could not have offered.

**Consequences:**
- Zero storage, zero migration, zero picker UI. "Full ATG parity" reduced to one submenu and one
  stylesheet block.
- Colours survive restart, session restore and window sync for free, which the mod's own
  implementation did not do reliably.
- Trance is now a second writer of `folder.color`, alongside `ZenFolders.createFolder`. They do
  not conflict — Zen writes the sentinel once at creation, Trance writes a real code on user
  action — but if Zen ever starts deriving folder appearance from `color`, this needs revisiting.
- `onDisable()` deliberately does **not** reset `folder.color`. It is platform state, not Trance
  state; discarding the user's choices on a pref flip would make the toggle destructive.

---

## ADR-017 — `npm run import` copies the en-US language pack into `engine/`

**Date:** 2026-08-25 · **Status:** accepted

**Context:** the Phase 4 build shipped with no keyboard shortcuts and no localised chrome text at
all — every menu, tooltip and label empty, only Trance's literal strings (`about:preferences`
nav button, pane labels) visible. The cause was not Trance code: the same build with
`trance.enabled=false` was identically broken.

Zen's nine in-tree Fluent files — `browser/zen-{workspaces,split-view,general,menubar,
vertical-tabs,folders,boosts,live-folders,space-routing}.ftl` — are linked from `browser.xhtml`
(62 `<link rel="localization">` in the built document) but were absent from
`engine/browser/locales/en-US/browser/`. Fluent's registry treats a linked resource as
**required**: one missing file makes `generateBundles` yield **zero** bundles for the whole
document, not just for that file. Measured in the running build: 650 of 706 `[data-l10n-id]`
elements untranslated, 76 of 154 `<key>` elements left with neither `key` nor `keycode` — which
is exactly "shortcuts gone, text gone". `about:preferences` fails the same way through
`preferences/zen-preferences.ftl`.

The files exist in the repo at `locales/en-US/browser/**`. They reach `engine/` only via
`scripts/copy_language_pack.py en-US`, whose only caller was
`scripts/download-language-packs.sh` — a CI script. No local command ran it, and
`surfer download` / `surfer reset` wipe `engine/`, so any local tree was one reset away from a
silently unlocalised browser.

**Decision:** add `npm run locales` (`python3 scripts/copy_language_pack.py en-US`) and chain it
onto the end of `npm run import`. Every path that regenerates `engine/` already ends in an
import, so the language pack can no longer go missing without the developer removing it by hand.

**Consequences:**
- `npm run import` gains ~1s and a dozen file copies. It stays idempotent: the script deletes
  `zen*` from the target directory before copying.
- Only `en-US` is copied. The other 39 locales in `locales/` remain a CI concern
  (`download-language-packs.sh`), because they also need the upstream `firefox-l10n` clone that
  script performs.
- `browser/locales/jar.mn` packages `%browser/**/*.ftl` by glob, so no packaging change is
  needed — the files are picked up by the next `npm run build:ui`.
- This failure mode is silent and total. If chrome text or shortcuts ever disappear again, check
  for zero-bundle documents first: a single missing `.ftl` blanks the entire window.

---

## ADR-018 — Cosine ships preinstalled, with a Trance conflict banner on the mods it replaces

**Date:** 2026-08-25 · **Status:** accepted

**Context:** ADR-002 rejected "ship Sine + a curated mod list preinstalled" and §2 lists "not a
mod manager" as a non-goal. Both were arguments against Trance *sourcing its own features* from
mods. Neither is an argument against the manager being present for everything Trance does not
reimplement: without it a fresh Trance profile is strictly less capable than the Zen profile it
replaces, and the user has to run Sine's own installer against the app bundle by hand.

The risk ADR-004 already named — "users can still install Zen mods and thereby recreate the
exact conflicts Trance exists to solve" — gets larger the moment the manager is one click away,
and its stated mitigation ("document the risk") is a first-run panel nobody rereads at the
moment they are actually installing Nebula.

**Decision:** Ship the manager, on Sine's pre-release ("Cosine") channel, and put the warning at
the point of decision rather than in a document.

- Provisioning is `scripts/trance-cosine.py`: it fetches the bootloader (`sineorg/bootloader`)
  and the engine (`CosmoCreeper/Sine`, newest `*c` release), both MPL-2.0, and installs them into
  the app bundle and the profile per Sine's own `.browsercfg.json` layout. Nothing is vendored
  into this tree.
- `src/zen/trance/settings/trance-mod-guard.js` annotates Sine's marketplace cards and its
  installed-mods list. Three states: **native** (Trance already owns it), **partial** (some of it
  ships, the rest is scheduled), **planned** (a later phase owns it). Each banner names the
  owning Trance feature, the `trance.*` pref that configures it and links to the Trance pane.
- Pref-gated on `trance.modguard.enabled`. Off means no observer, no stylesheet, no DOM.
- **No mods are preinstalled.** ADR-002 stands: Trance's own features are never sourced from a
  mod.

**Consequences:**
- §2's "does not ship or replace Sine/Cosine" narrows to "does not *replace*". Trance ships it;
  it is still not Trance's feature-delivery mechanism.
- The mod table in `trance-mod-guard.js` duplicates `docs/trance/mods-inventory.json`. It has to
  be updated alongside the inventory when a phase lands; there is no build step joining them.
- Sine derives its fork id from `AppConstants.MOZ_APP_NAME`, which for Trance is `trance`, so it
  falls back to `firefox` and hides every Zen-only mod. The provisioner patches one row into its
  fork table. Sine's self-updater overwrites that file, so the provisioner must be re-run after
  an engine update — and after any `npm run build:ui`, which re-stages the app bundle and drops
  `config.js`.
- Shipping this in a packaged build still needs `config.js` and `defaults/pref/config-prefs.js`
  placed into the bundle by the build rather than by a script. That is an upstream touchpoint
  (`FINAL_TARGET_FILES`) and is not done yet.

---

## ADR-019 — Frosting is translucency of Zen's own background layers, not a tint Trance paints

**Date:** 2026-08-25 · **Status:** accepted · **Supersedes:** part of Phase 3's implementation

**Context:** Phase 3 shipped the surface layer as a colour: `--trance-surface-bg` — the
workspace accent mixed into `light-dark(#ffffff, #0d0f14)` at `--trance-surface-alpha` (62%) —
written into Zen's `--zen-navigator-toolbox-background` extension point, with a
`backdrop-filter` behind it.

In use that is not glass, it is a black box, and the reason is structural rather than a matter
of tuning:

1. In a dark scheme the tint is a 62%-opaque near-black laid over a workspace gradient that is
   already dark. The result is a darker gradient. No value of the opacity slider fixes this;
   lowering it only makes the box fainter.
2. The tint paints *after* the element's own `backdrop-filter`, so whatever the blur revealed
   was immediately covered by the tint that was supposed to be revealing it.
3. The blur had little to reveal in the first place. `#navigator-toolbox` is `z-index: 2`
   (`--browser-area-z-index-toolbox`, Zen overrides Firefox's `0`) and the only thing painted
   beneath it in the backdrop root is `#zen-browser-background`, a smooth gradient. Blurring a
   smooth gradient is close to a no-op.
4. Because the tint was a per-element `background`, it stopped at each element's border box. It
   therefore missed the `#zen-sidebar-splitter` hairline beside the toolbox, the gutter
   `#zen-tabbox-wrapper`'s margin leaves around the content pane, and — with the sidebar
   collapsed, where Zen widens `#nav-bar` past the toolbox with a negative margin — the whole
   window width above the page.

**Decision:** The surface layer stops painting a surface. `--trance-surface-alpha` becomes an
`opacity` applied to Zen's *own* background elements:

```css
:root[trance="true"][trance-surface-sidebar="true"] {
  & #zen-browser-background,
  & #zen-toolbar-background { opacity: var(--trance-surface-alpha); }
}
```

That is what lets the window's native translucency through, which is where the frost actually
comes from: Zen already ships `zen.widget.macos.window-vibrancy` (an `NSVisualEffectView` behind
a `background: transparent` `#main-window`), Windows Mica, and `zen.widget.linux.transparency`.
`backdrop-filter` stays, and now has a job — blurring what *Gecko* painted behind a region, which
is what makes compact mode's floating sidebar read as glass over the page. Trance's own paint is
reduced to `--trance-surface-bg`, an ~8% white sheen with an accent trace.

`#zen-browser-background` is `position: absolute; inset: 0` on `#browser`, so one declaration
covers the sidebar, the splitter hairline, the gutter around the page and the full window width
when collapsed. The three misses in (4) were symptoms of the same wrong model, not four bugs.

A fourth region, `content`, is added for the page's own backdrop
(`trance.surface.region.content`, off by default). It is **translucency only and never blurred**:
a blurred content pane is the most expensive surface a browser can have — full window area, and
a backdrop that changes on every scrolled frame — and the window translucency behind it already
supplies the frost. The blur budget in TRANCE.md §3.3 and §12.1 therefore stays at three.

**Consequences:**
- `--trance-surface-base` is gone; `--trance-surface-sheen`, `--trance-content-alpha`,
  `--trance-content-base` and `--trance-content-bg` are new.
- The "surface opacity" slider changes meaning: 100% is now stock Zen and lower values reveal
  more, where before 100% was a fully opaque tint. This is a better control — it has a
  no-op end — but any user who had tuned the old slider will want to retune it.
- Trance now depends on two Zen element ids, `#zen-browser-background` and
  `#zen-toolbar-background`. Both are load-bearing to Zen's gradient engine and its space-switch
  crossfade, so they are unlikely to move, but they join the list of things to re-verify after a
  rebase. Neither is an upstream *touchpoint* — no Zen file is edited.
- The content region cannot make an opaque site translucent, and must not try: Trance styles
  chrome, never content (TRANCE.md §9.3, where Zen Internet is the single owner of the content
  area). What it reaches is new tabs, `about:` pages, rounded corners, first paint, and sites
  Zen Internet has already marked `transparent="true"` — and its selector explicitly excludes
  that last case so the two never both apply.
- Its selector carries two IDs to match the specificity of the `browser[type="content"]` rule in
  `zen-browser-container.css` it has to beat, and therefore carries a `trance-specificity`
  opt-out comment. The alternative was `!important`, which is banned (§6.2 rule 1).

---

## ADR-020 — macOS native context menus stay on; icons in them are an opt-in trade

**Date:** 2026-08-25 · **Status:** accepted

**Context:** Phase 5's headline is one icon set across the browser. On macOS, page and tab
context menus are drawn by AppKit, not by Gecko: `widget.macos.native-context-menus` defaults to
`true` (verified in `StaticPrefList.yaml`) and Zen does not override it. No stylesheet can put an
icon into an AppKit menu, so on the platform Trance targets first, the two menus a user opens
most often are exactly the two the icon set cannot reach.

Zen Context Menu (mod 20) solves this by requiring the pref be turned off — its own preference
list opens with "‼️ Uncheck to enable this mod in macOS, overriding native context menu". That
buys the icons and gives up the platform menu: its accessibility behaviour, its scrolling, its
feel, and its correctness under future macOS changes.

**Decision:** Trance ships with the platform menu intact and exposes the trade as
`trance.chrome.icons.macos-emulated-menus`, off by default.

- With it off — the default — icons land on every menu the browser draws itself: panels, the app
  menu, the bookmarks menu, Zen's folder and space menus, subview buttons, the toolbar. Page and
  tab context menus stay native and unstyled.
- With it on, `TranceChrome` claims `widget.macos.native-context-menus`, and restores the user's
  own value when the pref is turned off again or the feature is disabled — the same
  claim-and-restore pattern `TranceSurfaces` uses for `zen.theme.acrylic-elements` (ADR-011).

**Consequences:**
- Trance's second platform-pref claim. Both are recorded here, both are exactly reversible, and
  both exist because the alternative was an `!important` arms race or a silent regression.
- The settings page states the trade in the checkbox's own description rather than in a doc,
  because it is the kind of decision a person should make at the moment they make it.
- Whether this default is right is a question for the user, and it is asked in
  `docs/trance/mods/zen-context-menu.md` §8.

---

## ADR-021 — Two mods shipped nothing, on purpose

**Date:** 2026-08-25 · **Status:** accepted

**Context:** Phase 6's cluster is four mods. Two of them ended their §8.2 investigations with the
verdict changed and no code written, which is worth recording so a later session does not read
the gap as an oversight.

**Decision:**

- **Floating Status Bar (7) → `ZEN`.** Its entire README is one sentence: it detaches the status
  bar from the window corner so it appears to float. Zen's own
  `zen.theme.styled-status-panel` gives `#statuspanel` padding and its label a 16px radius, a
  hairline and a background mixed from `--zen-primary-color` — which *is* that behaviour — and it
  is on by default on macOS. Building a Trance version would mean two owners for one element
  (§3.1) in exchange for nothing a user could point at. The Zen pref is surfaced on the Trance
  settings page rather than mirrored into a `trance.*` pref, for the reason `superpins.md` §6
  gives about lazy pinned tabs.

- **Render.js (14) → `DEFER`.** This answers TRANCE.md §16 Q8, which held a phase slot open
  pending exactly this investigation. Its five behaviours are: a workspace fan switcher (Zen owns
  the space transition, and the swipe gesture is built around it), reactive workspace indicators
  (a clock — that is Live Calendar, mod 9, Phase 7, with an `onWallClock` design already
  specified), new-tab hover interactions (Phase 5 assigned that button an owner), masonry
  essentials (a tab-strip layout change, unrelated to motion), and "ambient motion across the UI"
  (not a behaviour, and §3.4 exists because ambient chrome motion is what holds the refresh
  driver awake). Five behaviours, five conflicts with owners that already exist.

**Consequences:**
- `mods-inventory.json` carries both new verdicts; Render.js has no `phase`.
- §16 Q8 is answered and can be closed.
- If the user names a Render.js behaviour they actually use, it gets built against the owner it
  belongs to — not as a mod port. `docs/trance/mods/render-js.md` §8 asks.
- The count that matters for §8's table: of 23 mods, one is now `ZEN` and one is `DEFER`.

---

## ADR-022 — A translucent window spends none of the blur budget

**Date:** 2026-08-25 · **Status:** accepted · **Extends:** ADR-019

**Context:** ADR-019 established that frosting is translucency of Zen's own background layers
rather than a tint Trance paints, and kept a `backdrop-filter` behind that translucency to soften
whatever Gecko had painted underneath. Three separate reports followed from a single build:
*"frosting is pure black"*, *"the area around the tab window is unfrosted"*, and *"blur radius
and surface saturation do nothing"*.

Two causes, and the second is the interesting one.

1. `trance-surface-visible` was never set at startup. Every blur rule was gated on it, and
   `TranceSurfaces` only listened for `focus` — which a chrome window that is already frontmost
   when the feature initialises never fires, and `TranceCore` enters at
   `MozBeforeInitialXULLayout`. So the blur was dead for the whole session and the slider
   genuinely did nothing.

2. Once that was fixed the blur ran, and the sidebar turned **solid black**. Measured on macOS
   with the same profile and the same translucency: `trance-surface="flat"` (no
   `backdrop-filter`) renders the sidebar as glass over the desktop; `trance-surface="nebula"`
   (identical except for the filter) renders it opaque black.

The reason is that "the frost" is two different things depending on the platform. Where the
window is translucent in its own right — macOS vibrancy (`zen.widget.macos.window-vibrancy`
installs an `NSVisualEffectView` as the window's content view, `nsCocoaWindow.mm`), Windows Mica,
or a transparent GTK window — the frost is produced **behind Gecko** by the compositor, and
`#main-window` is `background: transparent` so it shows through (`zen-theme.css`). Nothing Gecko
painted is involved.

`backdrop-filter` cannot reach that. It establishes a backdrop root, snapshots the region
*Gecko* painted behind the element — which in a transparent window is nothing — filters that, and
composites the result over the area. The transparent region stops being transparent. The
operating system's frost is not softened; it is replaced.

**Decision:** the blur budget is a ceiling, not a target. On any platform whose window supplies
its own translucency, Trance ships **zero** `backdrop-filter` surfaces and the compositor is the
entire effect. The three-surface budget applies unchanged everywhere else, where the window is
opaque and Gecko really did paint the backdrop.

The condition is the same media query `zen-theme.css` uses to decide whether `#main-window` is
transparent, so the two can never disagree:

```css
(-moz-windows-mica) or (-moz-platform: macos) or
  ((-moz-platform: linux) and -moz-pref('zen.widget.linux.transparency'))
```

**Consequences:**
- On macOS the surface blur radius has nothing to act on, so `about:preferences#trance` hides the
  slider on exactly that condition and shows one sentence in its place. A control that provably
  cannot do anything is worse than an absent one.
- Surface *saturation* moved out of the `backdrop-filter` and onto Zen's background elements as a
  `filter`, so it acts on the workspace gradient — the thing a person moving a slider called
  "surface saturation" is looking at — rather than on a backdrop that does not exist.
- The default `trance.surface.opacity` dropped from 62 to 35. With the black-painting filter gone,
  62% of Zen's gradient is still an almost-opaque sheet on a space with no gradient picked.
- This is the best available outcome for §3.3's power argument, not a compromise against it: the
  platform where blur was most expensive is now the platform that runs none.
- The address bar's page dim is unaffected. That is a `filter` on content Gecko really does paint,
  it is clipped to the content pane, and it has its own radius pref rather than borrowing this one.

---

## ADR-023 — Internal pages are reached with a registered user sheet, not with the chrome

**Date:** 2026-08-26 · **Status:** accepted · **Extends:** ADR-019, ADR-011

**Context:** With the chrome frosted, `about:preferences` and `about:config` are the last opaque
slabs in the window — and they are the pages a user opens to change how the window looks, so the
one place the effect breaks is the one place it is being adjusted.

Nothing in the existing surface layer can reach them. Every Trance stylesheet is an AUTHOR sheet
loaded into a browser window through `nsIDOMWindowUtils` (ADR-010). An `about:` page is a
*content* document in a `<browser>`: no chrome stylesheet is in its scope, `:root` is the page's
own root, and `--trance-*` does not exist there.

There are two halves to make translucent and they are owned by different layers:

1. **The canvas.** Gecko fills a content browser's canvas with the page's background colour, or
   with `-moz-default-background-color` when the page declares none. It composites with alpha only
   when the `<browser>` carries `transparent="true"`, which is what
   `browser.tabs.allow_transparent_browser` makes `tabbrowser.js` do at browser-creation time —
   the same platform switch the `content` region already claims (ADR-011).
2. **The page.** `common-shared.css` paints `--in-content-page-background` on `body`, so even over
   a transparent canvas the page paints itself opaque.

**Decision:** the page half ships as `trance-internal.css`, registered by `TranceSurfaces` with
`nsIStyleSheetService` as a **USER sheet** and scoped with `@-moz-document url-prefix("about:")`.
That is the mechanism `userContent.css` has always used and the only one available to a sheet that
must pick its documents by URL.

Three consequences are recorded here rather than discovered later:

- **It is the one Trance sheet allowed `!important`.** The ban (§6.2 rule 1) is about author sheets
  fighting author sheets, which is nondeterministic. A user sheet is a different cascade origin,
  and user-normal loses to author-normal, so `!important` there is the documented way to sit above
  the page rather than a way to win a race. The stylelint plugin exempts that one named file.
- **It cannot read the token layer.** `--trance-internal-alpha` is declared in the file and
  re-declared at runtime by a generated one-line `data:` sheet built from
  `trance.surface.internal.opacity`. Two `nsIStyleSheetService` calls when the slider stops moving;
  no rule anywhere is rebuilt.
- **The switch is per-browser, not per-URL.** Claiming `allow_transparent_browser` makes *every*
  tab's canvas alpha-composited, at which point Zen's own `[transparent="true"]` rule would make
  arbitrary websites translucent too — which Trance does not do, because it cannot make an unknown
  page's body text legible over a workspace gradient. So `TranceSurfaces` marks the browsers
  holding an `about:` page with `trance-internal-page`, from one tabs progress listener per window,
  and `trance-surfaces.css` gives every unmarked browser the chrome's own opaque colour.

**Alternatives rejected:**

- *Register the sheet per window as an author sheet.* An author sheet in the chrome window is not
  in the content document's scope at all. This does not work, it merely looks like it should.
- *Ship the alpha as one of a few discrete levels selected by `@media -moz-pref(…)`.* `-moz-pref()`
  is a media-query feature only, so this would mean a rule per step and a slider that snaps.
- *Make every browser transparent and accept it.* This is the failure mode above, and it is
  precisely the "Trance never restyles a page" line in §1.

**Consequences:**
- `about:preferences#trance` can now be designed against a translucent backdrop, which is what
  made the card treatment in `trance-settings.css` worth doing.
- The user sheet is application-wide, so `TranceSurfaces` refcounts it across windows rather than
  letting `TranceStyles` handle it — the one stylesheet in the tree that is not per window.
- Turning the region off unregisters both sheets, releases the platform pref if the `content`
  region does not also want it, and removes the marker from every browser. A disabled feature
  costs zero (§6.5) holds.

---

## ADR-024 — Trance installs "New Icons" rather than reimplementing it

**Date:** 2026-08-26 · **Status:** accepted · **Supersedes in part:** the icon-cluster plan in §8.1

**Context:** "New Icons" (`qumeqa/zen-icons`) has no licence file. §7.3 is unambiguous about what
that means: no asset and no rule may be copied, and its look may not be reproduced. Phase 5's
answer was `scripts/trance-icons-line.py` — an original 51-glyph stroke set written against a
stated construction (16×16 grid, 1.5px stroke, round joins) rather than traced from anything —
which satisfies the *coverage* requirement the mod contributed and deliberately does not look like
it.

That is the most a clean-room reimplementation can do, and it is not what someone who wants that
icon set wants. They want that icon set.

**Decision:** installing a mod is not copying it. Trance already ships Sine preinstalled precisely
so that everything it does not reimplement stays reachable (ADR-018), and `scripts/trance-cosine.py`
already fetches Sine itself from its own releases at provisioning time rather than vendoring it.
The same arrangement applies here: the provisioner installs `new-icons` from the Sine store into
`{profile}/chrome/sine-mods/` and into the new-profile stage, at whatever version the author is
currently publishing. Nothing from the mod enters this tree, and the tree carries no licence claim
over it.

`trance.chrome.icons.enabled` therefore defaults to **false**. The three Trance packs are still
shipped, still one switch away, and still the answer for anyone who uninstalls the mod — but they
are no longer what the browser does out of the box, because the browser can now do the real thing.

**Consequences:**
- This is the only entry in `PREINSTALLED_MODS`, and the list exists for a legal reason rather than
  a design one. Adding a second mod to it needs its own argument: §1's "not a mod manager" is
  otherwise back on the table.
- The mod guard gains a fifth status, `shipped`, and `new-icons` moves to it. It is not a warning
  and is not coloured like one — the banner says Trance installed it, why, and that turning the
  Trance packs on would give every toolbar glyph two owners.
- Fresh profiles get it too: `config.js` now seeds `chrome/sine-mods` from the staged copy
  alongside `chrome/utils` and `chrome/JS`. Sine rebuilds `chrome.css` from `mods.json` on every
  startup, so the absolute paths in the staged entry-point sheets never have to be rewritten.
- The provisioner merges into an existing `mods.json` rather than replacing it. A provisioner that
  removed a user's own mods would be a mod manager with an opinion.
- Sine's self-updater owns the mod from then on, exactly as it would for a mod the user installed.

---

## ADR-025 — Edgeless: the web view is part of the browser, and the frost is one layer

**Date:** 2026-08-26 · **Status:** accepted · **Extends:** ADR-019, ADR-022

**Context:** Stock Zen floats the web view — `--zen-element-separation` of gutter around it,
`--zen-big-shadow` under it, four rounded corners, and an opaque background of its own. With the
chrome frosted, that arrangement is what stops the window reading as one material: the card is
opaque, the gutter around it is frosted, and the seam between them is the hardest edge on screen.

The frost had the matching problem at a smaller scale. Three regions each painted their own sheen
— `#navigator-toolbox`, `#zen-appcontent-navbar-wrapper`, `#urlbar[breakout-extend]` — so the
sidebar and the toolbar were two panes that happened to be adjacent, and the gutter between them
and the page was a third appearance again.

**Decision:** one switch, `trance.surface.edgeless`, default on, that makes four changes which are
one decision:

1. `#zen-tabbox-wrapper` loses its margin, so the view reaches the window edge.
2. `.browserSidebarContainer` loses every corner radius, in both layouts.
3. The shadow goes. A shadow is what a floating card casts.
4. The view takes `--zen-main-browser-background`: the colour of what surrounds it.
5. `#zen-toolbar-background` stops painting, so the sidebar and the page are one gradient.

And then the sheen collapses onto `#zen-main-app-wrapper`, which spans the sidebar, the toolbar, the gutter and
the space around the page. The content pane paints over it, so the page is never behind glass and
everything that is not the page is behind the same glass.

**Consequences:**
- The blur budget drops from three surfaces to two, and in practice to one: `#zen-main-app-wrapper` carries the
  layer, and the expanded address bar keeps its own because it floats over the *page* rather than
  over the chrome, so no other surface is behind it to do the job. On a translucent window it is
  still zero (ADR-022).
- The three region switches remain, and remain meaningful with edgeless off. They are not dead
  code; they are the non-edgeless arrangement.
- Four of the rules need Zen's own specificity to beat, and carry `trance-specificity` comments
  saying which declaration each one replaces. That is the mechanism §6.2 rule 7 provides for
  exactly this case; the alternative is `!important`.
- "The tab window is the same colour as the surroundings" is also what keeps ADR-023 honest: with
  `allow_transparent_browser` claimed for internal pages, an unmarked browser needs an opaque
  backdrop from somewhere, and this is it.

**Amendment, 2026-08-26 — points 2 and 5, from the first build with edgeless actually on.**

Point 2 originally kept one corner: the one beside the sidebar's top, named per layout because Zen
puts the sidebar on the right with an attribute rather than with `direction`, "so the sidebar and
the page still read as two things". Two problems, both visible the moment the gutter went:

- With every other edge gone, one surviving 12px arc is not a distinction — it is the only edge in
  the window, and it reads as a rule that was half-applied.
- "Which corner is round" became a fact about the layout, restated in a second rule for
  `[zen-right-side="true"]` and needing a third for whatever layout Zen adds next.

All four corners go, in both layouts, and the mirrored rule is deleted. Zero is the same answer on
both sides, which is what "adapts to tabs on the right" should have meant.

Point 5 is new, and it is the edge that survived removing every geometric one. Zen renders the
workspace gradient **twice**: `#zen-browser-background` spans the whole browser area with
`--zen-main-browser-background`, and `#zen-toolbar-background` spans the entire vertical tab strip
with a separately generated `--zen-main-browser-background-toolbar` (`ZenGradientGenerator`
computes and assigns both as inline styles on those two elements). With the gutter, the shadow and
the radius gone, the boundary between the two gradients is a hard colour seam running the height of
the window exactly where the removed edge used to be — the sidebar reading blue-grey against a
pink-orange page.

Neither variable can be re-pointed: they are inline styles, so an author sheet cannot answer them
without `!important` (§6.2 rule 1). The second copy is not painted instead —
`#zen-browser-background` is `inset: 0` on `#browser` and therefore already behind the tab strip,
so `display: none` on `#zen-toolbar-background` uncovers what was always underneath rather than
painting anything new. `display: none` rather than `opacity: 0` because the element carries
`::before`, `::after` and a grain child that Zen crossfades on every workspace change, and a
transparent element still does that work. The grain is not lost: the browser-area background has
its own.

With edgeless **off**, both gradients come back — two panes are two panes, and the seam is then the
border it is supposed to be.

---

## ADR-026 — The browser's own pages get a blur surface; the chrome budget does not move

**Date:** 2026-08-26 · **Status:** accepted · **Extends:** ADR-019, ADR-022, ADR-023

**Context:** ADR-023 made `about:` pages translucent. That is half of what the setting promises. A
translucent page over an *unblurred* backdrop does not read as glass; it reads as a washed-out
slab, because the workspace gradient's grain shows straight through the type. Every frosted chrome
region in the browser is blurred; the one surface a person spends minutes reading was not.

The obvious objection is the blur budget: three surfaces, and adding a fourth needs an entry here
(TRANCE.md §12.3 rule 1).

**Decision:** add `trance.surface.internal.blur`, default on, gated on
`trance.surface.internal-pages`, which applies the same `backdrop-filter` the chrome regions use to
`browser[trance-internal-page="true"]` — the element `TranceSurfaces` already marks from its one
tabs progress listener.

The chrome budget stays at three, and this is not a fourth entry in it:

- It is not a chrome region. It is the page-transparency feature ADR-023 already ships, finished.
- It cannot nest with the chrome surfaces. The content pane paints *over* the edgeless layer, so
  the two never sample each other — which is the property that made nesting the expensive case.
- It is painted only while a browser is actually showing an `about:` page. A window with three
  websites open pays nothing.
- It is inside the same platform gate as everything else in that section: on a translucent window
  (macOS vibrancy, Windows Mica, transparent GTK) it does not exist, because there the compositor
  has already produced the frost and a `backdrop-filter` over it would replace it with a flat
  rectangle (ADR-022).

**Consequences:**
- On macOS — the platform this was developed on — the switch is inert and the settings page swaps
  it for a note, on exactly the same media condition the stylesheet uses. That is the same
  treatment the blur-radius slider already gets, and it is honest: the frost is there, the
  operating system made it.
- Gating on the switch above rather than standing beside it means one question is answered in one
  place. Blurring what is behind an opaque page is a pass spent on something nobody can see.
- `trance-surfaces.css` gains a fourth `backdrop-filter` block. It remains the only file allowed
  one, and the linter still enforces that.

---

## ADR-027 — Folder tree connectors are installed, not reimplemented

**Date:** 2026-08-26 · **Status:** accepted · **Extends:** ADR-024 · **Supersedes part of:** Phase 4

**Context:** Trance drew folder tree connectors itself: a trunk on `.zen-tab-group-start` and an
elbow on each child's `::after`, two boxes and no JavaScript where the mod ships a `.uc.js` that
walks the tab strip on every mutation. It was cheaper than the mod, it was a clean-room
reimplementation by requirement — Zen Folder Tree Connectors is GPL-3.0, so under TRANCE.md §7.2 no
rule from it may be copied — and it was, unavoidably, an approximation of someone else's drawing.

That is the identical position ADR-024 found for the "New Icons" icon set, arrived at from the
other end of the licence spectrum: unlicensed there, strongly licensed here, the same consequence
either way. ADR-024 answered it by installing the mod rather than reproducing it, and gave the
reason: installing a mod is not copying it. Sine fetches it from the author's own repository at
provisioning time, exactly as its own installer would, and nothing from it enters this tree.

**Decision:** apply the same answer. `scripts/trance-cosine.py` preinstalls
`ZenFolderTreeConnectors` alongside `new-icons`, and Trance draws no connectors of its own:

- `trance.tabstrip.connectors` is removed. Not defaulted off — removed. A pref that configures
  nothing is a second owner that happens to be idle.
- `--trance-connector-color`, `--trance-connector-width` and `--trance-connector-radius` are gone
  from the token layer, and the rules that consumed them are gone from `trance-tabstrip.css`.
- The mod guard's entry for it moves from `native` to `shipped`, so its card says Trance put it
  there rather than warning about it.

**Consequences:**
- The connectors are the lines the mod's author draws, at the version they publish, and there is
  exactly one owner for them again.
- Uninstalling the mod now leaves folders with no connectors at all, where before it fell back to
  Trance's. The mod guard's banner says so.
- The mod's `.uc.js` runs, with the per-mutation walk Trance's CSS avoided. That is the cost, it is
  real, and it is the same trade ADR-024 accepted: a mod the user can uninstall beats a
  reimplementation the user cannot have the original of.
- Two mods are now preinstalled. Both are drawings; that is the test for this category, and a
  third entry needs the same argument, not a preference.

---

## ADR-028 — The settings page has one palette, declared once, for the whole document

**Date:** 2026-08-26 · **Status:** accepted

**Context:** `trance-settings.css` styled `[data-category="paneTrance"]` and nothing else. The
result was that the Trance pane was the one coherent surface in a window of Firefox defaults, Zen's
additions and Sine's markup — five visual languages behind one sidebar, each individually
defensible, together reading as an unfinished port. The sticky strip behind the search box was the
sharpest symptom: `preferences.css` paints it in `--background-color-canvas` so scrolled settings
are occluded, which on a page Trance had made translucent is an opaque rectangle across the top of
a transparent page.

**Decision:** the palette moves up a level, to `#preferences-root`, and is a real palette rather
than a set of tweaks: Vercel's — a true black canvas, one hairline doing all the separating, type
in two weights and two greys, one control radius and one card radius, and an *inverted* primary
(white on black, black on white) instead of a hue.

Three mechanics carry it:

1. **Cascade layers.** Firefox's in-content design tokens are declared inside `@layer tokens-*`. An
   unlayered declaration beats a layered one outright, whatever its specificity — so one block
   re-points the whole design system with no `!important` and no arms race.
2. **Custom-property inheritance into shadow DOM.** `moz-page-nav`, `moz-card`, `moz-toggle` and
   `moz-input-search` declare the same tokens on `:host`; the outer tree wins for normal
   declarations, so the value set on the document root is the value the widget's internals see.
   The category rail, the search box and every card restyle without a selector reaching into a
   shadow tree.
3. **The alpha is a variable, not a theme.** Every surface colour is mixed toward `transparent` by
   `--trance-internal-alpha` — the value the Page opacity slider writes into the registered user
   sheet. The same declarations are glass while internal-page transparency is on and solid black
   when it is off.

Two things do not fit that mechanism and are handled explicitly:

- **No hue.** Zen resolves `--color-accent-primary` from the active space's gradient, and a profile
  with no gradient picked resolves it to a near-neutral grey. A design leaning on it is a design
  that disappears on a fresh profile — the same failure `--trance-accent-vivid` documents for the
  chrome. The page's inverse is the one value guaranteed to read in both schemes.
- **`<menulist>` is drawn by the platform.** On macOS that is a real `NSPopUpButton`: it ignores
  every token above and opens a system-coloured menu. `trance-settings.js` leaves the menulist in
  the DOM — `Preferences` binds to it and Sine's dialogs listen to it — and gives it a combobox
  face, forwarding a selection back as `menulist.value = …` plus a bubbling `command`. State stays
  on the menulist, so the sync is one-directional. Scope is deliberately the Trance pane and Sine's
  mod dialogs only: Firefox's own panes populate their menulists from pane code at times this file
  cannot predict, and replacing those would be a behavioural change dressed up as a visual one.

**Consequences:**
- Sine's pane needs `!important`, and gets its own file for it. Sine's stylesheet is a third
  party's, injected into the same document at runtime, with roughly a dozen `!important`
  declarations; inside one origin no specificity answers that. TRANCE.md §6.2 rule 1 exists because
  the mod stack used `!important` to fight *itself* — four sheets, one element, a winner that
  changed with load order. Here there are two sheets in a fixed order and Trance's is meant to win.
  The exemption is one named file (`trance-sine.css`) with that argument written in it, and the
  linter enforces the ban everywhere else.
- `trance-settings.css` becomes the token owner for a document the chrome token layer cannot reach,
  on the same terms `trance-tokens.css` is for a browser window: one block, at the top, and nothing
  below it declares a colour.
- `#search-container` is re-painted rather than cleared. It still has to occlude; making it
  transparent would put scrolled settings behind the search box. The user sheet deliberately leaves
  the property alone and says so, because an author-normal declaration loses to a user
  `!important`. **Superseded — see ADR-029.**
- `trance-settings.js` grows a document-level layer (`gTrancePage`) beside the pane module, because
  the combobox has to reach Sine's dialogs and `preferences.js` only constructs the pane module
  when someone opens the Trance pane. It owns the page's one scheduler and observer hub;
  `trance-mod-guard.js` borrows them rather than installing a second MutationObserver over the same
  subtree.

---

## ADR-029 — One pane language: the platform's own widgets are the component set

**Date:** 2026-08-26 · **Status:** accepted · **Extends:** ADR-028

**Context:** ADR-028 gave the document one palette. It did not give it one *layout*. The Trance
pane is a card of rows — a name, a sentence, a control in the same three columns every time, with
switches on the right-hand edge. Zen's three panes (Look and Feel, Tab Management, Keyboard
Shortcuts) are a `groupbox` of loose `checkbox`es with an `<h2>` every so often and a tickbox on
the left, and Firefox's own panes are a third arrangement again. Same colours, three shapes; the
category rail switches between them and the page reads as three products sharing a window.

Two smaller things came out of the same build:

- The search strip was still a black rectangle across the top of the settings page. ADR-028 painted
  it in "the page's own colour at the page's own alpha" on the theory that a colour the page
  already uses cannot read as a separate slab. It can, because the page is not that colour:
  `trance-internal.css` clears the root's *and* the body's background outright, so nothing else in
  the document paints `--in-content-page-background` and the strip was the only thing rendering it.
- Focus could enter a text field on this page and not leave. In an HTML document `mousedown` on the
  body moves focus off whatever had it; in a XUL document `#preferences-body` is not focusable, so
  nothing accepts the focus, and Escape did nothing either. Tab and clicking another control were
  the only ways out.

**Decision:**

1. **The platform's widgets are the component set.** No markup is added to Zen's or Firefox's
   panes. `groupbox` becomes the Card, `checkbox` becomes the Switch, `menulist` becomes the Select
   (the ADR-028 combobox), `input[type=range]` becomes the Slider, `.zenCKSOption-input` becomes a
   `kbd`. Every rule is written to the same specificity as the declaration it replaces and wins on
   sheet order, so the ban on `!important` holds and each widget keeps the behaviour and
   accessibility the platform wrote for it.

   The switch is the one that needed a technique. A XUL `checkbox` gives exactly one child to work
   with, `.checkbox-check`, and the Trance pane's switch uses the checkbox as the track and the
   check as the knob — which is unavailable here, because on these panes the checkbox is the whole
   row. So `.checkbox-check` is the track and the knob is a `radial-gradient` inside it:
   `background-position-x` is animatable, so the knob slides, the switch stays one element and one
   composited property, and no pseudo-element is asked of a XUL `<image>`.

2. **Every heading is an eyebrow.** `hbox.subcategory > h1` is drawn as a small-caps band on every
   pane, and the Trance pane's page-title override is deleted. One pane in twelve wearing a 1.5em
   heading was the single largest inconsistency between it and the rest, and the category rail
   already says which page this is.

3. **The search strip is neither painted nor pinned.** `.sticky-container` goes `position: static`.
   The occlusion the strip existed to provide is only needed because the strip is pinned; unpinned,
   the search field scrolls with the settings it searches, there is nothing behind it to hide, and
   it needs no background. That is also where a Vercel settings search lives — in the flow at the
   top of the page rather than in a bar over it.

4. **Escape and click-away leave a text field.** Two window listeners in `gTrancePage`, both of
   which read `document.activeElement` and return immediately unless it is a text field. Escape is
   handled in the bubble phase and honours `defaultPrevented`, so `moz-input-search` still clears
   its own value on the first press and this blurs on the second. Range, checkbox and radio inputs
   are excluded: they are focusable and are not text fields, and blurring a slider on Escape would
   take the keyboard away from someone adjusting it.

**Consequences:**
- The combobox scope grows to `groupbox[data-category^="paneZen"] menulist`. The condition is not
  "which pane it is" but whether the `menupopup` is written out in full at parse time and never
  repopulated — all six of Zen's are, which is why Firefox's own panes stay out for the reason
  ADR-028 gives.
- The card, row and switch rules are scoped to `groupbox[data-category^="paneZen"]`. Firefox's own
  panes are deliberately out: they already carry the ADR-028 palette and are already built out of
  `moz-card` and `setting-group`, and their checkboxes sit at unpredictable depths inside `hbox`es
  and fieldsets, where a full-bleed row would pull its negative margin out of the wrong container.
  Zen's markup is flat — every checkbox is a direct child of the groupbox or of one `vbox.indent` —
  which is the condition these rules need, and the selectors say so by being direct-child
  selectors rather than descendant ones.
- The eyebrow rule *is* document-wide, because it is type rather than layout and cannot bleed out
  of a container. That is what makes the panes read as one product even where the card treatment
  does not apply.
- The Trance pane keeps owning its own card treatment. The measure of the change is that the two
  are indistinguishable.
- The mochitest that asserted the strip carried an alpha now asserts it carries none, and the
  edgeless corner test asserts zero corners instead of one. Both were checking the previous
  decision correctly; both decisions changed.

---

## ADR-030 — Zen Library and Live Calendar are installed, not reimplemented

**Date:** 2026-08-26 · **Status:** accepted · **Extends:** ADR-024, ADR-027 · **Supersedes:** Phase 7

**Context:** Phase 7 was `TranceLibrary` and `TranceCalendar`: a custom element with a Places data
layer and its own settings section, and an `onWallClock`-driven calendar held to one timer wakeup
per minute. `TRANCE.md` §13 wrote "Library is non-negotiable" next to it.

Two mods were already preinstalled rather than reimplemented, and both were preinstalled for a
licence reason: the thing they ship is a drawing, and a clean-room reimplementation of a drawing is
an approximation of it (ADR-024, ADR-027). ADR-027 closed by saying a third entry in that category
"needs the same argument, not a preference". These two do not have that argument — neither ships a
drawing — so they need a different one, and the investigations found it.

The argument that justifies every reimplementation in this project is **ownership**. Two
stylesheets over one element with a winner decided by load order is `TRANCE.md` §3.1, and removing
that is what the native rewrites buy. Neither of these mods is in that position:

- Zen Library opens a full-window shell of its own, on a command of its own, and restyles nothing
  Zen or Trance owns.
- Live Calendar draws a hover popup over a pinned essentials tab and restyles nothing either.

With no conflict to remove, what is left is cost, and the cost audits came back at or below what a
Trance rewrite would have achieved. Zen Library is 7,500 lines holding no interval, no
`MutationObserver`, no `backdrop-filter` and no infinite animation; its single static
`will-change` is the only §3 offence in the whole mod. Live Calendar holds exactly one always-armed
timer — a 60-second ICS refresh — which is precisely the budget phase 7's own acceptance criterion
set for the replacement, plus a 1 Hz countdown that exists only while a reminder popup is up.

**Decision:** preinstall both. `scripts/trance-cosine.py` gains `zen-library` and
`zen-live-calendar`, and Trance builds no library and no calendar:

- No `TranceLibrary`, no `TranceCalendar`, no `prefs/trance/apps.yaml`, no settings section. Not
  written and defaulted off — not written.
- The inventory's verdict for mods 9 and 23 changes `NATIVE` → `PREINSTALL`, and the legend for
  that verdict widens: it is no longer only for drawings.
- Both mod-guard cards move from `planned` to `shipped`, and each says what it costs — the 60-second
  timer is named on the calendar's card rather than left in this file.

**Consequences:**
- Phase 7's acceptance criteria are met by the mods rather than by Trance code, and the calendar's
  ≤ 1 wakeup/minute criterion is measured on the thing that ships.
- Four mods are now preinstalled and there are two admissible arguments for that category, not one:
  a licence that forbids reproducing a drawing, or a mod that owns nothing Trance owns and costs
  what a rewrite would cost. Both are narrow, and a fifth entry still needs one of them.
- Zen Library's `will-change: transform` ships, so one compositor layer is promoted for an element
  that is hidden until the library is opened. That is the entire measured §3 cost of this decision.
- Live Calendar needs a per-calendar secret ICS URL that nothing can provision, so its setup stays
  manual and is documented in `CREDITS.md` and its investigation doc.
- Zen Library stays the highest-value relicensing-outreach target in `CREDITS.md`, but for a
  different reason than before: not so Trance can copy it, so that shipping it is unambiguous.

---

## ADR-031 — The theme picker is extended in place, not rebuilt

**Date:** 2026-08-26 · **Status:** accepted

**Context:** Phase 8 is "an enhanced gradient picker, clean-room, built on Zen's existing gradient
engine". The mod it comes from, BetterZenGradientPicker, is unlicensed, so no source was read and
only its observable behaviour is in scope (`TRANCE.md` §7.3).

The investigation found that Zen's own picker already does most of it. Zen owns the wheel, up to
three dots, six harmony algorithms, five preset pages, a translucency slider, a grain knob, the
per-space theme format, the session-store persistence and the paint. Of the seven behaviours the
mod adds, exactly one — a translucency slider — is a duplicate of something Zen already has.

That makes "reimplement the picker" the wrong shape. A Trance picker would have to own the gradient
engine, the theme format and a migration for every existing space, and it would arrive at a panel
that looked much like the one already there. Worse, it would put Trance in the position the mods are
in: a second owner for one panel, with the arrangement decided by load order — §3.1, reintroduced by
the feature whose whole subject is a colour panel.

**Decision:** `TranceTheme` extends Zen's picker in place.

- Trance appends its own nodes to `#PanelUI-zen-gradient-generator` and wraps five methods on
  `gZenThemePicker` as own-properties of this window's instance: `getColorFromPosition`,
  `getGradient`, `getGradientForWorkspace`, `onWorkspaceChange` and the static `getTheme`. Zen keeps
  owning everything it owned.
- The gradient angle is applied by **rotating the CSS Zen produced** rather than by reimplementing
  `getGradient`: each `linear-gradient()` angle moves by the delta and each
  `radial-gradient(circle at x% y%)` centre rotates about the middle of the box by it. Zen's three
  layout cases — and any future one — keep working without Trance knowing about them.
- **No Trance translucency slider.** Requirement 2 of the brief is met by the slider Zen already
  ships; the palettes move that one. A second control over one value is the thing this project
  removes.
- Lightness, angle and palette are **per space**, so they are three extra fields on the theme object
  Zen already saves, stamped in by the one seam every write passes through. They are not prefs: one
  pref would be one value for all spaces, and one pref per space is an unbounded set that §6.6 could
  not surface.
- Exact hex entry is a front-end to Zen's own `addCustomColor`, and Zen's colour swatch and opacity
  spinner are **moved** into the Trance row rather than duplicated. Trance claims
  `zen.theme.gradient.show-custom-colors` while enabled and gives it back on disable, because
  without that list there is no way to remove an exact colour again (ADR-011's pattern).

**Consequences:**
- Phase 8 adds **no upstream touchpoint**. The list stays at 14 (`TRANCE.md` §11.3 budget: ~15).
- While a lightness is set, the wheel is hue and saturation only, where Zen derives lightness from
  distance to the centre. That is a real behaviour change to an existing control, it is what asking
  for a lightness slider means, and the "Full colour" palette reverses it.
- Trance depends on the shape of five Zen methods, so an upstream rewrite of `getGradient` is a
  rebase hazard that no touchpoint list will warn about. The mochitest asserts the rotation and the
  lightness *through* the picker rather than by inspecting Trance's own code, so it fails loudly if
  the seam moves.
- The feature attaches on the `zen-space-gradient-update` notification rather than on window load,
  because `gZenThemePicker` is constructed during session restore. In a private window that
  notification never fires, no picker is ever built, and the feature correctly costs one observer.
- The saved-themes list is the only Trance pref that is state rather than a setting. It appears on
  the settings page as a count with a "Forget all" button, which is what §6.6 asks of it.

---

## ADR-032 — The extension policy is installed by the build, and there is exactly one of it

**Date:** 2026-08-26 · **Status:** accepted

**Context:** `TRANCE.md` §9 requires seven extensions on a fresh profile, installed by an enterprise
policy rather than vendored as XPIs (§9.1), and lists three per-platform paths for `policies.json`:
inside the bundle on macOS, beside the binary on Linux and Windows. It also notes that
`build/AppDir/distribution/policies.json` already exists and says "merge into it, do not create a
second file".

That file is the AppImage's, and only the AppImage's. It is copied into the Linux AppDir by
`.github/workflows/build.yml`; it is not part of any macOS or Windows package, and it is not part of
the local build a developer runs. Merging into it would have produced a browser that installs seven
extensions on Linux and none anywhere else — and the update policies it already carries
(`DisableAppUpdate` and friends, ADR-009) turn out to have had that shape all along.

Firefox does have a supported way to place this file: `FINAL_TARGET_FILES.distribution`, which is how
`browser/app/distribution` installs `distribution.ini`. It needs a `moz.build`, which
`src/zen/trance/` had deliberately never had (ADR-012).

**Decision:** one `policies.json`, owned by Trance, installed by the build.

- `src/zen/trance/distribution/policies.json` carries both the update policies and the seven
  `ExtensionSettings` entries.
- `src/zen/trance/moz.build` installs it with `FINAL_TARGET_FILES.distribution`, under
  `DIST_SUBDIR = ""` — without the reset it would land in `dist/bin/browser/distribution/`, which
  nothing reads, because `browser/moz.build` exports `DIST_SUBDIR = "browser"` and this tree is
  reached through `browser/base/moz.build`.
- `src/zen/moz.build` gains `"trance"` in `DIRS`. That was a *planned* touchpoint (`TRANCE.md`
  §11.3) whose condition was "only when Trance ships C++, XPIDL, an XPCOM manifest or a
  `resource:///modules/` module". None of those is true; a build-installed data file is a fourth
  case the condition did not anticipate, and the alternative was a second copy of the policy in
  someone else's tree. ADR-012 otherwise stands: everything reachable by a `chrome://` URL is still
  packaged by `jar.inc.mn` and there is still no `Components.manifest`.
- `build/AppDir/distribution/policies.json` is **deleted**. This is not tidying: the AppImage step
  runs `mv zen/* $APPDIR/`, and `mv` refuses to move a directory onto a non-empty directory of the
  same name, so leaving both files in place would have broken the Linux build the first time the
  packaged tree contained a `distribution/` of its own.

**On `extensions.autoDisableScopes`.** §9.2 prescribed setting it to 0, "do not auto-disable
policy-installed add-ons". It does not do that. `XPIDatabase.updateMetadata` reads it under
`isDetectedInstall && aNewAddon.foreignInstall`, so it applies only to add-ons *found in a scanned
directory*. A policy install is `AddonManager.getInstallForURL(...).install()` — the ordinary
profile-scope install path, never marked foreign, enabled as soon as it finishes. Setting it to 0
would have changed nothing for our seven and would have removed the protection that stops another
program dropping an XPI into the system add-ons directory and having it enable itself. It is not
set. `prefs/trance/extensions.yaml` keeps the other half of §9.2,
`extensions.postDownloadThirdPartyPrompt`, and still does not touch
`xpinstall.signatures.required`.

**On what `normal_installed` actually permits.** §9.1 says the user "can disable or remove it". Half
of that is right. `Policies.sys.mjs` calls `manager.disallowFeature("uninstall-extension:<id>")` for
`normal_installed` as well as `force_installed`; only the *disable* feature is left alone for
`normal_installed`. So a bundled extension can be turned off but not uninstalled from about:addons
while the policy is active. That is a documentation correction, not a decision to revisit: the
switch that matters is there, and removing the policy entry removes the rest.

**The first-run panel.** `TranceFirstRun` reports what the policy actually did, once, and offers to
retry.

- The list of extensions comes from `Services.policies.getActivePolicies().ExtensionSettings`, not
  from a list in the module. `policies.json` is the one owner of that decision, and a second copy in
  JS would go stale on the first change. The module holds display names only, and falls back to the
  add-on id.
- Retry calls `installAddonFromURL` from `PoliciesHelpers.sys.mjs` — the policy engine's own
  function, with its own arguments. A retried install is the first implementation run again, not a
  second one that might differ.
- A row is "Installing…" only while `AddonManager.getAllInstalls()` says so, "Failed" only when an
  install event says so, and "Not installed" otherwise. The three are genuinely different answers
  and a panel that guessed between them would be worse than no panel.
- It waits for Zen's welcome flow, and it waits on the `zen-welcome-stage` attribute rather than on
  `zen.welcome-screen.seen`. Zen sets that pref when the welcome *starts* (`ZenStartup`), so it is
  not a "welcome is over" signal; the attribute is removed in `ZenWelcome.finish()`.
- `trance.firstrun.completed` is claimed when the panel opens, not when it closes — one window
  shows it, and a browser killed with the panel open has still had its first run. The settings page
  offers "Show it again", which clears the pref.

**The pref the test suite needed.** Shipping a real `policies.json` in the build broke *every*
mochitest in the tree, not only Trance's: Gecko ignores a local policy under automation only when
`AppConstants.NIGHTLY_BUILD && Cu.isInAutomation` (`shouldIgnoreLocalPolicies`), and Trance's update
channel is `trance`, so the policy stayed active and the browser opened by dialling AMO —
`FATAL ERROR: Non-local network connections are disabled and a connection attempt to
addons.mozilla.org was made`, and the harness killed the run before a single test executed.

The fix is one pref in the mochitest profile, `toolkit.policies.perUserDir=true`, which points the
policy reader at the run-time directory instead of the install directory. Nothing writes a
`policies.json` there, so no policy is active — and `browser.policies.alternatePath`, which
Firefox's own enterprise-policy tests use, still wins, because it is consulted exactly when the
local file does not exist. It goes in `testing/profiles/mochitest/user.js`, a file Zen already
patches.

**Consequences:**
- The upstream touchpoint list goes from 14 to 17, over the ~15 budget by two. One is a deletion,
  which can only conflict if upstream edits the file it deleted; one is a `DIRS` entry; one is a
  pref in a file that was already patched.
- Under automation the panel therefore reports no active policy, which is what its "no policy" branch
  is for and what the mochitest asserts on this machine.
- Every platform now gets the update policies, where only the Linux AppImage did. That is the
  behaviour ADR-009 described and did not have.
- A build made without a full `mach build` — `build:ui` only, or a copied `.app` without its
  `distribution/` folder — has no active policy, no extensions, and a first-run panel that says
  exactly that. This is the most common way to be confused by this feature and the panel names it.
- Trance now has a `moz.build`. The rule that everything chrome-packaged goes through `jar.inc.mn`
  is unchanged, and this file should stay one `FINAL_TARGET_FILES` entry long.

---

## ADR-033 — Picture-in-Picture is installed, not reimplemented

**Date:** 2026-08-26 · **Status:** accepted

**Context:** Phase 10 was a clean-room reimplementation of "Pimp your PiP" (mod 13), with the
acceptance criterion "PiP window restyle survives Firefox's PiP updates; no effect on PiP
performance". The investigation (`docs/trance/mods/pimp-your-pip.md`) applied the ADR-030 test and
the mod passed both halves of it more clearly than Zen Library or Live Calendar did.

*Ownership*: Trance has no stylesheet in the Picture-in-Picture player. Every Trance sheet is loaded
into `browser.xhtml` through `nsIDOMWindowUtils`, and the single exception — `trance-internal.css` —
is a user sheet aimed at `about:` documents. The player is
`chrome://global/content/pictureinpicture/player.xhtml`, in a window of its own, and no Trance rule
names any element the mod touches. There is no second owner to remove.

*Cost*: 88 lines of CSS. No script, no observer, no timer, no `backdrop-filter`, no infinite
animation, no `will-change`. Two hover transitions, in a window that exists only while PiP is open.

**Decision:** Trance installs the mod. Verdict `NATIVE` → `PREINSTALL`, and phase 10 ships no Trance
code — the third phase to do so, on the argument Phase 7 established.

- It is the fifth entry in `PREINSTALLED_MODS`, and the first from the **Zen theme store** rather
  than the Sine store. Those are different install shapes: a Sine-store mod has a marketplace entry
  and an author's repository; a Zen-store mod is one folder of `zen-browser/theme-store` whose
  `theme.json` sets `homepage` to the empty string, which is the flag Sine's own updater reads to
  decide where that mod's updates come from. `scripts/trance-cosine.py` gained a second install path
  that mirrors what Sine's marketplace actor does, and preserves the empty `homepage` exactly as
  published so the mod keeps updating from the store it came from.
- The provisioner fetches that one folder rather than a zip of all seventy-odd themes, which is what
  Sine's generic installer would do on its way to keeping one of them.
- No pref, no module, no stylesheet, no settings row. The mod's switch is in Mods, with every other
  installed mod's.
- The mod guard's card for it moves `planned` → `shipped`.

**Consequences:**
- "The restyle survives Firefox's PiP updates" is no longer Trance's criterion to meet. Firefox's
  player markup is not a stable API; when it moves, the mod breaks visibly and harmlessly — the
  player looks like Firefox's again — and the fix belongs to the author who is tracking it. A Trance
  reimplementation would have carried the same risk with a slower fix.
- The mod is `!important` throughout, which no Trance stylesheet may be. That is correct for what it
  is: one author sheet answering Firefox's own, in a fixed order, with no third sheet in the
  document — the same argument `trance-sine.css` makes in this tree.
- Five of the twenty-three mods now ship as their authors publish them, on three distinct arguments:
  a licence that forbids reproducing a drawing (ADR-024, ADR-027), a rewrite that would cost what
  the original costs (ADR-030), and now a mod with nothing to conflict with and nothing to trim.

---

## ADR-034 — Two §12.1 budgets are measured differently than they were written

**Date:** 2026-08-26 · **Status:** accepted

**Context:** Phase 11's deliverable is `scripts/trance-perf.py`, which turns §12.1 from nine
assertions into nine numbers. Two of the nine cannot be measured the way §12.1 says.

*"Chrome compositor layers, idle ≤ 6 — `layers.draw-borders=true`, count."* WebRender has no layers.
It has picture-cache slices, which are not exposed to chrome script, and `layers.draw-borders` is a
debug overlay drawn on top of the window — there is nothing to count programmatically, and counting
rectangles in a screenshot would be a worse measurement than none.

*"GPU frames while occluded = 0."* Occlusion means covered by another window. A browser cannot cover
its own window, and no amount of scripting from inside the process makes macOS report otherwise.

**Decision:** Both rows keep their intent and change their instrument, and the scorecard states the
substitution on every run rather than quietly presenting a proxy as the thing itself.

- **Compositor layers → compositor surfaces.** Count the chrome elements whose *computed* style
  forces the compositor to keep a separate surface: a non-`none` `backdrop-filter`, a non-`none`
  `filter`, a `will-change` naming transform/opacity/filter, or a 3D transform. That is the property
  §12.1 was reaching for, it is exact, it is cheap, and it can gate a pull request. It is also
  checked twice — in `scripts/trance-perf.py` against a real profile, and in
  `browser_trance_perf.js` against a mochitest window.
- **Occlusion → minimise, plus a wiring test.** The harness minimises and labels the row as the
  proxy it is. `browser_trance_perf.js` separately overrides `window.isFullyOccluded`, dispatches
  `occlusionstatechange`, and asserts `TranceScheduler` suspends and stops calling frame
  subscribers.

**Consequences:**
- The mochitest proves the *wiring*, not the platform. If macOS never reports a translucent Trance
  window as occluded — which Phase 11's B2 exists to find out — that test still passes and the
  browser still burns frames. Nothing here should be read as having answered that question.
- The surface count is a computed-style snapshot, so it is only as good as the moment it is taken.
  An element promoted for the length of an animation is invisible to it, which is correct: §3.5
  permits exactly that and bans the static case, and the static case is what a snapshot sees.
- §12.1's table is updated to describe what is measured. The budgets themselves did not move.

---

## ADR-035 — Phase 11's Tier A cost one upstream touchpoint, not five

**Date:** 2026-08-26 · **Status:** accepted

**Context:** The Phase 11 plan approved spending 5–7 upstream touchpoints on inherited performance
defects, against a §11.3 budget of ~15 that already stood at 17. Working through them, four of the
five turned out not to need one, and two turned out not to be defects.

**Decision:** Take each fix in the cheapest place that is also the correct place, and drop the two
that do not survive inspection.

- **Static `will-change` (four sites) → `trance-reset.css`, zero touchpoints.** The reset layer
  exists for exactly this: neutralising a Zen default Trance is taking a position on. Each rule uses
  Zen's own selector verbatim, so it wins on load order rather than by escalating specificity, which
  is what §6.2 rule 7 asks for. The `no-will-change` stylelint rule gained a narrow exemption —
  `will-change: auto`, in that file only — because the rule bans *promoting* a layer and `auto` is
  how a promotion is taken back. Verified: `will-change: transform` in that file is still rejected.
  Two of Zen's four are deliberately left alone; `trance-reset.css` says why at the point of use.
- **Zen's loading indicator → a default-branch write in `TranceFeedback`, zero touchpoints.**
  `zen.view.enable-loading-indicator` defaults true and Trance ships its own bar, so a page load
  animated two — the §3.1 two-owners problem, reached from inside the project. Shipping the pref off
  in `prefs/trance/` does not work: `ffprefs` sorts by pref *name* with a stable sort and emits
  duplicates adjacently, so a second definition of the same name resolves in `fs::read_dir` order,
  which is filesystem-dependent. Shipping it off in `prefs/zen/view.yaml` is a permanent touchpoint
  for a value that is only correct while Trance's bar is on. So it is claimed and released with the
  feature, refcounted across windows, on the *default* branch so nothing lands in prefs.js — the
  same shape `TranceSurfaces#claimZenAcrylic` already uses for `zen.theme.acrylic-elements`
  (ADR-011).
- **`ZenMediaController`'s 1 Hz position ticker → one touchpoint, and the only one.** A
  `setInterval` that runs for the whole of every media session regardless of whether the window is
  visible. Timer wakeups are what keep an Apple Silicon CPU out of deep idle (§3.6), and this one is
  paid by the most ordinary thing a browser does in the background. Parked on
  `sizemodechange`/`occlusionstatechange`, position re-derived from elapsed wall time on resume.
- **Dropped: compact mode's `background-attachment: fixed !important`.** The plan called it a
  viewport-sized resample per repaint. It is not: `fixed` there is what aligns the compact toolbar
  overlay's gradient to the window instead of to the element, which is a visual requirement, and the
  repaint hazard `fixed` carries applies to scrolling content, which a chrome overlay is not.
  Removing it would have changed the look to buy nothing.
- **Dropped: `zen.session-store.log` defaulting true.** Twenty-eight `console.debug` calls, almost
  all on the startup and restore paths. Microseconds, against a permanent rebase surface. The
  harness profile turns it off so it does not colour a measurement; the shipped browser keeps Zen's
  default.

**Consequences:**
- The touchpoint list goes 17 → 18, not 17 → 24. §11.3's budget is still exceeded and still needs
  the retirement pass it needed before this phase.
- Two of the plan's six Tier A items were wrong on the mechanism, and both were caught by reading
  the code rather than by measuring it. That is the argument for keeping the "confirmed by reading"
  bar in front of the "measure it" bar, not behind it.
- A third correction, larger, did not reach the code at all: the plan asserted that a plain
  `npm run build` is unoptimised because `--enable-optimize` sits inside `if test "$ZEN_RELEASE"` in
  `configs/common/mozconfig`, and therefore that Phase 11 needed an 80-minute rebuild before any
  number could be trusted. The objdir says otherwise — `MOZ_OPTIMIZE=1`, `-O3`, `NDEBUG`, `MOZ_DEBUG`
  absent — because Gecko defaults optimisation on when neither flag is given. The flag was restating
  the default. What a dev build genuinely lacks is LTO, PGO and `MOZILLA_OFFICIAL`; only the last has
  a behavioural effect worth correcting (`zen.workspaces.debug` defaults true), and the harness
  profile corrects it in one line. `scripts/trance-perf.py` records the build's provenance on every
  run and refuses only a genuine `--enable-debug` build.

---

## ADR-036 — The Trance mochitests only pass when run one file at a time

**Date:** 2026-08-26 · **Status:** accepted (defect recorded, not fixed)

**Context:** Phase 11 needed to know whether its changes broke anything, which meant knowing what
was already broken. `npm test trance` reports 6–7 failures across four files. Every one of those
files passes on its own:

```
npm test trance/browser_trance_settings.js   → 0 failures
npm test trance/browser_trance_surfaces.js   → 0 failures
npm test trance/browser_trance_theme.js      → 0 failures
npm test trance/browser_trance_feedback.js   → 0 failures (3 runs)
```

The failures are also not stable: the tab-close burst assertions report `2 > 2`, then `1 > 2`, then
`0 > 2` across runs of identical code. And removing `browser_trance_perf.js` from `browser.toml`
entirely reproduces the same six failures, so the file added in this phase is not the one leaking.

**Decision:** Record it as a defect of the suite and leave it. Phase 11's changes are verified
against it rather than blamed for it.

**Consequences:**
- `npm test trance` is currently a *smoke* test, not a gate. Until this is fixed, a red run has to
  be triaged file-by-file, which is the opposite of what a suite is for, and any future phase will
  pay that cost again.
- The likely mechanism is state carried between files in one browser session — prefs left set, DOM
  left in place, a `registerCleanupFunction` that does not restore what its test changed. Four
  files failing and the rest passing is a small enough surface to find it in.
- Worth doing before Phase 12 wires CI: a suite that cannot distinguish "my change broke this" from
  "this was already broken" will either block every PR or be ignored, and both outcomes cost more
  than the fix.

---

## ADR-037 — Occlusion does fire on a translucent macOS window

**Date:** 2026-08-26 · **Status:** accepted

**Context:** The Phase 11 plan's highest-priority open question (Tier B2) was whether macOS ever
reports a *translucent* Trance window as occluded. If it did not, `isFullyOccluded` would never
become true, `TranceScheduler`'s suspend path would be dead code, Gecko's own compositor throttling
would be dead with it, and that alone would have explained the community reports of Zen burning CPU
while idle.

**Decision:** Answered by measurement, and the answer is that it works. `scripts/trance-perf.py`
reads `window.isFullyOccluded` at three points in the workload and finds it `true` whenever another
application covers the window — including while `document.hasFocus()` is still `true`, which is the
case that mattered, and which is exactly the state a browser is in while the user works in a
terminal in front of it.

A second, independent confirmation arrived as a bug: the scroll probe originally ran a fixed count
of 120 `requestAnimationFrame` callbacks and hung, because the covered window had stopped painting
altogether. The probe is now time-bounded and counts the frames it actually got, which turns that
hang into the measurement.

**Consequences:**
- Tier B2 is closed without code. The suspend path is live, and `browser_trance_perf.js` asserts the
  wiring so a future change cannot quietly remove it.
- It does **not** explain the idle-CPU numbers, which means those numbers need a different
  explanation — see the Phase 11 first-measurement notes in TRANCE.md §13. Closing the likeliest
  cause is progress even though it is a negative result.
- Anything measuring frame rate on this machine must account for the harness's own terminal
  occluding the browser. That is a property of the measurement setup, not of the browser.

---

## ADR-038 — The workspace cross-fade animates opacity on the compositor, not a custom property

**Date:** 2026-08-27 · **Status:** accepted

**Context:** Phase 11 Tier B1. `ZenSpaceManager.mjs` faded between two window-sized gradient layers
by animating the CSS custom property `--zen-background-opacity`, which `zen-browser-ui.css` read
back as `opacity` on `.zen-browser-generic-background::after` and `::before`. Five costs compounded
on every frame of every space switch:

1. A custom property cannot be run on the compositor in Gecko, so each frame was a main-thread
   restyle of everything inheriting the variable.
2. `opacity: var(--x)` is not compositable either, so both window-sized layers repainted rather
   than composited.
3. Each layer paints up to four stacked gradients under `background-blend-mode: screen` — a
   per-pixel blend over the whole window, twice.
4. A 30 KB grain PNG sits on top of them.
5. Motion has no WAAPI path for custom properties, so it fell back to its JS driver and wrote the
   value from script once per frame on top of all of that.

This was the strongest mechanism-level match in the tree for the "~30 fps space switch on an M3"
reports, and the only slice of "replace the vendored Motion library" (Tier C3) worth taking.

**Decision:** Animate `opacity` on the two pseudo-elements directly, through
`gZenUIManager.motion.animateMini` with `pseudoElement`. Three details are load-bearing:

- **`animateMini`, not `animate`.** It is Motion's WAAPI-only entry point: the only one that accepts
  `pseudoElement`, and the only one with no JS driver to silently fall back to. That absence is the
  property being bought, not an incidental difference.
- **`motion.spring` as a function, not the string `"spring"`.** `animateMini` rejects the string
  form outright, and given the function it samples the spring into a `linear()` easing — same curve,
  and a curve the compositor can run.
- **The variable stays.** The swipe gesture and the theme picker both write
  `--zen-background-opacity` directly, so the switch hands the layers back to it when it ends: set
  the variable to the value the animation is already showing, then cancel. Motion cannot commit
  styles to a pseudo-element and therefore leaves finished pseudo-element animations filling their
  final value forever, so the cancel is not optional. Both steps happen in one turn, so there is a
  single style flush and no frame in between.

The visual is identical. `opacity` groups an element after its own background layers have blended,
so a composited alpha and a painted one produce the same pixels.

**Measured**, on this dev build, ten space switches per run, three runs a side, extensions off,
medians:

| | before | after | |
|---|---|---|---|
| Total main-thread style time across the switches | 182.3 ms | 124.3 ms | **−32%** |
| Worst single style flush during a switch | 9.67 ms | 4.11 ms | **−57%** |
| Cross-fade layers running on the compositor | 0 of 2 | **2 of 2** | |

**Two things the measurement cost, and one it could not buy:**

- The harness never ran this workload before. `PROBE_SWITCH_SPACES` asked `gZenWorkspaces` for
  `_workspaces()`, which does not exist, so `list` was always empty and every run reported "fewer
  than two spaces in a fresh profile" and skipped — including runs where there were plenty. It now
  calls `getWorkspaces()`, and creates the second space a fresh profile lacks. The single most
  relevant workload in Phase 11 had been silently not running.
- `nsIDOMWindowUtils.getOMTAStyle` is the obvious instrument for "is this on the compositor" and is
  the wrong one: under WebRender it returns `""` for an animation that is demonstrably compositing.
  That was established against a plain element as a control before any conclusion was drawn from it.
  `Animation.isRunningOnCompositor` is chrome-only, works, and is what the harness reads.
- That check cannot be made from a mochitest: an animation is not handed to the compositor until a
  frame carrying it has been painted, and a mochitest window never gets there. So
  `browser_trance_perf.js` asserts the *mechanism* — `animateMini` exists, `spring` is still usable
  as a generator, the keyframes are `opacity` and not a custom property, the spring became a
  `linear()` easing, and the variable still drives the layers at rest — and the harness asserts the
  outcome, as `space_switch_on_compositor`.

**Consequences:**
- One upstream touchpoint: `src/zen/spaces/ZenSpaceManager.mjs`. `zen-browser-ui.css` is *not*
  touched — the variable it reads is still the resting state, which is why keeping it was worth the
  extra cancel step.
- Three new scorecard rows: `style_flush_space_switch_ms` (budget < 2 ms, still red at 4.11),
  `style_total_space_switch_ms` (recorded), and `space_switch_on_compositor` (budget 2, green). The
  last is the first `gte` row on the scorecard — one where more is better — so `evaluate` and
  `diff_baseline` both had to learn that direction rather than assuming every number is a cost.
- The harness also notes, rather than scores, the cross-fade's resting state. A switch that leaves
  the wrong layer opaque or an animation filled forever is a visual bug that every timing row would
  happily call an improvement, because an animation that never ran is the fastest one there is.
- Tier C3 stays declined. This was the slice that carried the gain; the rest of the Motion sweep is
  still a dozen upstream files for the remainder.

## ADR-039 — Trance ships no icon packs, and the app-menu button wears the Trance mark

**Status:** accepted · Phase 5 revision

**Context:**

Phase 5 shipped three complete icon sets in-tree — `line` (drawn for Trance), `fluent` and `zen`
(vendored from Context Menu Icons, MIT) — behind `trance.chrome.icons.enabled` and
`trance.chrome.icons.pack`, plus `trance.chrome.icons.macos-emulated-menus` so that the packs could
reach the two context menus macOS draws itself.

ADR-024 had already taken the load-bearing decision out from under them: Trance preinstalls the
"New Icons" mod, so out of the box the glyphs are the ones that mod's author draws, and the packs
defaulted to off. What remained was ~530 rules, ~290 SVG files, two generator scripts and four
preferences, all of which existed to serve a switch nobody was expected to flip — and which, when
flipped, could only win by disabling Zen's own `zen-icons/icons.css` wholesale, because 137 of its
declarations carry `!important`. Every element the chosen pack had no glyph for then fell back to
Firefox's icon, so "one owner per element" was bought at the price of three drawing styles in one
menu.

Meanwhile the one icon setting that *is* a preference rather than a second implementation — how big
the icons are — did nothing at all. `trance.chrome.icons.size` wrote `--trance-menu-icon-size`,
which only the pack stylesheets read, and the packs were off. Moving the slider changed a variable
with no consumer.

**Decision:**

1. **The packs go.** `src/zen/trance/icons/{line,fluent,zen}/`, the three generated
   `trance-icons-*.css`, `scripts/trance-icons.py` and `scripts/trance-icons-line.py` are removed,
   along with `trance.chrome.icons.enabled`, `trance.chrome.icons.pack` and
   `trance.chrome.icons.macos-emulated-menus`. Nothing disables Zen's icon sheet any more, so there
   is no second owner to arbitrate.

   What stays under `src/zen/trance/icons/` is not a set: four glyphs the theme picker needs
   (`palette`, `heart`, `heart-filled`, `plus`) and the browser has none of. They are original work
   and they are packaged flat, so the `<pack>` path segment is gone with the packs.

2. **Size becomes a percentage of the browser's own.** `trance.chrome.icons.scale`, default 100, in
   steps of 25 between 50 and 200, clamped and snapped in `TranceChrome` so a value typed into
   about:config cannot produce a toolbar nobody can use. It is mirrored twice: into
   `--trance-icon-scale` as a multiplier, and into `--trance-menu-icon-size` as a length.

   The multiplier reaches the toolbar through `--zen-toolbar-button-size`, which is the variable
   Firefox's own toolbar-button rule multiplies into the icon box's width and height. That is
   geometry rather than the image, so it applies to whichever glyph is there — the browser's, or
   the New Icons mod's — without owning either. 100% resolves to exactly what Zen already declared,
   including its macOS 17px branch, so the default is a genuine no-op.

3. **The app-menu button wears the Trance mark**, on by default, behind
   `trance.chrome.logo-menu-button`. Zen declares `list-style-image: url("menu.svg") !important` on
   `#PanelUI-menu-button` and TRANCE.md §6.2 rule 1 forbids answering with an `!important`. It is
   not needed: `list-style-image` is inherited, the `<image class="toolbarbutton-icon">` inside the
   button is what paints it, and a normal declaration on that child beats a value it merely
   inherited — importance does not travel down the tree. The mark is
   `chrome://branding/content/about-logo.svg`, the same asset about:support and the about dialog
   use, so there is one logo file rather than a chrome copy of it.

**Consequences:**
- The Phase 5 acceptance criteria still hold, and two of them hold more cheaply: "no duplicate
  glyphs" is now true because Trance draws none of the duplicated ones, and "no data-URI icons"
  is true of the four files that are left.
- Uninstalling the New Icons mod no longer falls back to a Trance pack. It falls back to the
  browser's own icons, which is what the mod guard now says on its card.
- The `macos-emulated-menus` trade (ADR-020) disappears with the packs: there is nothing left that
  needed macOS's native context menus turned off in order to be visible.
- The settings page's Icons card is one row.

## ADR-040 — Edgeless squares only the corners that meet a window edge, and the page paints nothing

**Status:** accepted · Phase 3 revision

**Context:**

Three reports about edgeless mode, and all three turned out to be the same class of mistake — a
decision taken in one place and then contradicted in another.

1. *"The content window and the rest of the UI are different colours."* The edgeless rule painted
   the content `<browser>` with `--zen-main-browser-background`: the workspace gradient at full
   strength. What the chrome around it actually shows is that gradient at `--trance-surface-alpha`,
   over the window's own translucency, under the edgeless sheen. Three layers against one, so the
   pane read as a near miss of the colour beside it — a visible rectangle wherever the page did not
   paint over it.
2. *"The page does not reach the top when the toolbar is hidden."* Zen never collapses
   `#zen-appcontent-navbar-wrapper` to nothing. In single-toolbar layout it is a
   `--zen-element-separation` window-drag strip; compact mode's hidden toolbar shrinks to the same
   value. Either way a band of chrome sits above the page — which is a gutter, the one thing
   edgeless removes everywhere else.
3. *"Corners are rounded where they touch the screen."* Two owners. The edgeless rule zeroed all
   four corners of `.browserSidebarContainer`; the address bar's page-recede in `trance-chrome.css`
   then clipped `#zen-tabbox-wrapper` with `inset(0 round var(--zen-webview-border-radius))` — Zen's
   radius for a *floating card* — and put every corner back.

**Decision:**

1. **The content `<browser>` paints nothing** in edgeless mode: `background: transparent`. It is
   the only value that cannot be a near miss, because it puts the pane over the identical stack.
   `#zen-browser-background` is `inset: 0` on `#browser` and already spans the content area, and
   the edgeless layer on `#zen-main-app-wrapper` is behind both, so there is nothing to reproduce —
   only something to stop covering. This is not the `content` region, which stays opt-in and off: a
   page's *own* backdrop going translucent can put a gradient behind body text, whereas what shows
   here is what showed before — the pixels a page leaves unpainted — in the colour the rest of the
   window is.
2. **The collapsed strip goes to zero height**, in both of Zen's collapsed states, and only while
   they are collapsed: the hover, popup and compact-active states are excluded rather than
   overridden, so the toolbar still comes back exactly as it did.
3. **A corner is square when one of its edges runs along the window, and rounded when neither
   does.** Four `--trance-webview-edge-*` values describe the layout — bottom and far side are the
   window, the sidebar side never is, the top depends on whether anything is above the pane — and
   the four corners are `min()` of their two edges. The mirrored layout is handled once, by two
   variables that say which physical side the sidebar is on, rather than by a second copy of every
   rule that draws a corner.

   The same four values drive both consumers. `--trance-webview-radius-{tl,tr,br,bl}` are declared
   in `trance-tokens.css` at Zen's own radius (the right answer for a window that is not edgeless),
   narrowed by `trance-surfaces.css` when it is, and read by the `clip-path` in `trance-chrome.css`.

**Consequences:**
- In the shipped layout exactly one corner survives — the top one on the sidebar side — and it
  disappears by itself when the toolbar is hidden, because then that corner's top edge *is* the top
  of the window. The earlier "keep one corner" rule reached the same picture by asserting it; this
  one derives it.
- `--zen-webview-border-radius` is no longer read directly anywhere in Trance.
- The address-bar recede and the pane can no longer disagree about the shape of the page, which was
  the actual defect behind report 3.
- **Known limitation, compact mode.** `compact-mode/sidebar.inc.css` restores side gutters on
  `#zen-tabbox-wrapper` with `!important`, which edgeless cannot answer (§6.2 rule 1), so a compact
  window is edgeless top and bottom only. Zeroing the collapsed strip there also leaves Zen's
  `--margin-top-fix` — the negative margin that stops the page moving when the toolbar unhides —
  over-correcting by one `--zen-element-separation`, because that value assumes the strip is still
  there. Both are compact-mode-only and neither is worth an `!important` to fix.

---

## ADR-041 — Frosting is one switch and one surface; transparency is its own switch

**Date:** 2026-08-27
**Status:** Accepted
**Refs:** TRANCE.md §3.3, §6.2, §6.6, §12.3; ADR-011, ADR-019, ADR-025

**Context.** Phase 3 shipped the surface layer as a *region registry*: `trance.surface.preset`
(`nebula` / `compact` / `flat` / `custom`) plus one boolean per region
(`…region.sidebar`, `…region.toolbar`, `…region.overlay`, `…region.content`). Both turned out to
be controls that could not do what their options implied.

1. **The presets moved two tokens.** `compact` and `flat` differ from `nebula` by
   `--trance-radius-lg` and `--trance-surface-border`; `custom` had no block at all. Everything a
   person opens that dropdown for — blur radius, chrome opacity, saturation — is a slider, those
   sliders are pref-backed, and `TranceTokens` writes them as *inline* custom properties, which beat
   a preset block outright. So three of the four options were a name for two pixels and the fourth
   was a name for "no preset".
2. **The region switches asked for part of one decision.** ADR-025 had already collapsed the frost
   to a single layer on `#zen-main-app-wrapper` whenever edgeless was on — which is the default — so
   `sidebar` and `toolbar` only did anything in the non-edgeless case, and what they did there was
   produce two adjacent panes of glass with a seam between them. That seam is the exact look this
   project exists to remove.
3. **Transparency had no switch at all.** Whether the *window* is see-through is a platform
   decision behind a platform pref — `zen.widget.macos.window-vibrancy`, `widget.windows.mica`,
   `zen.widget.linux.transparency`, and `browser.tabs.allow_transparent_browser` for the content
   canvas — and none of the four was reachable from `about:preferences#trance`. "Make the browser
   transparent" meant editing about:config and knowing which line applied to you.

**Decision.**

1. **`trance.surface.preset` and the three chrome region prefs are removed.** The frost is one
   `backdrop-filter` on `#zen-main-app-wrapper` in every configuration, plus the expanded address
   bar, which floats over the *page* rather than over the chrome and therefore cannot be served by
   the layer beneath it. The blur budget is unchanged in kind and lower in practice: two surfaces
   where §3.3 allows three, and zero on a platform whose window is translucent in its own right.
2. **`trance.surface.region.content` stays**, because it is a different question — translucency for
   web pages, the only setting here that can put a workspace gradient behind body text, and the only
   one that is off by default.
3. **Edgeless now means "is the web view part of the surface, or cropped out of it".** On, the pane
   paints nothing and the layer runs edge to edge. Off, the pane keeps its own opaque backdrop and
   the frost stops at its border. That is one decision about the pane rather than four about the
   chrome behind it.
4. **`trance.surface.transparency` is added** as the master for point 3 above: it claims whichever
   platform pref this build's `matchMedia` says applies, and gives the user's value back when it is
   switched off — the same claim-and-restore contract as `zen.theme.acrylic-elements` (ADR-011).
   With it off, `--trance-surface-alpha` is not applied and the chrome is opaque.
5. **`trance.surface.image{,.opacity,.blur}` are added.** A texture layer over the sheen and under
   every piece of chrome, on the same single element, as a pseudo-element rather than a second
   background layer — `filter` applies to an element and not to one of its background layers, so a
   blur slider on a layer would blur the workspace gradient with it.

**Consequences:**
- §12.3 rule 1 is satisfied in the direction that needs no permission: this removes blurred
  surfaces rather than adding them.
- A profile carrying the old prefs keeps them in about:config as orphans; nothing reads them, and
  §6.6's "if a pref is not on this page it should not exist" now holds again because they are no
  longer emitted into `zen.js`.
- The settings pane loses a dropdown and three switches and gains two cards (Transparency,
  Background image), which is a net simplification of the Appearance section.
- `browser.tabs.allow_transparent_browser` is now *un*claimed properly: releasing it also strips
  `transparent="true"` from the browsers that were built while it was set. `tabbrowser` reads the
  pref at browser construction, so without that step every tab opened while Trance was on kept
  Zen's own `browser[transparent="true"]` white veil for the rest of its life — which is what
  "turning Trance off tints the content window permanently" was.

---

## ADR-042 — The `content` region is removed; the empty-tab mark replaces the idea it was reaching for

**Date:** 2026-08-27
**Status:** accepted
**Supersedes:** ADR-041 point 2, ADR-019 (in part)

**Context.**

ADR-041 kept `trance.surface.region.content` on the grounds that it was "a different question —
translucency for web pages". That was true and it was not sufficient, because in the browser Trance
actually ships the question has no reachable answer:

- A site that paints its own background covers the region entirely, which is nearly all of them, and
  Trance never restyles content.
- The sites that do not paint one are exactly the sites **Zen Internet** has already made
  transparent — and Trance preinstalls Zen Internet (ADR-032). So on every page where the region
  could have been seen, something else had already decided, and this was a second opinion about it.
- What was left is the pixels a page leaves unpainted, the rounded corners, and `about:` documents.
  The edgeless rule owns the first two (ADR-040: the pane paints *nothing*, so the chrome's own
  stack shows through) and the internal-pages switch owns the third (ADR-023, ADR-026) — and both
  own them at `transparent` rather than at a percentage.

So the switch's "on" state was indistinguishable from its "off" state on every page anyone opened,
and the slider under it moved `--trance-content-alpha`, whose only remaining consumer was a
*foreground* colour in the first-run panel that should never have been reading a page-backdrop token
in the first place.

Meanwhile the thing people actually wanted from "something behind the page" was a mark on an empty
tab, which the region could not have provided: it is a colour, not a picture, and it is behind the
canvas rather than in it.

**Decision.**

1. **`trance.surface.region.content` and `trance.surface.content.opacity` are removed**, with the
   `trance-surface-content` attribute, the rule that consumed it, and the
   `--trance-content-{alpha,base,bg}` tokens. There are no surface *regions* left at all.
2. **`browser.tabs.allow_transparent_browser` is claimed by the internal-pages switch alone.** It
   was already claimed by whichever of the two wanted it; now there is one.
3. **`trance.surface.newtab.logo{,.size,.opacity}` are added.** One chrome element, absolutely
   positioned over the content pane inside `#zen-tabbox-wrapper`, shown only while the selected tab
   is `about:newtab`, `about:blank` or `about:home`. Same file-picker control as the background
   image, and the same escaping — the picker method on the settings page is now one method over two
   prefs rather than two copies of one.
4. **`--trance-fg-on-accent` is added** for ink on a fill of the accent, which is what the first-run
   panel's primary button needed and what `--trance-content-bg` was standing in for. That is also
   the whole of "Done looks disabled": an 85%-alpha page backdrop used as a label colour.

**Why the mark is drawn by the chrome and not by the page.**

An `about:` document is content; no chrome stylesheet is in scope there. The one sheet Trance does
register against `about:` (trance-internal.css) is a USER sheet shared by every internal page in
every window, so a mark added there would appear on `about:config` and `about:addons` too and could
not follow a per-window pref without regenerating the sheet on every change. It is also painted
*over* the page rather than behind it, deliberately: behind, it would be visible only while
internal-page transparency happened to be on, and a feature that exists only when an unrelated
switch is set is a coincidence rather than a feature.

**Consequences:**
- §12.3 rule 1 is satisfied in the direction that needs no permission: one fewer translucent
  surface, and no new blur.
- A profile carrying the two removed prefs keeps them as orphans in about:config; nothing reads
  them, and the surfaces mochitest asserts that setting the old pref does nothing.
- The Appearance section loses the "Page background" card and gains "Empty tabs".

---

## ADR-043 — The mod guard warns on likelihood, not only on the 23 mods it has read

**Date:** 2026-08-27
**Status:** accepted
**Extends:** ADR-018

**Context.**

The guard annotated exactly the mods in `mods-inventory.json`. Everything else in a store of
hundreds got nothing — including mods that restyle the same six elements from the same six
selectors, which is the failure this project exists to remove. "We warn about the mods we have
investigated" is a smaller promise than "we warn about mods that can clash", and only the second one
is useful when the store is what it is.

**Decision.**

The curated table stays and is checked first: it names the exact feature, the exact pref and what
was actually decided about that mod, and a general note would be a worse answer to a question the
file already knows.

A card with no entry is classified from its own text — its title and description, the only thing
about an *uninstalled* mod that is readable from the settings page — against five surface areas
Trance owns (surfaces, tab strip, chrome, motion, theming). A hit gets a yellow "May clash with
Trance" banner naming the feature and its pref; a miss gets nothing.

`TRANCE_CLASH_EXCLUDE` is checked before all of it, and is the part that makes this bearable: a mod
about Picture-in-Picture, a clock, a calendar, the library or keyboard shortcuts owns a surface
Trance has no opinion about — several are preinstalled *by* Trance for exactly that reason (ADR-030,
ADR-039) — and a warning on one of those trains people to ignore the warnings on the rest.

**Why not read the mod's CSS.** Sine has not downloaded an uninstalled mod, so there is nothing to
read; and a guard that only worked after installation would be describing a conflict that had
already happened.

**Consequences:**
- Yellow is a third severity, and it means "likely" where red means "certain". Colouring the two the
  same would make the certain one mean less.
- False positives are possible and are the acceptable direction: the banner says what the mod is
  likely to be arguing with, links to the settings, and blocks nothing.

---

## ADR-044 — Four default settings Trance disagrees with Zen and Firefox about

**Date:** 2026-08-27
**Status:** accepted

**Context.**

Four browser defaults were wrong for the browser Trance is, and the four are not the same *kind* of
change, which is the whole content of this ADR:

- `zen.view.use-single-toolbar` (`true` upstream) puts the address bar inside the sidebar's 36px top
  strip, which already holds the window buttons, the compact-mode toggle and the space switcher.
  That strip is also the one `trance.chrome.topbuttons.reveal-on-hover` is about, and four owners for
  one row is the shape of problem this project exists to remove.
- `zen.urlbar.behavior` (`floating-on-type`) docks the bar until the first keystroke. Trance paints
  that panel — it is the one surface outside the single edgeless layer with a `backdrop-filter` of
  its own (ADR-041), and `trance.chrome.urlbar.focus-*` recedes the page behind it. Both arrive one
  character late in the upstream default, which reads as the effect stuttering.
- `browser.search.suggest.enabled` (`false`) is the address bar not doing the thing an address bar is
  for. Trance's privacy position is the whole of `prefs/privatefox/` plus three add-ons installed on
  first run, and it is about *tracking* — not about the search engine you deliberately chose seeing
  what you deliberately typed into it. `browser.search.suggest.enabled.private` stays off: a private
  window's contract is that it does not talk about itself.
- History mode: the privacy pane reads `privacy.history.custom` to decide whether it says "Remember
  history" or "Use custom settings", and the behaviour comes from `places.history.enabled` and
  `browser.privatebrowsing.autostart`. Setting one of the three produces a browser that remembers
  history and says it does not, or the reverse.

**Decision.**

The first three are changed **in the file that declares them**, marked with `# >>> TRANCE` /
`# <<< TRANCE`, and recorded as touchpoints #20 to #22. The fourth goes in a new Trance-owned file,
`prefs/trance/browser-defaults.yaml`, and costs no touchpoint.

The rule that decides which of the two a default gets, and it is not a matter of taste: **ffprefs
sorts every entry by pref name with a stable sort and emits duplicates adjacently, so a second
definition of a name that is already declared resolves in `fs::read_dir` order.** That is
filesystem-dependent, and therefore a different browser on a different machine — the same argument
`TranceFeedback` makes about `zen.view.enable-loading-indicator`. A pref nobody else declares has no
such ambiguity and belongs in Trance's own file; a pref somebody else declares has to be changed
where it is declared, whatever that costs in touchpoints.

**Consequences:**
- The touchpoint count goes from 19 to 22, further over the ~15 budget. A rebase conflict on any of
  the three is a one-line pref value to re-apply, which is the cheapest class of conflict in the
  table.
- All four are *defaults*, not locks. Every one of them has a control in `about:preferences`, and a
  user who changes it wins for the rest of the profile's life.
- `prefs/trance/browser-defaults.yaml` is now the place for any future non-`trance.*` default that
  nobody else declares, and its header says so.

## ADR-045 — The loading bar is a track and a fill, and the fill grows from the centre

**Date:** 2026-08-27
**Status:** accepted

**Context.**

The bar was one element whose `transform: scaleX()` *was* the progress, anchored at its left edge and
invisible until a load started. Three things followed from that, and all three read as a rendering
fault rather than as a design:

- there was nothing on screen for the fill to be a fraction *of*. A load began and a quarter of a bar
  appeared out of nowhere, unanchored to anything;
- it grew off to one side. The bar is a short object centred on the pane's edge, so a fill anchored
  to its left edge makes the whole object look off-centre until the instant it completes;
- at the shipped 3px thickness there was no room for both a boundary and a fill anyway. Once the pill
  radius has taken its share, 3px is a hairline pretending to be a control.

**Decision.**

Two elements. `#trance-loading-bar` is the track — full length, faint, present for the whole load,
painted in `--trance-loading-track` (a mix of the accent, so it is neither a foreign grey on a pale
theme nor invisible on a dark one). `#trance-loading-fill` is the only thing that moves, and its
`transform-origin` is `center`, so it opens outwards from the middle of the track in both directions.
The default thickness goes from 3px to 5px.

The gradient becomes symmetric — muted, vivid at 50%, muted — because a one-way ramp on a fill whose
two edges are both advancing puts the bright end at one edge and the dull end at the other.

The finish flourish moves from the fill to the **track**. The track is `overflow: clip` (so the
fill's square corners do not show through the track's arcs), so a fill scaled past 1 would overshoot
into a box that crops it and nothing would move. Scaling the track takes the fill with it, which is
the gesture, and it also stops the flourish sharing a property with the transition the stylesheet
drives from `--trance-loading-progress`.

**Consequences:**
- One more element per window while the loading bar is on, and no additional listener, timer or
  frame subscriber. The fill is still a composite per progress event, not a layout pass.
- `#writeProgress` keeps writing the custom property on the *bar*, so the horizontal and vertical
  rule pairs each read it through the cascade rather than needing their own copy.
- `trance.feedback.loading.thickness` changes default. A profile that has already set it keeps its
  value, which at 1–2px is now a track and a fill in two pixels; that is a legible thing to have
  chosen and is not overridden.

## ADR-046 — The page-opacity slider coalesces its sheet swap; edgeless claims the transparent canvas

**Date:** 2026-08-27
**Status:** accepted

**Context.**

Two bugs in `TranceSurfaces`, both of which come from a switch owning something it only *appeared* to
own.

The first: dragging "Page opacity" locked the browser up. `trance.surface.internal.opacity` shared an
observer with four other prefs, and that observer ran `#applyShape` — five pref reads, a platform
claim/release, a walk over every browser in the window, and then the expensive part: swapping the
generated one-line `nsIStyleSheetService` user sheet that carries `--trance-internal-alpha` into
`about:` documents. Registering a user sheet is a synchronous parse plus a style-data invalidation of
**every document in the application**. A `range` input notifies on every pixel of a drag.

The second: turning "Translucent internal pages" off silently broke Edgeless. Edgeless declares
`background: transparent` on the content browser, on the argument that the pane should show the
identical stack the chrome around it shows rather than a near miss. That argument only holds if there
is something to show through, and the thing that makes the canvas alpha-composited —
`browser.tabs.allow_transparent_browser` — was claimed by the internal-pages switch alone. With the
switch on (the default), edgeless was correct by coincidence.

**Decision.**

The slider gets its own observer, doing only the thing that value changes, coalesced through
`TranceScheduler.onIdle` with a 200ms timeout and the pending handle cancelled rather than stacked.
A two-second sweep is one sheet swap.

`#syncTransparentBrowser` claims the platform pref for the **union** of the two switches that need
it, `trance.surface.internal-pages || trance.surface.edgeless`, which is also the honest description
of what the pref is for.

The two default alphas are also brought into line: `trance.surface.opacity` and
`trance.surface.internal.opacity` both ship at 20. They stay separate sliders — a person may want the
page tinted differently from the chrome — but in an edgeless window the page is not a card on the
browser, it is part of the same continuous surface, and 55% inside 35% is a rectangle whose edges you
can see.

**Consequences:**
- The slider's effect now lands on the next idle moment rather than on the notification. On a busy
  main thread that is up to 200ms after the drag; the alternative is the browser not responding at
  all, which is what it did.
- Switching Edgeless off while internal pages are off releases the platform pref and strips
  `transparent="true"` from live browsers, exactly as before. Only the condition changed.
- `trance.surface.opacity` and `trance.surface.internal.opacity` change default. A profile that has
  set either keeps its value.

## ADR-047 — `icon` glow paints a sampled colour, not a blurred favicon

**Date:** 2026-08-27
**Status:** accepted

**Context.**

`trance.tabstrip.glow.mode = icon` drew the selected tab's favicon behind the tab, scaled to cover
the glow's box and put behind `filter: blur(var(--trance-tab-glow-spread))`. The pref's own comment
argued for it explicitly: sampling a favicon's dominant colour "means drawing it into a canvas and
walking the pixels on every tab switch, and the blur is both cheaper and a better answer".

Both halves of that turned out to be wrong.

It is not a better answer. A blur wide enough to hide a 16px picture does not reveal the icon's
colour; it reveals the average of the icon *and the transparent space around it*, which for most
favicons is a washed-out grey. What the mode promises — "the tab's own colour" — is the colour of the
mark, and averaging is the one operation guaranteed not to find it.

It is not cheaper either. "Once per tab switch" was the wrong unit. A `filter` on an element re-runs
whenever that element is repainted, and the element is a tab: it repaints on hover, on label change,
on every `busy` tick during a load. The sample runs once per *favicon*, and the answer is cached.

**Decision.**

`TranceTabStrip` samples the favicon once — decode, draw into a 16×16 canvas, count the pixels — and
writes the result to `--trance-tab-glow-color` on the selected tab. `icon` mode then draws exactly
the shape `theme` mode draws, in that colour. The blur is gone.

Three details that are the difference between this working and not:

- **Frequency weighted by chroma, not frequency.** A favicon is usually a coloured mark on a white or
  transparent field, so the most frequent colour is very often the field. The weight is a floor
  rather than a multiplier, so a genuinely monochrome icon still resolves to its own grey instead of
  to whatever stray anti-aliased pixel was the most colourful thing in it.
- **The result is lifted into a visible band** (`hsl`, saturation ≥ 45%, lightness clamped to
  45–70%). GitHub's favicon is near-black; painted literally it is a glow you cannot see. This is the
  same correction `--trance-accent-vivid` makes for the space accent, done in JavaScript because the
  token's own default *is* that accent and mixing it a second time in the rule would mute the one
  value that is already correct.
- **The cache is bounded** at 64 entries, keyed by favicon URL, insertion-ordered with one eviction
  per insertion past the limit. An unbounded map on a long-lived chrome window is a leak with a slow
  fuse.

The canvas is tainted by a cross-origin favicon and read anyway. That is legitimate here and only
here: `HTMLCanvasElement::CallerCanRead` grants the system principal the `all_urls` permission
(`nsContentUtils::PrincipalHasPermission`). Nothing sampled leaves the parent process or is
persisted — it is one colour in an in-memory map for the life of the window.

**Consequences:**
- `--trance-tab-glow-image` is replaced by `--trance-tab-glow-color`. A tab whose icon has not been
  read yet resolves the token, which is the accent, so there is never a frame with no colour.
- The sample is asynchronous, so `#syncGlowColor` checks three things when it returns: that the
  favicon it was asked about is still the one wanted, that the mode is still `icon`, and that the
  selected tab still carries that favicon. Without the first, a fast run through four tabs settles on
  whichever site decoded slowest.
- An icon that fails to decode, or a canvas read that is refused, resolves to no colour and the glow
  falls back to the accent. That is a correct answer rather than an absent one, so it is logged at
  debug level and not as an error.

## ADR-048 — One filled row: unselected tabs paint nothing and the selected one paints the scheme's opposite end

**Date:** 2026-08-27
**Status:** accepted

**Context.**

The tab fills were a four-step neutral ramp — 10 / 25 / 35 / 45 on light, 20 / 35 / 45 / 55 on dark —
plus a quieter step for pinned. The reasoning was sound in isolation: a neutral veil at four
strengths says one thing (how selected this row is) and says it identically on every theme.

In the window Trance actually is, it does not. A sidebar of eight tabs is eight stacked translucent
slabs drawn on a surface whose entire purpose is to be one continuous material, and the single piece
of information the fills carry — which tab am I on — was a 10% difference between two of them.

**Decision.**

An unselected tab paints nothing. The selected tab paints the scheme's opposite end at full strength:
white on a dark browser, black on a light one. It is the highest-contrast thing in the sidebar
because it is the only thing in the sidebar anyone needs to find without looking for it.

Two things travel with that and are not optional:

- `--trance-tab-fg-selected` inverts the selected row's ink. A label that kept the toolbar's colour
  would be white on white the moment the fill arrived. It is declared as `color` on the tab, so
  everything inside the row inherits it.
- The essentials grid takes the *inverse* — black on a dark browser, white on a light one — through
  `--zen-toolbar-element-bg`, the variable Zen's own essentials rules already read. It reads as a
  shelf precisely because the list below it no longer paints, and being the inverse of the selected
  tab means the two loudest objects in the sidebar can never be mistaken for one another.

Hover keeps a veil, at roughly the strength the old *default* fill used: "the pointer is over this
row" still has to be visible on a row that is otherwise painting nothing.

**Consequences:**
- `--trance-tab-pinned-bg` is now `transparent`. The token stays rather than the rule being deleted:
  "the pinned shelf is deliberately the same as the list" is a decision worth being able to see, and
  worth being able to change in one place.
- Every state Firefox and Zen draw that Trance has no rule for — multiselect, keyboard focus, the
  drag stack, the selected essential's own lighter veil — is untouched, because all of them resolve
  through variables rather than through the two declarations that changed.

## ADR-049 — Better New Tab button is preinstalled, not reimplemented

**Date:** 2026-08-27
**Status:** Accepted
**Supersedes:** the NATIVE verdict in `docs/trance/mods/better-new-tab-button.md`

**Context:**

Phase 5 kept one of the mod's three behaviours. B1 — the unlabelled centred plus — became
`trance.chrome.newtab.compact`; B2 became a `:active` transform under `trance.motion.level`; B3, the
per-component radius sliders, was dropped because Trance has one radius scale and one owner per
value (TRANCE.md §6.2).

That reasoning is sound about radius and wrong about this mod. The two owners argument (TRANCE.md
§3.1) is what justifies a reimplementation, and here Trance *created* the second owner: anyone who
wanted this mod installed it anyway, and then Trance's rules and the mod's rules both declared on
`#tabs-newtab-button`. What Trance shipped in its place was a third of the mod with the part most
people install it for — the radii — deliberately missing.

The mod is also in neither marketplace. It is a repository, which Sine installs by being handed
`author/repo`; the provisioner had no path for that, which is the only reason this was not already
possible.

**Decision:**

Trance preinstalls `themaster5209/zen-better-new-tab-button` through the provisioner and ships no
new-tab-button rules of its own. `trance.chrome.newtab.compact` is removed, along with its settings
row, its root attribute and the whole `[trance-chrome-newtab]` block in `trance-chrome.css`.

`scripts/trance-cosine.py` grows a third store kind, `github`: no marketplace entry to read, so the
mod's own `theme.json` is the entry — which is exactly what Sine does — and `homepage` is set to the
repository so Sine's updater keeps going back to the author.

`zen.view.show-newtab-button-top` also goes to `false` (touchpoint 20). The mod styles the button
where Zen puts it by default, and Zen's "move it to the top" option puts it somewhere else.

**Consequences:**
- The button has one owner again, and it is the mod's author, radius sliders included.
- The mod guard's card for it becomes "shipped" rather than "native": uninstalling it is supported
  and leaves the browser's own labelled button behind, with nothing of Trance's to argue with.
- Trance now reimplements seventeen mods and preinstalls six.

---

## ADR-050 — Brand artwork is generated from two source PNGs, and the mark is traced to a path

**Date:** 2026-08-27
**Status:** Accepted
**Closes:** ADR-008's outstanding half

**Context:**

ADR-008 kept Zen's raster icon set as a deliberate placeholder, and Phase 1 recorded "original icon
artwork" as its one open deliverable — the item blocking Phase 12, because TRANCE.md §7.4 is
unambiguous that Zen's name, logo and wordmark are not licensed for a fork to ship.

The artwork now exists: a quatrefoil knot, delivered as a black-on-transparent and a
white-on-transparent PNG at 2160², plus a macOS 26 Icon Composer bundle. What it is *not* is thirty
files. `configs/branding/trance/` needs eleven raster sizes, an `.icns`, five `.ico`s, two Windows
tiles, two private-browsing variants, a 32-bit BMP for the NSIS installer, four `about:` rasters and
two `about:` vectors.

Hand-exporting that set once is a morning. Hand-maintaining it is how brand assets drift: the 32px
icon keeps the old mark for a year because nobody re-exported it.

Two further constraints shaped the answer. First, the mark is monochrome, and Firefox's convention —
a bare mark on transparency, which works for a fox drawn in six colours — makes a single flat colour
disappear into whichever desktop theme matches it. Second, `trance-chrome.css` masks the branding
artwork to draw the mark on the app-menu button, and `mask-image` reads *alpha*: any artwork with a
plate behind it is a mask that is opaque everywhere, so the toolbar button would paint a solid
rounded square.

**Decision:**

`scripts/trance-branding.py` generates the entire shipped set from `docs/trance/brand/mark-{black,
white}.png`. Every application icon is the white mark on a superellipse plate in `#0D0F14` — the
`backgroundColor` already declared for the brand in `surfer.json`, so the icon and the installer
agree without a second constant. Private-browsing variants use the same plate in violet.

The mark is also traced to a real SVG path — alpha threshold, crack-following contour walk,
Ramer-Douglas-Peucker simplification, quadratic smoothing through the survivors — and shipped
twice: with the plate as `content/about-logo.svg`, and bare, in `currentColor`, as
`src/zen/trance/icons/trance-mark.svg`. The chrome mask moves to the bare copy and
`--trance-logo-mask-scale` drops from 150% to 100%, because the compensation it existed for was for
margin in Zen's artwork that Trance's does not have.

Source art lives in `docs/trance/brand/`, not in `configs/branding/trance/`. Surfer's branding patch
copies every non-`content` entry of the branding directory with `copyFileSync`, which throws on a
subdirectory — so a `source/` folder there would break `npm run import` rather than be ignored.

**Consequences:**
- Phase 1 closes. Nothing Zen drew ships any more, and §7.4 is satisfied for iconography.
- Changing the mark is one file and one command; the thirty derived files are never edited.
- The document icons (`document.ico`, `document_pdf.ico`) are a white page with the mark on it
  rather than the application icon, so a Trance-associated file does not look like Trance itself.
- ImageMagick and `iconutil` become developer-machine tools. They are not build dependencies: the
  outputs are committed, and surfer regenerates `firefox.icns` from `logo-mac.png` itself on macOS.
- The `.icon` bundle is kept as a design source and installed nowhere. No part of the Firefox build
  consumes a macOS 26 Icon Composer bundle; when one does, the source is already here.

---

## ADR-051 — Trance's onboarding replaces Zen's welcome, and owns four decisions Zen's cannot ask about

**Date:** 2026-08-27
**Status:** Accepted

**Context:**

Zen's welcome flow asks five questions: import, default browser, search engine, essentials, and
workspace colour. All five are about data and appearance, and all five are worth asking.

None of them is about how the browser is built, and Trance has four of those to ask. Three exist
only because of decisions this project already took:

- ADR-006 reduced Trance to one brand, which resolved every `@IS_TWILIGHT@`-gated pref to its stable
  value with no way back. Upstream Zen ships two builds; Trance ships one, so this has to become a
  setting or it stops being a choice at all.
- ADR-018 ships the Sine mod manager on its pre-release channel, Cosine. Wanting stable Sine
  currently means re-running a Python script.
- TRANCE.md §3.3 is the reason Trance frosts one layer and not four, and blur is still the one
  effect whose cost is genuinely different on an Intel Mac and an Apple Silicon one.

The fourth, edgeless (ADR-025, ADR-040), is the largest change Trance makes to the shape of a window
and the one most worth seeing before it happens.

The fifth question is not about the build. Zen Internet ships with Trance and does nothing at all
until its panel has been opened once — a bundled extension that silently does nothing is worse than
one that is not bundled.

The two flows cannot both run. `ZenWelcome` hides every child of `#browser` on entry and restores
them in `finish()`, so whichever runs second inherits a window the first has already torn down and
rebuilt.

**Decision:**

`TranceOnboarding` is a `TranceFeature` that replaces Zen's welcome. Ten pages: the five above,
then Zen's five rebuilt against Zen's own `browser/zen-welcome.ftl`, so those stay translated in
every locale Zen ships.

The upstream cost is one `if` in `ZenStartup.#checkForWelcomePage` (touchpoint 23) around the
existing `loadSubScript` call. With `trance.onboarding.enabled` false, or Trance itself disabled,
upstream behaviour is exactly what it was — the browser is never left with no first run.

Three of the five answers are ordinary prefs, and `TranceOnboarding` keeps a pref observer on each
for the whole session rather than only while the flow is on screen. The settings page can write
`trance.onboarding.channel` and cannot act on it; duplicating the list of twilight-gated prefs into
`trance-settings.js` would be two owners for one decision, which is the failure this project exists
to remove (TRANCE.md §3.1).

Choosing "stable" *clears* the twilight prefs rather than writing the opposite value, so a later
change to Zen's own default is inherited rather than frozen. `services.sync.engine.spaces` is the
exception: `prefs/zen/sync.yaml` locks it on the stable side, and a locked pref cannot be set from
the user branch — so that one is unlocked to write and re-locked to clear.

The mod-manager page rewrites the version in the engine's own `engine.json`. That is Sine's
mechanism, not a workaround for it: the engine compares that version against its releases, and a
Cosine release is one whose tag ends in `c`. Nothing is downloaded and nothing restarts.

`TranceFirstRun` learns to wait on whichever flow is actually running. Both publish the same pair of
signals — a claimed-on-entry pref and an attribute on the document element — so the wait is the same
wait; only which pair to read changes, decided by the same condition `ZenStartup` uses.

**Consequences:**
- `scripts/trance-env.sh` gains `TRANCE_ARCH`, because `configs/macos/mozconfig` has always branched
  on `SURFER_COMPAT` and nothing has ever set it: every build was arm64 whatever the machine was. A
  question the browser asks and the build cannot honour is a question worth not asking.
- The five Trance pages are English in the module. Trance has no locale pipeline of its own, and
  inventing one for ten strings would be a Phase 12 decision taken here by accident. Reusing Zen's
  strings for the half that maps one-to-one costs nothing; the other half is a recorded gap.
- Turning onboarding off freezes the three prefs it owns, because the observers go with the feature.
  That is the `disabled means zero` contract (TRANCE.md §6.5) applied honestly rather than an
  exception carved out of it.
- The flow is the only Trance feature that can be running while the user has no browser UI to escape
  to. Every allocation goes through the base class, so flipping the pref off mid-flow gives the
  window back rather than stranding it — and that is what the mochitest asserts first.

---

## ADR-052 — `distribution/policies.json` ships unconditionally, because upstream ships it only to Mozilla

**Date:** 2026-08-28
**Status:** Accepted

**Context:**

ADR-032 made `src/zen/trance/distribution/policies.json` the one owner of Trance's update policy and
its seven preinstalled extensions, installed by `src/zen/trance/moz.build` into `dist/bin/distribution/`
so that the packager maps it to `@RESPATH@/distribution/*` — `Contents/Resources/distribution/` on
macOS, the install directory elsewhere.

It worked in every dev build and in none of the packaged ones, and the 0.1.0 release shipped without
it. Nobody noticed for the same reason ADR-032 noticed nothing: `npm start` runs out of
`obj-*/dist/Trance.app`, where `distribution/policies.json` is a symlink into the source tree that
the build put there. The packaged app is built from a *manifest*, and the manifest line is:

```
#if defined(BUILT_BY_MOZILLA)
@RESPATH@/distribution/*
#endif
```

`BUILT_BY_MOZILLA` is set by `--built-by-mozilla` and by nothing else. No fork sets it, so no fork's
package has ever contained a `distribution/` directory. The extensions did not fail to install in
the release build — the policy that installs them was never in the release build.

**Decision:** delete the guard. Touchpoint 24, one hunk in
`src/browser/installer/package-manifest-in.patch`, a file Zen already patches.

The alternative was to set `--built-by-mozilla` in `configs/common/mozconfig`, which is already
touchpoint 2 and would therefore have cost nothing new. It was rejected on what the flag *means*
rather than on what it does here: `AppConstants.BUILT_BY_MOZILLA` is read by Normandy's client
environment and by UITour, and `browser/app/distribution/moz.build` installs Mozilla's own
distribution files behind it. A browser that is not built by Mozilla asserting that it was, in order
to get one manifest line, is three lies to fix one bug.

**Consequences:**
- Verified the way it should have been the first time: `Trance.app/Contents/Resources/distribution/policies.json`
  is present in the repackaged `.dmg`, not merely in `dist/bin`.
- The dev build and the packaged build now disagree about nothing here, which is the property that
  was missing. A check that only ever ran against `npm start` could not have caught this, and
  Phase 12's CI matrix is where a packaged-artefact assertion belongs.
- Upstream's guard is deleted rather than duplicated with an inverted condition. A second
  `@RESPATH@/distribution/*` under `#if !defined(BUILT_BY_MOZILLA)` would list the same glob twice in
  any build that ever did set the flag, and "the line is there once, unconditionally" is the whole
  intent.

---

## ADR-053 — A Zen import is staged for the next startup rather than applied to the running one

**Date:** 2026-08-28
**Status:** Accepted

**Context:**

Onboarding's import page opened Firefox's migration wizard and nothing else. The wizard imports
bookmarks, history, passwords and cookies, and it recognises a Zen profile as a Firefox profile — so
it imports everything about that profile *except* the spaces, folders, essentials and pinned tabs
that are the reason it looks like anything. For somebody already running Zen, that is the whole
switching cost, and importing everything but it is close to importing nothing.

Two things had to be worked out before it could be built.

**Where the data is.** It is no longer in `places.sqlite`. `zen_workspaces` and `zen_pins` still
exist in older profiles, but `ZenSessionManager` migrates both into `zen-sessions.jsonlz4` on the
first run after the update and writes only there afterwards. A reader that preferred the tables
would import whatever the profile looked like on the day it upgraded. So the import reads the
session file and only the session file; a profile too old to have one reports nothing to import
rather than importing a year-old sidebar.

**Which build wrote which profile.** Zen keeps every channel's profiles in one vendor directory and
`profiles.ini` does not record the channel. `compatibility.ini` does: `LastPlatformDir` is the app
bundle that last ran the profile, so `/Applications/Twilight.app/…` and `/Applications/Zen.app/…`
separate cleanly. `LastVersion` gives the same answer a second way — `1.22t_…` against `1.18.10b_…` —
and is the fallback where the platform directory says nothing, which is Linux, where both channels
install under `/opt`. A profile with neither is still listed, as "Zen (unknown build)": a profile
with spaces in it is worth offering whatever wrote it.

**Decision:** detect and stage in Trance-owned code; adopt in one `if` upstream.

`TranceZenImport` walks the vendor directory next to Trance's own, lists every profile with at least
one space, and writes the chosen one's `spaces`, `folders`, `groups` and `splitViewData` — plus its
pinned and essential tabs — to `<profile>/trance-zen-import.jsonlz4`. Unpinned tabs are dropped
unless asked for: an open tab is something you were doing, a pinned tab is something you keep.

It stages rather than applies because there is nothing to apply *to*. `ZenSessionManager.readFile`
runs from `SessionFileInternal.read`, before any window exists; by the time the import page is on
screen the sidebar object is built, its setter is private, and everything that consumes it has run.
Touchpoint 25 is the adoption: one `if` in `readFile`, after the file has been read and before
anything looks at it, which replaces `_dataFromFile` and deletes the staging file.

Onboarding restarts the browser at the end of the flow when something is staged, so "the next
startup" is a few seconds away rather than a thing the user has to be told to do.

**Consequences:**
- `trance.import.staged` is a **boolean** and the filename is a constant in both halves. The
  touchpoint runs before any window, with full privileges; a pref holding a path would be a pref
  that names any file on the disk for a privileged early-startup read.
- The pref is cleared and the file deleted whether or not the read succeeded. An import that cannot
  be parsed must not be retried on every startup for the life of the profile.
- The restart is skipped under `Cu.isInAutomation`. `eRestart` takes the whole application down, and
  a mochitest that reached the end of the flow would take the harness with it.
- Workspace-scoped bookmarks (`zen_bookmarks_workspaces`) are **not** imported. They are GUIDs into
  `moz_bookmarks`, and the bookmarks themselves arrive — if they arrive — through the migration
  wizard under new GUIDs. Importing the mapping without the thing it maps would produce spaces that
  claim bookmarks that do not exist.
- Detection is `detectIn(root)` rather than a private method, so the suite can point it at a fixture
  directory. A test that reads the real `~/Library/Application Support/zen` tests the machine.
