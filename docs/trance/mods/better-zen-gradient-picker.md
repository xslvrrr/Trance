# BetterZenGradientPicker — investigation

> ⚠️ **No licence file. No source was read while writing this document and no
> code may ever be copied.** Everything below is a description of *observable
> behaviour*, from the mod's own screenshots and from the requirements the user
> stated. That is the clean-room boundary: what a product does is a fact about
> the product; how it does it is not. See `TRANCE.md` §7.3.

| | |
|---|---|
| **Mod** | BetterZenGradientPicker |
| **User's version** | 1.7 (for Zen 1.19.1b) |
| **Source** | `JustAdumbPrsn/BetterZenGradientPicker` |
| **License** | **None** — all rights reserved |
| **Verdict** | NATIVE — clean-room |
| **Phase** | 8 |
| **Cluster** | theming |
| **Investigated** | 2026-08-26 |

## 1. What it actually does

Zen's own picker is the baseline, and it is already substantial: a hue/saturation
wheel with up to three draggable dots, six colour-harmony algorithms behind one
cycling button, five pages of presets, a translucency slider that morphs from a
line into a sine wave as it rises, and a grain knob. What the mod adds on top:

- [x] B1 — A **lightness/darkness slider**, separate from the wheel.
- [x] B2 — A second slider for **translucency**, in the same stack as B1.
- [x] B3 — A **knob for the gradient angle**, alongside Zen's grain knob.
- [x] B4 — A **palette button** that switches between preset slider
      configurations — monochrome, dark, pastel, full and others.
- [x] B5 — A **heart button** that saves the current theme; it turns red once
      saved, and saved themes appear as an extra row of swatches at the start of
      the preset pager.
- [x] B6 — **Exact hex code entry**, rather than only the platform colour picker.
- [x] B7 — A **message naming the gradient type** when the algorithm button is
      pressed, and naming the palette when the palette button is.

## 2. Keep / drop

The user asked for all seven, and for the palette list not to stop at the four
they named. Nothing is dropped; one thing is *not built*.

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 lightness slider | Keep | The one real gap in Zen's picker. See §5. |
| B2 translucency slider | **Not built** | Zen's picker already has exactly this slider, writing to exactly this value. Building a second one is the two-owners problem this project exists to remove (`TRANCE.md` §3.1). The requirement is met by what is already there, and the palettes drive *that* slider. |
| B3 angle knob | Keep | Zen hard-codes `-45deg` with a `TODO` next to it. |
| B4 palettes | Keep | Widened to eight: full, vivid, pastel, muted, dark, light, neon, monochrome. |
| B5 saved themes | Keep | Including the extra page at the start of the pager. |
| B6 hex entry | Keep | As a front-end to Zen's own exact-colour path, not a second one. |
| B7 naming what happened | Keep | Extended to the palette button and to saving. |

## 3. What it touches

- **DOM nodes:** `#PanelUI-zen-gradient-generator` and everything inside it —
  `.zen-theme-picker-gradient`, `#…-color-actions`, `#…-color-pages`,
  `#…-controls`, `#zen-theme-picker-color`.
- **Zen modules it patches or depends on:** `gZenThemePicker`
  (`ZenGradientGenerator.mjs`) — the gradient engine, the harmony maths, the
  per-space theme format and the paint.
- **Chrome URLs / stylesheets it injects:** its own, over Zen's panel.

## 4. Failure modes present (TRANCE.md §3)

Assessed against the *category* rather than against the mod's source, which was
not read.

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes, by construction** | Any mod that rebuilds the controls of a panel it does not own is a second owner for that panel's layout. Two such mods — or this one plus Trance — produce a panel whose arrangement depends on load order. |
| §3.2 Own `MutationObserver` | Likely | A userChrome script that needs to know when a panel it did not build has opened has few other options. |
| §3.3–§3.6 | Not assessed | Not observable from screenshots, and not relevant to a reimplementation. |
| §3.7 Load-order race | **Yes** | It patches a Zen object that is constructed during session restore. |

## 5. Overlap

- **With stock Zen:** total, and that is the finding that shaped the design.
  Zen owns the wheel, the dots, the harmonies, the presets, the translucency
  slider, the grain knob, the theme format and the paint. Of the seven
  behaviours above, exactly one (B2) is a duplicate of something Zen has, and
  the other six are additions to it.
- **With other mods in the list:** none.
- **Merge target:** `TranceTheme`, extending `gZenThemePicker` rather than
  replacing it.

## 6. Trance design

- **Module:** `src/zen/trance/features/theme/TranceTheme.mjs`
- **Stylesheet:** `src/zen/trance/styles/trance-theme.css`
- **Base class:** `TranceFeature`
- **Scheduler use:** one `onFrame(…, { once: true })` per preview repaint, and
  never more than one armed at a time — see "One repaint per frame" below.
- **Observer use:** none of the hub's — one `Services.obs` subscription to
  `zen-space-gradient-update`, which is also how the feature learns that the
  picker has been constructed at all (see below).
- **New tokens required:** `--trance-picker-track`, `--trance-picker-thumb`,
  `--trance-picker-dot`, `--trance-picker-heart`,
  `--trance-picker-toast-bg`, `--trance-picker-toast-fg`,
  `--trance-picker-lightness-track`, `--trance-picker-slot`,
  `--trance-toast-life`, and `--trance-border-width-strong` in the geometry
  block. Three new glyphs in the Line pack: `heart`, `heart-filled`, `palette`.

### The seams

Five wraps, each an own-property on this window's picker so no other window and
no prototype is touched:

| Method | What Trance does with it |
|---|---|
| `getColorFromPosition` | Applies the lightness slider and the palette's saturation to the RGB Zen computed. The greyscale preset page is exempt: its dots encode lightness as position deliberately. |
| `getGradient` | Rotates the CSS Zen produced. Every `linear-gradient()` angle moves by the same delta and every `radial-gradient(circle at x% y%)` centre rotates about the middle of the box by it. |
| `getGradientForWorkspace` | Renders another space at *that* space's angle, so previews in the space switcher are not rotated by the space you happen to be in. |
| `onWorkspaceChange` | Notices that the active space changed and reloads Trance's three values from the new theme. |
| `updateCurrentWorkspace` | Coalesces preview repaints onto one animation frame and keeps the knob and the heart in step with a drag. See below. |
| `static getTheme` | Stamps `tranceLightness`, `tranceAngle` and `trancePalette` into every theme object. It is the one seam every write passes through, including writes Trance did not initiate. |

### One repaint per frame

`updateCurrentWorkspace` is the picker's whole repaint: every dot read, a theme
built, the custom-colour list rebuilt, two gradient strings recomputed, and the
gradient, accent, text colour and scheme written into every window showing the
space. Zen calls it from the `mousemove` handler on a dot drag — once per
event.

A mouse reporting at 125Hz therefore asks for twice the work a 60Hz display can
show; a 1000Hz gaming mouse asks for sixteen full repaints per frame, fifteen of
which are overwritten before anything is painted. That is where "extremely laggy
when changing colour" came from, and no individual step in it is slow.

So a repaint that saves nothing is coalesced onto the next frame through
`TranceScheduler` — the one rAF loop this project allows, already suspended when
the window is not visible. A *saving* repaint is never deferred: it ends a
gesture, its result is what reaches the session store, and it cancels anything
queued. `picker.updated` is still set when the deferred call is *queued*, so a
panel closed mid-gesture still saves.

The heart's "is this theme saved?" test moved off the pref for the same reason:
it was a string read, a `JSON.parse` and a `JSON.stringify` per saved theme on a
path that runs while the mouse is moving. The answer only changes when the pref
does, and the pref has an observer.

Both syncs are also skipped while the panel is shut. A theme changes for reasons
that have nothing to do with this popup — a space switch, another window, a
session restore — and each of those used to walk Trance's controls and measure
the knob for something nobody is looking at. `popupshowing` is when the answer
has to be right, so that is when it is computed.

### What a colour change actually costs

Measured on an M4, chrome window 1800×1131 at 2× — mean time from "assign the
theme" to the second frame after it, 20 changes per row:

| Configuration | To paint |
|---|---|
| Trance, default prefs | 25.3ms |
| …without the surface `filter: saturate()` | 19.5ms |
| …without the surface `opacity` as well | 15.2ms |
| Trance, surfaces feature off | 15.0ms |
| Trance off entirely (stock Zen) | 14.0ms |

The JavaScript is not the cost: a whole `updateCurrentWorkspace` is 0.37ms, 50
`getGradient` calls are 1.0ms, 50 `getColorFromPosition` calls are 0.3ms. Every
millisecond above stock Zen is paint, and all of it belongs to the two
declarations Trance puts on the elements that carry the workspace gradient —
which is why the saturation is now a function token that resolves to `none`
rather than to `saturate(100%)` (see trance-tokens.css).

Clicking the wheel with the panel open, after the coalescing above, measures
14.5ms — 69fps. A ~2fps report from a real session is therefore *not* reproduced
by this harness and is not explained by these numbers: something in that profile
or that display is costing 20× what this measures, and a startup profile is the
next step rather than another guess.

### Zen's translucency range, and when it is safe to widen

Zen reads the translucency slider's `min`/`max` **once**, through two
`ChromeUtils.defineLazyGetter`s on a module-local object nothing outside
`ZenGradientGenerator.mjs` can reach, and scales the wave behind the thumb, the
thumb's own size and the macOS/Mica blend to that first reading.

Widening the element after that read moves the thumb and nothing else: at 0.5
the thumb sits at the middle of the track while the wave fills 38% of it. So the
widening runs from `onEnable` — `MozBeforeInitialXULLayout`, after the panel is
parsed and long before session restore constructs the picker — and the cached
pair becomes 0 and 1. On a mid-session pref flip the pair is already cached and
the widening is skipped; the next window gets it.

### The exact-colour row

Zen's own add-a-colour row is the only path in the picker that uses a colour
verbatim, so Trance reuses it rather than duplicating it: the opacity spinner is
moved into the Trance row, and the hex field writes into Zen's
`<input type="color">` before calling `addCustomColor`.

That input is never shown. It opens the *operating system's* colour picker — a
second, differently shaped, modal colour picker launched from inside a colour
picker, on a panel whose entire subject is choosing a colour. What it is
genuinely good at is holding a value, and a hidden input holds one just as well.
It therefore stays in the row this feature already hides, and only the move of
the spinner has to be undone on disable.

### Attaching at all

`gZenThemePicker` does not exist when `TranceCore` builds its features: Zen
constructs it in `restoreWorkspacesFromSessionStore`, off session restore, long
after `MozBeforeInitialXULLayout`. Polling for it would be a timer.

It does not need one. Zen's construction ends with
`onWorkspaceChange(activeWorkspace)`, which finishes by notifying
`zen-space-gradient-update` — the notification this feature already needs in
order to keep its controls in step with the theme. One subscription is both the
arrival signal and the sync signal, and in a private window (where no picker is
ever built) the feature stays at one observer and nothing else, forever.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.theme.enabled` | bool | true | Extended colour picker |
| `trance.theme.controls.lightness` | bool | true | Lightness slider |
| `trance.theme.controls.angle` | bool | true | Gradient angle knob |
| `trance.theme.controls.hex` | bool | true | Exact colour entry |
| `trance.theme.palettes.enabled` | bool | true | Palette button |
| `trance.theme.saved.enabled` | bool | true | Saved themes |
| `trance.theme.saved.themes` | string | `[]` | Saved themes stored (count + Forget all) |
| `trance.theme.notifications` | bool | true | Say what each button did |

There is no `trance.theme.translucency`, and no per-space prefs — see §2 B2 and
`prefs/trance/theme.yaml`.

### Teardown plan

`onDisable()` cancels any queued repaint, restores the six wraps by deleting the
own-properties, puts Zen's opacity spinner back where it came from, puts back the
translucency slider's own `min`/`max`, removes the tooltips it filled in on Zen's
unlabelled buttons, walks the pager
back one page before removing the saved page so Zen's private index and the page
it is showing agree again, removes every created node, gives
`zen.theme.gradient.show-custom-colors` back to the user, and asks for one
repaint so the unrotated gradient is on screen immediately rather than at the
next click.

## 7. Acceptance criteria

- [x] Behaviours B1, B3–B7 present; B2 met by Zen's existing slider
- [x] Disabled state: no stylesheet, no listener, no DOM, no wraps — the
      mochitest asserts the panel's node count returns to what it was
- [x] §12.1 budgets unchanged: no timer, no hub observer, no animation except
      the notification's own, which ends
- [x] No `!important`, no private observer/timer, no new blur surface
- [x] No upstream touchpoint added
- [x] Attribution in `CREDITS.md`. Nothing in `THIRD-PARTY.md`: no code adapted

## 8. Open questions for the user

- The lightness slider takes ownership of lightness away from the wheel while it
  is set. That is what asking for a lightness slider means, and "Full colour"
  reverses it, but it is a behaviour change to a control that already existed
  and is worth knowing about.
