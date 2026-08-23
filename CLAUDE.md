# Trance — agent instructions

**Read `TRANCE.md` in full before doing anything.** It is the project's master plan.
This file is only the short version of the rules that must never be broken.

## What this repo is

A fork of [Zen Browser](https://github.com/zen-browser/desktop) (`upstream/dev`, fork point
`ed0a6fd`, Zen 1.21.15b / Firefox 154.0) that natively reimplements a curated set of Zen/Sine
mods as one coherent, pref-gated, power-efficient browser.

## Hard rules

1. **Never edit anything inside `engine/`.** It is generated. Edit `src/`, then `npm run import`.
2. **All Trance code lives in `src/zen/trance/`**, prefs in `prefs/trance/*.yaml`,
   docs in `docs/trance/`, brand assets in `configs/branding/trance/`.
   Editing any other file is an "upstream touchpoint" and must be recorded in
   `docs/trance/UPSTREAM-TOUCHPOINTS.md` with `// >>> TRANCE` / `// <<< TRANCE` markers.
3. **Never copy code from a GPL-3.0 or unlicensed mod.** See `TRANCE.md` §7.
   Nebula, Zen Folder Tree Connectors → GPL-3.0. Twelve others have no license at all.
   Those are clean-room reimplementations only.
4. **No private observers, timers, `backdrop-filter`, `!important`, or `infinite` animations.**
   Use `TranceObserverHub`, `TranceScheduler`, `trance-surfaces.css`, and tokens.
   These rules exist to fix the exact bugs this project was created to fix (`TRANCE.md` §3).
5. **A pref-disabled feature must cost zero runtime work** — no stylesheet, no listener, no DOM.
6. **Follow the phase order** in `TRANCE.md` §13. Do not skip ahead.
7. Before implementing any mod's features, write its investigation doc at
   `docs/trance/mods/<id>.md` (`TRANCE.md` §8.2).

## Build commands

```bash
npm run import && npm run build:ui && npm start   # fast loop for JS/CSS changes
npm run ffprefs                                   # after editing prefs/**/*.yaml
npm run import && npm run build                   # after moz.build/jar/manifest/C++ changes
npm run lint && npm run lc                        # must be clean before committing
```

Toolchain is pinned: Node 22 (`.nvmrc`), Python 3.11 (`.python-version`), Rust 1.94.1.
This machine currently has Node 24 / Python 3.14 / Rust 1.94.0 — pin before building.

## Upstream sync

`git fetch upstream dev && git rebase upstream/dev`. `main` is rebased, never merged.
Keep the touchpoint list under ~15 files.

## Commits

Conventional commits, scope `trance/<feature>`. Reference the relevant `TRANCE.md` section.
