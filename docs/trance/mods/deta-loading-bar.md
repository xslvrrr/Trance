# Deta Loading Bar — investigation

| | |
|---|---|
| **Mod** | Zen Deta Loading Bar |
| **User's version** | 2.0.4 |
| **Source** | `rasyidrafi/zen-deta-loading-bar` (Sine store id `zen-deta-loading-bar`) |
| **License** | **MIT** — © 2025 Muhammad Rasyid Rafi'i |
| **Verdict** | ADAPT |
| **Phase** | 6 |
| **Cluster** | motion-feedback |
| **Investigated** | 2026-08-25 |

## 1. What it actually does

- [x] B1 — **A loading bar appears while the selected tab is loading**, centred
      at the top (or bottom) of the content pane, above the page.
- [x] B2 — **The bar pulses.** It does not show progress. It animates between a
      minimum and maximum width, with opacity and scale, on a 1.2 s alternating
      loop, until the page finishes.
- [x] B3 — **Colours come from the Zen theme** (`--zen-primary-color`) or from
      three user-supplied colours, as a gradient or a single colour.
- [x] B4 — **A blur filter is applied to the bar** on every keyframe.
- [x] B5 — **A box shadow**, optional and customisable as a raw CSS string.
- [x] B6 — Fourteen preferences: enable, use-Zen-colour, single-colour, three
      colours, thickness, min width, max width, edge gap, top-or-bottom, shadow
      on/off, shadow string, blur on/off, blur intensity.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 loading bar | **Keep** | It is the feature, and page-load feedback is genuinely useful in a browser whose chrome has no other progress indicator. |
| B2 indeterminate pulse | **Replace with real progress** | The pulse is a decoration standing in for information the browser already has. `nsIWebProgressListener` reports bytes loaded; a bar driven by it says something true, and — the part that matters here — it animates only when progress changes, so there is nothing to keep running. See §4. |
| B3 colours | **Keep, from one token** | `--trance-accent` already follows the space gradient. Three colour prefs and a gradient/solid switch become zero prefs and one token. |
| B4 blur on the bar | **Drop** | A `filter: blur()` re-evaluated on every one of ~72 frames per pulse cycle, on an element whose whole job is to be seen. It is the most expensive part of the mod and the least visible. |
| B5 box shadow | **Keep, from the token** | `--trance-elev-1`. The raw-CSS-string pref is dropped: a pref whose value is unvalidated CSS is a way to break the chrome from `about:config`. |
| B6 fourteen prefs | **Reduce to three** | Enable, thickness, position. Colour follows the accent, geometry follows the tokens. |

## 3. What it touches

- **DOM nodes:** `.browserStack::before` (the bar is a pseudo-element),
  `#main-window`, `.tabbrowser-tab[busy]`, `#statuspanel`, and `:root` for six
  custom properties.
- **Zen modules:** none; reads `--zen-primary-color`.
- **Chrome URLs it injects:** one stylesheet.

## 4. Failure modes present (TRANCE.md §3)

This mod is the clearest single illustration of §3 in the whole set, so it is
worth being specific.

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Every declaration, including three `:root` custom properties set inside `@media` pref gates. |
| §3.2 Own `MutationObserver` | No | It is CSS-only, which the README advertises as "high performance". |
| §3.3 `backdrop-filter` | No | But see B4: a plain `filter: blur()` per frame, which is the same GPU work without the compositor-layer bookkeeping. |
| §3.4 `infinite` animation | **Yes — and worse than usual** | `animation: zen-loading-pulse 1.2s … infinite alternate`. Gecko does not throttle chrome animations, so this runs at display rate — 120 Hz on ProMotion — for the whole page load, in unfocused and occluded windows too. And the keyframes animate `width`, which is a **layout** property: every frame is a reflow of the content pane, not a composite. |
| §3.5 Static `will-change` | **Yes** | `transform: translateZ(0); will-change: auto` on `.browserStack` — the content pane itself — promoting a full-window compositor layer permanently, for a bar that is visible during page loads. |
| §3.6 timer loop | No | The animation is the loop. |
| §3.7 Load-order race | **Yes** | Sine bootloader. |
| §3.8 Duplicate icons / fonts | No | |

Four of the eight, in ninety lines of CSS. Nothing here is incompetent — it is
what "CSS-only" costs when the platform gives a stylesheet no way to ask how far
a page has loaded. Trance is inside the browser and can just ask.

## 5. Overlap

- **With stock Zen:** Firefox's tab throbber, which Zen hides by default
  (`zen.theme.hide-tab-throbber`). Zen has no other load indicator, which is
  exactly why this mod exists.
- **With other mods:** Render.js (14) also animates during navigation.
- **Merge target:** `TranceFeedback`.

## 6. Trance design

- **Module:** `src/zen/trance/features/feedback/TranceFeedback.mjs`
- **Stylesheet:** `trance-feedback.css`; keyframes in `trance-motion.css`
- **Base class:** `TranceFeature`
- **Scheduler use:** `onFrame`, and **only while a load is in flight** — the
  subscription is added when the first tab starts loading and cancelled when the
  last one stops, so an idle browser has no frame subscriber and
  `TranceScheduler` stops its `requestAnimationFrame` loop entirely
- **Observer use:** none. A `nsIWebProgressListener` on `gBrowser` is the right
  instrument; a `MutationObserver` watching for `[busy]` would be inferring what
  the listener states
- **New tokens:** `--trance-loading-thickness`, `--trance-loading-progress`

The design in one line: **the bar's width is the load's progress**, written as a
custom property from the progress listener, with a token-timed `transition` on
`transform: scaleX()` doing the interpolation. Consequences:

- No `infinite` animation, because there is no loop — each progress event starts
  one finite transition.
- No layout per frame, because `scaleX` composites; the mod animates `width`.
- Nothing runs while nothing is loading.
- The indeterminate case (a server that reports no total) gets a slow creep
  driven by `TranceScheduler.onFrame`, which suspends on blur and occlusion —
  the one thing a stylesheet cannot express.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.feedback.loading.enabled` | bool | `true` | Show a loading bar while pages load |
| `trance.feedback.loading.thickness` | int | `3` | Loading bar thickness (px) |
| `trance.feedback.loading.position` | string | `"top"` | Position — top / bottom |

Fourteen become three.

### Teardown plan

`onDisable()` removes the progress listener, cancels any frame subscription,
removes the root attribute and the bar's DOM node, and releases the token
bindings. With the pref off there is no listener, no subscriber, no node and no
stylesheet.

## 7. Acceptance criteria

- [ ] The bar tracks real load progress, and reaches 100% exactly when the load
      completes
- [ ] Zero `infinite` animations (asserted by the stylelint rule and by reading
      the live sheet back)
- [ ] Zero Trance frame subscribers while no tab is loading — asserted against
      `TranceScheduler`'s counters under `trance.debug`
- [ ] No `will-change` and no `translateZ(0)` on `.browserStack`
- [ ] Motion level 0: the bar still appears and still reports progress, in one
      step, with no transition
- [ ] `CREDITS.md` and `THIRD-PARTY.md` record rasyidrafi's MIT licence

## 8. Open questions for the user

1. Top or bottom? The mod defaults to top; Zen's own status panel lives at the
   bottom left, so a bottom bar shares that edge.
2. The bar shows real progress rather than pulsing. If you preferred the pulse
   as an aesthetic, say so — the indeterminate path exists anyway, and making it
   the default is one pref.

---

## 8. Revision — 2026-08-25

Reported as "loading bar settings do nothing". The settings were fine and so was
the bar: it drew a gradient in `--trance-accent`, which is
`--zen-primary-color`, which on a space with no gradient picked is
`rgb(47, 47, 47)` — a near-black three-pixel line on near-black chrome. Nothing
that configures an invisible thing looks like it works.

Marks that sit *on* the chrome now use `--trance-accent-vivid`, which mixes the
accent toward the opposite end of the colour scheme so it reads on every theme.
A saturated accent stays recognisably itself; a near-black or near-white one is
lifted until it can be seen. `--trance-accent` stays raw for tints and fills,
where the surface behind supplies the contrast.
