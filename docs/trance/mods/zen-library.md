# Zen Library — investigation

| | |
|---|---|
| **Mod** | Zen Library |
| **User's version** | 1.0.0 |
| **Source** | `12th-devs/Zen-Library` (author: JustADumbPrsn) |
| **License** | **None** — no `LICENSE` file in the repository |
| **Verdict** | ~~NATIVE — clean-room, ships in full~~ → **PREINSTALL** (ADR-030) |
| **Phase** | 7 |
| **Cluster** | apps |
| **Investigated** | 2026-08-26 |

## 0. Verdict: this one is installed, not reimplemented

`TRANCE.md` §13 scheduled `TranceLibrary` for this phase — "custom element +
data layer + its own settings section", with "Library is non-negotiable" next to
it. The investigation changed the verdict, and the argument is in §5 and §6
below. The short version:

The reason Trance reimplements twenty of these mods is **ownership**. Two
stylesheets over `#tabbrowser-tabs`, four over `.subviewbutton`, and a winner
decided by Sine's load order — that is `TRANCE.md` §3.1, and it is the failure
this fork exists to remove. Zen Library is not in that position. It opens a
surface of its own, over the whole window, on a command of its own, and it
touches nothing any Trance feature owns. There is no second owner to remove.

What is left is cost, and the cost audit in §4 comes back almost clean: no
interval, no `MutationObserver`, no `backdrop-filter`, no infinite animation. It
is 7,500 lines of someone else's finished, maintained application, and a
reimplementation would be 7,500 lines of ours that did the same thing at the
same price.

So Trance installs it. `scripts/trance-cosine.py` provisions it from the
author's own repository at build time, exactly as Sine's installer would, and
nothing from it enters this tree — which is also the only arrangement its
licence allows, since it has none (`TRANCE.md` §7.3).

## 1. What it actually does

- [x] B1 — A full-window library shell, opened from its own toolbar button and
      keyboard shortcut, closing on `Escape`.
- [x] B2 — **History** view: the Places history, grouped by day, searchable,
      with per-entry open/copy/delete.
- [x] B3 — **Downloads** view: the download list with its file actions, and the
      containing-folder reveal.
- [x] B4 — **Media** view: media playing or recently played in tabs, with
      transport controls.
- [x] B5 — **Spaces** view: a grid of the profile's spaces with drag-to-reorder.
- [x] B6 — **Boosts** view: Zen's own Boosts, listed and editable.
- [x] B7 — A shared shell around all five: sidebar nav, search field, empty
      states, and an enter/exit animation.

## 2. Keep / drop

Not applicable in the usual sense — the mod ships as one piece and Trance
installs it as one piece. It has its own preferences inside Sine, which is where
anyone who wants a view turned off should turn it off.

| Behaviour | Keep? | Reason |
|---|---|---|
| B1–B7 | Keep | Installed whole. Trance builds none of it and configures none of it. |

## 3. What it touches

- **DOM nodes:** creates its own shell inside the browser window; adds one
  toolbar button. Does not restyle Zen's tab strip, toolbar, urlbar or panels.
- **Zen modules it patches or depends on:** reads Places, `DownloadsCommon`,
  Zen's spaces and Boosts APIs. Patches none of them.
- **Chrome URLs / stylesheets it injects:** `ZenLibrary.css`, which imports its
  seven-file `css/` tree. All of it is scoped to the mod's own shell.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | No | Its selectors are its own shell. Nothing Trance owns is in scope. |
| §3.2 Own `MutationObserver` | **No** | Zero in 7,500 lines. |
| §3.3 `backdrop-filter` | **No** | None. |
| §3.4 `infinite` animation | **No** | None. |
| §3.5 Static `will-change` | Yes, once | `css/core.css:441` — one `will-change: transform` on the shell. One permanently promoted layer for an element that is `display: none` until the library is opened. |
| §3.6 `setInterval` / `setTimeout` loop | **No** | No interval anywhere. Six `requestAnimationFrame` calls, all one-shot layout settles inside an interaction. |
| §3.7 Load-order race | No | Nothing else in the profile touches its surface. |
| §3.8 Duplicate icons / fonts | Minor | Ships one SVG of its own. |

One offence, and it is the cheapest one on the list. That is a better §3 record
than several things Trance wrote itself.

## 5. Overlap

- **With stock Zen:** none for the shell. History and Downloads exist as Firefox
  library windows and panels; this is a different surface, not a second owner of
  those.
- **With other mods in the list:** Render.js (14) claimed an overlapping
  "library" idea and was already DEFERred for unrelated reasons.
- **Merge target:** none. Nothing absorbs it.

## 6. Trance design

**None.** There is no `TranceLibrary` module, no stylesheet, no pref and no
settings section, because Trance does not implement this.

The design question phase 7 actually had to answer was whether to spend that
work, and the answer is no:

- A reimplementation owns a Places query layer, a virtualised list, a downloads
  bridge, a media-session bridge, a spaces grid with drag reordering, and a
  Boosts editor. Nothing else in Trance needs any of it — it is six data layers
  that exist only to feed one screen.
- The §12 budgets are about *idle* cost. This mod's idle cost is one promoted
  compositor layer, and the acceptance criterion phase 7 wrote for itself
  ("< 20 ms of startup when enabled, 0 when disabled") is about a feature that
  is always loaded. This one is a mod behind Sine's own enable switch.
- `TRANCE.md` §1: "Not a 'maximum features' browser. Every feature must earn its
  frame budget." It earns it as it is.

The one thing Trance does own is saying so where the mod is: the mod guard marks
its card **Installed by Trance** rather than warning about it
(`trance-mod-guard.js`).

## 7. Acceptance criteria

- [x] The mod is in `PREINSTALLED_MODS` in `scripts/trance-cosine.py`, pinned to
      the commit the store listed on 2026-08-26.
- [x] A fresh profile gets it: the provisioner stages it into
      `{app}/trance-cosine/sine-mods/` and `config.js` seeds new profiles from
      that stage.
- [x] Its mod-guard card says "Installed by Trance", not "Replaced by Trance".
- [x] No file from the mod enters this tree.
- [x] Attribution in `CREDITS.md`. Nothing in `THIRD-PARTY.md`: no code is
      adapted, so there is nothing to attribute there.

## 8. Open questions for the user

None outstanding. The verdict change was the user's call (2026-08-26: "better
off not replacing").
