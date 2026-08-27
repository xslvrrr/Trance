# Live Calendar — investigation

| | |
|---|---|
| **Mod** | Live Calendar (Zen-Live-Calendar) |
| **User's version** | 1.0.0 (script version 2.0) |
| **Source** | `Vertex-Mods/Zen-Live-Calendar` (author: Vertex) |
| **License** | **None** — no `LICENSE` file in the repository |
| **Verdict** | ~~NATIVE — clean-room, `onWallClock`-driven~~ → **PREINSTALL** (ADR-030) |
| **Phase** | 7 |
| **Cluster** | apps |
| **Investigated** | 2026-08-26 |

## 0. Verdict: this one is installed, not reimplemented

`TRANCE.md` §13 scheduled `TranceCalendar` for this phase, with a specific
acceptance criterion attached to it: *"calendar costs ≤ 1 timer wakeup/minute"*.
That criterion was written because the mod was a known §3.6 offender, and
rebuilding it on `TranceScheduler.onWallClock` was going to be the fix.

The audit in §4 is why that stopped being worth doing. The mod holds **one**
always-armed timer, and it is a 60-second interval — which is exactly the budget
the acceptance criterion set. The thing Trance was going to build it to achieve,
it already achieves. What a reimplementation would additionally have to own is an
ICS fetcher, an iCalendar parser, a recurrence expander and a Google Meet
reminder scheduler, none of which any other Trance feature needs, all of which
would be new surface for exactly one screen.

As with Zen Library, the *ownership* argument that justifies the rest of this
project does not apply: the calendar draws its own popup over an essentials tab
and touches nothing Trance owns. So Trance installs it from the author's own
repository at provisioning time and builds nothing (ADR-030).

## 1. What it actually does

- [x] B1 — Hovering a pinned Google Calendar essential shows a popup preview of
      the day's events, Arc-style.
- [x] B2 — Events come from an ICS URL the user pastes into the mod's own
      settings, reachable from the same hover surface.
- [x] B3 — The event list refreshes on a 60-second cycle.
- [x] B4 — A meeting with a linked Google Meet raises a reminder popup five
      minutes ahead, with a Join button.
- [x] B5 — Dismissing that reminder re-raises it 30 seconds before the meeting
      starts.
- [x] B6 — The reminder popup counts down live while it is on screen.

## 2. Keep / drop

Installed whole. Its own preferences are in Sine, which is where anything here
gets turned off.

| Behaviour | Keep? | Reason |
|---|---|---|
| B1–B6 | Keep | Trance builds none of it and configures none of it. |

## 3. What it touches

- **DOM nodes:** its own popup and settings panel, anchored to the essentials
  tab it is bound to. No Zen element is restyled.
- **Zen modules it patches or depends on:** reads the pinned/essential tab list
  to find the Google Calendar tab. Patches nothing.
- **Chrome URLs / stylesheets it injects:** none — it ships one script and no
  stylesheet entry point (`theme.json` has no `style` key).

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | No | Styles its own popup only. |
| §3.2 Own `MutationObserver` | **No** | None. |
| §3.3 `backdrop-filter` | **No** | None. |
| §3.4 `infinite` animation | **No** | None. |
| §3.5 Static `will-change` | **No** | None. |
| §3.6 `setInterval` / `setTimeout` loop | **Yes, bounded** | One always-armed `setInterval` at 60 s (`live-calendar.uc.mjs:616`) refetching the ICS. One 1 Hz `setInterval` (`:759`) that exists only while a reminder popup is on screen, and is cleared with it. The remaining six timers are one-shot `setTimeout`s scheduling a specific reminder at a specific wall-clock time. |
| §3.7 Load-order race | No | Nothing else claims the essentials hover surface. |
| §3.8 Duplicate icons / fonts | No | — |

**The honest cost:** one wakeup per minute, forever, whether or not a calendar
tab exists — plus the network fetch and parse that wakeup performs. That is a
real cost and it is not zero. It is also, to within nothing, the cost of the
`onWallClock("minute")` subscription Trance was going to replace it with, and
`TranceScheduler`'s advantage over `setInterval` (suspension on blur and
occlusion) is worth less here than usual: an event that starts while the window
is occluded still has to raise its reminder.

## 5. Overlap

- **With stock Zen:** none. Zen has live folders, which fetch RSS, not ICS, and
  render in the tab strip rather than as a hover preview.
- **With other mods in the list:** Render.js (14) listed a "calendar" behaviour;
  it was already DEFERred (`docs/trance/mods/render-js.md`).
- **Merge target:** none.

## 6. Trance design

**None.** No `TranceCalendar` module, no stylesheet, no pref, no settings
section. The wall-clock scheduler this phase would have used already exists
(`TranceScheduler.onWallClock`) and is used by other features; nothing was
written for this one and nothing was removed.

The mod guard marks the card **Installed by Trance**, and says what the 60-second
timer costs, so the trade is visible where the mod is rather than only here.

## 7. Acceptance criteria

- [x] The mod is in `PREINSTALLED_MODS` in `scripts/trance-cosine.py`, pinned to
      the commit the store listed on 2026-08-26.
- [x] A fresh profile gets it, through the same staged copy as the other three.
- [x] Its mod-guard card says "Installed by Trance" and names the timer.
- [x] No file from the mod enters this tree.
- [x] Attribution in `CREDITS.md`. Nothing in `THIRD-PARTY.md`: no code adapted.
- [x] Phase 7's ≤ 1 wakeup/minute criterion holds — measured on the mod, not on
      a replacement for it.

## 8. Open questions for the user

Setup is manual and stays manual: the mod needs a per-calendar secret ICS URL,
which nothing can provision for you. The README's twelve steps are the ones to
follow, in Sine's own settings for this mod.
