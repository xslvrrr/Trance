# Nebula — investigation

> ⚠️ **GPL-3.0. No source was read while writing this document and no code may
> ever be copied.** Everything below is a description of *observable behaviour*
> from using the mod and from its public store listing and screenshots. That is
> the clean-room boundary: behaviour is a fact about the product, source is not.
> See `TRANCE.md` §7.2.

| | |
|---|---|
| **Mod** | Nebula |
| **User's version** | 3.3.3 |
| **Source** | `JustADumbPrsn/Zen-Nebula` (Sine store id `Nebula`) |
| **License** | **GPL-3.0** |
| **Verdict** | NATIVE — clean-room, mandatory |
| **Phase** | 3 |
| **Cluster** | surfaces |
| **Investigated** | 2026-08-24 |

Nebula is one of the two mods the user requires **in full** (`TRANCE.md` §4.3).
It is also the largest single source of the power drain this project exists to fix:
it is a full glass-and-gradient design language layered on top of Zen's own,
which means it contributes both a `backdrop-filter` stack (§3.3) and animated
gradients (§3.4).

## 1. What it actually does

Nebula is a design language, not a feature. Its user-visible behaviours are
almost entirely visual, and they fall into five groups.

- [x] B1 — **Frosted chrome.** Sidebar, toolbar and popups render as translucent
      "glass": a blurred, slightly saturated sample of what is behind them, tinted
      toward the theme's background colour.
- [x] B2 — **Ambient gradient backdrop.** The window background carries a soft,
      slowly-shifting colour field derived from the active Zen gradient, visible
      through the frosted chrome.
- [x] B3 — **Softened geometry.** Larger, more consistent corner radii; more
      generous internal padding; hairline borders instead of solid separators.
- [x] B4 — **Elevated surfaces.** Panels, menus and the expanded urlbar read as
      floating: soft shadow, inset highlight along the top edge, no hard border.
- [x] B5 — **Cohesive state styling.** Hover, active and selected states across
      tabs, toolbar buttons and menu items share one treatment (a tinted pill)
      rather than each element inventing its own.
- [ ] B6 — **Per-element decoration.** A long tail of small restyles (scrollbars,
      throbber, media controls, extension panel, findbar, …).
- [ ] B7 — **Its own configuration surface.** Sine preferences exposing toggles
      for the above.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 frosted chrome | **Keep** | The defining look. Becomes the `nebula` surface preset. Implemented once, per region, inside the blur budget. |
| B2 ambient gradient | **Keep, re-hosted** | Zen already owns the window backdrop (`#zen-browser-background`, `ZenGradientGenerator`). Trance tints *that*, rather than adding a second animated layer. No `infinite` animation — see §4. |
| B3 softened geometry | **Keep** | Pure token work: `--trance-radius-*`, `--trance-gap-*`. Costs nothing at runtime. |
| B4 elevated surfaces | **Keep** | Token work: `--trance-elev-*`, `--trance-surface-border`, `--trance-surface-highlight`. |
| B5 cohesive states | **Keep** | This is the one behaviour that actively *reduces* conflict — one state treatment replaces five competing ones. |
| B6 per-element decoration | **Defer** | Long tail. Individual items get picked up by the phase that owns the element (tabs → Phase 4, urlbar/menus → Phase 5, media → Phase 6). Doing them here would mean Phase 3 styling elements Phase 4 is about to rewrite. |
| B7 own config surface | **Drop** | Replaced by `about:preferences#trance` (§6.6). Trance does not ship a second settings system. |

"In full" is honoured by B1–B5: the design language ships complete and is the
default preset. B6 is not dropped, it is scheduled — every item lands in the
phase that owns its element, which is the only way to avoid Phase 3 and Phase 4
fighting over the same selectors.

## 3. What it touches

- **DOM nodes:** `#navigator-toolbox`, `#zen-main-app-wrapper`,
  `#zen-appcontent-wrapper`, `#tabbrowser-tabs`, `#urlbar`, `panel`,
  `menupopup`, `#zen-browser-background`.
- **Zen modules it depends on:** the gradient engine (`ZenGradientGenerator`,
  `zen.theme.*` prefs) for its accent, and `zenThemeModifier.js` for
  light/dark resolution.
- **Chrome URLs it injects:** a large stylesheet loaded through Sine into the
  profile's `chrome/zen-themes.css`, plus a preferences JSON.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Redeclares `--zen-*` on `:root` and uses `!important` to win against Zen and against the other three surface mods. Load order decides the winner, so the winner changes between sessions. This is the direct cause of the ghost borders and half-applied states after a space switch. |
| §3.2 Own `MutationObserver` | **Yes** | On the tab strip and toolbox, to re-apply state classes. |
| §3.3 `backdrop-filter` | **Yes — the main one** | Multiple overlapping blurred regions. Stacked with Transparent Zen, Compact Transparent Mode and Nova UI, this is four full-region separable Gaussian passes per frame at 120 Hz for a static UI, and it defeats macOS window-server occlusion because the blur source must be resolved even when nothing changed. |
| §3.4 `infinite` animation | **Yes** | The ambient gradient loops forever, which alone holds the refresh driver at display rate. |
| §3.5 Static `will-change` | **Yes** | Applied defensively to blurred and animated regions; each promotes a permanent compositor layer. |
| §3.6 `setInterval` / `setTimeout` loop | No | |
| §3.7 Load-order race | **Yes** | Depends on Zen's gradient variables existing when its sheet is evaluated. |
| §3.8 Duplicate icons / fonts | Partial | Ships some inline SVG that overlaps New Icons and Nova UI. |

Nebula exhibits five of the eight failure modes. That is not a criticism of the
mod — it is what any large theme has to do when it can only reach the browser
through an injected stylesheet. Trance can do it from inside instead.

## 5. Overlap

- **With stock Zen:** the gradient backdrop, the accent colour system and the
  light/dark scheme are all Zen features Nebula restyles rather than replaces.
  Trance extends Zen's, never shadows it.
- **With other mods:** Transparent Zen (17), Zen Compact Transparent Mode (19)
  and Nova UI (12) each apply their own translucency to overlapping regions.
- **Merge target:** `TranceSurfaces` + `trance-surfaces.css`. Nebula's look is
  the default preset; the other three become presets of the *same* system rather
  than additional layers (`TRANCE.md` §8.1).

## 6. Trance design

- **Module:** `src/zen/trance/features/surfaces/TranceSurfaces.mjs`
- **Stylesheet:** `src/zen/trance/styles/trance-surfaces.css` — the only file in
  the tree permitted to contain `backdrop-filter`, enforced by the
  `trance/no-backdrop-filter` stylelint rule.
- **Base class:** `TranceFeature`
- **Scheduler use:** none at steady state. The ambient gradient is a static CSS
  gradient over Zen's existing backdrop element, not an animation. B2's "slowly
  shifting" quality is achieved by the gradient following the active space's
  accent, which changes on user action, not on a timer.
- **Observer use:** none. Region enablement is attribute-driven from prefs.
- **New tokens:** `--trance-surface-blur`, `--trance-surface-alpha`,
  `--trance-surface-saturate`, `--trance-surface-tint`, `--trance-surface-bg`,
  `--trance-surface-border`, `--trance-surface-highlight` — all declared in
  `trance-tokens.css`.

### The blur budget

At most **three** blur surfaces per window — sidebar, toolbar, overlay — and
never nested. `TranceSurfaces` marks each claimed region with an attribute on
`:root`, and `trance-surfaces.css` applies `backdrop-filter` to exactly the
element that owns the region. Blur is dropped entirely when the window is
unfocused or occluded, and when `trance.motion.level = 0` or
`prefers-reduced-transparency` is set.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.surface.enabled` | bool | `true` | Frosted surfaces |
| `trance.surface.preset` | string | `nebula` | Surface style |
| `trance.surface.blur.radius` | int | `24` | Blur radius |
| `trance.surface.opacity` | int | `62` | Surface opacity |
| `trance.surface.saturation` | int | `130` | Surface saturation |
| `trance.surface.region.sidebar` | bool | `true` | Frost the sidebar |
| `trance.surface.region.toolbar` | bool | `true` | Frost the toolbar |
| `trance.surface.region.overlay` | bool | `true` | Frost panels and menus |
| `trance.surface.suspend-when-unfocused` | bool | `true` | Drop blur in background windows |

### Teardown plan

`onDisable()` must: unload `trance-surfaces.css`, remove every
`trance-surface-*` attribute from `:root`, release the token bindings (so the
custom properties fall back to what `trance-tokens.css` declares), remove the
focus/occlusion listeners, and restore `zen.theme.acrylic-elements` to the value
the user had before Trance claimed the toolbar region. After that the window is
byte-for-byte stock Zen.

## 7. Acceptance criteria

- [ ] B1–B5 present and correct at the `nebula` preset
- [ ] ≤ 3 `backdrop-filter` surfaces, never nested (`layers.draw-borders=true`)
- [ ] Occluded window → 0 GPU frames (`powermetrics`, profiler `Composite`)
- [ ] No visual artifact across space switch, tab switch, window resize,
      fullscreen toggle, light/dark switch
- [ ] Disabled state: no stylesheet, no listener, no attribute
- [ ] No `!important`, no private observer/timer, no `infinite` animation
- [ ] `CREDITS.md` records Nebula, its author, and that nothing was copied

## 8. Open questions for the user

1. **Fidelity.** `TRANCE.md` §16 Q6 — how close must the clean-room result be?
   Recommendation, and what this document assumes: *the same design language*,
   not a pixel match. Pixel-matching a GPL-3.0 work is both harder and legally
   riskier than sharing its vocabulary.
2. **B6 scheduling.** Confirm that deferring the per-element decoration tail to
   the phases that own those elements is acceptable, rather than shipping all of
   it in Phase 3.
3. **Ambient gradient motion.** Nebula's backdrop drifts continuously. Trance
   will not animate it, because that is the single largest idle-power item in
   the whole stack. Is a static gradient that follows the space accent an
   acceptable substitute?
