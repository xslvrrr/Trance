# Trance 0.3.3: the blur knob works, and the mark glows

Same Firefox 157.0 base as 0.3.2. This release fixes the blur knob that 0.3.2 broke, fixes a frozen
empty-tab mark behind the browser's own pages, and adds a glow to the mark.

## Fixed

**The blur knob changes the blur again.** In 0.3.2 the knob moved, and Trance wrote the new radius
into the macOS window material, but the window looked the same at every setting. macOS draws that
blur itself, and the way 0.3.2 wrote the radius never reached it. Trance now writes it through the
path macOS does read: 0 shows the desktop sharp and 60 is a soft wash. (ADR-109)

**The blur knob is where it should be when the browser starts.** Its handle used to sit in the
corner of the knob until you edited the theme. It is now on the ring from the first time the panel
opens. (ADR-109)

**The blur knob turns like the grain knob.** It had a dead spot at the top that no other knob has.
Now the whole ring is the range: zero at the top, clockwise in 2px steps to 60, and one step past
60 goes back to zero. (ADR-109)

**The mark goes when a browser page comes back.** Reopening Settings, Add-ons or another built-in
page with Cmd+Shift+T from an empty window left the mark showing behind it. Focusing one of those
pages paused Trance's per-frame work in the whole window until you switched to another app and
back, and hiding the mark is part of that work. It now pauses only when the window really is in the
background. (ADR-112)

**The update bar can be seen and clicked.** The bar that offers an update was drawn under the page
in 0.3.1 and 0.3.2, so you could neither see it nor click it. It now sits above the page. If you are
on 0.3.2, you can still update from Settings → Trance → Updates → **Install on quit**. (ADR-108)

## New

**The mark glows.** A blurred copy of the mark sits behind it. With Holographic on, the copy is the
sheen itself, so the glow is the colour of the light on the mark and follows it as the sheen moves.
Settings → Trance → Glow turns it off. (ADR-111)

**Better mod warnings.** The warnings in Settings → Mods were checked against the current Sine store.
Eight whole-browser themes (Natsumi Browser, Arc 2.0, Neo Zen, Wireframe 2.0, macaron, Livs Theme,
zap's cool photon theme and Paneru) now say they restyle what Trance owns. So do Zen Page Tint,
Blended Addressbar, No-Gaps and Square UI. Six mods that were warned about without cause no longer
are. (ADR-110)

## Removed

The note about folder tree lines in Settings → Trance → Tab strip. The Zen Folder Tree Connectors mod
is still installed.

## Known issue

A report that running onboarding again from Settings leaves the page tinted more strongly and the
mark blurred could not be reproduced. Settings is one of the pages that paused Trance's per-frame
work, so that run may have been affected. Please report it again if you still see it. (ADR-112)

## Tests

The Trance mochitest suite passes whole on this build: 941 passed, 0 failed (headless). New tests cover the knob's ring
and handle, the frame loop staying on in Settings, the mark leaving when a built-in page arrives,
the glow, and the update bar being the topmost thing under its own buttons.

## Build

Same shape as 0.3.2: a macOS Apple Silicon development build with no PGO or LTO. It is **not signed
and not notarised**, so clear the quarantine attribute yourself before the first launch:

```bash
xattr -dr com.apple.quarantine /Applications/Trance.app
```

The reasoning behind each change is in `docs/trance/DECISIONS.md` (ADR-108 to ADR-112).
