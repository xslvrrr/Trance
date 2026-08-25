# Tab Closing Bubble Animation — investigation

> ⚠️ **No license file — all rights reserved.** No source was read and no code
> may be copied. Behaviour description taken from the mod's README only.
> See `TRANCE.md` §7.3.

| | |
|---|---|
| **Mod** | Tab Closing Bubble Animation (`bubble-pop-deleting`) |
| **User's version** | 1.3 |
| **Source** | `Zylaah/bubble-pop-deleting` (Sine store id `bubble-pop-deleting`) |
| **License** | **none** |
| **Verdict** | NATIVE |
| **Phase** | 6 |
| **Cluster** | motion-feedback |
| **Investigated** | 2026-08-25 |

## 1. What it actually does

From the README: *"adds a fun, visual 'bubble explosion' animation when a tab or
a tab group is closed. Instead of just disappearing, the closed tab or group will
burst into a configurable number of small bubbles that animate outwards (Deta
Surf inspired)."*

- [x] B1 — **A closing tab bursts into bubbles** that travel outwards and fade.
- [x] B2 — **Closing a tab group does the same**, from the group's bounds.
- [x] B3 — **The bubble count is configurable.**
- [x] B4 — It is a UserScript: it creates the bubble elements at close time and
      removes them when the animation ends.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 tab burst | **Keep** | It is the only feedback in the whole browser that a tab closed *there* rather than simply vanished, and in a vertical strip where the list reflows underneath, that is genuinely useful and not only decorative. |
| B2 group burst | **Keep** | Same argument, more so: closing a folder removes several rows at once, and the reflow is larger. |
| B3 bubble count pref | **Keep, clamped** | One integer, clamped to a range that cannot make the browser stutter. Uncapped it is a way to schedule arbitrary work from `about:config`. |
| B4 script-created elements | **Keep — it has to be** | This is the one Phase 6 behaviour that genuinely cannot be CSS: the bubbles do not correspond to anything in the DOM, and they must be positioned from the closing tab's measured bounds. The Trance version creates them, animates them through `TranceMotion`, and removes them on completion. |

## 3. What it touches

- **DOM nodes:** `.tabbrowser-tab`, `tab-group` / `zen-folder`,
  `#tabbrowser-tabs`; creates its own absolutely-positioned elements.
- **Zen modules:** tab and folder closing paths.
- **Chrome URLs it injects:** one `.uc.js` plus a stylesheet, through Sine.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | Minor | Its bubble elements are its own. |
| §3.2 Own `MutationObserver` | **Likely** | Detecting a tab closing from a script that is not part of the browser generally means watching `#tabbrowser-tabs` for removals. Trance does not have to guess: `TabClose` is an event. |
| §3.3 `backdrop-filter` | No | |
| §3.4 `infinite` animation | **Named in TRANCE.md §3.4** as one of the three offenders. Not verifiable without reading the source, which is not permitted; the Trance version has no loops at all, so the question does not carry forward. |
| §3.5 Static `will-change` | Unknown | |
| §3.6 timer loop | Likely | Removing the bubbles after a fixed delay is the obvious implementation. `animationend` is the correct one. |
| §3.7 Load-order race | **Yes** | Sine bootloader; a UserScript that patches closing behaviour must run after the tab code exists. |
| §3.8 Duplicate icons / fonts | No | |

## 5. Overlap

- **With stock Zen:** Zen animates tab removal already (`zen-animations.css`).
  The burst is additive, and Trance's version must not fight Zen's collapse — it
  runs *over* it, from the bounds captured before the row starts collapsing.
- **With other mods:** Render.js (14) also adds micro-interactions to the tab
  strip.
- **Merge target:** `TranceFeedback`.

## 6. Trance design

- **Module:** `TranceFeedback` (bubbles sub-feature)
- **Stylesheet:** `trance-feedback.css`; keyframes in `trance-motion.css`
- **Scheduler use:** none for the animation itself. The bubbles are one Web
  Animations call each through `TranceMotion`, which adds `will-change` for the
  animation's lifetime and removes it after (TRANCE.md §3.5). No `rAF` loop, no
  timer: cleanup is `animationend`/`finished`
- **Observer use:** none. `TabClose` on `gBrowser.tabContainer` is the event
  Firefox already fires
- **New tokens:** `--trance-bubble-size`, `--trance-bubble-travel`

Bounds are read once, in the read phase, before anything is written — the
closing tab's rect is captured in the `TabClose` handler, and every bubble is
positioned from that one measurement. The mod's shape invites one
`getBoundingClientRect` per bubble; that is a forced reflow per bubble
(TRANCE.md §6.4).

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.feedback.bubbles.enabled` | bool | `true` | Burst a tab into bubbles when it closes |
| `trance.feedback.bubbles.count` | int | `8` | Bubbles per burst (clamped 3–16) |

### Teardown plan

Remove the `TabClose` listener, cancel any in-flight animations and remove any
bubble still in the DOM. With the pref off there is no listener and no node.

## 7. Acceptance criteria

- [ ] Closing a tab and closing a folder both burst; nothing is left in the DOM
      afterwards, asserted by counting Trance-owned nodes after the animation
- [ ] Zero `infinite` animations and zero timers
- [ ] One `getBoundingClientRect` per burst, not per bubble
- [ ] Motion level 0 and `prefers-reduced-motion`: no bubbles at all, and the
      tab still closes with no layout difference
- [ ] Disabled: no listener, no stylesheet, no DOM
- [ ] `CREDITS.md` records Zylaah and that nothing was copied

## 8. Open questions for the user

None. The default count is a guess; say if 8 is wrong.
