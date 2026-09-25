# Trance 0.3.0: Google works again, plus the punch list

Same Firefox 156.0.1 base as 0.2.1. This release fixes Google sign-in and Google's AI Overviews, and
lands the batch of polish recorded as ADR-087 to ADR-096.

## Fixed

**Google sign-in and AI Overviews.** Signing in with Google could fail or loop, and searches that
should have shown an AI Overview said "Can't generate an AI overview right now" instead. Neither was
the browser engine. The cause was ClearURLs, one of the extensions Trance installed on first run:

- Its Google rules strip `ei`, `sca_esv` and about forty other parameters from every request to
  Google, including the page's own background requests. The AI Overview request needs some of those
  parameters, so Google rejected it.
- Its "prevent tracking injection over history API" option rewrites addresses in the middle of
  Google's sign-in flow.

Both problems are still open upstream (ClearURLs #522, #508, #272, #510). ClearURLs has no setting
that a browser policy can change, so Trance cannot ship it with those two options off. Trance now
installs six extensions instead of seven, and Firefox's built-in query stripping does ClearURLs'
job. It is on by default, in normal and private windows, and it removes click identifiers such as
`gclid`, `fbclid`, `msclkid` and `mc_eid` from links you follow. It never touches a page's own
requests, and Mozilla maintains its list so that stripping does not break sites. "Copy Clean Link"
in the context menu still works.

**If you are upgrading:** the first start of 0.3.0 removes ClearURLs from your profile, once. If you
want it back, install it again from addons.mozilla.org and it will stay. Your tracking-protection
setting does not change. (ADR-097)

**The blur seam between the sidebar and the toolbar.** The 6px splitter between the two frosted
regions was not blurred, which left a visible line. It is now part of the frost, and blur is fully
off when Trance transparency is off. (ADR-087)

**Onboarding asks only questions that do something.** The flow is eight pages instead of ten. The
stable/twilight question (Trance has one channel) and the Zen Internet page (which changed nothing)
are gone. Choosing Sine or Cosine now actually installs that release. The processor page no longer
overwrites settings you changed yourself. (ADR-088)

**Zen's Library is on.** 0.2.1 retired the Library mod in favour of Zen's built-in Library, but the
built-in one was still switched off for Trance's single brand, so the sidebar only showed a
downloads button. The Library button is back. (ADR-090) While the Library is open, the toolbar row
narrows to fit beside it instead of sliding off the edge of the window. (ADR-096)

**Menus close with their fade on macOS.** Arrow panels such as the app menu used to vanish when
closed instead of fading out. They fade out now, and they still open without a fade, which avoids a
missing-shadow bug in Big Sur and later. (ADR-095)

## Changed

- **Theme picker:** the blur knob uses almost the whole ring, with a small dead zone at the top
  instead of a quarter at the bottom. Saved themes remember surface opacity and blur, show eight to
  a page (up to 24 in total), and the picker opens on your saved themes. (ADR-089)
- **Workspace indicators** shrink to dots until you hover them, and the active one stays visible.
  (ADR-091)
- **Window controls** reveal without overshooting. (ADR-092)
- **The app-menu button's** click area is now the same size as the buttons next to it. (ADR-093)
- **Holding the mouse button on the new-tab mark** tilts it further. (ADR-094)

## Build

Same shape as 0.2.1: a macOS Apple Silicon development build with no PGO or LTO. It is **not signed
and not notarised**, so clear the quarantine attribute yourself before the first launch:

```bash
xattr -dr com.apple.quarantine /Applications/Trance.app
```

The reasoning behind each change is in `docs/trance/DECISIONS.md` (ADR-087 to ADR-097).
