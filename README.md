<!--
   - This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/.
   -->

# Trance

**Trance is an opinionated fork of [Zen Browser](https://github.com/zen-browser/desktop) that
ships, out of the box, the unified equivalent of a heavily-modded Zen setup — without the mod
loader or the conflicts, with invisible-window work suspended instead of left running.**

*Trance* = **Tran**sparency + the calm of *Zen*. It is not a theme pack. It is a browser.

> **Status: pre-alpha.** See [`TRANCE.md`](./TRANCE.md) for the full plan and the phase Trance is
> currently on.

## Download

[**Trance 0.2.0 — macOS, Apple Silicon**](https://github.com/xslvrrr/Trance/releases/tag/0.2.0)

The [0.2.0 release notes](./docs/trance/release-0.2.0.md) cover the theme controls, the
performance defaults, the window activity controller and the import-integrity work.

A development build: no PGO, no LTO, **not signed and not notarised**. Gatekeeper will refuse to
open it until you clear the quarantine attribute yourself:

```bash
xattr -dr com.apple.quarantine /Applications/Trance.app
```

No Intel, Linux or Windows builds yet, and no auto-update — updates are disabled by policy and new
builds appear on the releases page. Both are Phase 12 (`TRANCE.md` §13).

## Why

A Zen install running 23 mods plus custom CSS produces two specific symptoms: visual artifacts on
state transitions, and idle power draw several times higher than stock. Neither is a bug in any
one mod — both are structural:

- every mod re-declares the same `--zen-*` custom properties and fights the cascade with
  `!important`, so the winner changes between sessions and between state transitions;
- seven mods each install their own `MutationObserver` on the tab strip, so one DOM change fans
  out to N callbacks, each doing its own `querySelectorAll` and forced reflow;
- four mods stack `backdrop-filter` over overlapping regions, so a static UI costs four full
  blur passes per frame at display refresh rate and the window server can never skip an occluded
  window;
- infinite CSS animations in chrome keep Gecko's refresh driver ticking forever — chrome
  animations are not throttled the way content animations are;
- several mods hold their own `setInterval`, which keeps the CPU out of deep idle.

Trance rebuilds those features as one system instead of patching around them: one design-token
layer, one observer hub, one scheduler, one blur budget, one settings surface, and one activity
controller per window.

## Design rules

These are enforced, not aspirational:

| Rule | Why |
|---|---|
| Opaque ordinary web content by default | Avoidable alpha composition is not the baseline |
| No full-window filters in the default configuration | Window-sized filters cost the whole content area |
| Saturation is 100%; no runtime image blur | The default path does not add a window-sized filter |
| Interaction motion changes opacity or transform only | Gestures stay on the compositor where possible |
| One token layer; `!important` banned in Trance code | Cascade determinism |
| One `MutationObserver` / `ResizeObserver` / `IntersectionObserver` per window | No observer storms |
| At most one `backdrop-filter` surface per window region | GPU idles when the UI is static |
| No `infinite` CSS animations; all looping work goes through the scheduler | Refresh driver can idle |
| One activity controller per window; invisible work suspends | Occluded and minimised windows stop periodic work |
| No private timers; clocks align to wall-clock boundaries | Deep CPU idle on Apple Silicon |
| A pref-disabled feature loads no stylesheet, registers no listener, adds no DOM | Off means free |

Full rationale and the measured budgets are in [`TRANCE.md`](./TRANCE.md) §3 and §12.

## Building

Trance builds the same way Zen does, through [`@zen-browser/surfer`](https://github.com/zen-browser/surfer).
The toolchain is pinned: Node 22 (`.nvmrc`), Python 3.11 (`.python-version`), Rust 1.94.1
(`.rust-toolchain`), plus GNU tar.

```bash
brew install python@3.11 gnu-tar     # macOS
nvm install
rustup toolchain install 1.94.1

source scripts/trance-env.sh          # pins the toolchain and the surfer brand for this shell
npm install
npm run init                          # download + import + bootstrap  (30–90 min)
npm run build                         # full build (1–4 h the first time)
npm start
```

Day-to-day, once the first build is done:

```bash
npm run import && npm run build:ui && npm start   # JS/CSS changes — seconds
npm run ffprefs                                   # after editing prefs/**/*.yaml
npm run lint                                      # Trance lint must be clean before committing
npm run lc                                        # licence headers and provenance
```

`npm run lc` currently fails on 524 Zen/Firefox-inherited files: the
`src/zen/tests/mochitests/**` suites copied from Firefox, the
`src/zen/@types/lib.gecko.*.d.ts` stubs, and binary assets outside surfer's ignore list. No
Trance-owned file is among them; a new path under `src/zen/trance/` is the signal to investigate.

`engine/` is a generated Firefox tree and is gitignored. **Never edit it** — edit `src/`, then
`npm run import`.

## Layout

| Path | Contents |
|---|---|
| `src/zen/trance/` | All Trance code |
| `prefs/trance/*.yaml` | All Trance prefs, under the `trance.*` namespace |
| `configs/branding/trance/` | Brand assets |
| `docs/trance/` | Plan, decision log, upstream touchpoint map, per-mod investigations |
| `src/zen/`, `src/browser/`, … | Zen and Firefox sources — modified only where marked `>>> TRANCE` |

## Relationship to Zen

Trance tracks Zen's `dev` branch and rebases onto it; it is never merged back upstream. Zen's own
native mods system stays intact and functional.

Trance reimplements mod *behaviour* in Trance-owned source. It does not vendor or load
third-party mod CSS/JS: two of the mods that inspired it are GPL-3.0 and twelve carry no license
at all, so copying is off the table regardless of the technical argument. Original authors are
credited in [`docs/trance/CREDITS.md`](./docs/trance/CREDITS.md).

## Licensing and branding

Trance is MPL-2.0, like Zen and Firefox — see [`LICENSE`](./LICENSE).

Zen's *code* is MPL-2.0; Zen's *name, logo, and wordmark* are not licensed for use by forks.
The icon set currently in `configs/branding/trance/` is still Zen's, used as a local development
placeholder. **It must be replaced with original artwork before any public build ships.**

## Telemetry

Off. Trance inherits Firefox's telemetry prefs with reporting disabled at build time
(`MOZ_TELEMETRY_REPORTING`, `MOZ_DATA_REPORTING`).

## Credits

Trance exists because of [Zen Browser](https://github.com/zen-browser/desktop) and the authors of
the mods that shaped the experience it reimplements. See
[`docs/trance/CREDITS.md`](./docs/trance/CREDITS.md) and
[`docs/trance/THIRD-PARTY.md`](./docs/trance/THIRD-PARTY.md).
