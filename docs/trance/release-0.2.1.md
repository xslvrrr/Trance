# Trance 0.2.1 — the sidebar comes back, and the glass is glass

A bug-fix release on a new base. Trance now tracks Zen through upstream `4c92731b2` — Firefox
156.0.1 — and fixes four defects that shipped in 0.2.0.

## Fixed

**The sidebar was stuck at 60px, half-styled, with the window buttons showing.** One object
literal in compact mode lost two of upstream's fields when Trance added its own, and the first
thing Zen does when it lays out a window is register on one of them. That call threw, the layout
pass never ran, and no window was ever told its sidebar was expanded — so it sat at the collapsed
rail width, every expanded-only rule was dead, and the collapsed-sidebar rule kept the window
buttons visible. The fields are back, the sidebar opens at its stored width, and the buttons wait
for the pointer again. (ADR-085)

**The Trance mark showed over loading pages, and sometimes over Settings.** The empty-tab mark
asked which page a tab was *showing*, and a tab keeps showing the page it is leaving until the next
one arrives. Clicking a link on the new-tab page left the mark up for the whole network wait; a tab
opened for Settings left it up while Settings loaded. It now also asks whether the tab is loading,
and it is only shown on an empty tab that is idle. (ADR-084)

**The blur knob could not be moved.** Trance switched blur off wherever the window was translucent
in its own right, because on Firefox 155 a `backdrop-filter` there painted a black slab over the
operating system's frost. Trance's default on macOS *is* a translucent window, so the knob was
disabled from launch and the settings page hid its blur slider. Firefox 156's WebRender patch
(Zen gh-15513) makes a chrome backdrop-filter read what is actually beneath it, so the gate is gone
from all three places that asked it.

That alone would have given you a knob that moved and changed nothing: the blur lived on the
element that *contains* everything Trance paints, so there was nothing behind it to soften. It now
lives on the sidebar and the toolbar, which sit over the texture and the gradient — and, in
compact mode, over the page. Turning the knob changes the frost you see. Still at most three
surfaces, never nested, and still off whenever the window is hidden, unfocused, at motion level 0,
or under reduced transparency. (ADR-082)

**"Fully transparent" had a white tint.** At 0% surface opacity the workspace gradient went away
but a thin white-weighted sheen was still painted across the whole window, so the bottom of the
slider was a milky haze rather than the desktop. The sheen now follows the same control: 0% paints
nothing of Trance's own, and 100% is unchanged. (ADR-083)

## Upstream

Sixty-seven Zen commits: Firefox 155 → 156.0.1, Zen Library, sharing spaces, folders and split
views across devices, cross-device tabs, and the URL-bar and sidebar transparency work above.
Trance's session-store, drag-and-drop, Picture-in-Picture and Cocoa window touchpoints are
re-applied on the new tree, and all 257 patches reverse-apply cleanly out of the finished engine.

**The Zen Library mod is retired.** Trance preinstalled it because nothing else in the browser
owned a library. Zen now ships one natively, and the mod registers the same button and element and
tears the built-in one down when it loads. Trance no longer installs it, and switches it off once in
profiles it had installed it into — disabled, not deleted, and if you turn it back on in Sine it
stays on. (ADR-086)

**The tab glow reaches past its row again.** Zen's new expanded-sidebar tab rule outranked Trance's
glow clip; the glow rule now names the same elements Zen's does.

## Build

Same shape as 0.2.0: a macOS Apple Silicon development build — no PGO, no LTO, **not signed and not
notarised**. Clear the quarantine attribute yourself before the first launch:

```bash
xattr -dr com.apple.quarantine /Applications/Trance.app
```

Building locally now needs Rust 1.95.0 (Zen's new pin); `source scripts/trance-env.sh` reports
the command if it is missing.

Reasoning in `docs/trance/DECISIONS.md` (ADR-082 to ADR-086).
