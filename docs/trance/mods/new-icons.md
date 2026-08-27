# New Icons — investigation

> ⚠️ **No license file — all rights reserved.** No source was read and no code
> or asset may be copied. Behaviour description taken from the mod's README and
> store listing only. See `TRANCE.md` §7.3.

| | |
|---|---|
| **Mod** | New Icons |
| **User's version** | 1.1 → 1.4 |
| **Source** | `qumeqa/zen-icons` (Sine store id `zen-icons`) |
| **License** | **none** |
| **Verdict** | **PREINSTALL** (was NATIVE) |
| **Phase** | 5 |
| **Cluster** | icons |
| **Investigated** | 2026-08-25 |
| **Verdict revised** | 2026-08-26 — ADR-024 |

## 0. The revised verdict

Everything below §1 stands: the reimplementation was built, it works, and it is
still shipped. What changed is which one is the default.

A clean-room set can satisfy this mod's *requirement* — a stroke set that reaches
the toolbar and the panels, not only the context menus — and by construction it
cannot be this mod's *icons*, because §7.3 forbids reproducing them. For anyone
who wanted this icon set, "a different icon set with the same coverage" is not
the thing they asked for, and no amount of care in §6 changes that.

Installing the mod is not copying it. Trance already ships Sine preinstalled so
that everything it does not reimplement stays reachable (ADR-018), and
`scripts/trance-cosine.py` already fetches Sine from its own releases rather than
vendoring it. `PREINSTALLED_MODS` in that script now carries this one entry: the
mod is fetched from the Sine store into `{profile}/chrome/sine-mods/` and into
the new-profile stage, at whatever version its author is publishing, and Sine's
own updater owns it from then on.

So `trance.chrome.icons.enabled` defaulted to **false** — and then, in ADR-039,
stopped existing. Three shipped packs behind a switch nobody was expected to
flip is a second owner kept alive for its own sake, and the only way a pack
could win was to disable Zen's icon sheet wholesale, which traded one problem
for three drawing styles in one menu. The packs are gone; uninstalling this mod
now falls back to the browser's own icons, and the mod guard says so on the
mod's own card under a `shipped` status that is not coloured like a warning
because it is not one.

## 1. What it actually does

From the README: *"New icons for the toolbar, popups, site data panel, and
better locale button."*

- [x] B1 — **Replaces the toolbar icon set** — back, forward, reload, home,
      downloads, extensions, account, app menu.
- [x] B2 — **Replaces the panel and popup icon set** — the app menu's rows, the
      protections panel, the downloads panel.
- [x] B3 — **Replaces the site-information ("site data") panel icons** — the
      padlock, permissions rows, tracking-protection rows.
- [x] B4 — **Restyles the locale/translations button.**

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 toolbar icons | **Keep — as coverage, not as this mod** | The behaviour "the toolbar uses the Trance icon set" is exactly what the icon cluster means. The glyphs come from Context Menu Icons' MIT packs (mod 4), which already contain `arrow-left`, `arrow-right`, `reload`, `home`, `downloads`, `extension`, `menu` and the rest. Nothing is taken from this mod. |
| B2 panel icons | **Keep — same route** | Same set covers `.subviewbutton` and `.panel-*` rows. |
| B3 site-data panel icons | **Keep — same route** | The MIT packs carry `security`, `security-warning`, `security-broken`, `permissions`, `geo`, `camera`, `microphone`, `screen`, `midi`, `xr`, `persistent-storage`, `popup`, `autoplay-media` and the blocked variants. |
| B4 locale button | **Drop** | A single-button restyle whose look is this mod's, not a behaviour. Reproducing it would be copying a design from an all-rights-reserved project with no licence to do so. |

The honest summary: this mod contributes a **requirement** to Phase 5 — that the
icon set reaches the toolbar, panels and the site-information panel, not just
context menus — and contributes **no assets and no code**.

## 3. What it touches

- **DOM nodes:** `#back-button`, `#forward-button`, `#reload-button`,
  `#home-button`, `#downloads-button`, `#unified-extensions-button`,
  `#PanelUI-menu-button`, `.subviewbutton`, `#identity-box`,
  `#identity-popup-*`, `#protections-popup-*`, `#translations-button`.
- **Zen modules:** none.
- **Chrome URLs it injects:** one stylesheet with an inlined SVG set.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Competes with Nova UI (12) and Context Menu Icons (4) on `.subviewbutton` and the toolbar buttons. |
| §3.2 Own `MutationObserver` | Unknown | Not established without reading the source, which is not permitted. |
| §3.3 `backdrop-filter` | No | |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | Unknown | |
| §3.6 timer loop | No | |
| §3.7 Load-order race | **Yes** | Sine bootloader ordering. |
| §3.8 Duplicate icons / fonts | **Yes** | Its set is the second of four copies of the same glyphs (TRANCE.md §3.8). Inlined as data URIs, so each is parsed per rule and cached never. |

## 5. Overlap

- **With stock Zen:** Zen keeps Firefox's icons; this replaces them wholesale.
- **With other mods:** Context Menu Icons (4), Zen Context Menu (20), Nova UI
  (12) — the whole reason the cluster exists.
- **Merge target:** the Trance icon set. This mod's contribution is the coverage
  list in §1, sourced from the MIT packs.

## 6. Trance design

- **Module:** `TranceChrome` (icons sub-feature) — no separate module
- **Stylesheet:** none. Three packs were built and then withdrawn (ADR-039);
  what is left of the icon cluster is `trance.chrome.icons.scale`, which sizes
  whichever glyph is on screen through Zen's own `--zen-toolbar-button-size`
  rather than supplying a glyph of its own
- **Scheduler use:** none
- **Observer use:** none
- **New tokens:** none beyond the icon-size tokens in `context-menu-icons.md`

### The thing that made all of this a no-op until it was found

Zen's own `src/browser/themes/shared/zen-icons/icons.css` is a second owner for
every element the packs map, and it wins: 137 of its declarations carry
`!important`, including the `list-style-image` on `#back-button`,
`#forward-button` and `#reload-button`. A normal author declaration cannot beat
an important one at any specificity, so no Trance pack ever reached the toolbar.
The only visible effect of turning the icon set on was that Trance's
`fill: currentColor` reached `.toolbarbutton-1`, which Zen's sheet does not
cover — so the switch left Zen's glyphs in place and *brightened* them.

The sheet is a `<link>` in `zen-assets.inc.xhtml`, so `TranceChrome` disabled
the element while a pack was loaded and re-enabled it the moment the switch went
off. That worked and was exactly reversible — but it also meant every element
the pack had no glyph for fell back to Firefox's icon rather than Zen's, which
is a large price for a switch that was off by default. ADR-039 removed the packs
and with them this whole mechanism: Zen's sheet is never touched now.

### Prefs

None of its own, and none left in the cluster except
`trance.chrome.icons.scale` (ADR-039).

### Teardown plan

Shared with the icons sub-feature.

## 7. Acceptance criteria

- [x] Toolbar, app menu, downloads panel and site-information panel all draw
      from the Trance set when the sub-feature is on — verified against the
      computed `list-style-image` of `#back-button`, not against the stylesheet
      (`browser_trance_chrome.js`), because the stylesheet was correct the whole
      time it was losing
- [x] No glyph is inlined as a data URI (TRANCE.md §3.8, Phase 5 acceptance)
- [x] No asset or rule originates from this mod
- [x] `CREDITS.md` records qumeqa and that nothing was copied

## 8. Open questions for the user

1. Relicensing outreach (TRANCE.md §16 Q7): qumeqa authors both this and Nova
   UI. A single request covering both would be worth making.
