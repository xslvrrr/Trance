# Pimp your PiP — investigation

| | |
|---|---|
| **Mod** | Pimp your PiP |
| **User's version** | 1.0.0 |
| **Source** | Zen theme store, `599a1599-e6ab-4749-ab22-de533860de2c` (author: shldk) |
| **License** | **None** — a theme-store entry with no `LICENSE` file and no licence field |
| **Verdict** | ~~NATIVE — clean-room~~ → **PREINSTALL** (ADR-033) |
| **Phase** | 10 |
| **Cluster** | picture-in-picture |
| **Investigated** | 2026-08-26 |

## 0. Verdict: this one is installed, not reimplemented

Phase 10 was scheduled as a clean-room reimplementation of this mod, with the
acceptance criterion "PiP window restyle survives Firefox's PiP updates; no
effect on PiP performance". The investigation changed the verdict on the same
two-part test Phase 7 applied to Zen Library and Live Calendar (ADR-030), and
this mod passes it more clearly than either of them did.

**Ownership.** Trance owns no part of the Picture-in-Picture player. Every
Trance stylesheet is loaded into a browser window — `TranceStyles` registers
them against `nsIDOMWindowUtils` for `browser.xhtml`, and the one exception,
`trance-internal.css`, is a user sheet aimed at `about:` documents. The PiP
player is neither: it is `chrome://global/content/pictureinpicture/player.xhtml`
in a window of its own. There is no Trance rule over any element this mod
touches, so there is no second owner to remove, and removing the mod removes no
conflict.

**Cost.** 88 lines of CSS and nothing else. No script, no `MutationObserver`, no
interval, no `backdrop-filter`, no infinite animation, no `will-change`. Two
transitions, both on a control overlay that only exists while a PiP window is
open. A clean-room rewrite would have produced a Trance-owned file of about the
same size, doing the same thing, in a window Trance otherwise has no interest
in — and it would have been an approximation of someone else's drawing, which is
the same trade New Icons and Zen Folder Tree Connectors lost (ADR-024, ADR-027).

So Trance installs it. `scripts/trance-cosine.py` provisions it from the Zen
theme store at build time, exactly as Sine's own installer would, and nothing
from it enters this tree — which is also the only arrangement its licence
allows, since it has none (`TRANCE.md` §7.3).

## 1. What it actually does

Read for this audit, not copied (§7.3 forbids copying, not reading; the same
line Phase 7 drew). Seven behaviours, all in one stylesheet:

1. Clears the control buttons' own background fill.
2. Moves close, unpip and minimise to fixed offsets — close and minimise to the
   right edge, unpip to the left — and paints their glyphs light.
3. Suppresses the hover pseudo-element behind each of those three.
4. Makes `#controls` fill the player and tints the whole surface on hover,
   through a 160 ms `background-color` transition, instead of Firefox's
   gradient scrim.
5. Hides `#controls-bottom-gradient`.
6. Stacks the bottom control row in reverse column order.
7. Rebuilds the scrubber: a full-width track, no thumb, 5 px tall growing to
   8 px on hover through a 160 ms transition.

The readme describes it as "improvements to PiP inspired by we know which
browser" — the design language is another browser's PiP, reproduced here.

## 2. Keep / drop

Not applicable in the usual sense: nothing is being rebuilt, so there is no
sub-feature list to trim. The mod ships as its author ships it, enabled, and
Sine's own per-mod switch turns it off.

## 3. What it touches

`.control-item.control-button`, `#close`, `#unpip`, `#minimize`, `#controls`,
`#controls-bottom`, `#controls-bottom-gradient`, `#scrubber` and
`.scrubber-no-drag` — every one of them inside the PiP player document.

Trance's own selectors, checked against that list: no Trance stylesheet mentions
any of them, and no Trance module opens, wraps or observes a PiP window.

## 4. Failure modes present (TRANCE.md §3)

| §3 failure | Present? |
|---|---|
| 3.1 Cascade nondeterminism | Only against Firefox's own player sheet, which is one sheet in a fixed order. Every declaration carries `!important` for that reason, and no other author sheet is in that document to fight. |
| 3.2 Observer storms | None — no script. |
| 3.3 Stacked `backdrop-filter` | None. |
| 3.4 Infinite animations | None. Two transitions, both hover-driven. |
| 3.5 Layer explosion from `will-change` | None. |
| 3.6 Timers instead of events | None. |
| 3.7 Load-order races | None — the sheet is static, and there is nothing to race. |
| 3.8 Duplicated icon sets | None — it recolours the player's existing glyphs rather than shipping any. |

The `!important` count is the only thing in this mod a Trance reviewer would
flag, and §6.2 rule 1's own exemption argument covers it exactly: the ban exists
because the mod stack used `!important` to fight *itself*. Here there are two
sheets, in a fixed order, and the mod's is the one meant to win — the same
argument `trance-sine.css` makes in this tree.

## 5. Overlap

None with any Trance feature, and none with any other mod in the inventory. The
PiP player is a window nothing else in this project has an opinion about.

Worth noting for later: Firefox's PiP player markup is not a stable API. If
upstream renames `#controls-bottom-gradient` or restructures the scrubber, this
mod breaks in a visible but harmless way — the player reverts to Firefox's own
look. That risk was going to exist for a Trance reimplementation too, and it is
the reason Phase 10's original acceptance criterion mentioned surviving PiP
updates. Preinstalling puts the fix where the mod is, with an author who is
already tracking it.

## 6. Trance design

None. Nothing is built.

`PREINSTALLED_MODS` in `scripts/trance-cosine.py` gains a fifth entry, and it is
the first one from the **Zen** theme store rather than the Sine store — which
needed a second install path in the provisioner, since a Zen-store mod has no
`homepage` and its files come from `zen-browser/theme-store` rather than from an
author's own repository. That path mirrors what Sine's own marketplace actor
does (`SineModsMarketplaceParent`: install from
`zen-browser/theme-store/tree/main/themes/<id>/`).

No pref, no module, no stylesheet, no settings row. The mod's own switch lives
in Mods, where every other installed mod's does.

## 7. Acceptance criteria

Phase 10's criteria, restated for what actually ships:

- A fresh profile has the mod installed and enabled, and a PiP window opens
  restyled. *Met by the provisioner, verified by opening one.*
- No effect on PiP performance. *Met by construction: no script, no timer, no
  blur, no infinite animation — two hover transitions on a window that exists
  only while PiP is open.*
- The restyle survives Firefox's PiP updates. *Not met by Trance and not
  Trance's to meet — it moves to the mod's author, which is the honest place for
  it. When it breaks, the player looks like Firefox's again.*

## 8. Open questions for the user

1. The mod is enabled on install, like the other four preinstalled mods. If PiP
   is something you want stock, the switch is in Mods and Trance will not touch
   it again.
