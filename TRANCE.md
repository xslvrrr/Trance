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

- Not a mod manager. Trance does **not** ship or replace Sine/Cosine.
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
| Upstream fetch depth | `--depth=200` (deepen with `git fetch upstream --deepen=500` if needed) |
| `origin` remote | **Not yet configured** — see Phase 0 tasks |

> ⚠️ The local clone had no `.git`. It was a plain source drop. Git history was reconstructed by
> fetching `upstream/dev` and pointing `main` at the matching commit. This is correct and verified,
> but note that **`origin` does not exist yet** — nothing is pushed anywhere.

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

- `npm install` has not run (`node_modules/` absent)
- `npm run init` (download + import + bootstrap) has not run — no `engine/` directory
- No Trance branding, no Trance code, no `trance.*` prefs
- No CI, no signing, no update server

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

**Design rule:** one Trance icon set, shipped as real files in the chrome jar, referenced by
`chrome://browser/skin/trance/icons/*.svg`.

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
├── icons/                      # one canonical SVG set
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
Nebula and Zen Folder Tree Connectors are reimplemented clean-room.

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

Machine-readable version: `docs/trance/mods-inventory.json`.

| # | Mod | Ver | Store | Source | License | Verdict | Phase |
|---|---|---|---|---|---|---|---|
| 1 | Advanced Tab Groups | 3.5.1 | Sine | `Vertex-Mods/Advanced-Tab-Groups` | MIT | ADAPT | 4 |
| 2 | Better New Tab Button | 1.0.6 | neither | `themaster5209/zen-better-new-tab-button` | none | NATIVE | 5 |
| 3 | BetterZenGradientPicker | 1.7 | Sine | `JustAdumbPrsn/BetterZenGradientPicker` | none | NATIVE | 8 |
| 4 | Context Menu Icons | 2.7.4.3 | Sine | `Starry-AXQG/Context-Menu-Icons` | MIT | ADAPT | 5 |
| 5 | Customize Collapsed Sidebar | 1.0.5 | Sine | `Ciuriya/zen-themes` | none | NATIVE | 4 |
| 6 | Deta Loading Bar | 2.0.4 | Sine | `rasyidrafi/zen-deta-loading-bar` | MIT | ADAPT | 6 |
| 7 | Floating Status Bar | 1.0.0 | Zen | `AmirhBeigi/zen-floating-statusbar` | none | NATIVE | 6 |
| 8 | Hide Extension Name | 1.0.0 | Zen | `ch4og/zenbrowser-themes` | MIT | ADAPT | 5 |
| 9 | Live Calendar | 1.0.0 | Sine | `Vertex-Mods/Zen-Live-Calendar` | none | NATIVE | 7 |
| 10 | **Nebula** | 3.3.3 | Sine | `JustADumbPrsn/Zen-Nebula` | **GPL-3.0** | NATIVE (clean-room) | 3 |
| 11 | New Icons | 1.1 → 1.4 | Sine | `qumeqa/zen-icons` | none | NATIVE | 5 |
| 12 | Nova UI | 2.2 | Sine | `qumeqa/nova` | none | NATIVE | 5 |
| 13 | Pimp your PiP | 1.0.0 | Zen | store-hosted, no homepage | unknown | NATIVE | 10 |
| 14 | Render.js | 1.0 | Sine | `SehajveerSingh2005/render.js` | none | NATIVE | 6 |
| 15 | SuperPins | 1.7.2 | both | `CosmoCreeper/Zen-Themes/SuperPins` | MIT | ADAPT | 4 |
| 16 | Tab Closing Bubble Animation | 1.3 | Sine | `Zylaah/bubble-pop-deleting` | none | NATIVE | 6 |
| 17 | **Transparent Zen** | 1.17.16 | Zen | `sameerasw/zen-themes/TransparentZen` | none | NATIVE | 3 |
| 18 | Unloaded Tabs | 1.0 | Sine | `qumeqa/unloaded-tabs` | none | NATIVE | 4 |
| 19 | Zen Compact Transparent Mode | 2.0.0 | Sine | `rasyidrafi/zen-compact-transparent-mode` | Apache-2.0 | ADAPT | 3 |
| 20 | Zen Context Menu | 3.1 | Zen | `KiKaraage/ZenMods` | MIT | ADAPT | 5 |
| 21 | Zen Custom URL Bar | 2.0.3 | Sine | `rasyidrafi/zen-custom-urlbar` | Apache-2.0 | ADAPT | 5 |
| 22 | Zen Folder Tree Connectors | 2.1 | Sine | `JustAdumbPrsn/ZenFolderTreeConnectors` | **GPL-3.0** | NATIVE (clean-room) | 4 |
| 23 | **Zen Library** | 1.0.0 | Sine | `12th-devs/Zen-Library` | none | NATIVE | 7 |

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
strip that owns pinned tabs, groups, folder connector lines, collapsed-state layout, and the
unloaded-tab visual state.

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
Zen Library (23) and Live Calendar (9) are real applications, not restyles. They get their own
phases and their own custom elements.

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
- `normal_installed` = installed automatically, **user can disable or remove it**. (`force_installed`
  would lock them in — rejected; this is a browser for a person, not a fleet.)
- Extensions auto-update from AMO like any other add-on.
- No redistribution of third-party binaries → no licensing entanglement.
- Requires network on first run. Ship a first-run panel that reports install status and offers a
  retry, so a failed install is visible rather than silent.

`policies.json` locations per platform:
- macOS: `Trance.app/Contents/Resources/distribution/policies.json`
- Linux: `<install>/distribution/policies.json`
- Windows: `<install>\distribution\policies.json`

The existing `build/AppDir/distribution/policies.json` already carries update policies for Linux —
merge into it, do not create a second file.

### 9.2 Companion prefs (`prefs/trance/extensions.yaml`)

```yaml
- name: extensions.autoDisableScopes
  value: 0                      # do not auto-disable policy-installed add-ons
- name: extensions.postDownloadThirdPartyPrompt
  value: false
```

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

# Pin the toolchain
nvm install && nvm use            # reads .nvmrc → Node 22
rustup toolchain install 1.94.1   # .rust-toolchain
# Python 3.11 required — install via pyenv/mise; 3.14 is NOT supported by mach

npm install
npm run init                      # download + import + bootstrap  (LONG: 30–90 min)
npm run build                     # full build (LONG: 1–4 h on M-series, first time)
npm start                         # launch
```

Expect `engine/` to reach ~40 GB with an objdir. Keep 60 GB free.

### 10.2 Day-to-day loop

| You changed | Run |
|---|---|
| Trance CSS / JS / XHTML under `src/zen/` | `npm run import && npm run build:ui && npm start` |
| `prefs/**/*.yaml` | `npm run ffprefs && npm run build:ui` |
| `jar.inc.mn`, `moz.build`, manifests | `npm run import && npm run build` |
| C++ (`src/zen/**/*.cpp`) | `npm run import && npm run build` |
| Firefox patches (`src/**/*.patch`) | `npm run import && npm run build` |

`npm run build:ui` is the fast path — use it constantly. Full builds are for structural changes only.

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

| Metric | Budget | How to measure |
|---|---|---|
| Chrome compositor layers, idle | ≤ 6 | `layers.draw-borders=true`, count |
| `backdrop-filter` surfaces, per window | ≤ 3 (sidebar, toolbar, overlay) — never nested | Grep `trance-surfaces.css`; visual check |
| Idle CPU, 1 tab, focused, no media | < 0.5% | `powermetrics`, 30 s sample |
| Idle CPU, window occluded | ~0% | `powermetrics` with window covered |
| GPU frames while occluded | 0 | Profiler `Composite` markers |
| Style flush on tab switch | < 2 ms | Profiler `Styles` marker |
| MutationObserver callbacks per tab open | ≤ 2 | Instrument `TranceObserverHub` under `trance.debug` |
| Active timers at idle | 0 from Trance | `about:performance`, profiler timer markers |
| Cold start delta vs stock Zen | < 100 ms | `MOZ_LOG` startup timeline / `about:startup` |

### 12.2 Regression harness (Phase 11 deliverable)

`scripts/trance-perf.py`:
- Launches a fresh profile build with a scripted workload (open 20 tabs, switch spaces 10×,
  resize, idle 60 s, occlude 60 s)
- Captures a Gecko profile + `powermetrics` output
- Emits a JSON scorecard against §12.1 and diffs against a stored baseline
- Runs in CI on every PR touching `src/zen/trance/**`

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

---

### Phase 0 — Fork initialisation ⏳ *in progress*

**Deliverables**
- [x] Git repository initialised, `main` at `upstream/dev` HEAD `ed0a6fd`, verified clean tree
- [x] `upstream` remote configured
- [x] `TRANCE.md`, `CLAUDE.md`, `docs/trance/` scaffolding
- [ ] `origin` remote created and pushed (needs a decision: GitHub org/repo name, public/private)
- [ ] Toolchain pinned locally (Node 22, Python 3.11, Rust 1.94.1)
- [ ] `npm install && npm run init && npm run build` → a launching stock-Zen build
- [ ] `docs/trance/UPSTREAM-TOUCHPOINTS.md`, `DECISIONS.md`, `CREDITS.md`, `THIRD-PARTY.md` created

**Acceptance:** `npm start` launches an unmodified Zen build from this tree.

---

### Phase 1 — Trance identity

**Deliverables**
- `configs/branding/trance/` — full asset set (see §5.6 for the required file list)
- `surfer.json`: `name: "Trance"`, `vendor`, `appId: "trance"`, `binaryName: "trance"`,
  `brands.trance`, `updateHostname`
- Remove/replace `zen-browser.app` injection URL in `prefs/zen/mods.yaml`
- `about:` page art, window title, macOS bundle identifier
- `README.md` rewritten for Trance; keep `LICENSE` (MPL-2.0) unchanged

**Acceptance:** build shows Trance branding everywhere; no Zen wordmark or logo ships;
profile directory is Trance-specific; a fresh profile is created on first run.

**⚠️ One-way door:** `appId` change orphans any existing profile. Do it once, here.

---

### Phase 2 — Foundation layer

**Deliverables** (§6 in full)
- `src/zen/trance/core/` — `TranceTokens`, `TranceScheduler`, `TranceObserverHub`,
  `TranceFeature`, `TranceMotion`, `TranceIcons`, `TranceLog`
- `src/zen/trance/styles/trance-tokens.css`, `trance-reset.css`, `trance-motion.css`,
  `trance.css` entry point
- `prefs/trance/core.yaml` — `trance.enabled`, `trance.motion.level`, `trance.debug`
- `about:preferences#trance` shell with zero features listed
- stylelint plugin enforcing the §6.2 rules; wired into `npm run lint`
- Wiring into `moz.build`, `jar.inc.mn`, `ZenPreloadedScripts.js`, `zen-theme.css`

**Acceptance:**
- Build green; `npm run lint` clean; lint rejects a deliberately-added `!important`
- With `trance.enabled=false`, zero Trance stylesheets loaded, zero observers, byte-identical
  behaviour to stock Zen
- `TranceScheduler` demonstrably stops on window blur (verify in profiler)

---

### Phase 3 — Surfaces: transparency, blur, Nebula look

Merges mods 10, 17, 19, and Nova UI's chrome treatment (12).

**Deliverables**
- `trance-surfaces.css` — the only file with `backdrop-filter`
- `TranceSurfaces.mjs` — occlusion/focus-aware blur enable/disable, region registry
- Nebula-equivalent visual language (clean-room), driven entirely by tokens
- Presets: `trance.surface.preset` ∈ {`nebula`, `compact`, `flat`, `custom`}
- Integration with Zen's gradient/theme engine (`zenThemeModifier.js`, `zen.theme.*` prefs)
- Settings: blur radius, surface alpha, tint, per-region enable

**Acceptance:** ≤ 3 blur surfaces, never nested; occluded window → 0 GPU frames;
no visual artifact across space switch, tab switch, window resize, fullscreen toggle,
light/dark switch.

---

### Phase 4 — Sidebar and tabs

Merges mods 1, 5, 15, 18, 22.

**Deliverables**
- `TranceTabStrip` — one owner for tab-strip rendering, extending Zen's `ZenFolders` /
  `ZenPinnedTabManager` rather than shadowing them
- SuperPins-equivalent pinned-tab behaviour
- Advanced-Tab-Groups-equivalent grouping (MIT — may adapt with attribution)
- Folder tree connector lines (clean-room; GPL source)
- Collapsed-sidebar customisation
- Unloaded-tab visual state
- Prefs + settings section

**Acceptance:** one observer subscription for the whole tab strip; ≤ 2 observer callbacks per tab
open; opening 20 tabs shows no style-flush regression against the Phase 2 baseline; drag-and-drop,
folders, spaces, split view all still work.

---

### Phase 5 — Chrome furniture and icons

Merges mods 2, 4, 8, 11, 12, 20, 21.

**Deliverables**
- One Trance SVG icon set at `chrome://browser/skin/trance/icons/`
- Context-menu icons (adapt MIT sources 4 + 20)
- New Tab button treatment; urlbar restyle; extension-name hiding
- `TranceChrome.mjs` with one pref per sub-feature

**Acceptance:** no duplicate glyphs; no data-URI icons in CSS; every sub-feature independently
toggleable with zero residual cost when off.

---

### Phase 6 — Motion and feedback

Merges mods 6, 7, 14, 16.

**Deliverables**
- Loading bar (adapt MIT source 6), driven by `TranceScheduler`
- Tab-closing bubble animation (clean-room)
- Floating status bar (clean-room)
- Render.js-equivalent effect (clean-room) — scope to be decided in its investigation doc
- All keyframes in `trance-motion.css`; all respect `trance.motion.level` and
  `prefers-reduced-motion`

**Acceptance:** zero `infinite` animations; zero Trance timers at idle; motion level 0 disables
all of it with no layout shift.

---

### Phase 7 — Zen Library and Live Calendar

Mods 23 and 9. Both clean-room, both ship in full (Library is non-negotiable).

**Deliverables**
- `TranceLibrary` — custom element + data layer + its own settings section
- `TranceCalendar` — `onWallClock`-driven, one wakeup per minute maximum
- Investigation docs first (`docs/trance/mods/zen-library.md`, `live-calendar.md`)

**Acceptance:** feature parity with the originals as documented in the investigation docs;
calendar costs ≤ 1 timer wakeup/minute; library adds < 20 ms to startup when enabled and 0 when
disabled.

---

### Phase 8 — Theming and gradient picker

Mod 3, plus Trance's own colour system.

**Deliverables**
- Enhanced gradient picker (clean-room) built on Zen's existing gradient engine
- Custom colour support, presets, export/import of a Trance theme
- Ties `--trance-accent` to the chosen gradient

**Acceptance:** theme changes apply without restart, without artifact, and without invalidating
the whole chrome stylesheet.

---

### Phase 9 — Extensions and first run

**Deliverables**
- `policies.json` per §9, on all three platforms
- `prefs/trance/extensions.yaml`
- First-run panel: reports extension install status, offers retry, explains that Trance's
  built-ins replace the corresponding Zen/Sine mods
- Sensible default extension configuration only where it is Trance-specific (nothing for uBO)

**Acceptance:** fresh profile on a networked machine → all 7 extensions present and enabled;
offline first run degrades visibly and recoverably, not silently.

---

### Phase 10 — Picture-in-Picture

Mod 13, clean-room.

**Acceptance:** PiP window restyle survives Firefox's PiP updates; no effect on PiP performance.

---

### Phase 11 — Performance hardening

**Deliverables**
- `scripts/trance-perf.py` harness (§12.2) + stored baseline
- CI job running it on PRs touching `src/zen/trance/**`
- Fix every §12.1 budget violation found

**Acceptance:** all §12.1 budgets green; scorecard committed.

---

### Phase 12 — Release infrastructure

**Deliverables**
- CI build matrix (macOS arm64/x64, Linux x64/aarch64, Windows x64/arm64) modelled on
  `.github/workflows/`
- Signing (macOS notarisation, Windows Authenticode) — needs certificates; decision required
- Update server / `updateHostname`, or explicitly disabled auto-update via policy
- Release channel decision: single `trance` channel, or `release` + `twilight` equivalents
- Public repo, README, screenshots, license/attribution pages

**Acceptance:** a downloadable, installable, self-updating (or explicitly non-updating) Trance
build on at least macOS arm64.

---

## 14. Repository conventions

### 14.1 Directories owned by Trance

```
src/zen/trance/**          # all Trance code
prefs/trance/*.yaml        # all Trance prefs
configs/branding/trance/** # brand assets
docs/trance/**             # all Trance docs
scripts/trance-*.py        # Trance tooling
```

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
| | `chrome://browser/skin/trance/…` | |
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
2. **Channels.** One `trance` channel, or `release` + a twilight-equivalent?
3. **Updates.** Run an update server (`updateHostname`), use GitHub releases + a MAR feed, or
   disable auto-update and ship manual downloads?
4. **Signing.** Apple Developer ID for notarisation? Windows code-signing cert? Without these,
   macOS and Windows installs need Gatekeeper/SmartScreen overrides.
5. **Zen's native mods system** — keep enabled, keep but point at a Trance store, or remove?
   (Current plan: keep, upstream-untouched, with reimplemented mods off by default.)
6. **Nebula fidelity.** How exact must the clean-room Nebula look be? Pixel-identical is both
   harder and legally riskier than "the same design language". Recommend the latter.
7. **Relicensing outreach.** Should we contact the authors of the 12 unlicensed mods
   (esp. Zen Library, Nova UI, New Icons, Live Calendar, Transparent Zen) to request MIT/MPL?
   It would let us adapt instead of reimplement and is a good-faith gesture regardless.
8. **Render.js scope.** What does the user actually use it for? Its purpose is unclear from the
   name and it drives a frame loop — needs the §8.2 investigation before it earns a phase slot.
9. **Platform priority.** macOS arm64 only for v1.0, or Linux too?
10. **Telemetry.** Zen inherits Firefox telemetry prefs. Trance default: off? (Recommend: off,
    and say so in the README.)

---

*Last updated: 2026-08-24 — Phase 0, fork initialised at `ed0a6fd`.*
