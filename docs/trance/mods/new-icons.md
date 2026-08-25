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
| **Verdict** | NATIVE |
| **Phase** | 5 |
| **Cluster** | icons |
| **Investigated** | 2026-08-25 |

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
- **Stylesheet:** the generated `trance-icons-<pack>.css`, extended by hand with
  the toolbar / panel / site-data selectors CMI does not already cover
- **Scheduler use:** none
- **Observer use:** none
- **New tokens:** none beyond the icon-size tokens in `context-menu-icons.md`

### Prefs

None of its own. `trance.chrome.icons.enabled` and
`trance.chrome.icons.pack` cover it.

### Teardown plan

Shared with the icons sub-feature.

## 7. Acceptance criteria

- [ ] Toolbar, app menu, downloads panel and site-information panel all draw
      from the Trance set when the sub-feature is on
- [ ] No glyph is inlined as a data URI (TRANCE.md §3.8, Phase 5 acceptance)
- [ ] No asset or rule originates from this mod
- [ ] `CREDITS.md` records qumeqa and that nothing was copied

## 8. Open questions for the user

1. Relicensing outreach (TRANCE.md §16 Q7): qumeqa authors both this and Nova
   UI. A single request covering both would be worth making.
