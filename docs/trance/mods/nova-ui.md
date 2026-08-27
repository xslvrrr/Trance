# Nova UI — investigation

> ⚠️ **No license file — all rights reserved.** No source was read and no code
> may be copied. Behaviour description taken from the mod's README and store
> listing only. See `TRANCE.md` §7.3.
>
> This document has two parts. **§1–§8 are the surfaces portion**, investigated
> on 2026-08-24 for Phase 3. **§9 is the chrome-furniture and icon portion**,
> investigated on 2026-08-25 for Phase 5.

| | |
|---|---|
| **Mod** | Nova UI |
| **User's version** | 2.2 |
| **Source** | `qumeqa/nova` (Sine store id `nova`) |
| **License** | **none** |
| **Verdict** | NATIVE |
| **Phase** | 5 (surfaces contribution lands in 3) |
| **Cluster** | chrome-furniture, surfaces, icons |
| **Investigated** | 2026-08-24 (surfaces only) |

## 1. What it actually does — surfaces contribution

- [x] B1 — **Flat, opaque-leaning chrome treatment.** Where Nebula goes glassy,
      Nova goes crisp: solid or near-solid surfaces, tighter radii, a visible
      hairline separating chrome from content.
- [x] B2 — **Consistent surface elevation.** Panels and menus share one shadow
      and one border treatment.
- [ ] B3 — Chrome furniture restyles (new tab button, urlbar, toolbar buttons) — **Phase 5**
- [ ] B4 — Its own icon set — **Phase 5**

## 2. Keep / drop — surfaces only

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 flat treatment | **Keep, as the shape of the `flat` preset** | Nova and Transparent Zen point in opposite directions — Nova is flat and opaque, Transparent Zen is translucent and blur-free. Both are "not Nebula". The `flat` preset takes Nova's geometry and Transparent Zen's translucency; they are compatible, and merging them is one preset instead of two. |
| B2 elevation | **Keep** | Already expressed as `--trance-elev-*`. No new work. |
| B3, B4 | **Deferred to Phase 5** | Not Phase 3's to touch. |

## 3. What it touches — surfaces only

- **DOM nodes:** `#navigator-toolbox`, `#zen-appcontent-wrapper`, `panel`,
  `menupopup`.
- **Zen modules:** none directly.
- **Chrome URLs it injects:** one stylesheet plus an inline SVG set, via Sine.

## 4. Failure modes present (TRANCE.md §3) — surfaces only

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Fourth competitor for the same chrome regions. |
| §3.2 Own `MutationObserver` | **Yes** | For the chrome-furniture behaviours (Phase 5 concern). |
| §3.3 `backdrop-filter` | **Yes** | Present despite the flat aesthetic — the fourth stacked blur. |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | Partial | |
| §3.6 timer loop | No | |
| §3.7 Load-order race | **Yes** | |
| §3.8 Duplicate icons / fonts | **Yes** | Its icon set duplicates New Icons (11), Context Menu Icons (4) and Zen Context Menu (20) — same glyphs, four inlined copies (Phase 5 concern). |

## 5. Overlap

- **With stock Zen:** Zen already provides panel/menu elevation tokens.
- **With other mods:** the entire surfaces cluster, plus the icon cluster.
- **Merge target:** `TranceSurfaces` for B1/B2; `TranceChrome` and the Trance
  icon set for B3/B4 in Phase 5.

## 6. Trance design — surfaces only

- **Module:** `TranceSurfaces`
- **Stylesheet:** `trance-surfaces.css`
- **Scheduler use:** none
- **Observer use:** none
- **New tokens:** none

### Prefs

None of its own in Phase 3. `trance.surface.preset = "flat"` covers B1/B2.

### Teardown plan

Shared with `TranceSurfaces`.

## 7. Acceptance criteria — surfaces only

- [ ] `flat` preset reads as Nova's geometry with no blur surfaces
- [ ] No blur is added by this preset — verified by grep and by
      `layers.draw-borders=true`
- [ ] `CREDITS.md` records the mod, author, and that nothing was copied

## 8. Open questions for the user

1. Nova UI and Nebula are aesthetically opposed. Confirm you actually want both
   available as presets, rather than Trance shipping Nebula only and treating
   Nova purely as a Phase 5 chrome-furniture source.
2. Which Nova behaviours do you actually keep enabled today? The default answer
   for Phase 5 sub-features is drop (`TRANCE.md` §8.2).

---

# §9. Chrome furniture and icons — Phase 5

**Investigated:** 2026-08-25 · README and store listing only; no source read.

## 9.1 What it actually does

From the README (*"README is outdated"*, the author's own note) and the
preferences screenshot:

- [x] B3a — **Standardised spacing and padding** across buttons, menu items and
      panels. This is the mod's stated purpose: not a new look, a consistent one.
- [x] B3b — **Refined popup styling** — menus, subviews and dropdowns share one
      treatment.
- [x] B3c — **Consistent border radius** for popups and panels.
- [x] B3d — **Essentials tabs given ordinary tab backgrounds** instead of their
      own colour treatment.
- [x] B3e — **Restyled scrollbars.**
- [x] B3f — **Optional visible borders** on all popups and panels.
- [x] B3g — **"Bleeding corners fix"** — removes white outlines on rounded
      corners.
- [x] B3h — **"Quietify integration"** — a visualiser-style animation on the
      mute button.
- [x] B3i — **Custom interface font**, user-supplied.
- [x] B4 — **Its own icon set** (recommends pairing with New Icons, mod 11).

## 9.2 Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B3a spacing/padding | **Keep — as the token scale, not as this mod** | "One consistent spacing scale" is `--trance-gap-{xs,sm,md,lg}`, which has existed since Phase 2. Phase 5 applies it to menu items, subview buttons and panel bodies, which is where Phase 3 deliberately stopped (`nebula.md` §2 — B3/B4/B5 shipped as tokens, unapplied). No design is taken. |
| B3b popup styling | **Keep, same route** | The surface and elevation tokens applied to `panel`, `menupopup` and `.panel-subview-body`. |
| B3c popup radius | **Keep, same route** | `--trance-radius-md` / `--trance-radius-lg`. |
| B3d plain essentials backgrounds | **Drop** | Zen's essentials treatment is deliberate and the user kept Zen's essentials in Phase 4. Flattening it is a taste change with no behaviour behind it. |
| B3e scrollbar restyle | **Keep, minimal** | Chrome scrollbars in the sidebar and panels are visibly Firefox-default against a frosted surface. One `scrollbar-width`/`scrollbar-color` pair from tokens, no custom-drawn scrollbar. |
| B3f optional borders | **Keep, not optional** | `--trance-surface-border` already exists and Phase 3 already uses it on the urlbar overlay. Panels get the same hairline, for the same reason: a translucent surface needs an edge to read as a pane. No pref — one owner, one answer. |
| B3g bleeding-corners fix | **Keep** | This is a genuine rendering artifact (a light seam where an opaque child meets a rounded translucent parent), not a preference. Fixing it is `overflow: clip` plus matching the child's radius to the parent's — and it is the precise class of "visual artifact" TRANCE.md §1 promises to eliminate. |
| B3h Quietify visualiser | **Drop** | An animation on the mute button, driven by audio state. It is the §3.4 pattern — a looping chrome animation that Gecko does not throttle — and it is decoration on a control that already has three states. |
| B3i custom font | **Drop** | Zen ships `src/zen/fonts/` and a font setting; a second owner for the interface font is exactly §3.1. |
| B4 icon set | **Drop as a source; keep as coverage** | Third copy of the same glyphs (TRANCE.md §3.8). Unlicensed, so nothing may be taken. The coverage requirement it shares with New Icons (11) is met from the MIT packs — see `new-icons.md` §2. |

Five of ten kept, none of them as this mod's design: what survives is the
requirement that Trance's own token scale actually reaches panels and menus,
which Phase 3 deferred on purpose.

## 9.3 What it touches — chrome furniture

- **DOM nodes:** `panel`, `menupopup`, `.panel-subview-body`, `.subviewbutton`,
  `.toolbarbutton-1`, `#PanelUI-menu-button`, `.zen-essentials-container`,
  scrollbars throughout the chrome, `.tab-audio-button`.
- **Zen modules:** none directly.
- **Chrome URLs it injects:** one stylesheet, one inlined SVG set, a Sine
  preferences file.

## 9.4 Failure modes — chrome furniture

Adds to §4: its `MutationObserver` (§3.2) belongs to B3h and B3i, both dropped.
B3h is an `infinite` animation (§3.4) and is dropped for that reason as much as
any other.

## 9.5 Trance design — chrome furniture

- **Module:** `TranceChrome` (panels sub-feature)
- **Stylesheet:** `trance-chrome.css`
- **Scheduler use:** none
- **Observer use:** none
- **New tokens:** `--trance-scrollbar-thumb`, `--trance-menu-item-height`

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.chrome.panels.enabled` | bool | `true` | Apply Trance's spacing and edges to menus and panels |

One pref for B3a/B3b/B3c/B3e/B3f/B3g together. They are one design decision
applied consistently, which is the mod's own stated goal; splitting them into
six switches would let a user assemble the inconsistency the feature exists to
remove.

### Teardown plan

Remove the `trance-chrome-panels` attribute.

## 9.6 Acceptance criteria — chrome furniture

- [ ] Menus, panels and subviews use `--trance-gap-*`, `--trance-radius-*`,
      `--trance-elev-*` and `--trance-surface-border`
- [ ] No white seam on any rounded translucent panel corner, checked in light
      and dark
- [ ] No animation is added to the mute button, and no custom font is set
- [ ] Disabled: no attribute, no rule matching
- [ ] `CREDITS.md` records qumeqa and that nothing was copied

## 9.7 Open questions for the user

1. Nova's flat aesthetic is available as `trance.surface.preset = "flat"`
   (§2 above). Phase 5's panel treatment is preset-independent — it is spacing
   and edges, not colour. Confirm you want the panel work applied under Nebula
   too, rather than only under `flat`.
2. Relicensing outreach: qumeqa authors both this and New Icons (11). One
   request covers both (TRANCE.md §16 Q7).

---

## 9. Revision — 2026-08-25

Reported as *"apply Trance's spacing and edges to menus and panels does
nothing"*, and the report was fair.

The switch set four `--panel-*` variables — a 10px corner where the platform
already draws something close to it, on a popup most people see for half a
second — and nothing about the *rows* moved. The rows are what a menu looks
like.

Upstream keeps the row geometry behind three variables in
`toolkit/themes/shared/menu.css`, so the fix is to declare those rather than to
fight `menupopup > menuitem` with a longer selector:

```css
--menuitem-border-radius: var(--trance-radius-sm);
--menuitem-margin: 0 var(--trance-gap-sm);
--menuitem-padding: var(--trance-gap-sm) var(--trance-gap-md);
```

An inset, rounded, taller row is the whole visible difference between a Firefox
menu and the one this sub-feature promises. `.subviewbutton` is not a `menuitem`
and takes none of those variables, so it repeats the same two values directly,
which is what keeps the two kinds of row lined up.

`--menuitem-margin` is inline-only on purpose: block margin here would double up
with `--panel-padding` and leave a menu that grows a little every time someone
touches one of the two.
