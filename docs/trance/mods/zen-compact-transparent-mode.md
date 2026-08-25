# Zen Compact Transparent Mode — investigation

| | |
|---|---|
| **Mod** | Zen Compact Transparent Mode |
| **User's version** | 2.0.0 |
| **Source** | `rasyidrafi/zen-compact-transparent-mode` (Sine store id `42b8c4ac-76d5-4521-9917-2e478931ee53`) |
| **License** | **Apache-2.0** |
| **Verdict** | ADAPT — code *may* be ported with attribution and NOTICE handling |
| **Phase** | 3 |
| **Cluster** | surfaces |
| **Investigated** | 2026-08-24 |

Apache-2.0 permits porting. In practice nothing needs porting: the behaviour is
a handful of declarations against Zen's compact-mode overlays, and Trance's
surface system already expresses it as a preset. Writing it fresh against the
Trance token layer is less work than adapting it *and* carrying the NOTICE and
`THIRD-PARTY.md` obligations. Recorded here so the decision is not re-litigated.

## 1. What it actually does

- [x] B1 — **Translucent compact overlays.** In Zen's compact mode, the sidebar
      and toolbar that slide in on hover render as blurred translucent panels
      instead of opaque ones.
- [x] B2 — **Floating panel geometry.** Those overlays get rounded corners and a
      drop shadow so they read as floating above the content rather than being
      cut out of the window.
- [ ] B3 — **Its own blur/opacity variables.**

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 translucent overlays | **Keep** | Compact mode is exactly where a frosted surface is most justified: the overlay genuinely sits above content, so the blur is doing real work rather than blurring a solid colour. |
| B2 floating geometry | **Keep** | Token work: `--trance-radius-lg`, `--trance-elev-2`. |
| B3 own variables | **Drop** | Replaced by the shared surface tokens. |

## 3. What it touches

- **DOM nodes:** `.zen-toolbar-background`, `#navigator-toolbox` and
  `#zen-sidebar-splitter` while `:root[zen-compact-mode="true"]`.
- **Zen modules:** Zen's own compact mode (`src/zen/compact-mode/`), which
  already ships a `backdrop-filter: blur(42px) … !important` on
  `.zen-toolbar-background` behind the `zen.theme.acrylic-elements` pref.
- **Chrome URLs it injects:** one stylesheet via Sine.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Competes with Zen's own compact-mode blur, which is itself `!important`. Two owners for one element. |
| §3.2 Own `MutationObserver` | No | |
| §3.3 `backdrop-filter` | **Yes** | A fourth blurred region, and in compact mode it can end up *nested* inside another blurred region — the worst case, because a nested blur forces the parent surface to be resolved before the child can sample it. |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | Partial | |
| §3.6 timer loop | No | |
| §3.7 Load-order race | **Yes** | |
| §3.8 Duplicate icons / fonts | No | |

## 5. Overlap

- **With stock Zen:** direct. Zen's `zen-compact-mode.css` already blurs
  `.zen-toolbar-background` when `zen.theme.acrylic-elements` is on. That pref
  defaults to false in a Trance build (it is `@IS_TWILIGHT@`, and Trance has a
  single non-twilight brand), so the collision is latent rather than active —
  but it is exactly the "two owners, `!important` decides" pattern.
- **With other mods:** the whole surfaces cluster.
- **Merge target:** `TranceSurfaces`, as the `compact` preset.

## 6. Trance design

- **Module:** `TranceSurfaces`
- **Stylesheet:** `trance-surfaces.css`
- **Scheduler use:** none
- **Observer use:** none — compact mode is already expressed as
  `:root[zen-compact-mode="true"]`, so the preset is a media-free attribute
  selector and costs nothing when compact mode is off.

### Zen's own compact-mode blur

Because Zen's rule carries `!important`, an author-level Trance rule cannot beat
it, and adding `!important` to fight it is forbidden (§6.2 rule 1). Instead,
while `TranceSurfaces` owns the toolbar region it forces
`zen.theme.acrylic-elements` to `false` and restores the user's previous value
on disable. That is the blur budget being enforced against upstream rather than
only against Trance's own stylesheets. See ADR-011.

### Prefs

No prefs of its own. `trance.surface.preset = "compact"` selects the tighter
geometry; the translucent-overlay behaviour itself is on in every preset,
because it is the one blur that is unambiguously earning its cost.

### Teardown plan

Shared with `TranceSurfaces`, plus restoring `zen.theme.acrylic-elements`.

## 7. Acceptance criteria

- [ ] B1, B2 present in compact mode
- [ ] The compact overlay blur is never nested inside another blur surface
- [ ] Zen's own `.zen-toolbar-background` blur does not also run
- [ ] `zen.theme.acrylic-elements` restored exactly on disable
- [ ] `CREDITS.md` + `THIRD-PARTY.md` updated only if code is ever adapted
      (currently: none was)

## 8. Open questions for the user

1. Do you use Zen's compact mode day to day? If not, this preset can be built
   but left untested until you do.
