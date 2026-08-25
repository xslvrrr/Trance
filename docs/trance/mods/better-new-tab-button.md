# Better New Tab Button — investigation

> ⚠️ **No license file — all rights reserved.** No source was read and no code
> may be copied. Behaviour description taken from the mod's README only.
> See `TRANCE.md` §7.3.

| | |
|---|---|
| **Mod** | Better New Tab Button |
| **User's version** | 1.0.6 |
| **Source** | `themaster5209/zen-better-new-tab-button` (not in either marketplace index; installed out-of-band) |
| **License** | **none** |
| **Verdict** | NATIVE |
| **Phase** | 5 |
| **Cluster** | chrome-furniture |
| **Investigated** | 2026-08-25 |

## 1. What it actually does

- [x] B1 — **Drops the "New Tab" label and centres the plus icon**, so the
      button is a square glyph rather than a labelled row.
- [x] B2 — **Rotates the plus icon on click.**
- [x] B3 — **Exposes border-radius preferences for several sidebar components**
      — tabs, the button itself, and neighbouring elements. Essentials tabs are
      excluded, which the README calls out as a known limitation.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 unlabelled, centred plus | **Keep** | It is the mod's point, it is two declarations, and it matches the collapsed rail Phase 4 already ships — where the button is a glyph anyway, so the expanded sidebar is the inconsistent one today. |
| B2 rotate on click | **Keep** | Cheap, finite, and exactly what `trance-motion.css` and `--trance-dur-fast` exist for. It is a `:active` transform, not a keyframe, so there is nothing to leave running (TRANCE.md §3.4). |
| B3 radius preferences | **Drop** | Trance already has one radius scale — `--trance-radius-{sm,md,lg,pill}` — and the entire anti-conflict design rests on there being one owner per value (TRANCE.md §6.2). Adding per-component radius sliders re-creates the problem in Trance's own settings page. The README's "Essentials tabs unfortunately don't support this" is what per-component overrides look like when they run out of road. |

## 3. What it touches

- **DOM nodes:** `#tabs-newtab-button`, `#vertical-tabs-newtab-button`,
  `#tabbrowser-arrowscrollbox-periphery > toolbarbutton`, and — for B3 —
  `.tabbrowser-tab .tab-background`.
- **Zen modules:** none.
- **Chrome URLs it injects:** one stylesheet plus a Sine preferences file.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | B3's radius overrides collide with Nebula (10) and Nova UI (12), both of which also set tab radius. Three owners for `--tab-border-radius`. |
| §3.2 Own `MutationObserver` | No | |
| §3.3 `backdrop-filter` | No | |
| §3.4 `infinite` animation | No | B2 is click-triggered and finite. |
| §3.5 Static `will-change` | Unknown | |
| §3.6 timer loop | No | |
| §3.7 Load-order race | **Yes** | Sine bootloader. |
| §3.8 Duplicate icons / fonts | No | Uses the browser's own plus glyph. |

## 5. Overlap

- **With stock Zen:** Zen already lets the new-tab button be moved to the top of
  the sidebar (`about:preferences#zenLooks`), which the README recommends. Zen
  collapses it to a glyph in the collapsed rail on its own.
- **With other mods:** Nova UI (12) restyles the same button; Nebula (10) and
  Nova both own tab radius, which B3 also sets.
- **Merge target:** `TranceChrome`.

## 6. Trance design

- **Module:** `TranceChrome` (new-tab sub-feature)
- **Stylesheet:** `trance-chrome.css`
- **Base class:** `TranceFeature`
- **Scheduler use:** none — B2 is a CSS transition on `:active`
- **Observer use:** none
- **New tokens:** none. The rotation uses `--trance-dur-fast` and
  `--trance-ease-emphasis`; the glyph size uses `--trance-menu-icon-size`.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.chrome.newtab.compact` | bool | `true` | Show the new-tab button as a plus, without its label |

B2 has no pref of its own: it is motion, and motion is owned by
`trance.motion.level`. At level 0 the transform duration is zero and the button
simply does not rotate, with no second switch to find (TRANCE.md §6.2).

### Teardown plan

Remove the `trance-chrome-newtab` attribute. Nothing else is allocated.

## 7. Acceptance criteria

- [ ] The expanded sidebar's new-tab button is an unlabelled centred plus
- [ ] It rotates on press at motion level 2, and does not at level 0
- [ ] No new radius pref exists anywhere
- [ ] Disabled: no attribute, no rule matching, no DOM
- [ ] `CREDITS.md` records themaster5209 and that nothing was copied

## 8. Open questions for the user

1. B3's radius sliders are dropped in favour of Trance's single radius scale. If
   the specific radii you had set differ from Trance's defaults, the fix is to
   change the three `--trance-radius-*` tokens once, for everything.
