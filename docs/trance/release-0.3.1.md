# Trance 0.3.1: the blur knob blurs the window

Trance now runs on Firefox 157.0 and tracks Zen through upstream `3d874409e`. This release has five
fixes to things 0.3.0 got wrong, and Trance now tells you when a new release is out.

## Fixed

**The blur knob changes the window's blur.** On macOS, the blur behind a transparent Trance window
came from the system's window material, and macOS does not let an app set how strong that blur is.
So the knob could only blur the browser's own background texture, and the desktop behind the window
never changed. Trance now asks the window server to blur the window's background by exactly the
knob's value. At 0 the desktop shows through sharp, and at 60 it is a soft wash. (ADR-099)

**No more white panels on the sidebar and toolbar.** The sidebar, the toolbar and the strip between
them each carried an in-browser blur layer. The browser filled the transparent part of those layers
with an opaque colour, so each one showed as a pale panel with a hard edge, even at 0px. Those
layers are gone. The sidebar and toolbar are now the same glass as the rest of the window. The
address bar, compact mode's floating sidebar and toolbar, and the browser's own pages still frost
what is behind them, because those sit over the page. (ADR-099)

**The active tab glow stays inside the tab.** It used to spill out past the selected tab into the
rows around it. Now it is drawn inside the tab's own rounded background. It has the same shape, and
"Reach" now sets how much of the tab it lights. (ADR-100)

**Workspace icons.** They sit 24px apart instead of 34px. Hovering one lifts it with a visible
animation, and its hover background is no longer cut off along the top. (ADR-101)

**The app-menu button.** Its hover background and click area were 41px square, spilling past the
button. They are now the same 29px as the buttons next to it, and the Trance mark is the same size as
the toolbar's other icons. (ADR-102)

**The top of the sidebar slides.** When the pointer reached the window buttons, the tabs below them
dropped by a whole toolbar row in one frame. They should have slid down as the buttons faded in. The
slide was a single CSS transition, and any stylesheet that set its own `transition` on that strip,
such as a `userChrome.css` fading it, replaced it outright. The slide is now an animation that no
stylesheet's `transition` can remove. (ADR-103)

## New

**Update notices.** Trance checks this repository's releases, pre-releases included. When a newer
version is out, a bar at the top of the window says so, with **Download** (opens the release page)
and **Skip this version**. Trance checks once after startup and again when you come back to the
window, never more often than every six hours. It runs no background timer and never downloads or
installs anything. You can turn it off, leave out pre-releases, or check now in Settings → Trance →
Updates. (ADR-098)

## Upstream

Sixteen Zen commits, merged at `3d874409e`: Firefox 156.0.1 → 157.0, swipe to add a space, the
status panel and Glance controls following the window's colour scheme, exact and prefix matches in
the URL bar's actions ranking above fuzzy ones, pinned-tab changes applying immediately, a freeze
when folders were toggled quickly, an "open when done" toggle for Library downloads, and animations
drawn from SVG sprites. Trance re-applies four of its patch changes on the new tree: the macOS
window, the session store, the page-colour cache and the stylelint rules. All 265 patches
reverse-apply cleanly out of the finished engine.

## Build

Same shape as 0.3.0: a macOS Apple Silicon development build with no PGO or LTO. The Firefox source
is 157.0's release-candidate build 1, which Zen's own twilight builds also use. It is **not signed
and not notarised**, so clear the quarantine attribute yourself before the first launch:

```bash
xattr -dr com.apple.quarantine /Applications/Trance.app
```

The window-blur change is native code in the macOS window patch (touchpoint 30). It uses a private
window-server call and looks it up at runtime, so if a future macOS drops it, you get an unblurred
window rather than a crash.

The reasoning behind each change is in `docs/trance/DECISIONS.md` (ADR-098 to ADR-103).
