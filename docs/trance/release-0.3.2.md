# Trance 0.3.2: round corners, less GPU, and updates that install

Same Firefox 157.0 base as 0.3.1. This release undoes the two costs 0.3.1's window blur brought
with it, and Trance can now install its own updates on macOS.

## Fixed

**The window keeps its rounded corners.** In 0.3.1, changing transparency or blur could turn the
window into a sharp-cornered box. The window blur came from the window server, and that blur
only works on a see-through window, so Trance had made the whole window see-through. Its shape then
became a plain rectangle. The blur radius now goes into the macOS window material itself, so the
window stays solid and keeps its corners at every blur value. The blur knob still sets the radius:
0 shows the desktop sharp, 60 is a soft wash, and turning Trance's surfaces off gives the material
its own blur back. (ADR-107)

**Much less GPU work.** The see-through window was also the cost. macOS redraws a see-through
window against whatever is behind it on every frame that changes, and over a video wallpaper that
added roughly 160–220 ms of WindowServer GPU time per second for one window. It cost the same at
blur 0 as at blur 24. A solid window with the material measured within noise of no window at all.
Tab switching does less work too. The arriving tab's blur was more than half of Trance's GPU time
while switching tabs, and it is the one part of the animation that has to be redone on every
frame. It now ends at 60% of the animation, where it has already faded to about a pixel, instead
of running to the end. The animation looks the same. (ADR-107)

**Confirmation dialogs appear.** "Forget saved themes" in Settings → Trance opened its "are you sure?"
dialog inside a hidden part of the page, so nothing appeared and the button seemed to do nothing.
The dialog now shows. (ADR-105)

**The Zen Library mod is uninstalled, not just switched off.** 0.2.1 switched the mod off once Zen
had its own Library. It stayed installed, and Sine kept listing and updating it. Trance now removes
it once, entry and folder, including from profiles where it was already switched off. If you
install it again yourself, Trance leaves it alone. (ADR-106)

## New

**Updates install themselves (macOS, Apple Silicon).** When a newer release is out, the update bar
offers **Install and restart**, **Install on quit** and **Skip this version**. Trance downloads the
release's DMG, checks its size and its SHA-256 against the digest GitHub publishes, checks that the
app inside is Trance at the expected version, and stages it. The app is replaced only after Trance
has quit, and the old copy is put back if the swap fails. Settings → Trance → Updates has the same
**Install on quit** button. Other platforms, and apps running from a read-only or translocated
location, still get **Open release page**. Firefox's own updater stays off. (ADR-104)

This starts with 0.3.2. 0.3.1 only knows how to link to the release page, so updating from 0.3.1
to 0.3.2 is still a manual download.

## Tests

The Trance mochitest suite passes whole: 916 passed, 0 failed (headless, on this build). Its
long-standing "flaky" tab-close burst test was misreading its own data, and the rest were
expectations that had fallen behind the browser. (ADR-105)

## Build

Same shape as 0.3.1: a macOS Apple Silicon development build with no PGO or LTO. It is **not signed
and not notarised**, so clear the quarantine attribute yourself before the first launch:

```bash
xattr -dr com.apple.quarantine /Applications/Trance.app
```

The blur radius is written into a private property of the macOS material (touchpoint 30). It is
looked up at runtime, so if a future macOS changes it, you get the material's standard blur rather
than a crash.

The reasoning behind each change is in `docs/trance/DECISIONS.md` (ADR-104 to ADR-107).
