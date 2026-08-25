# Unloaded Tabs — investigation

> ⚠️ **No license file — all rights reserved.** No source was read while writing
> this document and no code may be copied. Everything below comes from the mod's
> public README and store listing. See `TRANCE.md` §7.3.

| | |
|---|---|
| **Mod** | Unloaded Tabs |
| **User's version** | 1.0 (installed and enabled in the twilight profile) |
| **Source** | `qumeqa/unloaded-tabs` |
| **License** | **none** — all rights reserved |
| **Verdict** | NATIVE — clean-room |
| **Phase** | 4 |
| **Cluster** | sidebar-tabs |
| **Investigated** | 2026-08-25 |

The smallest mod in the whole inventory. Its store description is one sentence:
*"Makes unloaded tabs colorless and semi-transparent, so you can easily
distinguish them from loaded tabs."* It is a stylesheet with no preferences and
no script, and it exists because Firefox's own unloaded-tab styling is close to
invisible in a vertical sidebar.

## 1. What it actually does

- [x] B1 — **Unloaded tabs are desaturated** — the favicon renders greyscale.
- [x] B2 — **Unloaded tabs are semi-transparent** — the whole row is dimmed.

That is the entire mod. There is no third behaviour and no configuration.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 desaturate | **Keep** | The clearer of the two signals, and free: one `filter: grayscale()` on the favicon, no layout, no compositing beyond what the icon already costs. |
| B2 dim | **Keep** | Together with B1 this is unambiguous at a glance in a 48px rail, where a label is not visible at all. |

Both kept, both behind one pref. This is also where SuperPins' B5/B6 land: that
mod offered a strike-through *and* a dimming treatment for the same state, and
running both mods means two owners styling one tab. In Trance the unloaded state
has exactly one owner and one treatment.

## 3. What it touches

- **DOM nodes:** `.tabbrowser-tab[pending]`, `.tab-icon-image`,
  `.tab-label-container`.
- **Zen modules it depends on:** none. `pending` is a Firefox tab attribute;
  Zen already keys off `[pending="true"]` in `vertical-tabs.css:897`.
- **Chrome URLs it injects:** one stylesheet through Sine.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | Partial | It has to out-specify Firefox's own `[pending]` rules, and it collides with SuperPins' unloaded-tab knobs when both are installed. |
| §3.2 Own `MutationObserver` | No | `pending` is an attribute; CSS sees it directly. |
| §3.3 `backdrop-filter` | No | |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | No | |
| §3.6 `setInterval` / `setTimeout` loop | No | |
| §3.7 Load-order race | No | |
| §3.8 Duplicate icons / fonts | No | |

The cleanest mod in the inventory. Its only problem is that it is a *second*
answer to a question SuperPins also answers.

## 5. Overlap

- **With stock Zen:** Zen keys off `[pending="true"]` for pinned-tab close-button
  visibility and folder-active state, but applies no visual dimming of its own.
- **With Firefox:** `tabs.css` styles `[pending]` and `[pending][discarded]`
  faintly — enough in a horizontal strip, not enough in a sidebar.
- **With other mods:** SuperPins (15) B5 strike-through and B6 dimming.
- **Merge target:** `TranceTabStrip` + `trance-tabstrip.css`.

## 6. Trance design

- **Module:** `src/zen/trance/features/tabstrip/TranceTabStrip.mjs`
- **Stylesheet:** `src/zen/trance/styles/trance-tabstrip.css`
- **Base class:** `TranceFeature`
- **Scheduler use:** none.
- **Observer use:** none — `[pending]` is an attribute the style system already
  watches. Adding a `MutationObserver` for it, which several mods in this cluster
  do, buys nothing at all.
- **New tokens:** `--trance-tab-unloaded-opacity`,
  `--trance-tab-unloaded-saturation` in `trance-tokens.css`.

Both tokens are pref-bound through `TranceTokens`, so the two sliders cost one
`setProperty` each and never invalidate a rule.

The rule matches `:is([pending], [discarded])` rather than `[pending]` alone: a
tab discarded from memory but not yet re-shown is in the same user-visible state
and Firefox distinguishes them for its own bookkeeping, not for the user.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.tabstrip.unloaded.enabled` | bool | true | Dim unloaded tabs |
| `trance.tabstrip.unloaded.opacity` | int | 55 | Unloaded tab opacity |
| `trance.tabstrip.unloaded.saturation` | int | 0 | Unloaded tab colour |

Percentages, integers — `ffprefs` quotes any value containing a `.`, which would
silently make it a string pref (the same constraint recorded in
`prefs/trance/surfaces.yaml`).

### Teardown plan

`onDisable()` releases the two token bindings and removes the
`trance-tabstrip-unloaded` root attribute. There is nothing else to undo.

## 7. Acceptance criteria

- [x] B1 and B2 present, and visible in both the expanded sidebar and the rail
- [x] Exactly one owner for the unloaded-tab appearance
- [x] Disabled state: no stylesheet, no inline custom property, no attribute
- [x] No observer, no timer
- [x] Attribution in `CREDITS.md`

## 8. Open questions for the user

- None.
