# Transparent Zen — investigation

> ⚠️ **No license file — all rights reserved.** No source was read and no code
> may be copied. Behaviour description only. See `TRANCE.md` §7.3.

| | |
|---|---|
| **Mod** | Transparent Zen |
| **User's version** | 1.17.16 |
| **Source** | `sameerasw/zen-themes/TransparentZen` (Zen store id `642854b5-88b4-4c40-b256-e035532109df`) |
| **License** | **none** |
| **Verdict** | NATIVE |
| **Phase** | 3 |
| **Cluster** | surfaces |
| **Investigated** | 2026-08-24 |

## 1. What it actually does

- [x] B1 — **Transparent chrome background.** The browser chrome loses its
      opaque background so the platform's own window material (macOS vibrancy,
      Windows Mica, Linux compositor blur) shows through.
- [x] B2 — **Translucent chrome elements.** Toolbar, sidebar and urlbar
      backgrounds become semi-transparent tints rather than solid fills.
- [ ] B3 — **Content-area transparency.** Makes the page area translucent too on
      supporting sites.
- [ ] B4 — **Per-element opacity knobs.** A set of variables for tuning how
      transparent each part is.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 transparent chrome | **Keep** | Already most of the way there in stock Zen — `zen-theme.css` sets `background: transparent` on `#main-window` under `-moz-windows-mica`, macOS, and `zen.widget.linux.transparency`. Trance's job is to make the *chrome elements* cooperate with it, not to re-implement it. |
| B2 translucent elements | **Keep, as the `flat` preset** | This is Transparent Zen without the blur: tint and alpha, no `backdrop-filter`. It is the cheapest surface preset and the correct default for anyone who cares about battery. |
| B3 content transparency | **Drop** | `TRANCE.md` §9.3: the content area has exactly one owner, and it is the Zen Internet extension by the same author. Trance restyles chrome only. Doubling up here is how the content area ends up double-tinted. |
| B4 opacity knobs | **Keep, unified** | Collapses to `trance.surface.opacity` plus the three per-region toggles. Nine knobs across four mods becomes four. |

## 3. What it touches

- **DOM nodes:** `#main-window`, `#navigator-toolbox`, `#urlbar`, tab strip,
  `browser[type="content"]`.
- **Zen modules:** none directly; it rides on Zen's existing
  `--zen-themed-toolbar-bg-transparent` and the platform transparency media
  queries in `zen-theme.css`.
- **Chrome URLs it injects:** one stylesheet via the Zen mods system.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Sets background/opacity on the same elements as Nebula, Nova UI and Compact Transparent Mode. Whichever loads last wins, and it is not the same one every session. |
| §3.2 Own `MutationObserver` | No | Pure CSS. |
| §3.3 `backdrop-filter` | **Yes** | On the chrome regions, stacking with the other three. |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | Partial | On the translucent regions. |
| §3.6 timer loop | No | |
| §3.7 Load-order race | **Yes** | Depends on Zen's transparency variables already being resolved. |
| §3.8 Duplicate icons / fonts | No | |

## 5. Overlap

- **With stock Zen:** substantial. Zen already makes the window background
  transparent on all three platforms and already ships
  `--zen-themed-toolbar-bg-transparent`. A meaningful part of this mod is
  redundant with the Zen version the user is running.
- **With other mods:** Nebula (10) and Nova UI (12) tint the same regions;
  Compact Transparent Mode (19) tints them again in compact mode.
- **Merge target:** `TranceSurfaces`. Becomes the `flat` preset — same region
  registry, same tokens, `--trance-surface-blur: 0px`.

## 6. Trance design

- **Module:** `TranceSurfaces` (shared with Nebula; no separate module)
- **Stylesheet:** `trance-surfaces.css`
- **Scheduler use:** none
- **Observer use:** none
- **New tokens:** none beyond the surface family Nebula already requires

### Prefs

No prefs of its own. `trance.surface.preset = "flat"` selects this behaviour.

### Teardown plan

Shared with `TranceSurfaces` — see `nebula.md` §6.

## 7. Acceptance criteria

- [ ] B1, B2 present at the `flat` preset with zero `backdrop-filter` surfaces
- [ ] Content area untouched (B3 stays with Zen Internet)
- [ ] Platform transparency still works on macOS, Mica and Linux
- [ ] `CREDITS.md` records the mod, author, and that nothing was copied

## 8. Open questions for the user

1. Do you want `flat` as the default preset rather than `nebula`? It is
   materially cheaper — no blur passes at all — and on macOS the window server's
   own vibrancy already provides most of the effect.
2. Confirm B3 is genuinely handled by the Zen Internet extension in your setup,
   so Trance can leave the content area alone.

---

## 8. Revision — 2026-08-25

Reported as "no proper page transparency support", and the report was right: the
`content` region set a CSS `background` on the `<browser>` and stopped there.
That colour sits *behind* the content process's canvas, and the canvas is
opaque — Gecko fills it with the page's background colour, or white when the
page declares none. So the only thing the declaration could reach was the few
pixels the rounded corners expose and the frame before first paint.

Real page transparency is one attribute and Gecko owns it. `transparent` on a
chrome-document `<browser>` reaches `BrowserParent::IsTransparent`, travels to
the content process in `ParentShowInfo`, and makes
`PresShell::IsTransparentContainerElement` true — at which point the canvas is
composited with alpha instead of filled. Firefox already ships the switch that
sets it on every tab it builds: `browser.tabs.allow_transparent_browser`.
`TranceSurfaces` claims it while the region is on and gives it back on disable,
the same treatment `zen.theme.acrylic-elements` gets (ADR-011).

Two consequences, both stated on the settings page rather than hidden:

- `tabbrowser.js` reads the pref when it *creates* a browser, so this reaches
  tabs opened from that point on.
- With the switch on, every content browser carries `transparent="true"`, so the
  Trance rule now *requires* that attribute where it used to exclude it — the
  declaration it replaces is Zen's own fixed
  `light-dark(rgba(255,255,255,0.6), rgba(255,255,255,0.1))`, so the alpha
  follows the slider instead of being a constant. The default dropped from 85%
  to 40%, because with the canvas actually transparent the number now means what
  it says.
