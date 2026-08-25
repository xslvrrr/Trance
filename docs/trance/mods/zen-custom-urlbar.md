# Zen Custom URL Bar — investigation

| | |
|---|---|
| **Mod** | Zen Custom URL Bar |
| **User's version** | 2.0.3 |
| **Source** | `rasyidrafi/zen-custom-urlbar` (Sine store id `zen-custom-urlbar`) |
| **License** | **Apache-2.0** |
| **Verdict** | ADAPT |
| **Phase** | 5 |
| **Cluster** | chrome-furniture |
| **Investigated** | 2026-08-25 |

> Apache-2.0. Code may be adapted with attribution and NOTICE handling. See
> `docs/trance/THIRD-PARTY.md`.

## 1. What it actually does

Every behaviour is gated on the urlbar being expanded —
`#urlbar[breakout-extend="true"]:focus-within`:

- [x] B1 — **Blurs and dims the page behind the expanded address bar.**
      `filter: blur(5px) brightness(0.7)` on `#zen-tabbox-wrapper`.
- [x] B2 — **Scales the page down slightly** while the bar is open
      (`transform: scale()`, default 1 = off).
- [x] B3 — **Rounds the expanded bar and its background**, default 12px.
- [x] B4 — **Recolours the expanded bar's background**, either from Zen's own
      `--zen-dialog-background` or from a user-supplied colour, mixed with a
      transparency percentage.
- [x] B5 — **Adds Zen's large shadow** to the expanded bar.
- [x] B6 — Eight preferences: master toggle, scale, blur, brightness, radius,
      use-Zen-colour, custom colour, transparency percentage.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 blur + dim the page | **Keep** | This is the mod. It is also the only thing here that is a *behaviour* rather than a colour choice: it makes the address bar read as a modal layer, which is what it is. Note it is a `filter`, not a `backdrop-filter`, so it does not touch the blur budget (TRANCE.md §3.3) — and it only runs while the bar is open. |
| B2 scale the page | **Drop** | The mod itself defaults it to 1, i.e. off, and scaling the content view forces a re-raster of the whole page for a transient effect. |
| B3 radius | **Keep, from the token** | Phase 3 already gives `#urlbar[breakout-extend]` `--trance-radius-lg`. Nothing to add. |
| B4 recolour | **Drop** | Phase 3's overlay region already owns the expanded bar's surface, and it derives from the space accent rather than from a hardcoded `rgba(23, 23, 26, 1)`. Two owners for one element is the problem this project exists to remove (TRANCE.md §3.1). |
| B5 shadow | **Keep, from the token** | Already `--trance-elev-2` in `trance-surfaces.css`. |
| B6 eight prefs | **Reduce to two** | A master toggle and a dim strength. Blur radius follows `--trance-surface-blur`, which the user already tunes once for the whole browser. |

## 3. What it touches

- **DOM nodes:** `#urlbar[breakout-extend]`, `.urlbar-background`,
  `#zen-tabbox-wrapper`, `:root` (six custom properties).
- **Zen modules:** none; consumes `--zen-dialog-background`,
  `--zen-big-shadow`, `--zen-tabbox-ease`.
- **Chrome URLs it injects:** one stylesheet.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Every declaration is `!important`, including six `:root` custom properties — the exact pattern TRANCE.md §3.1 names as the source of half-applied states. It and Nebula (10) both own `.urlbar-background`. |
| §3.2 Own `MutationObserver` | No | Pure CSS, driven by `:has()`. |
| §3.3 `backdrop-filter` | No | It uses `filter` on the content wrapper, which is a different (and here, correct) tool. |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | No | |
| §3.6 timer loop | No | |
| §3.7 Load-order race | **Yes** | Sine bootloader. |
| §3.8 Duplicate icons / fonts | No | |

One genuine cost worth noting: `:root:has(#urlbar[breakout-extend]:focus-within)`
puts a `:has()` invalidation dependency on the root element. Trance keeps the
`:has()` but scopes it to `#zen-tabbox-wrapper`'s own ancestor chain rather than
`:root`, so the invalidation is local.

## 5. Overlap

- **With stock Zen:** Zen owns `#urlbar` behaviour in `src/zen/urlbar/` and
  `prefs/zen/zen-urlbar.yaml`, and already animates the breakout.
- **With other mods:** Nebula (10) and Nova UI (12) both style the urlbar.
- **Merge target:** `TranceChrome` for B1; the rest is already `TranceSurfaces`'
  overlay region.

## 6. Trance design

- **Module:** `TranceChrome` (urlbar sub-feature)
- **Stylesheet:** `trance-chrome.css`
- **Scheduler use:** none — the dim is a CSS transition with a duration token
- **Observer use:** none
- **New tokens:** `--trance-urlbar-dim` (a brightness multiplier, written at
  runtime from the pref)

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.chrome.urlbar.focus-dim` | bool | `true` | Dim the page while the address bar is open |
| `trance.chrome.urlbar.focus-dim.strength` | int | `30` | Dim strength (%) |

Eight prefs become two, and the blur radius is the one the user already set for
every other surface.

### Teardown plan

Remove the `trance-chrome-urlbar-dim` attribute and release the token binding.
The `filter` is a rule, not an inline style, so it goes with the attribute —
there is no half-dimmed state to clean up.

## 7. Acceptance criteria

- [ ] Opening the address bar dims and blurs the page; closing it restores it
      with a token-timed transition
- [ ] Nothing is dimmed while the bar is closed, and no `filter` remains in the
      computed style
- [ ] Motion level 0 removes the transition but keeps the dim (it is state, not
      motion)
- [ ] No `!important`, no `:root` custom property declared outside the tokens file
- [ ] `CREDITS.md` and `THIRD-PARTY.md` record rasyidrafi's Apache-2.0 licence

## 8. Open questions for the user

1. B2 (scaling the page) is dropped, matching the mod's own default. Say so if
   you had turned it on.
