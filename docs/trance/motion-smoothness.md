# Why animations do not feel as smooth as a Chromium browser

**Date:** 2026-09-04
**Machine:** MacBook Pro, Apple silicon, macOS 27.0 (26A5388g), built-in Liquid Retina XDR
(ProMotion, 3024×1964 @2×, 120 Hz)
**Build:** `engine/obj-aarch64-apple-darwin/dist/Trance.app`, Firefox 155 base, branch
`codex/zen-155-phase0`
**Harness:** `scripts/trance-motion-bench.py` (added by this investigation)

The complaint this document answers is the most common one made about any Gecko-based browser and
the least falsifiable: *animations do not look as smooth as they do in Chrome*. It is usually
answered with a guess about vsync. The answer here is measured, and it is not vsync.

---

## Summary

| Question | Answer | Evidence |
|---|---|---|
| Is the browser dropping frames? | No. | 120.0 Hz achieved, 0 late frames, 0 dropped, over 479 frames. |
| Is the display link stuck at 60 Hz on ProMotion? | No. | Median inter-frame interval 8.333 ms; `targetFrameRate` 120. |
| Is compositing falling back to software? | No. | WebRender + the macOS native CoreAnimation compositor, GPU process, zero fallbacks. |
| Are the frame timestamps jittery relative to Chrome? | No. | cv 5.9 % vs Chrome's 5.8 %, jerk p95 1.74 ms vs 1.80 ms, same page, same display, same minute. |
| Then what is different? | The browser UI's own motion: its timings, and the properties it animates. | Below. |

**The engine is not the problem.** Two things about the UI are.

---

## What was measured, and how

### 1. Content, Trance vs Chrome, same page and display

A page that animates `transform` under `requestAnimationFrame` for 8 s after a 1.5 s warm-up, and
reports the distribution of its own frame intervals. Served over `http://127.0.0.1`, opened in each
browser in turn, window frontmost.

|  | Trance (Firefox 155) | Chrome |
|---|---|---|
| frames | 964 | 963 |
| mean interval | 8.303 ms | 8.307 ms |
| sd | 0.490 ms | 0.486 ms |
| **cv** | **5.9 %** | **5.8 %** |
| p50 / p95 / p99 | 8.34 / 9.20 / 9.34 ms | 8.30 / 9.20 / 9.30 ms |
| jerk mean / p95 | 0.430 / 1.740 ms | 0.498 / 1.800 ms |

The two engines are indistinguishable. Both show the same periodic ±0.9 ms pair (a 7.5 ms interval
followed by a 9.2 ms one) that CoreVideo's variable-rate output produces on a ProMotion panel.
Chrome's numbers are quantised to 0.1 ms because it coarsens `performance.now()`; that is the only
visible difference between the two columns.

This rules out every engine-level explanation at once: the vsync source, the refresh-driver rate,
the display link's ProMotion behaviour, and frame pacing.

### 2. The chrome window's own refresh driver

Same measurement, run inside the parent process against `browser.xhtml` over Marionette:

```
achieved 120 Hz over 479 frames
interval  median 8.333 ms   sd 0.282 ms   cv 3.4%
tail      p95 8.867 ms   p99 9.325 ms   max 9.345 ms
late      0 (0%)   dropped 0
```

The browser UI is not dropping frames either.

### 3. What one animated element costs the chrome

Profiler markers on `GeckoMain`, per second, while *n* off-screen probe elements run one CSS
keyframe animation in the chrome window at 120 Hz:

| animated property | n | refresh ticks/s | style flushes/s | sync reflows/s | display lists/s |
|---|---:|---:|---:|---:|---:|
| *(baseline, idle)* | — | 7.5 | 23.3 | 1.0 | 15.5 |
| `transform` | 1 | 119.0 | 73.3 | 0 | 39.0 |
| `transform` | 20 | 120.5 | 14.3 | 0 | 9.5 |
| `opacity` | 1 | 120.3 | 0.3 | 0 | 0.5 |
| `opacity` | 20 | 120.8 | 0 | 0 | 0 |
| **`margin-left`** | **1** | **120.5** | **361.5** | **241.0** | **241.0** |
| **`margin-left`** | **20** | **120.8** | **362.3** | **241.5** | **241.5** |
| **`height`** | **1** | **121.8** | **365.3** | **243.5** | **243.5** |
| **`height`** | **20** | **120.5** | **361.5** | **241.0** | **241.0** |

Read the last four rows as **three style flushes, two synchronous reflows and two display-list
rebuilds of the whole browser UI, every frame**, for a single 40×8 px box. The numbers do not move
when twenty boxes animate instead of one, because it is the *document* being reflowed, not the
element.

`transform` and `opacity` are handed to the compositor — confirmed independently:
`animation.effect.getProperties()[0].runningOnCompositor === true` for a `transform` keyframe
animation in the chrome document — and cost the main thread nothing.

Reproduce all three sections with:

```bash
python3 scripts/trance-motion-bench.py
```

The probes sit off-screen, so the harness *understates* the cost: animating the same property on a
real toolbar element repaints every icon near it as well, which was ~12 image paints per frame in
the exploratory runs.

---

## Finding 1 — the UI's motion is timed like a mod, not like a browser

Zen declares two timing tokens and every transition in the sidebar, the folder tree, the split-view
group and the compact-mode toolbar reads one of them:

```css
--zen-tabbox-element-indent-transition: margin-inline-start 0.1s ease-in-out;
--zen-hidden-toolbar-transition-duration: 0.15s;
```

Plus 43 further `transition:` declarations across Zen's own sheets with the duration written
inline, clustered at 0.08 s, 0.1 s, 0.15 s and 0.2 s, on `ease`, `ease-in-out` or `linear`.

At 120 Hz, 0.1 s is twelve frames of a symmetric curve. That is not a frame-rate problem and no
amount of engine work improves it: it is a gesture that leaves and arrives at the same speed, over
a distance short enough that what the eye gets is a jump with a blur on it. The browsers being
compared against move over roughly twice as long, on a curve that leaves fast and arrives slowly,
and their UI is not CSS at all — it is native drawing, so it never had this class of choice to get
wrong.

**Fixed.** `trance-tokens.css` now claims all three of Zen's motion tokens onto Trance's own
duration and easing scale, inside `:root[trance="true"]`:

| token | Zen | Trance |
|---|---|---|
| `--zen-tabbox-element-indent-transition` | `0.1s ease-in-out` | `var(--trance-dur-fast)` (140 ms) `var(--trance-ease-standard)` |
| `--zen-hidden-toolbar-transition-duration` | `0.15s` | `var(--trance-dur-base)` (220 ms) |
| `--zen-hidden-toolbar-transition` | `… ease-in-out` | `… var(--trance-ease-standard)` |

`--trance-ease-standard` is `cubic-bezier(0.2, 0, 0, 1)`. Because both resolve through
`--trance-dur-*`, `trance.motion.level` now clamps Zen's transitions along with Trance's own — at
level 1 they shorten and at level 0 they are instant, which they were not before. Turning Trance
off gives Zen's values back.

The 43 inline durations in Zen's sheets are **not** fixed: each is an upstream touchpoint, and
there is no token to claim. They are listed below as remaining work.

## Finding 2 — the UI animates properties Gecko cannot composite

Sixteen transitions in Zen's sheets and three in Trance's animate a layout property. Every one of
them pays the cost in section 3 above for as long as it runs:

| file | property |
|---|---|
| `zen/common/styles/zen-theme.css` | `margin-inline-start` (the token above; read by four sheets) |
| `zen/common/styles/zen-browser-container.css` | `margin` — on `.browserContainer`, the web view itself |
| `zen/tabs/zen-tabs/vertical-tabs-topbar.inc.css` | `height` |
| `zen/compact-mode/toolbar.inc.css` | `height` |
| `zen/compact-mode/windows-captions-fix-default.inc.css` | `max-height` |
| `zen/split-view/zen-split-view.css` | `inset` (×2) |
| `zen/media/zen-media-controls.css` | `height` (×2) |
| `zen/spaces/zen-workspaces.css` | `padding-top`, `margin-inline-end` |
| `zen/spaces/zen-gradient-generator.css` | `height` |
| `zen/trance/styles/trance-theme.css` | `height` — **fixed**, now `scale` |
| `zen/trance/styles/trance-chrome.css` | `margin-block-end` — kept, reason recorded |
| `zen/trance/styles/trance-onboarding.css` | `gap`, `width` — kept, reasons recorded |

Zen's own comment on the browser-container rule already says `/* … this makes zen REALLY slow … */`
about a neighbouring declaration.

On an Apple-silicon laptop none of this drops a frame — 150 concurrent layout animations held
120.0 Hz with zero late frames. That is precisely why it survives review: the cost shows up as
battery, as the fans, and as stutter on machines nobody develops on, rather than as a bug on the
machine it was written on. It is the failure mode TRANCE.md §3.5 exists to prevent.

**Fixed, partly.** A new stylelint rule, `trance/no-layout-transition`, rejects a transition or
animation naming any layout-affecting property anywhere under `zen/trance/**`. It is deliberately
overridable with `stylelint-disable-next-line` plus a reason, because some gestures genuinely *are*
layout — a strip that collapses has to give its height back to what is below it, and no transform
does that. Three of Trance's own rules carry that comment; one converted to `scale` outright.

The rule does not run on Zen's sheets. Converting those is upstream-touchpoint work and several of
them are not mechanical: the web view's `margin` animation cannot become a transform without
scaling a remote frame, and split view's `inset` animation resizes panes rather than moving them.

---

## Ruled out, with evidence

- **ProMotion / variable refresh.** The display link fires at 8.333 ms and `targetFrameRate` is 120.
  Firefox on macOS still uses the deprecated `CVDisplayLink`
  (`gfx/thebes/gfxPlatformMac.cpp`) rather than `CADisplayLink`, and caches `mVsyncRate` once at
  `EnableVsync()`; neither cost anything measurable here.
- **A single display link across several monitors.** A real limitation — the `TODO` is in
  `OSXVsyncSource::CreateDisplayLink` — but not reachable on a single-display machine.
- **Compositor fallback.** `WEBRENDER = available`, `WEBRENDER_COMPOSITOR = available`,
  `GPU_PROCESS = available`, `fallbacks: []`.
- **Off-main-thread animation being unavailable in the chrome document.**
  `runningOnCompositor` is `true` for a chrome `transform` keyframe animation, and the marker table
  above shows zero main-thread work for it. (`nsIDOMWindowUtils.getOMTAStyle` returns `""` under
  WebRender and is not a usable check.)
- **Trance's surfaces.** The frame-cost table is unchanged with `trance.surface.enabled` and
  `trance.surface.transparency` false, and unchanged again with `trance.enabled` false.
- **Startup churn as a background cost.** For roughly the first ten seconds after the window
  appears the refresh driver runs at display rate and rebuilds the display list ~4× per frame. It
  stops on its own; a later idle sample is completely clean. The bench waits for it rather than
  reporting it (`wait_until_idle`).

---

## Remaining work

1. The 43 inline durations and easings in Zen's own sheets. Each is an upstream touchpoint; the
   cheapest shape is probably a second pair of Zen tokens for "fast" and "base" that those
   declarations read, claimed here the same way the existing three now are.
2. The sixteen layout-property transitions in Zen's sheets, in rough order of how often a user sees
   them: the tab indent, the browser container's `margin`, the compact-mode toolbar's `height`,
   split view's `inset`.
3. Extend `trance/no-layout-transition` to Zen's sheets once (2) is done, or the rule will never
   catch a regression in the part of the UI that has the most of them.
4. Run the bench on an Intel Mac and on a 60 Hz external display. Every conclusion here is from one
   machine, and finding 2's "costs nothing visible" is exactly the claim that is machine-dependent.
