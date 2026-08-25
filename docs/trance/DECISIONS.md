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
