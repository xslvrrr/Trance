# Render.js — investigation

> ⚠️ **No license file — all rights reserved.** No source was read and no code
> may be copied. Behaviour description taken from the mod's README only.
> See `TRANCE.md` §7.3.

| | |
|---|---|
| **Mod** | render.js |
| **User's version** | 1.0 |
| **Source** | `SehajveerSingh2005/render.js` (Sine store id `render-js`) |
| **License** | **none** |
| **Verdict** | **DEFER** (was NATIVE — changed by this investigation) |
| **Phase** | 6 → post-1.0 |
| **Cluster** | motion-feedback |
| **Investigated** | 2026-08-25 |

TRANCE.md §16 Q8 held a slot open for this: *"What does the user actually use it
for? Its purpose is unclear from the name and it drives a frame loop — needs the
§8.2 investigation before it earns a phase slot."* This is that investigation,
and the answer is that it does not earn one yet.

## 1. What it actually does

The README is a manifesto rather than a feature list — *"render.js is not a
theme. it changes how it behaves. small interactions become expressive."* — but
it does enumerate five things:

- [x] B1 — **Dynamic workspace fan switcher.** Spaces fan out as cards when
      switching.
- [x] B2 — **Reactive workspace indicators** — the space indicator reflects
      time, context and state.
- [x] B3 — **Playful new-tab interactions** — hover text, subtle variation.
- [x] B4 — **Masonry layout for essentials.**
- [x] B5 — **"Ambient motion and micro-interactions across the UI."**

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 fan switcher | **Defer** | It replaces Zen's own space-switch animation, which Zen owns end to end (`ZenSpacesSwipe.mjs`, `zen-animations.css`) and which the swipe gesture is built around. Two owners for the space transition is not a small conflict — it is the transition. |
| B2 reactive indicator | **Defer** | "Reflects time" means a clock, and a clock is Live Calendar (9), which has its own Phase 7 slot and its own `onWallClock` design. Building a second time-driven indicator in Phase 6 would guarantee two wakeup sources. |
| B3 new-tab interactions | **Drop** | Phase 5 already decided what the new-tab button does (`better-new-tab-button.md`). A second owner, for hover text. |
| B4 masonry essentials | **Defer** | A layout change to a Zen-owned container, unrelated to motion and feedback. If it is wanted it belongs with the tab strip, not here. |
| B5 "ambient motion" | **Drop** | Not a behaviour. Nothing here can be specified, built or accepted, and §3.4 exists because ambient chrome motion is precisely what holds the refresh driver awake. |

## 3. What it touches

- **DOM nodes:** `zen-workspace`, `.zen-current-workspace-indicator`,
  `#zen-essentials`, `#tabs-newtab-button`, and — per B5 — unspecified others.
- **Zen modules:** the spaces implementation, at minimum.
- **Chrome URLs it injects:** a `.uc.js` and a stylesheet, through Sine.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | Overlaps mods 2, 9 and Zen's own space animation. |
| §3.2 Own `MutationObserver` | **Yes** | Named in TRANCE.md §3.2 as one of the seven. |
| §3.3 `backdrop-filter` | Unknown | |
| §3.4 `infinite` animation | **Likely** | "Ambient motion" is the description of one. |
| §3.5 Static `will-change` | Unknown | |
| §3.6 timer loop | **Yes** | Named in TRANCE.md §3.6 as holding a frame loop. |
| §3.7 Load-order race | **Yes** | It patches Zen internals through Sine's bootloader. |
| §3.8 Duplicate icons / fonts | No | |

## 5. Overlap

- **With stock Zen:** the space switcher and its swipe gesture.
- **With other mods:** Better New Tab Button (2, Phase 5), Live Calendar
  (9, Phase 7), Tab Closing Bubble (16, Phase 6).
- **Merge target:** none chosen. Each of its five behaviours belongs to a
  different existing owner, which is itself the finding.

## 6. Trance design

None, deliberately. Every behaviour either duplicates an owner Trance has
already assigned, or is unspecifiable.

Recording the decision rather than half-building it is the point: TRANCE.md §8.2
says the default answer for a sub-feature is drop, and §15.2 says ask before
building anything not on the user's actual daily path. Five behaviours, five
conflicts with owners that already exist, and no statement of which of them the
user actually uses.

### Prefs

None.

### Teardown plan

Nothing to tear down.

## 7. Acceptance criteria

- [ ] No Trance code exists for this mod
- [ ] `mods-inventory.json` verdict updated to `DEFER`, phase cleared
- [ ] TRANCE.md §16 Q8 answered and closed
- [ ] `CREDITS.md` records SehajveerSingh2005 and that nothing was copied

## 8. Open questions for the user

1. **Which of B1–B4 do you actually use?** This is the question §16 Q8 asked and
   it is still the blocker. Name one and it gets built properly, against the
   owner it belongs to — B1 as a change to Zen's space animation, B2 as part of
   Phase 7's calendar, B4 as a tab-strip layout option. Name none and Render.js
   stays deferred past 1.0, which is the current recommendation.
