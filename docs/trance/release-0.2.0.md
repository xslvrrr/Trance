# Trance 0.2.0 — flat to glass, and the blur knob

**The theme editor's top slider used to answer two questions at once.** `currentOpacity` reached
the CSS as the *alpha* of every colour in the workspace gradient, so one control decided both how
much colour the chrome carried and how much of the window showed through it. Neither could be
asked on its own: "a strong colour you can see the desktop through" and "a flat, solid theme" were
both unreachable positions on it.

Three controls now, three values.

## Changed

**Zen's top slider is tint strength.** 0 is the neutral chrome with no colour in it, 1 is the
colour at full strength, and both are opaque. The wrap on `getGradient` composites the alpha Zen
emitted down against the browser's own chrome colour — the same arithmetic Zen already used on
platforms whose window cannot be transparent, applied everywhere, so the slider means one thing
wherever you run it.

Exact colours are untouched: the hex field promises that eight digits sets the colour's opacity,
and that alpha is a digit you typed rather than a slider position. `transparent` stops in a multi-
colour gradient are untouched too — those are the gradient's shape, not its strength.

**Existing themes read as more colourful.** Tint strength used to be multiplied by the surface
alpha; at half tint and 20% surface a theme now shows the same colour at 20% rather than at 10%.
The two numbers are independent now, so the old look is still reachable — it just is not the only
thing reachable.

## Added

**A master opacity slider**, under the lightness slider. This is transparency, on its own axis:
100% is a flat, solid theme, 0% is fully transparent. It writes `trance.surface.opacity`, the
same value the settings page has always had under Frosting.

**A master blur knob**, next to it, built like the gradient-angle knob with the radius in pixels in
the middle. 270° of arc, clamped at both ends rather than wrapped, so a drag past the maximum
holds instead of falling to zero. It writes `trance.surface.blur.radius`.

Neither control owns its value. The pref does; the settings page writes the same one, and both
surfaces read themselves back from it, so they cannot disagree while both are open. Both are behind
`trance.theme.controls.master` and there is a switch for them on the settings page.

## Fixed

**The blur radius had no consumer on macOS even with transparency turned off.** The stylesheet gate
was "is this macOS", not "is this window translucent". Where the window *is* natively translucent —
macOS vibrancy, Windows Mica, a transparent GTK window — the frost comes from the compositor at a
radius the operating system owns, and asking the browser to blur it again replaces it with a flat
rectangle instead of softening it. That part is unchanged and is why the gate exists. But with
transparency off the window is opaque, the browser paints the backdrop, and the blur is both correct
and the only frost available — and it was switched off anyway. macOS and Linux now ask the platform
switch itself; Mica keeps answering through `-moz-windows-mica`, which reports what is in effect
rather than what was requested.

The blur knob goes inert wherever that radius has no consumer, and says why in its tooltip rather
than accepting a drag that changes nothing. On the shipped macOS default — vibrancy on — that is its
state: the frost is the operating system's. Turning **Transparency** off in settings hands it back.
The settings page's own blur row swaps for a note on the same condition.

## Performance

**The default is the cheap case.** Ordinary web content is opaque by default. The default has no
full-window filters, saturation is 100% — a genuine no-op rather than a filter that happens to leave
the colour unchanged — and the default path does not blur window-sized imagery at runtime.
Interaction motion changes opacity and transform only, so it does not turn a tab or workspace
gesture into a layout pass.
Phase 0 also makes measurement trustworthy: an unsettled run, missing GPU or energy data, an
unreconciled process-tree change, a mismatched revision, a non-production build, or a material
thermal or power-mode change invalidates the run. The measurement rules and performance defaults are
from Phases 0 and 1, not a claim about an unmeasured benchmark (AUDIT.md Phases 0–1; ADR-034,
ADR-035, ADR-038).

## Power

**Invisible work follows the window.** One activity controller per window now carries the focused,
visible, occluded and minimised states, as well as the other platform states that matter to the
scheduler. Media position updates, live-folder network refreshes, compact-mode hover work, and
hidden Split View and Glance browsers all stop when the window cannot be seen. Media uses one
window-level ticker instead of one interval per card; it updates visible cards, and a hidden card
derives its current position from monotonic time when it is shown (AUDIT.md Phase 2; ADR-037,
ADR-059).

## Architecture

**One owner means one gesture.** Window material, navigation and progress, global preferences and
stylesheets, tab structure, and observer dispatch each have one owner rather than a stack of
competing listeners. The result is visible: two loading bars no longer animate on every page load,
and a background tab finishing a load no longer drives the selected pane's loading gesture. The
navigation path is keyed by the browser, the progress UI is updated at most once per frame, and
hidden-window mutations collapse into one invalidation on resume. Base integration keeps Boosts and
Glance work to top-level documents, lets inactive Split View and Glance suspend, restores session
restore's private-browsing guards, and batches session/window synchronisation writes instead of
globally disabling WebRender or hardware acceleration (AUDIT.md Phases 3–4; ADR-045, ADR-059,
ADR-060, ADR-061, ADR-062, ADR-063, ADR-064, ADR-065, ADR-066, ADR-067, ADR-068).

## Startup

**A disabled feature is absent, and a failed feature is undone.** Feature implementation loads only
when its preference is on. The theme controls and their stylesheet parse when the picker is opened,
not at browser startup; onboarding is not parsed after completion. Feature setup is transactional:
if it fails, acquired styles, tokens and subscriptions are released instead of leaving a half-
enabled feature behind (AUDIT.md Phase 5; ADR-069, ADR-070).

## Build and provenance

**The import has one account of what the fork contains.** A canonical ordered patch manifest records
the expected patch bases, results, overlaps and external origins. Import now fails when a declared
patch is not reflected in the engine, rather than allowing a missing patch to surface later as a
mysterious build difference. External patches and mods are pinned to immutable revisions, with
origins recorded, so the source used for a build can be identified again. The matched PGO/LTO build
matrix and receipts are prepared but the runner remains dry by default, so this development build
makes no optimisation claim (AUDIT.md Phases 5–6; ADR-071, ADR-076, ADR-078).

---

macOS Apple Silicon only, unsigned, still a development build — no PGO, no LTO. Gatekeeper will
refuse to open it until you clear the quarantine attribute:

```bash
xattr -dr com.apple.quarantine /Applications/Trance.app
```

Reasoning in `docs/trance/DECISIONS.md` (ADR-081).
