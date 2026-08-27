# Trance Browser — Master Plan

> **This file is the single source of truth for the Trance project.**
> Any agent or contributor starting a fresh session should read this file first, in full,
> before touching anything. It is intentionally long. Do not summarise it away.
>
> Companion files:
> - `CLAUDE.md` — short, auto-loaded rules for agent sessions (points here)
> - `docs/trance/mods-inventory.json` — machine-readable source-of-truth for the 23 mods
> - `docs/trance/DECISIONS.md` — append-only decision log (ADRs)
> - `docs/trance/UPSTREAM-TOUCHPOINTS.md` — every upstream file Trance modifies

---

## Table of contents

1. [What Trance is](#1-what-trance-is)
2. [Current repository state](#2-current-repository-state)
3. [Root-cause analysis: why the mod stack hurts](#3-root-cause-analysis-why-the-mod-stack-hurts)
4. [Core architectural decision](#4-core-architectural-decision)
5. [Zen internals map](#5-zen-internals-map)
6. [The Trance foundation layer](#6-the-trance-foundation-layer)
7. [Licensing and legal constraints](#7-licensing-and-legal-constraints)
8. [Feature inventory — all 23 mods](#8-feature-inventory--all-23-mods)
9. [Bundled Mozilla extensions](#9-bundled-mozilla-extensions)
10. [Build and development runbook](#10-build-and-development-runbook)
11. [Upstream sync strategy](#11-upstream-sync-strategy)
12. [Performance and power budget](#12-performance-and-power-budget)
13. [Roadmap — phases, deliverables, acceptance](#13-roadmap--phases-deliverables-acceptance)
14. [Repository conventions](#14-repository-conventions)
15. [Agent playbook — how to run a session](#15-agent-playbook--how-to-run-a-session)
16. [Open questions](#16-open-questions)

---

## 1. What Trance is

**Trance is an opinionated fork of Zen Browser** that ships, out of the box, the unified
equivalent of a heavily-modded Zen setup — without the mod loader, without the conflicts,
and without the power drain.

### Name

*Trance* = **Tran**sparency + the calm of *Zen*. Familiar silhouette, distinct identity.
It is deliberately not a "theme pack". It is a browser.

### Mission statement

> One coherent browser that does what 23 mods + 7 extensions + custom CSS currently do,
> designed as a single system rather than a pile of overlapping patches.

### Goals

- **Unity.** One design-token layer, one animation system, one observer, one settings surface.
- **Out-of-the-box.** Fresh profile → the full experience. No Sine, no `userChrome.css`, no marketplace.
- **Efficiency.** Idle power draw comparable to stock Zen, not 3× it.
- **Longevity.** Tracks upstream Zen `dev` continuously. Small, well-marked upstream diff surface.
- **Configurability without chaos.** Every feature is pref-gated under `trance.*` and surfaced in
  `about:preferences#trance`. Disabling a feature must cost zero runtime work, not just hide it.

### Non-goals

- Not a mod manager. Trance does **not** replace Sine/Cosine, and never sources its own
  features from a mod. It *does* ship Cosine preinstalled, with no mods installed, so that
  everything Trance does not reimplement stays reachable; the mods Trance does own carry a
  conflict banner in Cosine's own UI (ADR-018).
  (Zen's own native mods system stays; see §4.4.)
- Not a Zen replacement upstream. Trance never intends to be merged into Zen.
- Not a "maximum features" browser. Every feature must earn its frame budget.
- Not cross-branding. We do not ship Zen's trademarks; see §7.4.

### Success criteria (v1.0)

| Criterion | Target |
|---|---|
| Fresh-profile parity with the user's current modded setup | ≥ 90% of daily-driver features |
| Visual artifacts on tab switch / space switch / window resize | Zero |
| Idle CPU, 1 tab, window focused, no media | < 0.5% (parity with stock Zen ±0.2%) |
| Idle GPU work, window fully occluded | Zero compositor frames |
| Chrome compositor layers | ≤ 6 |
| Cold start regression vs stock Zen | < 100 ms |
| Upstream rebase onto `zen dev` | ≤ 30 min manual work per week |

---

## 2. Current repository state

### 2.1 Fork lineage

| Field | Value |
|---|---|
| Working directory | `/Users/ryan/Downloads/Code/Trance-dev` |
| Git initialised | Yes — `main` branch |
| Fork point | `ed0a6fd4474b855bd9c4f39e724c78a0f7e7ed24` (`upstream/dev` HEAD, 2026-08-23) |
| Fork point subject | `gh-15039: Use Title Case for split view labels (gh-15059)` |
| Upstream remote | `upstream` → `https://github.com/zen-browser/desktop.git` |
| Tree state at fork | Byte-identical to `upstream/dev` (verified: 0 differing paths) |
| Zen release version | `1.21.15b` (latest release as of 2026-08-19) |
| Zen twilight version | `1.22t` |
| Firefox base | `154.0` |
| History | Full — 6,951 commits, `.git` ≈ 5.6 GB |
| `origin` remote | `https://github.com/xslvrrr/Trance.git` — **public**, default branch `main` |

> ⚠️ The local clone had no `.git`. It was a plain source drop. Git history was reconstructed by
> fetching `upstream/dev` and pointing `main` at the matching commit — verified byte-identical.
>
> ⚠️ `origin` is a **GitHub fork** of `zen-browser/desktop` (see ADR-005). Two consequences:
> the PR UI defaults its base branch to Zen's repo — always check it; and the repo is public
> while it still carries Zen branding, so **Phase 1 is on the critical path** before any release
> or promotion (§7.4).
>
> Pushing to a *non-fork* repo is painful: GitHub HTTPS returns HTTP 500 on packs above roughly
> a thousand commits, so a fresh remote needs ~30 chunked pushes. The fork shares GitHub's object
> store, so pushes are instant.

### 2.2 Toolchain — what this machine has vs what Zen pins

| Tool | Pinned by repo | Installed here | Action |
|---|---|---|---|
| Node | `22` (`.nvmrc`) | `v24.11.1` | Use `nvm use` in repo root before npm scripts |
| Python | `3.11` (`.python-version`) | `3.14.7` | **Must** install 3.11; mach + surfer scripts assume it |
| Rust | `1.94.1` (`.rust-toolchain`) | `1.94.0` | `rustup toolchain install 1.94.1` |
| Xcode CLT | — | `/Library/Developer/CommandLineTools` | OK for dev builds |
| macOS SDK | `26.5`/`26.4` for `ZEN_RELEASE` | `26.1` only | Dev builds fine; release builds need a newer SDK |
| Platform | — | macOS 27.0, arm64 | — |
| Free disk | ~40–60 GB needed | 130 GB | OK, but tight if multiple objdirs |

### 2.3 What is NOT done yet

*(updated 2026-08-24, after Phases 2 and 3 and the Phase 1 identity fixes)*

- Phase 1 is complete, artwork included. The identity landed 2026-08-24 (the profile directory and
  vendor were fixed the same day, after Phase 3 smoke-testing found the build still using Zen's —
  ADR-014); the artwork landed 2026-08-27 (ADR-050), which closed ADR-008's placeholder.
- No CI (Zen's workflows still reference `--brand release`/`twilight` and will fail — Phase 12),
  no signing, no update server (updates are off, ADR-009)
- `npm run lc` fails on **115 upstream** files with no MPL header at the fork point, including
  `src/zen/tests/mochitests/tooltiptext/xul_tooltiptext.xhtml` and all of `src/zen/@types/`.
  Pre-existing, not Trance's — every file under `src/zen/trance/` passes, including the 284
  vendored icons. Fix or exclude the upstream ones before relying on `lc` as a CI gate.
  Note also that surfer's `# Ignore license in this file` escape hatch is unusable: its regex
  carries the `g` flag and is reused across files, so it matches on roughly every other one
  (`docs/trance/THIRD-PARTY.md`).

---

## 3. Root-cause analysis: why the mod stack hurts

The stated symptoms are *visual artifacts* and *power drain* without crashes. That is a very
specific signature. These are the mechanisms, and each one directly informs a design rule in §6.

### 3.1 Cascade nondeterminism → visual artifacts

Every mod ships its own stylesheet that re-declares `--zen-*` custom properties on `:root`
and leans on `!important` to win. Load order is a function of:

- Sine bootloader script order (async, not guaranteed)
- Zen's own `zen-themes.css` regeneration (`ZenMods.mjs` rebuilds the whole file)
- `userChrome.css` (loaded last by `nsLayoutStylesheetCache`)

When two mods both style e.g. `#tabbrowser-tabs .tabbrowser-tab[selected]`, the winner changes
between sessions and, worse, between *state transitions* — because some mods swap attributes and
others swap classes. Result: half-applied states, ghost borders, elements that keep an old
background after a space switch.

**Design rule:** one token layer, one owner per selector, `!important` banned inside Trance.

### 3.2 Observer storms → main-thread cost

Nebula, SuperPins, Advanced Tab Groups, Unloaded Tabs, Zen Library, Render.js, and Live Calendar
each install their own `MutationObserver`, typically on `#tabbrowser-tabs`, `#navigator-toolbox`,
or `document.documentElement` with `{ subtree: true, attributes: true }`.

Every DOM mutation in the chrome fans out to N observer callbacks. Tab churn (opening 10 tabs,
switching spaces, a page load flipping `busy`/`progress` attributes) triggers hundreds of
callbacks per second, each doing its own `querySelectorAll` + style write → forced reflow.

**Design rule:** exactly one `MutationObserver`, one `ResizeObserver`, one `IntersectionObserver`
per window, owned by `TranceObserverHub`. Features subscribe with a selector filter.

### 3.3 Stacked `backdrop-filter` → continuous GPU work

This is the single biggest power drain. Transparent Zen, Zen Compact Transparent Mode, Nebula, and
Nova UI each apply `backdrop-filter: blur(...)` to overlapping regions.

Each `backdrop-filter` surface:
- forces its own compositor layer
- forces the layer *behind* it to be readback-able (defeats occlusion culling)
- costs a full separable Gaussian pass per frame, per layer

On macOS this also defeats the window server's ability to skip drawing an occluded window: the
blur source must be resolved even when nothing changed. Four stacked blurs over the sidebar means
four full-region blur passes at display refresh rate (120 Hz on ProMotion) for a static UI.

**Design rule — the blur budget:** at most **one** `backdrop-filter` surface per window region
(sidebar, toolbar, content overlay). Blur radius comes from a token. Blur is disabled entirely
when the window is occluded or unfocused, and when `trance.motion.level = 0`.

### 3.4 Infinite CSS animations on hidden elements → refresh driver never idles

`animation: ... infinite` in Nebula's gradients, Deta Loading Bar's shimmer, and Tab Closing Bubble
keep Gecko's refresh driver ticking even when the animating element is `display:none`-adjacent,
offscreen, or in an unfocused window. Firefox throttles animations in *content*, not in *chrome*.

A single infinite chrome animation is enough to hold the browser at 120 fps forever.

**Design rule:** no `infinite` animations in Trance CSS. Looping visuals are driven by
`TranceScheduler`, which stops on blur/occlusion and respects `prefers-reduced-motion`.

### 3.5 Layer explosion from defensive `will-change`

Multiple mods apply `will-change: transform` / `translateZ(0)` to the same elements as a
cargo-culted perf fix. Each promotes a layer; each layer costs VRAM and a composite step.

**Design rule:** `will-change` only on elements that are *actively* animating, added and removed
by the scheduler, never statically in CSS.

### 3.6 Timers instead of events

Live Calendar (`setInterval` for the clock), Deta Loading Bar (progress polling), Render.js
(frame loop) each hold their own timer. Timer wakeups prevent the CPU from entering deep idle
states — this is disproportionately expensive on Apple Silicon.

**Design rule:** one coalesced scheduler tick. Clock-type features align to the next wall-clock
boundary, not to a polling interval.

### 3.7 Load-order races with Zen's own startup

`ZenPreloadedScripts.js` imports Zen's feature modules in a defined order before
`DOMContentLoaded`. Sine's bootloader injects at a different, autoconfig-driven point. Mods that
patch Zen internals (SuperPins patches `ZenPinnedTabManager`, Advanced Tab Groups patches
`ZenFolders`) may or may not see the finished object.

**Design rule:** Trance features register through Zen's own `nsZenPreloadedFeature` /
`nsZenDOMOperatedFeature` lifecycle and are listed in `ZenPreloadedScripts.js`. No monkey-patching
after the fact — modify the upstream module directly and record it in `UPSTREAM-TOUCHPOINTS.md`.

### 3.8 Duplicated icon sets and fonts

New Icons, Context Menu Icons, Zen Context Menu, and Nova UI each ship their own SVG set, often
as data-URIs inlined into CSS. Same glyph, four copies, four parses.

**Design rule:** Trance ships no icon set. Phase 5 built three, ADR-039 removed them: the browser
already draws these glyphs, the preinstalled "New Icons" mod redraws them for anyone who wants that
(ADR-024), and a Trance pack could only win by disabling Zen's own icon sheet wholesale. The
duplication this rule was written against is now answered by not participating in it.

What remains under `chrome://browser/content/trance-icons/*.svg` is not a set: the handful of
glyphs Trance's own UI needs and the browser has none of, as real files in the chrome jar, one copy
each, never inlined as data URIs. (Phase 2 wrote `chrome://browser/skin/` here; Phase 5 landed it
under `content/` instead, because `skin/` is packaged from `browser/themes/jar.mn` and would have
cost an upstream touchpoint for nothing.) Icon *size* is a preference —
`trance.chrome.icons.scale`, a percentage of the browser's own — and it reaches whichever glyph is
on screen through Zen's `--zen-toolbar-button-size` rather than by supplying one.

---

## 4. Core architectural decision

### 4.1 The decision

**Trance reimplements mod *features* natively in Trance-owned source files.
It does not vendor, bundle, or load third-party mod CSS/JS.**

### 4.2 Why

| Alternative | Why rejected |
|---|---|
| Ship Sine + a curated mod list preinstalled | Preserves every root cause in §3. Also inherits 23 upstream maintenance surfaces. |
| Vendor each mod's CSS into the chrome jar | Cascade conflicts remain; licensing is unresolvable (§7); mods break on Zen updates. |
| Fork each mod and maintain 23 forks | The user explicitly asked for "one large project instead of countless small ones". |
| **Reimplement natively (chosen)** | Fixes conflicts by construction, fixes power drain, licensing is clean, one upstream sync surface. |

### 4.3 What "reimplement" means in practice

For each mod:
1. Read its source. Identify the *user-visible behaviour* — not the implementation.
2. Write that behaviour into `src/zen/trance/<feature>/` using Zen's own APIs and Trance's
   foundation layer.
3. Credit the original author and mod in `docs/trance/CREDITS.md` and in the feature's file header.
4. Never copy code from an unlicensed or GPL-3.0 mod (§7).

Where a mod is essentially "a pile of CSS", reimplementation means writing new CSS against the
Trance token layer that achieves the same look. Visual result may be *inspired by*; the source
must be ours.

> **Nebula and Zen Library are non-negotiable in full** (user requirement). Both are large.
> Nebula is GPL-3.0 → clean-room reimplementation is mandatory, not optional (§7.2).
> Zen Library is unlicensed → same.

### 4.4 Relationship to Zen's native mods system

Zen's `src/zen/mods/` (marketplace at `zen-browser.github.io/theme-store`) **stays intact**.
Rationale: it is upstream code, removing it enlarges the diff surface, and users may still want it.

But Trance ships with it **off by default** for the mods Trance reimplements — there is no point
having both. Add a first-run note explaining that Trance's built-ins replace those mods.

If the theme-store URL should point elsewhere later, that is a one-line change in
`src/zen/mods/ZenMods.mjs:317` — record it in `UPSTREAM-TOUCHPOINTS.md`.

---

## 5. Zen internals map

Everything here was verified against the fork point commit. Re-verify after any upstream rebase.

### 5.1 Top-level layout

```
Trance-dev/
├── surfer.json              # Build identity: name, vendor, appId, binaryName, version, brands
├── package.json             # npm scripts wrapping @zen-browser/surfer
├── configs/
│   ├── branding/{release,twilight}/   # Per-brand icons + content/ (about: page art)
│   ├── common/mozconfig     # Shared build flags
│   └── {macos,linux,windows}/mozconfig
├── prefs/
│   ├── firefox/             # Overrides of Firefox defaults
│   ├── zen/*.yaml           # Zen feature prefs  ← Trance adds prefs/trance/*.yaml
│   ├── fastfox/ privatefox/ # Betterfox-derived
│   └── README.md
├── src/                     # Patches + new files applied onto the Firefox tree
│   ├── browser/ toolkit/ dom/ gfx/ ... # *.patch files against Firefox
│   └── zen/                 # Zen's own source (this is where Trance code goes)
├── build/                   # Packaging: AppDir, flatpak, windows, signing
├── scripts/                 # Python maintenance scripts (update_ff.py etc.)
├── tools/ffprefs/           # Rust tool: prefs/**.yaml → engine/browser/app/profile/zen.js
└── engine/                  # (gitignored) The downloaded Firefox source tree
```

### 5.2 `src/zen/` — the Zen feature tree

```
src/zen/
├── moz.build                  # DIRS list — every feature dir must be listed here
├── ZenComponents.manifest     # #include of each feature's Components.manifest
├── zen.globals.mjs
├── common/
│   ├── ZenPreloadedScripts.js # ← THE startup import list. Order matters.
│   ├── zenThemeModifier.js
│   ├── zen-sets.js
│   ├── jar.inc.mn             # ← Packaging: maps source files → chrome:// URLs
│   ├── Components.manifest
│   ├── modules/
│   │   ├── ZenCommonUtils.mjs # exports nsZenMultiWindowFeature,
│   │   │                      #         nsZenDOMOperatedFeature,
│   │   │                      #         nsZenPreloadedFeature
│   │   ├── ZenStartup.mjs  ZenUIManager.mjs  ZenUpdates.mjs
│   │   ├── ZenSessionStore.mjs  ZenMenubar.mjs  ZenSidebarNotification.mjs
│   │   └── ZenHasPolyfill.mjs
│   ├── styles/                # ← All Zen chrome CSS
│   │   ├── zen-theme.css      # (preprocessed, note the `*` in jar.inc.mn)
│   │   ├── zen-toolbar.css    # (preprocessed)
│   │   ├── zen-sidebar.css  zen-omnibox.css  zen-popup.css  zen-buttons.css
│   │   ├── zen-animations.css  zen-branding.css  zen-browser-ui.css
│   │   ├── zen-browser-container.css  zen-panel-ui.css  zen-single-components.css
│   │   ├── zen-sidebar-notification.css  zen-overflowing-addons.css
│   │   ├── zen-panels/{bookmarks,print,dialog}.css
│   │   └── schemes/           # Colour schemes
│   └── emojis/
├── mods/                      # Native mods system
│   ├── ZenMods.mjs            # Downloads mods, rebuilds profile chrome/zen-themes.css
│   ├── nsZenModsBackend.{h,cpp}  ZenStyleSheetCache.{h,cpp}   # C++ stylesheet injection
│   ├── nsIZenModsBackend.idl  components.conf
│   └── actors/ZenModsMarketplace{Parent,Child}.sys.mjs
├── tabs/  folders/  live-folders/  spaces/  space-routing/
├── compact-mode/  glance/  split-view/  urlbar/  downloads/
├── boosts/  drag-and-drop/  window-drag/  media/  share/  sync/
├── sessionstore/  kbs/  welcome/  toolkit/  fonts/  images/
├── @types/  vendor/  tests/
```

### 5.3 How a Zen feature is wired — the exact recipe

To add `src/zen/trance/foo/`:

1. **Create the dir** with source files.
2. **`src/zen/trance/foo/moz.build`** — declare the dir (usually just includes `jar.inc.mn` via
   the parent's jar).
3. **Register in `src/zen/moz.build`** → add `"trance"` to `DIRS` (one entry for the whole
   Trance tree; sub-features are listed in `src/zen/trance/moz.build`).
4. **Package the files** — add lines to a `jar.inc.mn` mapping:
   ```
   content/browser/trance-components/TranceFoo.mjs   (../../zen/trance/foo/TranceFoo.mjs)
   content/browser/trance-styles/trance-foo.css      (../../zen/trance/foo/trance-foo.css)
   ```
   A leading `*` marks the file for preprocessing (`#ifdef`, `@VARS@`).
5. **Import at startup** — add to the `scripts` array in `src/zen/common/ZenPreloadedScripts.js`:
   ```js
   "chrome://browser/content/trance-components/TranceFoo.mjs",
   ```
   Order matters: foundation modules first, features after.
6. **Custom elements** go in the `customZenElements` array in the same file (lazy creation callback).
7. **Chrome-process services / actors** → a `Components.manifest` `#include`d from
   `src/zen/ZenComponents.manifest`.
8. **Prefs** → `prefs/trance/foo.yaml`, picked up by `npm run ffprefs`.
9. **CSS import** — Trance stylesheets are `@import`ed from a single `trance.css` entry point
   which is itself imported once from `zen-theme.css` (see §6.2).

### 5.4 Feature base classes (`ZenCommonUtils.mjs`)

| Class | Use when |
|---|---|
| `nsZenPreloadedFeature` | Needs to exist before `DOMContentLoaded`; gets `init(window)` |
| `nsZenDOMOperatedFeature` | Only touches the DOM; initialised after the document is ready |
| `nsZenMultiWindowFeature` | Must operate across all browser windows; provides window iteration |

Trance features extend these, never invent a parallel lifecycle.

### 5.5 Prefs pipeline

- Source: `prefs/**/*.yaml`, list-of-objects format:
  ```yaml
  - name: trance.blur.enabled
    value: true
  - name: trance.blur.radius
    value: 24
  - name: trance.acrylic
    value: "@IS_TWILIGHT@"          # preprocessor substitution
  - name: trance.something
    value: "@cond"                   # conditional pref
    condition: "defined(MOZILLA_OFFICIAL)"
  - name: trance.locked-thing
    value: "x"
    locked: true
  ```
- Tool: `tools/ffprefs` (Rust) — `npm run ffprefs`
- Output: `engine/browser/app/profile/zen.js`, and it appends `#include zen.js` to `firefox.js`
- Source of truth for the tool paths: `tools/ffprefs/src/main.rs:111-112`

### 5.6 Branding

- `surfer.json` `buildOptions.generateBranding: true` → surfer generates the Firefox branding dir
  from `configs/branding/<brand>/`.
- Each brand dir contains: `logo{16,22,24,32,48,64,128,256,512,1024}.png`, `logo.png`,
  `logo-mac.png`, `firefox.ico`, `firefox64.ico`, `firefox.icns`, `document.ico`,
  `document_pdf.ico`, `pbmode.ico`, `VisualElements_{70,150}.png`,
  `PrivateBrowsing_{70,150}.png`, `MacOSInstaller.svg`, `wizWatermark.bmp`, `content/`.
- `surfer.json` `brands.<name>` supplies `brandFullName`, `brandShortName`, `brandShorterName`,
  `backgroundColor`, and release metadata.
- `name`, `vendor`, `appId`, `binaryName` are **global**, not per-brand. Changing `appId`
  changes the profile directory → users get a fresh profile. That is intended for Trance but
  must happen exactly once, in Phase 1, and never again.

### 5.7 Build system

`@zen-browser/surfer` wraps `mach`. Key npm scripts:

| Script | Does |
|---|---|
| `npm run init` | `download` + `import` + `bootstrap` — the full first-time setup |
| `npm run download` | Fetch the Firefox source into `engine/` |
| `npm run import` | Apply `src/**` patches + new files onto `engine/`, run `ffprefs` + service dumps |
| `npm run bootstrap` | `mach bootstrap` — install build deps |
| `npm run build` | Full build |
| `npm run build:ui` | **Fast path.** Rebuilds only chrome UI (JS/CSS/XHTML) — seconds, not hours |
| `npm start` | Launch the built browser with `--noprofile` |
| `npm run export` | Export changes from `engine/` back into `src/**` as patches |
| `npm run lint` / `lint:fix` | `mach lint zen` |
| `npm test` | `scripts/run_tests.py` |
| `npm run sync` | `scripts/update_ff.py` — bump the Firefox base version |

> **Critical workflow note:** `engine/` is gitignored and is where you actually run the browser.
> Edits made in `engine/` must be exported back with `npm run export`, or made in `src/` and
> re-imported with `npm run import`. **Trance's own new files live in `src/zen/trance/` and are
> copied into `engine/` by `import`.** Never edit Trance source inside `engine/`.

---

## 6. The Trance foundation layer

Built in Phase 2, before any feature. Everything else depends on it.

### 6.1 Module layout

```
src/zen/trance/
├── moz.build
├── jar.inc.mn
├── TranceComponents.manifest
├── core/
│   ├── TranceTokens.mjs        # JS-side access to design tokens; pref → CSS var sync
│   ├── TranceScheduler.mjs     # single rAF/idle-coalesced tick, occlusion & focus aware
│   ├── TranceObserverHub.mjs   # single Mutation/Resize/Intersection observer, multiplexed
│   ├── TranceFeature.mjs       # base class: extends nsZenPreloadedFeature, adds pref gating
│   ├── TranceMotion.mjs        # motion level, prefers-reduced-motion, animation registry
│   ├── TranceIcons.mjs         # icon set registry
│   └── TranceLog.mjs           # namespaced, pref-gated logging (`trance.debug`)
├── styles/
│   ├── trance.css              # single entry point — @imports everything below, in order
│   ├── trance-tokens.css       # :root custom properties ONLY. No selectors.
│   ├── trance-reset.css        # neutralises the Zen defaults Trance replaces
│   ├── trance-surfaces.css     # the blur/transparency layer (the blur budget lives here)
│   ├── trance-motion.css       # keyframes + duration tokens; no `infinite`
│   └── features/*.css          # one file per feature, in dependency order
├── icons/{fluent,zen}/         # the two icon packs, real SVG files
├── settings/
│   ├── TranceSettings.mjs      # about:preferences#trance
│   └── trance-settings.css
└── features/
    └── <feature>/…
```

### 6.2 The token layer — the anti-conflict mechanism

`trance-tokens.css` is the **only** file in Trance allowed to write to `:root`.
Every other Trance stylesheet consumes tokens and never redefines them.

Token families (names are the contract; extend, don't rename):

```css
:root {
  /* Surfaces */
  --trance-surface-blur: 24px;
  --trance-surface-alpha: 0.62;
  --trance-surface-tint: light-dark(#ffffff, #0d0f14);
  --trance-surface-border: color-mix(in oklch, currentColor 12%, transparent);

  /* Geometry */
  --trance-radius-sm: 6px;
  --trance-radius-md: 10px;
  --trance-radius-lg: 16px;
  --trance-radius-pill: 999px;
  --trance-gap-xs: 2px;  --trance-gap-sm: 4px;
  --trance-gap-md: 8px;  --trance-gap-lg: 12px;

  /* Motion — consumed by trance-motion.css and TranceMotion.mjs */
  --trance-dur-instant: 80ms;
  --trance-dur-fast: 140ms;
  --trance-dur-base: 220ms;
  --trance-dur-slow: 380ms;
  --trance-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --trance-ease-emphasis: cubic-bezier(0.3, 0, 0, 1.2);

  /* Elevation — resolved to shadows, never ad-hoc box-shadow */
  --trance-elev-0: none;
  --trance-elev-1: 0 1px 2px rgb(0 0 0 / 0.10);
  --trance-elev-2: 0 4px 16px rgb(0 0 0 / 0.14);

  /* Accent — derived from Zen's gradient engine, never hardcoded */
  --trance-accent: var(--zen-primary-color, AccentColor);
}
```

**Rules, enforced by lint (Phase 2 deliverable — a stylelint plugin):**

1. No `!important` anywhere in `src/zen/trance/**`. If you need it, the selector is wrong.
2. No literal colour values outside `trance-tokens.css`.
3. No literal durations/easings outside `trance-tokens.css` and `trance-motion.css`.
4. No `animation-iteration-count: infinite`.
5. No `backdrop-filter` outside `trance-surfaces.css`.
6. No `will-change` in CSS at all (JS adds/removes it).
7. Max specificity: one ID **or** three classes/attributes. Higher requires a comment justifying it.

### 6.3 `TranceScheduler`

Single source of animation and periodic work.

```
API sketch:
  TranceScheduler.onFrame(cb, { priority })     → handle    // rAF-coalesced
  TranceScheduler.onIdle(cb, { timeout })       → handle
  TranceScheduler.onWallClock(cb, "minute")     → handle    // aligned to boundary, no polling
  TranceScheduler.cancel(handle)
```

Behaviour:
- One `requestAnimationFrame` loop per window, started only when ≥1 frame subscriber exists.
- Automatically suspends on `window` blur, on `occlusionstatechange` (window fully occluded),
  and when the browser reports `docShell.isActive === false`.
- `onWallClock` computes the exact delay to the next boundary and uses a one-shot timer.
  A clock ticking once a minute costs one wakeup per minute, not 60.

### 6.4 `TranceObserverHub`

```
API sketch:
  TranceObserverHub.observeMutations(selector, cb, { attributes, childList, subtree })
  TranceObserverHub.observeResize(element, cb)
  TranceObserverHub.observeIntersection(element, cb, opts)
```

- Internally: **one** `MutationObserver` on `document.documentElement` with the union of all
  requested options, dispatching to subscribers filtered by `Element.matches(selector)` and
  `closest()`.
- Callbacks are queued and flushed once per frame via `TranceScheduler`, so N mutations in one
  task produce one callback, not N.
- Reads and writes are phase-separated (read phase → write phase) to avoid forced reflow.

### 6.5 `TranceFeature` base class

```
class TranceFeature extends nsZenPreloadedFeature {
  static prefName;            // e.g. "trance.superpins.enabled"
  static styles = [];         // chrome:// css URLs, loaded/unloaded with the pref
  onEnable(window) {}
  onDisable(window) {}
}
```

Guarantees:
- **Disabled means zero cost.** No listeners, no observers, no stylesheet loaded, no DOM.
- Pref flips take effect live — no restart. Each feature must be able to fully tear itself down.
- Every feature registers its pref with the settings page automatically.

### 6.6 Settings surface

`about:preferences#trance` — one page, grouped by the roadmap phases:
Appearance · Sidebar & Tabs · Chrome · Motion & Feedback · Library · Advanced.

Every `trance.*` pref appears here. If a pref is not in the UI, it should not exist.

---

## 7. Licensing and legal constraints

> **Read this before copying a single line from any mod.** This section is the reason for §4.

Zen (and therefore Trance) is **MPL-2.0**. Firefox is MPL-2.0.

### 7.1 License audit of the 23 mods

| License | Mods | Can we copy code? |
|---|---|---|
| **MIT** | Advanced Tab Groups, Context Menu Icons, Deta Loading Bar, Hide Extension Name, SuperPins, Zen Context Menu | ✅ Yes, with attribution + license text retained |
| **Apache-2.0** | Zen Compact Transparent Mode, Zen Custom URL Bar | ✅ Yes, with attribution + NOTICE handling |
| **GPL-3.0** | **Nebula**, Zen Folder Tree Connectors | ⚠️ See §7.2 |
| **No license file** | Better New Tab Button, BetterZenGradientPicker, Customize Collapsed Sidebar, Floating Status Bar, Live Calendar, New Icons, Nova UI, Render.js, Tab Closing Bubble Animation, Transparent Zen, Unloaded Tabs, **Zen Library** | ❌ No — all rights reserved by default |
| **Unknown / store-hosted** | Pimp your PiP (no homepage; store repo `zen-browser/theme-store` is MIT but per-mod terms unclear) | ❌ Treat as unlicensed until confirmed |

### 7.2 The GPL-3.0 problem

MPL-2.0 §3.3 permits distributing a Larger Work under GPL — meaning a Trance build containing
GPL-3.0 code would have to be distributed **under GPL-3.0 as a whole**. That is a project-defining
license change for a Firefox fork, it conflicts with parts of the Firefox tree that are not
GPL-compatible in practice, and it is not what this project wants.

**Therefore: no GPL-3.0 mod code enters this repository. Ever.**
Nebula is reimplemented clean-room. Zen Folder Tree Connectors was too, in Phase 4, and that was
withdrawn: what it ships is a drawing, and a clean-room reimplementation of a drawing is an
approximation of it. Trance preinstalls the author's own distribution instead — installing a mod is
not copying it, nothing from it enters this tree, and there is one owner for the lines again
(ADR-027). That is the same answer §7.3 already reached for the "New Icons" set (ADR-024).

### 7.3 The unlicensed problem

"No LICENSE file" ≠ public domain. It means *all rights reserved*: no right to copy, modify, or
redistribute. Twelve of the 23 mods — including the non-negotiable **Zen Library** — are in this
bucket.

Options, in order of preference:
1. **Clean-room reimplement** (default; already the §4 decision).
2. **Ask the author to license it** — MIT/MPL-2.0. Worth doing for Zen Library, Nova UI,
   New Icons, Live Calendar, Transparent Zen. Track outcomes in `docs/trance/CREDITS.md`.
3. Do not ship the feature.

### 7.4 Zen trademarks and branding

Zen's *code* is MPL-2.0; Zen's *name, logo, and wordmark* are not licensed for use by forks.
Trance must ship entirely original branding before any public distribution:
- New icon set (`configs/branding/trance/`)
- New `brandFullName` / `brandShortName` / `brandShorterName`
- New `appId`, `binaryName`, `vendor`
- New `updateHostname` (or updates disabled)
- Remove `zen-browser.app` from `zen.injections.match-urls` (`prefs/zen/mods.yaml`)
- Own `about:` page art in `configs/branding/trance/content/`

Placeholder Zen assets during development are acceptable **only** for local dev builds. They must
be gone before Phase 12 (any distribution).

### 7.5 Extension redistribution

See §9 — the chosen mechanism (policy-driven install from AMO) sidesteps redistribution entirely.

### 7.6 What every Trance source file carries

```
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: <feature name>
// Behaviour inspired by "<Mod Name>" by <author> (<url>).
// Implemented independently for Trance; no code copied.
```

Where code *is* copied (MIT/Apache-2.0 only), the original header stays and the file is listed in
`docs/trance/THIRD-PARTY.md` with its license text.

---

## 8. Feature inventory — all 23 mods

Legend for **Verdict**:
- `NATIVE` — reimplement in Trance
- `ADAPT` — permissive license, may port code with attribution
- `ZEN` — Zen already does this; configure rather than build
- `DEFER` — post-1.0
- `PREINSTALL` — Trance installs the author's own distribution instead of reimplementing it, either
  because the licence forbids reproducing what it ships (ADR-024, ADR-027) or because a rewrite
  would remove no conflict and cost what the original costs (ADR-030, ADR-033)

Machine-readable version: `docs/trance/mods-inventory.json`.

| # | Mod | Ver | Store | Source | License | Verdict | Phase |
|---|---|---|---|---|---|---|---|
| 1 | Advanced Tab Groups | 3.5.1 | Sine | `Vertex-Mods/Advanced-Tab-Groups` | MIT | ADAPT | 4 |
| 2 | Better New Tab button | 1.0.6 | neither | `themaster5209/zen-better-new-tab-button` | none | PREINSTALL (ADR-049) | — |
| 3 | BetterZenGradientPicker | 1.7 | Sine | `JustAdumbPrsn/BetterZenGradientPicker` | none | NATIVE | 8 |
| 4 | Context Menu Icons | 2.7.4.3 | Sine | `Starry-AXQG/Context-Menu-Icons` | MIT | ADAPT | 5 |
| 5 | Customize Collapsed Sidebar | 1.0.5 | Sine | `Ciuriya/zen-themes` | none | NATIVE | 4 |
| 6 | Deta Loading Bar | 2.0.4 | Sine | `rasyidrafi/zen-deta-loading-bar` | MIT | ADAPT | 6 |
| 7 | Floating Status Bar | 1.0.0 | Zen | `AmirhBeigi/zen-floating-statusbar` | none | NATIVE | 6 |
| 8 | Hide Extension Name | 1.0.0 | Zen | `ch4og/zenbrowser-themes` | MIT | ADAPT | 5 |
| 9 | Live Calendar | 1.0.0 | Sine | `Vertex-Mods/Zen-Live-Calendar` | none | PREINSTALL (ADR-030) | — |
| 10 | **Nebula** | 3.3.3 | Sine | `JustADumbPrsn/Zen-Nebula` | **GPL-3.0** | NATIVE (clean-room) | 3 |
| 11 | New Icons | 1.1 → 1.4 | Sine | `qumeqa/zen-icons` | none | PREINSTALL (ADR-024) | — |
| 12 | Nova UI | 2.2 | Sine | `qumeqa/nova` | none | NATIVE | 5 |
| 13 | Pimp your PiP | 1.0.0 | Zen | store-hosted, no homepage | none | PREINSTALL (ADR-033) | — |
| 14 | Render.js | 1.0 | Sine | `SehajveerSingh2005/render.js` | none | NATIVE | 6 |
| 15 | SuperPins | 1.7.2 | both | `CosmoCreeper/Zen-Themes/SuperPins` | MIT | ADAPT | 4 |
| 16 | Tab Closing Bubble Animation | 1.3 | Sine | `Zylaah/bubble-pop-deleting` | none | NATIVE | 6 |
| 17 | **Transparent Zen** | 1.17.16 | Zen | `sameerasw/zen-themes/TransparentZen` | none | NATIVE | 3 |
| 18 | Unloaded Tabs | 1.0 | Sine | `qumeqa/unloaded-tabs` | none | NATIVE | 4 |
| 19 | Zen Compact Transparent Mode | 2.0.0 | Sine | `rasyidrafi/zen-compact-transparent-mode` | Apache-2.0 | ADAPT | 3 |
| 20 | Zen Context Menu | 3.1 | Zen | `KiKaraage/ZenMods` | MIT | ADAPT | 5 |
| 21 | Zen Custom URL Bar | 2.0.3 | Sine | `rasyidrafi/zen-custom-urlbar` | Apache-2.0 | ADAPT | 5 |
| 22 | Zen Folder Tree Connectors | 2.1 | Sine | `JustAdumbPrsn/ZenFolderTreeConnectors` | **GPL-3.0** | PREINSTALL (ADR-027) | — |
| 23 | **Zen Library** | 1.0.0 | Sine | `12th-devs/Zen-Library` | none | PREINSTALL (ADR-030) | — |

### 8.1 Overlap and merge notes

These mods overlap; merging them is the entire point of Trance. Merge targets:

**Transparency cluster → one `trance-surfaces.css` + `TranceSurfaces.mjs`**
Transparent Zen (17) + Zen Compact Transparent Mode (19) + Nebula's glass (10) + Nova UI's
chrome treatment (12). Today: 4 independent blur stacks. In Trance: one surface system with
per-region tokens and a hard one-blur-per-region budget (§3.3). Nebula's *look* is the default;
the other three become preset variations of the same system, not extra layers.

**Sidebar/tab cluster → `TranceSidebar` + `TranceTabs`**
SuperPins (15) + Advanced Tab Groups (1) + Zen Folder Tree Connectors (22) +
Customize Collapsed Sidebar (5) + Unloaded Tabs (18).
All five touch `#tabbrowser-tabs` and Zen's `ZenFolders` / `ZenPinnedTabManager`. Today: five
observers, conflicting selectors on the same elements. In Trance: one rendering path for the tab
strip that owns pinned tabs, groups, collapsed-state layout, and the unloaded-tab visual state.
Folder connector lines were in that list and are not any more: the mod is preinstalled rather than
reimplemented, so it owns them (ADR-027).

> Note: Zen already ships `folders/`, `live-folders/`, and essentials/pinned-tab handling.
> Extend Zen's implementations; do not build a parallel tab system.

**Icon cluster → one icon set**
New Icons (11) + Context Menu Icons (4) + Zen Context Menu (20) + Nova UI (12) icons.
One SVG directory, one naming convention, one `chrome://browser/skin/trance/icons/` root.

**Chrome furniture cluster**
Better New Tab Button (2) + Hide Extension Name (8) + Zen Custom URL Bar (21) + Nova UI (12).
Small CSS/behaviour tweaks to the toolbar and urlbar — one feature module,
`TranceChrome`, with individual prefs.

**Feedback/motion cluster → `TranceMotion` consumers**
Deta Loading Bar (6) + Tab Closing Bubble (16) + Floating Status Bar (7) + Render.js (14).
All four are animation-driven; all four currently hold their own timers. In Trance they are
subscribers to `TranceScheduler`, and every keyframe lives in `trance-motion.css`.

**Standalone larger features**
Zen Library (23) and Live Calendar (9) are real applications, not restyles — which is exactly why
Trance ends up installing them rather than rewriting them. They open surfaces of their own and own
no element any Trance feature owns, so there is no conflict for a rewrite to remove, and the cost
audit in their investigation docs comes out at what a rewrite would have cost anyway (ADR-030).

### 8.2 Per-mod investigation checklist (do this before implementing any of them)

For each mod, before writing code, produce `docs/trance/mods/<id>.md` containing:
- [ ] What it actually does, listed as discrete user-visible behaviours
- [ ] Which DOM nodes / Zen modules it touches
- [ ] Which prefs/settings it exposes, and which of them the user actually uses
- [ ] Which of §3's failure modes it exhibits (observers, blur, infinite animation, timers)
- [ ] What overlaps with other mods and with stock Zen
- [ ] Proposed Trance pref names
- [ ] Decision: which parts to keep, which to drop

> The user noted: *"I typically take small parts of them and disable the majority of their
> features."* — so the default answer for most sub-features is **drop it**. Ask before building
> anything not on the user's actual daily path. Exceptions: **Nebula** and **Zen Library**, which
> ship in full.

---

## 9. Bundled Mozilla extensions

All seven are non-negotiable and must be present on a fresh profile.

| Extension | AMO slug | GUID | License |
|---|---|---|---|
| uBlock Origin | `ublock-origin` | `uBlock0@raymondhill.net` | GPL-3.0 |
| SponsorBlock | `sponsorblock` | `sponsorBlocker@ajay.app` | GPL-3.0 |
| Privacy Badger | `privacy-badger17` | `jid1-MnnxcxisBPnSXQ@jetpack` | GPL-3.0 |
| Dark Reader | `darkreader` | `addon@darkreader.org` | MIT |
| ClearURLs | `clearurls` | `{74145f27-f039-47ce-a470-a662b129930a}` | LGPL-3.0 |
| Return YouTube Dislike | `return-youtube-dislikes` | `{762f9885-5a13-4abd-9c77-433dcd38b8fd}` | GPL-3.0 |
| Zen Internet | `zen-internet` | `{91aa3897-2634-4a8a-9092-279db23a7689}` | MIT (`sameerasw/my-internet`) |

### 9.1 Chosen mechanism — enterprise policy, `normal_installed`

**Do not vendor XPIs into the repo.** Five of seven are GPL-family; bundling their binaries in an
MPL-2.0 distribution creates the same licensing entanglement as §7.2, and it freezes their versions.

Instead ship `distribution/policies.json`:

```json
{
  "policies": {
    "ExtensionSettings": {
      "uBlock0@raymondhill.net": {
        "installation_mode": "normal_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi"
      },
      "sponsorBlocker@ajay.app": {
        "installation_mode": "normal_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/sponsorblock/latest.xpi"
      },
      "jid1-MnnxcxisBPnSXQ@jetpack": {
        "installation_mode": "normal_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/privacy-badger17/latest.xpi"
      },
      "addon@darkreader.org": {
        "installation_mode": "normal_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/darkreader/latest.xpi"
      },
      "{74145f27-f039-47ce-a470-a662b129930a}": {
        "installation_mode": "normal_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/clearurls/latest.xpi"
      },
      "{762f9885-5a13-4abd-9c77-433dcd38b8fd}": {
        "installation_mode": "normal_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/return-youtube-dislikes/latest.xpi"
      },
      "{91aa3897-2634-4a8a-9092-279db23a7689}": {
        "installation_mode": "normal_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/zen-internet/latest.xpi"
      }
    }
  }
}
```

Properties of this approach:
- `normal_installed` = installed automatically, **user can disable it**. (`force_installed` would
  also forbid disabling — rejected; this is a browser for a person, not a fleet.)
  *Correction, Phase 9:* `normal_installed` does **not** permit uninstalling. `Policies.sys.mjs`
  calls `disallowFeature("uninstall-extension:<id>")` for both modes and only leaves *disable* alone
  for `normal_installed`. Removing one for good means removing its entry from `policies.json`
  (ADR-032).
- Extensions auto-update from AMO like any other add-on.
- No redistribution of third-party binaries → no licensing entanglement.
- Requires network on first run. Ship a first-run panel that reports install status and offers a
  retry, so a failed install is visible rather than silent.

`policies.json` locations per platform:
- macOS: `Trance.app/Contents/Resources/distribution/policies.json`
- Linux: `<install>/distribution/policies.json`
- Windows: `<install>\distribution\policies.json`

~~The existing `build/AppDir/distribution/policies.json` already carries update policies for Linux —
merge into it, do not create a second file.~~
**Superseded by ADR-032.** That file reaches only the Linux AppImage, so merging into it would have
shipped the extensions on one platform. The single file is `src/zen/trance/distribution/policies.json`,
installed on all three platforms by `FINAL_TARGET_FILES.distribution` in `src/zen/trance/moz.build`
— the mechanism `browser/app/distribution` uses for `distribution.ini` — and the AppDir copy is
deleted.

### 9.2 Companion prefs (`prefs/trance/extensions.yaml`)

```yaml
- name: extensions.postDownloadThirdPartyPrompt
  value: false
```

~~`extensions.autoDisableScopes: 0`~~ — **not set (ADR-032).** It does not do what the line above it
claimed. `XPIDatabase.updateMetadata` reads it only under `isDetectedInstall && foreignInstall`, so
it governs add-ons *found in a scanned directory*, never a policy install — which goes through
`AddonManager.getInstallForURL(...).install()` and is enabled the moment it finishes. Setting it to
0 would change nothing for the seven and would remove the protection that stops another program
dropping an XPI into the system add-ons directory and having it enable itself.

Do **not** set `xpinstall.signatures.required: false`. AMO builds are signed; keep verification on.

### 9.3 Extension ↔ Trance overlap

- **Zen Internet** (`sameerasw/my-internet`) applies per-site transparent CSS. It pairs with
  Trance's own chrome transparency; make sure the content-area transparency in
  `trance-surfaces.css` does not double up with it. One owner for the content area: Zen Internet.
- **Dark Reader** vs Trance's colour scheme: Trance must not restyle content. Chrome only.
- **uBlock Origin**: consider shipping a default filter-list selection? → **No** for v1.0.
  Ship defaults; do not preconfigure other people's tools.

---

## 10. Build and development runbook

### 10.1 One-time setup (not yet done)

```bash
cd /Users/ryan/Downloads/Code/Trance-dev

# Native deps (macOS)
brew install python@3.11 gnu-tar
nvm install                       # reads .nvmrc → Node 22
rustup toolchain install 1.94.1   # .rust-toolchain

source scripts/trance-env.sh      # pins python/node/rust for THIS shell
npm install
npm run init                      # download + import + bootstrap  (LONG: 30–90 min)
npm run build                     # full build (LONG: 1–4 h on M-series, first time)
npm start                         # launch
```

**`source scripts/trance-env.sh` before every build session.** Two traps it exists to cover:

- macOS `python3` must be **3.11**. mach does not support 3.14, and Homebrew's `python@3.11`
  is not linked as `python3` — the script prepends its `libexec/bin`.
- rustup only auto-reads `rust-toolchain` / `rust-toolchain.toml`. Zen's pin is
  `.rust-toolchain` (dotted), which rustup **ignores**, so `rustc` silently stays on whatever
  is default. The script reads the file and exports `RUSTUP_TOOLCHAIN`.
- `gtar` (GNU tar) is required — surfer cannot unpack the Firefox tarball with macOS bsdtar,
  and the failure only appears several minutes into `npm run download`.

Expect `engine/` to reach ~40 GB with an objdir. Keep 60 GB free.
Note the repo's own `.git` is ~3 GB once Zen's full history is fetched.

### 10.2 Day-to-day loop

| You changed | Run |
|---|---|
| Trance CSS / JS / XHTML under `src/zen/` | `npm run import && npm run build:ui && npm start` |
| `prefs/**/*.yaml` | `npm run ffprefs && npm run build:ui` |
| `jar.inc.mn`, `moz.build`, manifests | `npm run import && npm run build` |
| C++ (`src/zen/**/*.cpp`) | `npm run import && npm run build` |
| Firefox patches (`src/**/*.patch`) | `npm run import && npm run build` |

`npm run build:ui` is the fast path — use it constantly. Full builds are for structural changes only.

#### Sine is not part of the build, and every build removes it

`scripts/trance-cosine.py` writes `config.js` and `defaults/pref/config-prefs.js` into the built
app bundle. Both are packaging outputs as far as the build system is concerned, so **any build —
including `build:ui` — deletes them**, and the browser then starts with no Sine, no preinstalled
mods, and no `sineMods` pane. Nothing warns you; the browser just quietly loses half of what
ADR-018 promised.

So the loop is:

```bash
npm run import && npm run build:ui
python3 scripts/trance-cosine.py --profile "<your profile>"   # after every build
npm start
```

**And the reverse, for tests.** With Sine provisioned, `npm run test` crashes the test browser at
startup: mochitest forbids non-local connections and kills the process on the first one, and Sine
fetches its marketplace at init. The crash reason names the URL, so it is at least legible when it
happens:

```
Attempting to connect to non-local address! … uri is [https://raw.githubusercontent.com/…]
```

It is not always that legible. Since Phase 7 added two script mods to `PREINSTALLED_MODS`, the
failure observed instead is that Marionette never comes up at all — the run ends with

```
TimeoutError: Timed out waiting for connection on 127.0.0.1:2828!
ERROR Automation Error: Received unexpected exception while running application
```

and a crash stack whose top frame is `trance + 0x898`, which names nothing. Zero tests run. If a
test run dies before the first assertion, check for `config.js` in the app bundle *first*; it looks
exactly like a Trance regression and is not one.

Run tests from a build that has not been provisioned, or move `config.js` and
`defaults/pref/config-prefs.js` aside for the run. `--uninstall` does it, and re-provisioning
afterwards is one command.

### 10.3 Debugging the chrome UI

- **Browser Toolbox**: `devtools.chrome.enabled=true`, `devtools.debugger.remote-enabled=true`,
  then Cmd+Opt+Shift+I. This is how you inspect `browser.xhtml` and Trance's DOM/CSS live.
- **Live CSS iteration**: edit in the Browser Toolbox style editor for the tight loop, then
  port the result back into `src/zen/trance/styles/`. Never leave changes only in `engine/`.
- **Layer visualisation**: `layers.draw-borders=true` in `about:config` — this is how you catch
  layer explosion (§3.5) and verify the blur budget (§3.3).
- **Profiling**: Firefox Profiler with the "Graphics" + "Sequential styling" feature set.
  Look at `Styles` and `Composite` markers on the parent process.
- **macOS power**: `sudo powermetrics --samplers cpu_power,gpu_power -i 1000 -n 30` with the
  window idle and then occluded.

### 10.4 Lint and test

```bash
npm run lint          # mach lint zen  — must be clean before any commit
npm run lint:fix
npm test              # scripts/run_tests.py
npm run lc            # license header check; `npm run lc:fix` to add headers
```

`npm run lc` will fail on any Trance file missing the MPL header (§7.6). Run it before committing.

---

## 11. Upstream sync strategy

### 11.1 Branch model

```
upstream/dev  ──────────────────────────────────►   (Zen, moves daily)
                 \
main             ─┴──────────────────────────────►   (Trance; rebased onto upstream/dev)
                        \
feat/trance-<feature>    ┴───►   (short-lived, merged into main)
```

`main` is **rebased** onto `upstream/dev`, not merged. This keeps the Trance diff readable as a
patch series, which is the whole point.

### 11.2 The weekly sync

```bash
git fetch upstream dev
git rebase upstream/dev            # resolve; see UPSTREAM-TOUCHPOINTS.md for the hot files
npm run import && npm run build:ui # verify UI still builds
npm run lint
```

If Firefox's base version changed upstream (`surfer.json` `version.version`), a full
`npm run build` is required, and `npm run sync` may need re-running.

### 11.3 Minimising conflict surface — the golden rule

> **New behaviour goes in new files under `src/zen/trance/`.
> Edits to upstream files are the exception, must be minimal, and must be marked.**

Every edit to a file Zen also owns gets a marker so rebase conflicts are obvious:

```js
// >>> TRANCE
…our change…
// <<< TRANCE
```
```css
/* >>> TRANCE */
…
/* <<< TRANCE */
```

Every such file is recorded in `docs/trance/UPSTREAM-TOUCHPOINTS.md` with the reason and the
minimal change. Keep that list under ~15 files. Known unavoidable touchpoints:

| File | Why |
|---|---|
| `src/zen/moz.build` | Add `"trance"` to `DIRS` |
| `src/zen/ZenComponents.manifest` | `#include trance/TranceComponents.manifest` |
| `src/zen/common/ZenPreloadedScripts.js` | Import Trance core + features, in order |
| `src/zen/common/styles/zen-theme.css` | Single `@import` of `trance.css` |
| `src/zen/common/jar.inc.mn` (or a new Trance jar) | Package Trance assets |
| `surfer.json` | Brand identity |
| `configs/branding/trance/**` | New brand (additive, no conflict) |
| `prefs/trance/*.yaml` | New prefs (additive, no conflict) |
| `build/AppDir/distribution/policies.json` | Extension policy |

Anything beyond this list needs a line in `DECISIONS.md` explaining why it could not be done
in a Trance-owned file.

---

## 12. Performance and power budget

### 12.1 Budgets (these are acceptance gates, not aspirations)

Budgets are unchanged since Phase 0. Two of the *instruments* changed in Phase 11, because what was
written down could not be read off a running browser — see ADR-034. The rows marked † say what is
actually measured.

| Metric | Budget | How to measure |
|---|---|---|
| † Chrome compositor **surfaces**, idle | ≤ 6 | Count chrome elements whose computed style forces a compositor surface: non-`none` `backdrop-filter` or `filter`, `will-change` naming transform/opacity/filter, 3D transform. WebRender has no layers and `layers.draw-borders` is a debug overlay, not a count |
| `backdrop-filter` surfaces, per window | ≤ 3 (sidebar, toolbar, overlay) — never nested | Same query, `backdrop-filter` only. "Never nested" is asserted with `Node.contains` in `browser_trance_perf.js` |
| Idle CPU, 1 tab, focused, no media | < 0.5% | `ChromeUtils.requestProcInfo()` `cpuTime` delta over a 60 s idle window. No sudo; `--powermetrics` cross-checks it when available |
| † Idle CPU, window **minimised** | ~0% | Same. Occlusion cannot be scripted from inside the process — minimise is the proxy, and the scorecard labels it as one |
| GPU frames while minimised | 0 | Profiler `Composite` markers on the Renderer/Compositor thread, between the `TrancePerf:Minimize{Start,End}` markers the harness stamps |
| Style flush on tab switch | < 2 ms | Longest profiler `Styles`/`RestyleDocument` marker within 250 ms of a `TabSelect` |
| Style flush on space switch | < 2 ms | Longest `Styles`/`RestyleDocument` marker between the `TrancePerf:SpaceSwitch{Start,End}` markers. Added in Phase 11 with ADR-038, alongside a recorded row for the *total* style time across the same window — the total is what moves when a per-frame restyle stops happening, the worst frame is the DOM work at the start of the switch |
| Space cross-fade layers on the compositor | 2 of 2 | `Animation.isRunningOnCompositor`, sampled per frame across the switches. `nsIDOMWindowUtils.getOMTAStyle` cannot be used: under WebRender it returns `""` for an animation that is demonstrably compositing (ADR-038) |
| MutationObserver callbacks per tab open | ≤ 2 | `TranceLog` `observer.mutation.callbacks` delta ÷ tabs opened, under `trance.debug` |
| Active timers at idle | 0 from Trance | `TranceScheduler.timerCount` + `frameSubscriberCount` |
| Resident memory, 1 tab / 20 tabs | recorded, no budget | Sum of `residentUniqueSize` across all processes. Added in Phase 11: the memory question needed a number and §12.1 had none |
| Cold start delta vs stock Zen | < 100 ms | Same binary, `trance.enabled` true vs false, N=10, median. A true stock-Zen figure needs a second build — measure it once, do not gate on it |

**On the build you measure.** A plain `npm run build` from this tree *is* optimised — Gecko defaults
`MOZ_OPTIMIZE` on and `MOZ_DEBUG` off, and the objdir confirms `-O3` with `NDEBUG`. The
`--enable-optimize` inside `if test "$ZEN_RELEASE"` in `configs/common/mozconfig` is restating the
default, not supplying it. What a dev build lacks is LTO, PGO and `MOZILLA_OFFICIAL`; only the last
changes behaviour (`zen.workspaces.debug` defaults true), and the harness profile sets it false.
`scripts/trance-perf.py` records the provenance on every run and refuses only an `--enable-debug`
build.

### 12.2 Regression harness (Phase 11 deliverable)

`scripts/trance-perf.py` — self-contained, stdlib only, no mach virtualenv:
- Launches the packaged build against a fresh **real** profile, so the enterprise policy, the seven
  preinstalled extensions and Cosine are all present. A mochitest profile has none of them, and they
  are the largest thing Trance adds to a Zen window
- Drives the §12.2 workload over Marionette in chrome context — 20 tabs, 10 space switches, resize,
  scroll, 60 s idle, 60 s minimised — through a ~80-line client written against the wire protocol,
  because `marionette_driver` wants mozrunner/mozversion/psutil from mach's venv. The space switches
  create the second space a fresh profile lacks; before ADR-038 they silently did not run at all
- Captures a Gecko profile via `MOZ_PROFILER_STARTUP`/`MOZ_PROFILER_SHUTDOWN` and parses it offline;
  `--powermetrics` adds `sudo -n powermetrics` when it is available, and is never required
- Emits a JSON scorecard against §12.1 and diffs against `docs/trance/perf-baseline.json`
- `--extensions none` and `--disable-trance` are the two ablations: what the add-ons cost, and what
  Trance itself costs
- Runs in CI on every PR touching `src/zen/trance/**`

`src/zen/tests/trance/browser_trance_perf.js` covers what the harness cannot: the surface and
`backdrop-filter` counts in-process, the reset layer still matching Zen's `will-change` selectors
after a rebase, zero Trance timers at idle, that `TranceScheduler` suspends on
`occlusionstatechange`, and the mechanism the space cross-fade depends on — `motion.animateMini`
with a `pseudoElement`, `opacity` keyframes rather than a custom property, the spring sampled into a
`linear()` easing, and `--zen-background-opacity` still driving both layers at rest. It proves
wiring and mechanism, not platform behaviour: occlusion needs a second application and compositing
needs a painted frame, so both of those are the harness's job. See ADR-034 and ADR-038.

### 12.3 Standing rules

1. Any new `backdrop-filter` requires removing an existing one, or a `DECISIONS.md` entry.
2. Any new observer must go through `TranceObserverHub`. No exceptions.
3. Any new timer must go through `TranceScheduler`. No exceptions.
4. A feature that is pref-disabled must load no stylesheet and register no listener.
5. New animations must declare a duration token and terminate.

---

## 13. Roadmap — phases, deliverables, acceptance

Phases are sequential. Each is a mergeable milestone. Do not start a phase before its predecessor's
acceptance criteria pass.

One exception, taken deliberately: **Phase 13 (Onboarding) landed before Phase 12 (Release
infrastructure)**, on 2026-08-27, at the user's request. The numbering and the dependency disagree —
Phase 12 is what puts a build in front of another person, and the first thing that person sees is
the onboarding flow. Phase 11's performance work is still the open item.

---

### Phase 0 — Fork initialisation ✅ *complete (2026-08-24)*

**Deliverables**
- [x] Git repository initialised, `main` at `upstream/dev` HEAD `ed0a6fd`, verified clean tree
- [x] `upstream` remote configured; full history fetched (6,951 commits)
- [x] `TRANCE.md`, `CLAUDE.md`, `docs/trance/` scaffolding
- [x] `docs/trance/UPSTREAM-TOUCHPOINTS.md`, `DECISIONS.md`, `CREDITS.md`, `THIRD-PARTY.md` created
- [x] `origin` = `xslvrrr/Trance`, `main` pushed, default branch set (ADR-005)
- [x] Toolchain pinned — `scripts/trance-env.sh` (Python 3.11.16, Node 22.23.2, Rust 1.94.1, gnu-tar)
- [x] `npm install`
- [x] `npm run download` — Firefox 154 source, 7.3 GB in `engine/`
- [x] `npm run import` — 251 patches applied cleanly
- [x] `npm run bootstrap` — mach reports "ready to build"; pulled MacOSX26.5.sdk
- [x] `npm run build` — green in 79 min 50 s, warnings only, produced `dist/Nightly.app`
- [x] `npm start` verified — parent + content + GPU processes launch, `Mozilla Zen 1.0.0`
- [ ] Delete the leftover private `xslvrrr/trance-browser` repo — **user decided: delete.**
      Blocked on an OAuth scope the CLI does not have; run
      `gh auth refresh -h github.com -s delete_repo` then
      `gh repo delete xslvrrr/trance-browser --yes`

**Acceptance:** ✅ `npm start` launches an unmodified Zen build from this tree.

**Notes from the first build**

- Wall clock: ~80 min on M-series for a full build. `engine/` ≈ 7.3 GB, objdir ≈ 13.1 GB,
  `~/.mozbuild` ≈ 3.2 GB, `.git` ≈ 5.6 GB. Budget ~30 GB for the whole checkout.
- mach detects an AI agent and **suppresses progress output**, printing only warnings and errors.
  Objdir size and `find … -name '*.o' | wc -l` are the progress signals.
- Never pipe a long build through `tail`/`tr` — the pipeline buffers everything to the end, so a
  killed wrapper loses the entire log. Redirect to a file, and launch via `nohup` so the build
  survives if the wrapper dies:
  ```bash
  source scripts/trance-env.sh
  nohup npm run build > /tmp/trance-build.log 2>&1 &
  ```
- The dev build runs from `~/Library/Application Support/zen/Profiles/*.Default (unofficial)`,
  which is **separate** from an installed Zen's `(release)` / `(twilight)` profiles. Phase 1's
  `appId` change moves it out of the `zen/` directory entirely.
- Expect `main/search-config-v2 Invalid content signature` in the console on first run — Zen's
  service dumps are signed for the official build. Harmless for local development.

---

### Phase 1 — Trance identity ✅ *complete (2026-08-24), except artwork*

**Deliverables**
- [x] `configs/branding/trance/` — full asset set (renamed from `configs/branding/release/`;
      `twilight/` deleted, ADR-006). Wordmarks rewritten; icon raster set still Zen's (ADR-008)
- [x] `surfer.json`: `name: "Trance"`, `vendor: "Trance"`, `appId: "trance"`,
      `binaryName: "trance"`, single `brands.trance`, `updateHostname`
- [x] Removed the `zen-browser.app` injection grant in `prefs/zen/mods.yaml`
- [x] `about:` page art, window title, macOS bundle identifier (`app.trance-browser.trance`)
- [x] `configs/common/mozconfig`: `MOZ_APP_BASENAME`, distribution id, source repo (ADR-007)
- [x] `prefs/trance/branding.yaml` — overrides surfer's hardcoded zen-browser.app URLs,
      disables auto-update (ADR-009)
- [x] `scripts/trance-env.sh` pins the surfer brand to `trance`
- [x] `README.md` rewritten for Trance; `LICENSE` (MPL-2.0) unchanged
- [x] `MOZ_APP_PROFILE`, `MOZ_APP_VENDOR`, distribution-id default and the Linux user appdir moved
      off Zen's values, in `src/toolkit/moz-configure.patch` and the new
      `src/browser/moz-configure.patch` (ADR-014)
- [x] **Original icon artwork** — landed 2026-08-27 (ADR-050). The mark is a quatrefoil knot;
      `scripts/trance-branding.py` generates the whole shipped set from `docs/trance/brand/
      mark-{black,white}.png` — eleven raster sizes, the `.icns`, five `.ico`s, the Windows tiles
      and installer bitmap, the `about:` art, and two real SVG paths traced out of the source.
      Every application icon is the white mark on a `#0D0F14` superellipse plate, because a
      monochrome mark on transparency disappears into whichever desktop theme matches it.

**Acceptance:** build shows Trance branding everywhere; no Zen wordmark or logo ships;
profile directory is Trance-specific; a fresh profile is created on first run.

*Result: met. Names, wordmarks, vendor, profile directory and bundle identity landed 2026-08-24;
iconography landed 2026-08-27 with ADR-050. Nothing Zen drew ships any more.*

**⚠️ One-way door:** `appId` and `MOZ_APP_PROFILE` orphan any existing profile. Done once, here.

*The `appId` half was taken on 2026-08-24. The profile half was **missed** at the time and only
found during Phase 3 smoke-testing: `MOZ_APP_PROFILE` is a `project_flag` that `mozconfig` cannot
set, so the build kept using Zen's `zen` value and shared a profile root with an installed Zen.
Fixed the same day (ADR-014). macOS profiles are now
`~/Library/Application Support/Trance/Profiles/…`; the old `zen/` directory is untouched and still
belongs to any installed Zen.*

---

### Phase 2 — Foundation layer ✅ *complete (2026-08-24)*

**Deliverables** (§6 in full)
- [x] `src/zen/trance/core/` — `TranceCore`, `TranceLog`, `TranceScheduler`,
      `TranceObserverHub`, `TranceStyles`, `TranceTokens`, `TranceMotion`, `TranceIcons`,
      `TranceFeature`
- [x] `src/zen/trance/styles/` — `trance.css` entry point, `trance-tokens.css`,
      `trance-reset.css`, `trance-motion.css`
- [x] `prefs/trance/core.yaml` — `trance.enabled`, `trance.motion.level`, `trance.debug`
- [x] `about:preferences#trance` — real pane, English labels (ADR-013)
- [x] stylelint plugin at `src/zen/trance/lint/stylelint-plugin-trance/`, 8 rules, wired into
      `.stylelintrc.js` scoped to `zen/trance/**`
- [x] Wiring: `jar.inc.mn` + one `#include`, one import in `ZenPreloadedScripts.js`
- [x] Browser mochitests at `src/zen/tests/trance/`

**Two planned touchpoints turned out to be unnecessary and were not taken:**
- `zen-theme.css` — stylesheets load through `nsIDOMWindowUtils` instead, which is the only way
  to make "disabled costs nothing" literally true (ADR-010)
- `src/zen/moz.build` / `ZenComponents.manifest` — chrome-packaged files reach the build through
  `jar.inc.mn` alone (ADR-012)

**Acceptance:**
- ✅ Build green; `mach lint zen/trance` clean; every Trance file passes `lc`
- ✅ Lint rejects a deliberately-added `!important` — and a literal colour, a literal duration,
      an `infinite` animation, a stray `backdrop-filter`, a `will-change`, an over-specific
      selector, and a `:root` custom property outside the tokens file
- ✅ With `trance.enabled=false`: no Trance stylesheet in the style set (verified by a token
      failing to resolve), no observer connected, no timer armed, no root attribute
- ✅ `TranceScheduler` stops when its last subscriber leaves and suspends on blur / occlusion /
      minimise

**Note on `TranceFeature` and Zen's lifecycle.** `TranceFeature` does not extend
`nsZenPreloadedFeature`, though §6.5 implied it would. That class binds `init()` to
`MozBeforeInitialXULLayout` in its constructor, which is wrong for something that may first be
constructed when a pref is flipped mid-session — and calling a subclass's `onEnable()` from the
base constructor throws, because a subclass's private methods are not installed until `super()`
returns. `TranceCore` is the `nsZenPreloadedFeature`, so Trance still enters through Zen's own
startup lifecycle (§3.7), and it constructs features and then calls `feature.init()`.

---

### Phase 3 — Surfaces: transparency, blur, Nebula look ✅ *complete (2026-08-24); reworked 2026-08-25, see ADR-019*

Merges mods 10, 17, 19, and Nova UI's chrome treatment (12).
Investigation docs: `docs/trance/mods/{nebula,transparent-zen,zen-compact-transparent-mode,nova-ui}.md`.

**Deliverables**
- [x] `trance-surfaces.css` — the only file with `backdrop-filter`, enforced by
      `trance/no-backdrop-filter`
- [x] `TranceSurfaces.mjs` — region registry, occlusion/focus-aware blur
- [x] Nebula-equivalent visual language (clean-room), driven entirely by tokens
- [x] Presets: `trance.surface.preset` ∈ {`nebula`, `compact`, `flat`, `custom`}
- [x] Integration with Zen's gradient engine — `--trance-surface-tint` mixes
      `--zen-primary-color` into the surface, so chrome follows the space accent
- [x] Settings: preset, blur radius, opacity, saturation, per-region enable, suspend-when-unfocused
- [x] `prefs/trance/surfaces.yaml`; browser mochitests at
      `src/zen/tests/trance/browser_trance_surfaces.js`

**The three regions, and why exactly three:**

| Region | Element | Note |
|---|---|---|
| sidebar | `#navigator-toolbox` | Tinted via `--zen-navigator-toolbox-background`, the extension point Zen leaves for exactly this |
| toolbar | `#zen-appcontent-navbar-wrapper` | Multi-toolbar layout only — in single-toolbar layout the nav bar is inside the toolbox, and blurring both would nest |
| overlay | `#urlbar[breakout-extend]` | Panels and menus join this region in Phase 5, when the chrome-furniture cluster owns them |

**Acceptance:**
- ✅ ≤ 3 blur surfaces, never nested — asserted in `browser_trance_surfaces.js`
- ✅ Blur is dropped on blur / occlusion / minimise, so an occluded window does no blur work
- ⏳ *Visual* sign-off across space switch, tab switch, resize, fullscreen, light/dark is not
      something a test can assert. Needs a human pass. Also needs `powermetrics` + profiler
      numbers, which arrive properly with the Phase 11 harness.

**Reworked 2026-08-25 (ADR-019).** The first implementation was wrong in kind, not in degree:
it wrote a 62%-opaque accent-tinted near-black into `--zen-navigator-toolbox-background` and
called that frosting. Over an already-dark workspace gradient that is a black box, the tint
painted *over* the `backdrop-filter` that was supposed to be revealing something, and being a
per-element `background` it stopped at each border box — missing the `#zen-sidebar-splitter`
hairline, the gutter around the content pane, and the full window width when the sidebar is
collapsed.

Frosting is now the chrome getting out of the way: `--trance-surface-alpha` is applied as an
`opacity` to Zen's own `#zen-browser-background` and `#zen-toolbar-background`, which is what
lets the window's native translucency through (`zen.widget.macos.window-vibrancy` on macOS,
Mica on Windows, `zen.widget.linux.transparency` on Linux). `backdrop-filter` stays and now has
something to blur. Trance's own paint is an ~8% sheen.

A fourth region, `content`, covers the page's own backdrop
(`trance.surface.region.content`, off by default). It is translucency only and never blurred,
so the blur budget in §3.3 and §12.1 is still three.

**Deliberately deferred, and why.** Nebula's B3 (geometry), B4 (elevation) and B5 (cohesive hover
/ active states) ship in Phase 3 *as tokens* — `--trance-radius-*`, `--trance-elev-*`,
`--trance-surface-border/-highlight` — but are not yet applied to tabs, toolbar buttons or menus.
Those elements belong to Phase 4 and Phase 5, and styling them here would mean Phase 3 writing
rules that Phase 4 immediately rewrites, which is the multiple-owners problem this project exists
to remove. See `docs/trance/mods/nebula.md` §2.

---

### Phase 4 — Sidebar and tabs ✅ *complete (2026-08-25); two defects fixed the same day*

Merges mods 1, 5, 15, 18, 22.
Investigation docs: `docs/trance/mods/{advanced-tab-groups,superpins,
customize-collapsed-sidebar,unloaded-tabs,zen-folder-tree-connectors}.md`.

**Deliverables**
- [x] `TranceTabStrip` — one owner for the tab strip. It extends nothing of Zen's: `ZenFolders`
      and `ZenPinnedTabManager` keep their jobs, and Trance styles what they build and adds a
      single menu item to a popup they own
- [x] SuperPins-equivalent pinned-tab behaviour — sticky pinned section; lazy pinned tabs
      surfaced as the platform pref they actually are
- [x] Advanced-Tab-Groups-equivalent grouping — per-folder colour on Firefox's own tab-group
      colour (ADR-016) and a section-style folder header. No code adapted; none was needed
- [x] Folder tree connector lines (clean-room; GPL source) — **CSS only, no script**
- [x] Collapsed-sidebar customisation — rail width, tab size, favicon size, top/bottom margins,
      stacked top buttons; defaults are the user's own `mod.ccs.*` values
- [x] Unloaded-tab visual state — one owner, absorbing SuperPins' competing knobs
- [x] `prefs/trance/tabstrip.yaml`; a **Sidebar & tabs** section in `about:preferences#trance`
- [x] Browser mochitests at `src/zen/tests/trance/browser_trance_tabstrip.js`

**Two extension points did most of the work, and both were found rather than built:**

- `.zen-tab-group-start` — an empty `<html:div>` `nsZenFolder.markup` puts in every folder
  container and **nothing in the tree styles** (three references, all markup). Trance
  absolutely-positions it as the connector trunk. That is why Phase 4 draws tree lines with no
  observer where the GPL original ships a `.uc.js`.
- `MozTabbrowserTabGroup.color` — folders are tab groups, tab groups have had a colour, a palette
  and session persistence since Firefox shipped them. Zen assigns `zen-workspace-color`, a
  sentinel with no matching token, and never exposes the rest. See ADR-016.

**Acceptance:**
- ✅ One observer subscription for the whole tab strip, and it exists for one purpose:
      keeping `trance-folder-color` in step with folders appearing and disappearing. Connectors,
      unloaded state, the rail and sticky pins are attribute- and CSS-driven and add none
- ✅ ≤ 2 observer callbacks per tab open — asserted in `browser_trance_tabstrip.js` against
      `TranceLog`'s counters. The subscription filters out mutations that did not involve a
      folder, so a tab open costs a records scan and no rescan
- ✅ Zero `!important` in the feature, asserted by reading the live stylesheet back (ADR-015)
- ✅ Disabled state: no stylesheet, no menu item, no attribute, no subscription
- ⏳ *Visual* sign-off — the rail at non-default sizes, connectors at depth ≥ 2, sticky pins
      inside Zen's `arrowscrollbox`, and drag-and-drop / spaces / split view unaffected. Needs a
      human pass, as Phase 3's did. Sticky positioning inside a XUL `arrowscrollbox` is the one
      item here most likely to need adjustment
- ⏳ "No style-flush regression opening 20 tabs against the Phase 2 baseline" — needs the
      Phase 11 harness to state as a number rather than as an absence of observers

**Two defects, found by using it and fixed the same day.**

- The sticky pinned section borrowed `--trance-surface-bg` as its occluder. That token belongs to
  the surface feature and is a translucent veil, not something that can hide tabs scrolling
  underneath — and at the time it was a 62%-opaque near-black, so it painted a dark band under the
  space name. Worse, it applied whenever the sidebar was expanded, including when there were no
  pinned tabs at all. It now uses its own `--trance-sticky-bg` and is gated on Zen's
  `hide-separator` attribute, so an empty pinned section paints nothing.
- The collapsed rail's two spacing prefs were written as absolute paddings on
  `#navigator-toolbox`. That replaced Zen's own `padding-bottom: var(--zen-toolbox-padding)` —
  the rail lost its bottom padding — and stacked on top of the `#titlebar` padding Zen already
  applies to clear the macOS window buttons, which pushed the sidebar icons down. They are now
  *extra* space added to what Zen computes, and default to zero, so the stock layout is untouched
  unless asked for.

**Scope decisions (user, 2026-08-25).** Full ATG parity was requested; the investigation reduced
it to two behaviours because Zen already ships folders, subfolders, an icon picker and a folder
context menu, and Firefox already ships the colour. SuperPins' grid layout was dropped, confirming
the `grid-count = 1` in the user's own profile. Fifteen of SuperPins' eighteen knobs, and every
`mod.ccs.*` value the user had not set, were dropped under §8.2's default.

---

### Phase 5 — Chrome furniture and icons ✅ *complete (2026-08-25)*

Merges mods 2, 4, 8, 11, 12, 20, 21.
Investigation docs: `docs/trance/mods/{context-menu-icons,zen-context-menu,new-icons,nova-ui,
better-new-tab-button,hide-extension-name,zen-custom-urlbar}.md`.

**Deliverables**
- [x] ~~One Trance SVG icon set, three packs~~ — built, then **withdrawn by ADR-039**. Trance
      ships no icon pack: the browser draws these glyphs and the preinstalled "New Icons" mod
      redraws them (ADR-024), so a Trance pack was a second owner that could only win by disabling
      Zen's icon sheet. What is left is `trance.chrome.icons.scale`, a percentage of the browser's
      own size, applied through `--zen-toolbar-button-size`
- [x] The Trance mark on the app-menu button, opt-out (`trance.chrome.logo-menu-button`, ADR-039)
- [x] New Tab button treatment; address-bar focus dim; extension-name hiding; menu and panel
      spacing, radius, edges and scrollbars from the existing tokens
- [x] `TranceChrome.mjs`, eleven prefs; `prefs/trance/chrome.yaml`; a **Chrome** section in
      `about:preferences#trance`
- [x] Browser mochitests at `src/zen/tests/trance/browser_trance_chrome.js`

**Three decisions worth recording:**

- **~~One sheet per pack, loaded exclusively.~~** Correct, and beside the point: the cheapest pack
  is the one that does not exist. ADR-039 removed all three.
- **~~The mapping is generated, not hand-maintained.~~** Removed with the packs.
- **~~macOS context menus stay native~~** (ADR-020). The trade disappeared with the packs: there
  is no longer anything that needed an AppKit menu replaced in order to be visible.
- **Icon size goes through the browser's own variable.** `--zen-toolbar-button-size` is what
  Firefox's toolbar-button rule multiplies into the icon box, so scaling it is geometry rather
  than the image — it applies to whichever glyph is there and owns none of them (ADR-039).

**Fifty-odd preferences became six.** Zen Context Menu alone ships thirty-two "hide this menu
item" toggles; all thirty-two were dropped under §8.2, along with Better New Tab Button's
per-component radius sliders (Trance has one radius scale) and six of Zen Custom URL Bar's eight.

**Acceptance:**
- ✅ No duplicate glyphs — exactly one pack is in the style set, asserted in
      `browser_trance_chrome.js`
- ✅ No data-URI icons — asserted by reading the live stylesheet back, for both packs
- ✅ Every sub-feature independently toggleable, one root attribute each, nothing left behind
- ✅ Zero `!important` in the feature sheet or either generated sheet
- ⏳ *Visual* sign-off — icon coverage across the app menu, the site-information panel and Zen's
      own popups, at both packs. Needs a human pass

---

### Phase 6 — Motion and feedback ✅ *complete (2026-08-25)*

Merges mods 6, 7, 14, 16 — of which **two shipped nothing, on purpose** (ADR-021).
Investigation docs: `docs/trance/mods/{deta-loading-bar,tab-closing-bubble,floating-status-bar,
render-js}.md`.

**Deliverables**
- [x] Loading bar — **rebuilt on real progress rather than adapted.** The MIT original is
      CSS-only because a stylesheet cannot ask how far a page has loaded, and it pays for that
      with `animation: … infinite alternate` animating `width` (a layout property, so every frame
      at display rate is a reflow of the content pane), a `filter: blur()` on each of those
      frames, and a permanently promoted `.browserStack`. Four of §3's eight failure modes in
      ninety lines. Trance listens to `nsIWebProgressListener` and scales the bar with
      `transform`. Fourteen prefs became three
- [x] Tab-closing burst (clean-room) — on `TabClose`, the event Firefox already fires, with the
      bubbles animated through `TranceMotion` so `will-change` lasts exactly as long as the
      animation, and one `getBoundingClientRect` per burst rather than one per bubble
- [x] Floating status bar — **nothing built.** Verdict changed to `ZEN`: Zen's own
      `zen.theme.styled-status-panel` already does it and is on by default on macOS. The Zen pref
      is surfaced on the Trance page rather than mirrored (ADR-021)
- [x] Render.js — **nothing built.** Verdict changed to `DEFER`, answering §16 Q8: each of its
      five behaviours duplicates an owner Trance has already assigned (ADR-021)
- [x] `prefs/trance/feedback.yaml`; a **Feedback** group in `about:preferences#trance`;
      browser mochitests at `src/zen/tests/trance/browser_trance_feedback.js`

**Acceptance:**
- ✅ Zero `infinite` animations — and zero `@keyframes` in `trance-feedback.css` at all. The bar
      is a `transition`, which is finite by construction; the burst is Web Animations
- ✅ Zero Trance timers and zero frame subscribers at idle, asserted against `TranceScheduler`'s
      counters. The only frame subscription this feature ever holds is the indeterminate creep,
      which exists while a load with no reported length is in flight and suspends with the window
- ✅ Motion level 0 disables the burst entirely, with no layout shift — the bar still reports
      progress, in one step, because progress is state rather than motion
- ⏳ *Visual* sign-off on the burst and on the bar's timing. Needs a human pass

**One defect found by running it, and fixed the same day.** `TranceCore` enters at
`MozBeforeInitialXULLayout` — deliberately, so Trance is never in a load-order race with Zen
(§3.7) — and this is the first Trance feature that needs `gBrowser`, which does not exist yet at
that point. Phases 3 to 5 style markup the document already contains; this one attaches to a
progress listener and a tab-close event. Both halves silently did nothing until
`TranceFeedback` learned to wait for the window's `load`. The `trance.debug` log said so
plainly, which is what it is for.

---

### Phase 7 — Zen Library and Live Calendar ✅ *complete (2026-08-26); nothing was built*

Mods 23 and 9. Both investigations changed the verdict `NATIVE` → `PREINSTALL` (ADR-030), so this
phase ships two mods and no Trance code.

The reimplementation argument in this project is *ownership* — two stylesheets over one element,
winner decided by load order (§3.1). Neither mod is in that position: each opens a surface of its
own and restyles nothing Zen or Trance owns. With no conflict to remove, only cost is left, and
both audits came back at or under what a rewrite would have achieved: Zen Library holds no
interval, no `MutationObserver` and no infinite animation across 7,500 lines, and Live Calendar's
one always-armed timer is a 60-second refresh — the exact budget this phase set for its own
replacement.

**Deliverables**
- ~~`TranceLibrary`~~, ~~`TranceCalendar`~~ — not written
- `zen-library` and `zen-live-calendar` added to `PREINSTALLED_MODS` in `scripts/trance-cosine.py`,
  pinned, staged into the app so a fresh profile gets them
- Investigation docs (`docs/trance/mods/zen-library.md`, `live-calendar.md`) and ADR-030
- Mod-guard cards moved `planned` → `shipped`, each naming what it costs

**Acceptance:** met by the mods rather than by Trance code. Calendar costs 1 timer wakeup/minute,
measured on what ships. Library adds nothing to startup when the mod is disabled in Sine, and one
promoted compositor layer when it is not.

---

### Phase 8 — Theming and gradient picker ✅ *complete (2026-08-26)*

Mod 3, plus Trance's own colour system. Clean-room: BetterZenGradientPicker is unlicensed, so no
source was read (§7.3).

Zen already ships a gradient picker with a colour wheel, harmony algorithms, a translucency slider
and a grain knob. Trance does not replace it — replacing it would mean owning Zen's gradient engine
and its per-workspace theme format for the sake of four extra controls. `TranceTheme` **extends the
panel in place**: it appends its own controls to the existing `#PanelUI-zen-gradient-generator` and
wraps three methods on `gZenThemePicker`, so Zen keeps owning the dots, the harmonies and the
saving, and Trance owns exactly the things it adds (ADR-031). With the pref off, the panel is
stock Zen's again, node for node.

**Deliverables**
- `TranceTheme` — lightness slider, gradient-angle knob (live only while the theme *is* a
  gradient), eight palettes, saved themes, exact hex entry, and an in-panel toast that names what
  each button just did
- `trance-theme.css` and the picker's tokens
- Ties `--trance-accent` to the chosen gradient — already true through `--zen-primary-color`, and
  now true of the lightness and palette controls too
- Investigation doc (`docs/trance/mods/better-zen-gradient-picker.md`) and ADR-031

**Acceptance:** theme changes apply without restart, without artifact, and without invalidating the
whole chrome stylesheet — every control writes through Zen's own `updateCurrentWorkspace`, which
already had that property. No upstream touchpoint added.

---

### Phase 9 — Extensions and first run ✅ *complete (2026-08-26)*

**Deliverables**
- `src/zen/trance/distribution/policies.json` — one file, all three platforms, installed by
  `FINAL_TARGET_FILES.distribution` in the first `moz.build` this tree has ever had. It carries the
  update policies the Linux AppImage used to carry alone, and the AppDir copy is deleted (ADR-032)
- `prefs/trance/extensions.yaml` — one pref, not two. `extensions.autoDisableScopes` was examined
  and not set: it governs sideloads, not policy installs, and setting it would only have weakened
  the sideload prompt (§9.2, ADR-032)
- `TranceFirstRun` — a panel, once, naming each of the seven and its state, with a retry that calls
  the policy engine's own `installAddonFromURL`. The extension list comes from
  `Services.policies.getActivePolicies()`, so `policies.json` stays the one owner of it
- Settings section, and "Show it again" for the panel
- Nothing configured on anyone else's behalf: no filter list, no Dark Reader theme, no SponsorBlock
  categories (§9.3)

One thing shipping a real policy broke, and it broke everything: Gecko ignores a local
`policies.json` under automation only on Nightly channels, so with `trance` as the channel every
mochitest in the tree started by dialling AMO and the harness killed the browser before a single
test ran. One pref in the mochitest profile — `toolkit.policies.perUserDir` — points the reader at a
directory nothing writes a policy into (ADR-032).

**Acceptance:** met. A fresh profile on a networked machine gets all seven, installed and enabled,
and the panel says so. Offline, the same panel says which ones failed and offers to try again — the
"visibly and recoverably" half — and a build whose `distribution/` folder never arrived is told
that, in as many words, instead of showing seven empty rows.

---

### Phase 10 — Picture-in-Picture ✅ *complete (2026-08-26); nothing was built*

Mod 13, and the third phase to ship by not writing code (ADR-033).

The investigation applied Phase 7's test and the mod passed both halves of it more clearly than
either of Phase 7's did. *Ownership*: every Trance stylesheet is loaded into `browser.xhtml`, and
the one exception is a user sheet aimed at `about:` pages — the PiP player is neither, so no Trance
rule names any element this mod touches and there is no second owner to remove. *Cost*: 88 lines of
CSS, no script, no timer, no observer, no blur, no infinite animation, in a window that exists only
while PiP is open.

**Deliverables**
- The mod added to `PREINSTALLED_MODS`, and with it a second install path in
  `scripts/trance-cosine.py`: this is the first mod Trance installs from the **Zen theme store**
  rather than the Sine store, which is a different shape — one folder of `zen-browser/theme-store`,
  with the empty `homepage` that tells Sine's updater where its updates come from
- Investigation doc (`docs/trance/mods/pimp-your-pip.md`) and ADR-033
- Mod-guard card moved `planned` → `shipped`

**Acceptance:** "no effect on PiP performance" is met by construction. "Survives Firefox's PiP
updates" is no longer Trance's to meet, and that is the honest outcome rather than a dodge: the
player's markup is not a stable API, a Trance rewrite would have carried the same breakage, and when
it breaks the player simply looks like Firefox's again.

---

### Phase 11 — Performance hardening *(in progress, 2026-08-26)*

**Deliverables**
- [x] `scripts/trance-perf.py` — Marionette-driven harness against a real profile (§12.2)
- [x] `src/zen/tests/trance/browser_trance_perf.js` — the budgets that do not need a real profile,
      plus the occlusion-wiring assertion the harness cannot reach (ADR-034)
- [x] Tier A: the defects confirmed by reading rather than by measuring (ADR-035)
- [x] Stored baseline — `docs/trance/perf-baseline.json`
- [ ] CI job on PRs touching `src/zen/trance/**` (needs Phase 12's matrix)
- [x] Tier B1 — the workspace cross-fade, moved onto the compositor and measured (ADR-038)
- [x] Tier B2 — occlusion on a translucent macOS window, answered (ADR-037)
- [ ] Tier B3–B6: the rest of the measurement-gated work, reported before anything lands

**The committed baseline.** Twelve of the thirteen rows carry a number. Dev build, no LTO/PGO, one
20-tab workload with the seven extensions installed — `docs/trance/perf-baseline.json`:

| Row | Measured | Budget | |
|---|---|---|---|
| Compositor surfaces, idle | 5 | ≤ 6 | pass |
| `backdrop-filter` surfaces | 0 | ≤ 3 | pass |
| MutationObserver callbacks per tab open | 0.1 | ≤ 2 | pass |
| Trance timers at idle | 0 | 0 | pass |
| Space cross-fade layers on the compositor | 2 of 2 | 2 | pass |
| Idle CPU, focused, 1 tab | 14.9% of one core | < 0.5% | **fail** |
| Idle CPU, minimised | 15.8% | ~0% | **fail** |
| Style flush on tab switch | 5.0 ms | < 2 ms | **fail** |
| Style flush on space switch | 13.0 ms | < 2 ms | **fail** |
| Total style time across the space switches | 225.0 ms | recorded | — |
| GPU frames while minimised | *unmeasured* | 0 | — |
| Resident, 1 tab / 20 tabs | 1153 MB / 1441 MB | recorded | — |

The three space rows are new with ADR-038, and were absent from the first run for a reason worth
naming: `PROBE_SWITCH_SPACES` asked `gZenWorkspaces` for `_workspaces()`, which does not exist, so
every run reported "fewer than two spaces in a fresh profile" and skipped — the single most relevant
workload in this phase, silently never executed. It now calls `getWorkspaces()` and creates the
second space a fresh profile lacks.

The idle-CPU and tab-switch rows moved a few points against the first run (13.0 → 14.9, 16.8 → 5.0).
That is run-to-run noise on this machine, not a change: nothing in Tier A or B1 touches either path.
It is also why the baseline is one whole run rather than the best row from several — a scorecard
stitched together from different browsers is not an observation of any of them.

Trance's own rows are green, and comfortably. Everything red is about the browser as a whole,
which is what §12.1 was always asking about.

Three things the first runs settled that guesswork had not:

- **Occlusion works** (ADR-037). Tier B2's premise is false — `isFullyOccluded` goes true whenever
  another window covers Trance, even while the window still has focus. The suspend path is live.
  The idle-CPU numbers therefore need a different explanation.
- **The idle CPU is diffuse, not a hot spot.** Per-process attribution shows no single offender:
  browser 1.4%, GPU 1.0%, extension 1.0%, and seven more between 0.7% and 0.8% each — including
  three `preallocated` content processes that should be doing nothing at all. A browser that never
  reaches quiescence is what the harness observed directly: the settle phase watched CPU decay from
  205% to ~6% over two minutes and never saw two consecutive samples under 5%.
- **Memory is dominated by three processes**: browser 388 MB, GPU 378 MB, extension 224 MB. The GPU
  process being the same size as the parent is the surprise, and it is not something the extension
  ablation will explain.

Two findings that were not in the plan and are worth naming:

- `#TabsToolbar` and `#toolbar-menubar` carry `will-change: opacity` from **Firefox's own**
  `browser-shared.css`, gated on `:root[customtitlebar]` — not from Zen. They are two of the five
  compositor surfaces counted above. The reset layer could take them back for zero touchpoints, but
  they exist for the titlebar fade, so that is a Tier B measurement question, not a confirmed defect.
- The tab-switch style flush was read as "probably the same mechanism as the workspace cross-fade".
  It is not. B1 landed, the space rows moved by a third, and the tab-switch row did not move with
  them — it varies between 5 ms and 17 ms run to run on its own. Two red rows that looked like one
  finding are two findings, and the second one is still open.

**Outstanding in the harness:** the profile contains no `Composite` markers on any thread even with
`MOZ_PROFILER_STARTUP_FILTERS` set, so the "GPU frames while minimised" row is reported as
*unmeasured* rather than as a zero. A green row with nothing behind it is the one outcome this
phase exists to prevent, so the row stays blank until the markers are captured.

**What the investigation closed before it started.** Two popular explanations for Zen's idle CPU do
not hold in this tree, and ruling them out cheaply was worth more than chasing them. All five
upstream `infinite` chrome animations are gated — `#zen-loading-progress-bar` is *removed from the
DOM* when idle (`ZenProgressBar.sys.mjs`), and `zen-back-and-forth-text` only runs under `&:hover`.
And `:has()` is not a problem: twelve occurrences upstream, eleven in Trance, all scoped to small
subtrees. Neither is the answer.

**Tier A, landed.** Three fixes, one upstream touchpoint between them — see ADR-035 for why four of
five needed none:
- Zen's four static `will-change` declarations, taken back in `trance-reset.css`. The reset layer
  existed for exactly this and was empty until now. Two of the four are deliberately left: one is
  correctly scoped to an animation, and one names only layout properties and is therefore inert.
- Zen's loading indicator, claimed and released with `TranceFeedback` on the *default* pref branch,
  refcounted across windows. Two bars animated on every page load before this — the §3.1 two-owners
  problem, reached from inside the project rather than from a mod.
- `ZenMediaController`'s 1 Hz position ticker, parked while the window is minimised or occluded.

**Two Tier A items were dropped on inspection, not deferred.** Compact mode's
`background-attachment: fixed !important` aligns the toolbar overlay's gradient to the window — a
visual requirement, and the repaint hazard `fixed` carries belongs to scrolling content, which a
chrome overlay is not. `zen.session-store.log` defaulting true is twenty-eight `console.debug` calls
on the startup path: microseconds, against a permanent rebase surface.

**Tier B1, landed (ADR-038).** The workspace cross-fade animated the `--zen-background-opacity`
custom property, which `zen-browser-ui.css` read back as `opacity` on two pseudo-elements. A custom
property cannot be compositor-animated in Gecko, so every frame was a main-thread restyle;
`opacity: var()` is not compositable either, so both window-sized layers repainted; each paints up
to four stacked gradients under `background-blend-mode: screen`; a 30 KB grain PNG sits on top; and
Motion falls back to its JS driver for custom properties, so the value was written from script per
frame on top of all of it. Five compounding costs on one interaction, and the strongest
mechanism-level match in the tree for the "~30 fps space switch on an M3" reports.

It now animates `opacity` on the pseudo-elements directly through `motion.animateMini`, Motion's
WAAPI-only entry point — the only one that takes `pseudoElement`, and the only one with no JS driver
to fall back to. The variable stays, because the swipe gesture and the theme picker write it
directly; the switch hands the layers back to it and cancels the animations when it ends. One
upstream touchpoint, and `zen-browser-ui.css` untouched. Medians of three runs a side, ten switches
each, same build, same harness:

| | before | after | |
|---|---|---|---|
| Total main-thread style time across the switches | 182.3 ms | 124.3 ms | **−32%** |
| Worst single style flush during a switch | 9.67 ms | 4.11 ms | **−57%** (budget < 2 ms: still red) |
| Cross-fade layers running on the compositor | 0 of 2 | **2 of 2** | |

The instrument was nearly wrong twice, which is worth recording as loudly as the result.
`getOMTAStyle` returns `""` under WebRender for an animation that is demonstrably compositing — it
would have reported the fix as a failure, and was only caught by running a plain element through it
as a control. And `Animation.isRunningOnCompositor` stays false in a mochitest window, because an
animation is not handed to the compositor until a painted frame has carried it, so that assertion
lives in the harness and the mochitest asserts the mechanism instead.

**Tier B2, closed by measurement (ADR-037).** Occlusion does fire on a translucent macOS window, so
the premise was false: `isFullyOccluded` goes true whenever another window covers Trance, even while
it still has focus, and `TranceScheduler`'s suspend path is live. A negative result, and it means
the idle-CPU numbers still need a different explanation.

**Tier B, outstanding — in priority order.**
3. Content-area clip and shadow on `.browserSidebarContainer`, which wraps every remote browser.
4. Static gradient composition: two window-sized layers under a screen blend, at rest.
5. Extension ablation — seven add-ons ship `normal_installed`, and that is the largest memory lever
   Trance actually controls. Report only; no defaults change without a decision.
6. A small, individually-measured Gecko pref pass. No Betterfox blob.

**Declined, with reasons, so they are not re-argued:** `ZenCompactMode`'s nine-site rAF chain (large,
permanent rebase cost, one interaction); lazy-loading the eighteen preloaded modules (declined on
*risk* — `nsZenPreloadedFeature` binds `init()` in its constructor, so deferring the import defers
the registration); replacing the vendored Motion library wholesale (item 1 above is the one slice
carrying most of the gain); `:has()` reduction (nothing to win); and the Speedometer gap, which is
SpiderMonkey versus V8 and not addressable in a fork that does not touch `js/src`.

**Acceptance:** all §12.1 budgets green or individually explained in `DECISIONS.md`; scorecard and
baseline committed. A red row with a recorded reason is a legitimate outcome. A green row with no
measurement behind it is not — which is the whole reason this phase exists.

---

### The settings pass *(2026-08-27)*

Not a phase. A batch of work that cuts across Phases 3 to 6 and belongs to none of them: fifteen
changes driven by using the browser rather than by a roadmap, recorded here so the next session can
tell which of them were decisions and which were defects.

**Removed.**
- The `content` region — a translucent backdrop for websites — with its two prefs, its attribute,
  its rule and the three `--trance-content-*` tokens (ADR-042). There are no surface regions left.

**Added.**
- **The empty-tab mark**: a picture over the content pane while the selected tab is empty, with a
  file picker, a size and an opacity. Same control as the background image; the settings page's
  picker is now one method over two prefs rather than two copies of one (ADR-042).
- **The active tab glow**, opt in, three-valued: `none`, the space's accent, or the tab's own
  favicon blurred past recognition behind it. Nebula's behaviour, reimplemented from its
  description — the mod is GPL-3.0 (§7.2). Drawn on the tab rather than on `.tab-background`,
  because Zen clips the latter to exactly the box the glow exists to escape.
- **The animation pack**: a tab arriving from 90% out of a blur, and the address bar settling down
  to its size — the same gesture with the scale the other side of 1. Both are Web Animations
  through `TranceMotion`, so both are nothing at motion level 0 without either knowing that motion
  levels exist.
- **The loading bar's geometry**: four edges rather than two, a length as a share of that edge, an
  inset from it, and a finish flourish. A full-width hairline flush against the window is the least
  legible version of a progress bar available.
- **Tab fills as tokens**: pinned, default, hover and selected, as a neutral veil at four strengths
  rather than a tint. `--trance-shadow-color` with them, which is a *light* edge on a light chrome
  and a shadow on a dark one.
- **The top of the sidebar**, hidden until reached for. `opacity` and `transform` rather than
  `display`, so that the pointer landing on a hidden button is still inside the strip that reveals
  them — which is the only part of this that is hard.

**Fixed.**
- The app-menu mark was drawn at a few pixels across. `about-logo.svg` is a 1024×1024 branding
  canvas with the mark inset inside it, so as a `list-style-image` the *canvas* was what got scaled
  into the icon box. It is a `mask-image` at `mask-size: contain` now, in `currentColor`, which also
  makes it follow the theme.
- The first-run panel's primary button read as disabled: it used `--trance-content-bg`, a page
  *backdrop* carrying the content region's alpha, as a label colour. `--trance-fg-on-accent` is the
  token that should always have existed.
- Toggling anything transparency-related left an open settings tab with the wrong background until
  restart. `#releaseTransparentBrowser` strips `transparent="true"` from live browsers and nothing
  put it back, because `tabbrowser` only reads the pref when it *creates* one.
- The settings search field was transparent over a transparent page, so the window showed through
  what was typed into it. It is a card now, in the same palette as every other card on the page.

**Changed.**
- The mod guard warns on *likelihood* as well as on the 23 mods it has read (ADR-043).
- Four browser defaults Trance disagrees with (ADR-044): the sidebar-and-toolbar layout, an
  always-floating address bar, search suggestions on, and history remembered. Three cost a
  touchpoint each and one did not, and §5.5 is the reason which is which.

---

### Phase 12 — Release infrastructure *(in progress, 2026-08-28)*

**Deliverables**
- [ ] CI build matrix (macOS arm64/x64, Linux x64/aarch64, Windows x64/arm64) modelled on
      `.github/workflows/`. Zen's workflows still reference `--brand release`/`twilight` and fail
- [ ] Signing (macOS notarisation, Windows Authenticode) — needs certificates; decision required
- [x] Update server / `updateHostname`, or explicitly disabled auto-update via policy — disabled,
      in `src/zen/trance/distribution/policies.json` (Phase 9)
- [ ] Release channel decision: single `trance` channel, or `release` + `twilight` equivalents
- [x] Public repo, README — `xslvrrr/Trance`. Screenshots still missing
- [x] A downloadable macOS arm64 build: the `0.1.0` prerelease, built locally rather than in CI

**The 0.1.0 build (2026-08-28).** `npm run package` on this machine, from the tree at `bf1a6900d`.
Dev build — no PGO, no LTO — ad-hoc/linker-signed only, so Gatekeeper rejects it until the user
clears the quarantine attribute. That is stated on the release page rather than worked around: a
build nobody can verify is one the user is vouching for personally.

surfer's AUS step writes a distribution URL of
`https://github.com/xslvrrr/Trance/releases/download/0.1.0/macos.mar`, which is why the tag is bare
`0.1.0` and not `v0.1.0`. No MAR is uploaded — updates are off by policy, and shipping the artefact
would advertise an update path that does not exist.

**Acceptance:** a downloadable, installable, self-updating (or explicitly non-updating) Trance
build on at least macOS arm64. *Met for macOS arm64 as of 0.1.0; the CI matrix, signing and the
channel decision are still open.*

---

### Phase 13 — Onboarding ✅ *complete (2026-08-27)*

*Taken out of order, ahead of Phase 12, at the user's request. The dependency runs the other way
round from the numbering: Phase 12 ships a build to other people, and the first thing another
person sees is this flow.*

**Deliverables**
- [x] `TranceOnboarding` — a ten-page first-run flow that **replaces** Zen's welcome rather than
      running before or after it. Two full-window takeovers cannot share a window (ADR-051)
- [x] Five Trance pages, ahead of Zen's: Zen feature set (stable/twilight), mod-manager channel
      (Cosine/Sine), processor (Apple Silicon/Intel), edgeless, and Zen Internet setup
- [x] Five Zen pages rebuilt against Zen's own `browser/zen-welcome.ftl` — import and default
      browser, search engine, essentials, workspace colours, finish — so they stay translated
- [x] `prefs/trance/onboarding.yaml`: `enabled`, `completed`, `onboarding.channel`,
      `mods.channel`, `perf.arch`
- [x] Touchpoint 23 — one `if` in `ZenStartup.#checkForWelcomePage`. Nothing else upstream
- [x] `TranceFirstRun` waits on whichever flow is actually running, not on Zen's specifically
- [x] Settings: a "First run" group with the three settings the flow asks about and a
      "Run it again" button, so none of the five answers is a one-time-only decision
- [x] `scripts/trance-env.sh` gains `TRANCE_ARCH`. `configs/macos/mozconfig` has always branched on
      `SURFER_COMPAT` and nothing has ever set it, so every build was arm64 whatever the machine
      was — the architecture page would otherwise have been asking a question the build could not
      honour
- [x] `browser_trance_onboarding.js` — nine tasks, the first of which is that turning the feature
      off mid-flow gives the window back

**Acceptance:** a fresh profile runs Trance's flow rather than Zen's; every answer is a pref that is
still reachable in Settings afterwards; turning the feature off restores Zen's welcome exactly;
and disabling it mid-flow leaves a whole browser window.

*Known gap: the five Trance pages are English. Trance has no locale pipeline of its own, and
building one for ten strings is a Phase 12 decision — see §16.*

---

## 14. Repository conventions

### 14.1 Directories owned by Trance

```
src/zen/trance/**          # all Trance code
prefs/trance/*.yaml        # all Trance prefs
configs/branding/trance/** # brand assets
docs/trance/**             # all Trance docs
scripts/trance-*.py        # Trance tooling
scripts/trance-env.sh      # toolchain and build-target pinning
docs/trance/brand/**       # brand *source* art, not shipped assets
```

`docs/trance/brand/` is deliberately not under `configs/branding/trance/`: surfer's branding patch
copies every non-`content` entry of that directory with `copyFileSync`, which throws on a
subdirectory, so source art there would break `npm run import` rather than be ignored (ADR-050).

Anything outside these is an upstream touchpoint and must be in `UPSTREAM-TOUCHPOINTS.md`.

### 14.2 Naming

| Thing | Convention | Example |
|---|---|---|
| Module files | `Trance<Feature>.mjs` | `TranceSurfaces.mjs` |
| CSS files | `trance-<feature>.css` | `trance-surfaces.css` |
| Custom properties | `--trance-<family>-<name>` | `--trance-surface-blur` |
| Prefs | `trance.<feature>.<setting>` | `trance.surface.blur.radius` |
| Custom elements | `<trance-*>` | `<trance-library>` |
| Chrome URLs | `chrome://browser/content/trance-components/…` | |
| | `chrome://browser/content/trance-styles/…` | |
| | `chrome://browser/content/trance-icons/…` | |
| Branches | `feat/trance-<feature>`, `fix/<short>`, `chore/<short>` | |

### 14.3 Commits

Conventional commits, matching Zen's own style where it helps:

```
feat(trance/surfaces): unify blur into a single per-region surface layer

Replaces the four independent backdrop-filter stacks inherited from
Transparent Zen, Compact Transparent Mode, Nebula and Nova UI with one
surface system driven by --trance-surface-* tokens.

Refs: TRANCE.md §3.3, §13 Phase 3
```

Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `ci`, `build`.
Scope: `trance/<feature>`, `brand`, `prefs`, `upstream`, `docs`.

### 14.4 Definition of done, per feature

- [ ] Investigation doc exists at `docs/trance/mods/<id>.md` (§8.2)
- [ ] Implemented under `src/zen/trance/`, extends `TranceFeature`
- [ ] Pref-gated; disabled state costs nothing (verified in profiler)
- [ ] Uses `TranceScheduler` and `TranceObserverHub` — no private timers or observers
- [ ] CSS uses only tokens; passes the stylelint rules; no `!important`
- [ ] Exposed in `about:preferences#trance`
- [ ] MPL header + attribution comment (§7.6)
- [ ] `npm run lint` and `npm run lc` clean
- [ ] §12.1 budgets still green
- [ ] `UPSTREAM-TOUCHPOINTS.md` updated if any upstream file changed
- [ ] `CREDITS.md` updated

---

## 15. Agent playbook — how to run a session

Read this before doing anything in a fresh session.

### 15.1 Orientation (always)

1. Read `TRANCE.md` (this file) — at minimum §2, §4, §6, §11, §13, §14.
2. `git log --oneline -15` and `git status` — where did the last session stop?
3. Check `docs/trance/DECISIONS.md` for anything that supersedes this file.
4. Identify the current phase from §13's checkboxes. **Do not skip ahead.**

### 15.2 Rules

- **Never edit files inside `engine/`.** Edit `src/`, then `npm run import`.
- **Never copy code from a GPL-3.0 or unlicensed mod** (§7). If in doubt, reimplement.
- **Never add an observer, timer, `backdrop-filter`, `!important`, or `infinite` animation**
  outside the sanctioned mechanisms (§6, §12.3).
- **Never widen the upstream diff surface** without a `DECISIONS.md` entry (§11.3).
- One phase per session where possible. Land it, verify acceptance criteria, commit.
- If a feature's investigation doc (§8.2) does not exist, write it before writing code.
- The user disables most sub-features of most mods. Default to **not** building a sub-feature;
  ask. Exceptions: Nebula, Zen Library.

### 15.3 When you finish

- Tick the boxes in §13 for what you completed.
- Append to `DECISIONS.md` anything a future session would otherwise re-litigate.
- Commit with a message that references the phase.
- State plainly what is done, what is partial, and what is blocked.

### 15.4 Things that will bite you

| Symptom | Cause |
|---|---|
| Change doesn't appear | Forgot `npm run import`, or edited in `engine/` |
| New file not found at its `chrome://` URL | Missing `jar.inc.mn` entry |
| Module never runs | Not listed in `ZenPreloadedScripts.js` |
| Pref missing at runtime | Forgot `npm run ffprefs`, or YAML shape is wrong |
| Build fails after adding a dir | Not added to the parent `moz.build` `DIRS` |
| `npm run lc` fails | Missing MPL header |
| mach errors on Python | Python 3.14 in `PATH`; Zen pins 3.11 |
| Rebase conflicts everywhere | Trance code leaked into upstream files — see §11.3 |

---

## 16. Open questions

Decide these with the user; record answers in `docs/trance/DECISIONS.md`.

1. **Repo hosting.** GitHub org/name for `origin`? Public from day one, or private until Phase 1
   branding is done? (Public + Zen branding = trademark problem — §7.4.)
2. ~~**Channels.** One `trance` channel, or `release` + a twilight-equivalent?~~
   **Answered (ADR-006):** one `trance` brand. A second channel is a cheap later addition.
3. **Updates.** Run an update server (`updateHostname`), use GitHub releases + a MAR feed, or
   disable auto-update and ship manual downloads?
   *Provisionally off (ADR-009). Must be decided for real in Phase 12.*
4. **Signing.** Apple Developer ID for notarisation? Windows code-signing cert? Without these,
   macOS and Windows installs need Gatekeeper/SmartScreen overrides.
5. **Zen's native mods system** — keep enabled, keep but point at a Trance store, or remove?
   (Current plan: keep, upstream-untouched, with reimplemented mods off by default.)
6. **Nebula fidelity.** How exact must the clean-room Nebula look be? Pixel-identical is both
   harder and legally riskier than "the same design language". Recommend the latter.
7. **Relicensing outreach.** Should we contact the authors of the 12 unlicensed mods
   (esp. Zen Library, Nova UI, New Icons, Live Calendar, Transparent Zen) to request MIT/MPL?
   It would let us adapt instead of reimplement and is a good-faith gesture regardless.
8. ~~**Render.js scope.** What does the user actually use it for?~~
   **Answered (ADR-021):** the investigation found all five of its behaviours duplicate owners
   Trance has already assigned. Verdict changed to `DEFER`; it earns no phase slot. Reopens only
   if the user names a specific behaviour they use, in which case it is built against the owner
   it belongs to rather than ported (`docs/trance/mods/render-js.md` §8).
9. **Platform priority.** macOS arm64 only for v1.0, or Linux too?
10. **Telemetry.** Zen inherits Firefox telemetry prefs. Trance default: off? (Recommend: off,
    and say so in the README.)
11. **Localisation.** Trance ships no strings of its own in any language but English. The
    onboarding flow made this visible for the first time — its five Zen-derived pages are
    translated because they reuse `browser/zen-welcome.ftl`, and its five Trance pages are not
    (ADR-051). The settings pane, the first-run panel and the mod guard have the same gap and
    always have. Does Trance grow a `.ftl` of its own and a locale pipeline in Phase 12, or ship
    English-only and say so?

---

*Last updated: 2026-08-26 — Phases 2 through 10 complete. Fork at `ed0a6fd`.

Phase 3's surface layer was **reworked** the same day it was tested: frosting is now translucency
of Zen's own background layers rather than a tint Trance paints, which is what made it a black box
(ADR-019), and a fourth, unblurred `content` region was added. Phase 4 shipped two defects that
this pass fixed — the sticky pinned section painted a dark band under the space name even with no
pins, and the collapsed rail's spacing prefs replaced Zen's padding instead of adding to it.

Phase 5 landed the chrome-furniture and icon cluster: two icon packs (Fluent by default, Zen as
the alternative), ~267 assignments generated from an MIT source with every `!important` stripped,
and seven mods' worth of behaviour reduced to six preferences. Phase 6 landed motion and feedback,
where two of the four mods correctly shipped nothing (ADR-021) and the loading bar was rebuilt on
`nsIWebProgressListener` rather than ported — the original is four of §3's eight failure modes in
ninety lines of CSS.

`npm run lint`, `mach lint -l stylelint zen/trance` and the Trance half of `npm run lc` are clean;
the stylelint plugin was re-verified to actually reject a planted `!important`. The browser
mochitests were **run**, not merely written: 196 assertions across five files, all passing.

Running them found that four of the older ones had never worked. Three read `document.styleSheets`
looking for a Trance sheet, which cannot find one — Trance loads its sheets through
`nsIDOMWindowUtils`, so they are in the style set but not in the document's sheet list; those
assertions had been silently throwing rather than checking anything. The fourth asserted the
observer hub returns to *zero* subscriptions, which stopped being true the moment Phase 4 added a
permanent one. All four now assert what they meant to.

Phase 7 landed by **not building anything**: both of its mods had their verdict changed to
PREINSTALL by their investigations (ADR-030). Neither owns an element any Trance feature owns, so a
rewrite would have removed no conflict, and both cost audits came back at or under what the rewrite
was going to be held to — Zen Library holds no interval, no `MutationObserver` and no infinite
animation across 7,500 lines, and Live Calendar's one always-armed timer is the 60-second refresh
that was this phase's own acceptance criterion. Four mods are preinstalled now, on two admissible
arguments rather than one.

Phase 8 landed the theme picker as `TranceTheme`, and it extends Zen's panel rather than replacing
it (ADR-031): five method wraps on `gZenThemePicker` and a row of controls appended to the panel
Zen already ships. Of the seven behaviours the mod contributes, six are additions and one — a
translucency slider — was deliberately not built, because Zen's picker already has that slider and
a second one is the two-owners problem. The phase added **no upstream touchpoint**; the list is
still at 14.

Phase 9 gave Trance its first `moz.build`. The seven extensions are installed by one
`policies.json` on all three platforms rather than by the Linux AppImage's copy, which is deleted
(ADR-032) — and two of §9's own instructions turned out to be wrong when read against the engine:
`extensions.autoDisableScopes` governs sideloads and not policy installs, so it is not set, and
`normal_installed` permits disabling but not uninstalling. `TranceFirstRun` reports what the policy
actually did, takes its list from the policy rather than from a copy of it, and retries through the
policy engine's own function.

Phase 10 shipped nothing again, and for a third distinct reason: Pimp your PiP is 88 lines of CSS
over a window no Trance stylesheet reaches, so there was neither a conflict to remove nor a cost to
cut (ADR-033). Five of the twenty-three mods now ship as their authors publish them, and the
provisioner learned to install from the Zen theme store to do it.

Outstanding: original icon artwork (ADR-008, deliberately deferred by the user); deleting
`xslvrrr/trance-browser`, which needs a `delete_repo` OAuth scope the CLI does not have; visual
sign-off on Phases 3 to 9, which no test can assert; the 115 pre-existing upstream `lc` failures,
which must be fixed or excluded before `lc` can be a CI gate; and five mochitest assertions that
fail as of 2026-08-26 and predate Phase 9 — a flaky burst-scatter check in the feedback suite, the
settings pane's search-strip assertion, the surfaces suite's edgeless gradient comparison, and two
translucency-range assertions in the theme suite. 612 of 617 pass.
Next: Phase 11 (performance hardening).*
