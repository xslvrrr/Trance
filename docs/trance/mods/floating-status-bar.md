# Floating Status Bar — investigation

> ⚠️ **No license file — all rights reserved.** No source was read and no code
> may be copied. Behaviour description taken from the mod's README only.
> See `TRANCE.md` §7.3.

| | |
|---|---|
| **Mod** | Zen Floating Statusbar |
| **User's version** | 1.0.0 |
| **Source** | `AmirhBeigi/zen-floating-statusbar` (Zen store) |
| **License** | **none** |
| **Verdict** | **ZEN** (was NATIVE — changed by this investigation) |
| **Phase** | 6 |
| **Cluster** | motion-feedback |
| **Investigated** | 2026-08-25 |

## 1. What it actually does

The whole README: *"Mod for Zen Browser that detaches the status bar from the
bottom left corner of the browser window so that it appears to float."*

- [x] B1 — **The link-target status panel floats** — detached from the window's
      bottom-left corner, with its own rounded, inset presentation, rather than
      sitting flush in the corner as Firefox draws it.

That is the entire mod.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 floating status panel | **Already shipped by Zen** | `zen.theme.styled-status-panel` gives `#statuspanel` 6px of padding and its label a 16px radius, a hairline border and a background mixed from `--zen-primary-color` (`zen-single-components.css`). Padding on the container plus a radius on the label *is* "detached from the corner and floating". The pref defaults to true on macOS, so this behaviour is already on in the user's build. |

**Verdict changed from NATIVE to ZEN.** `mods-inventory.json` said "Zen has
`zen.theme.styled-status-panel`; check overlap before building" — the overlap is
total. Building a Trance version would mean two owners for `#statuspanel`, which
is the failure this project exists to remove (TRANCE.md §3.1), in exchange for
nothing a user could point at.

The only gap worth naming is that Zen's version hardcodes its colours
(`rgba(225, 225, 225, 0.15)`, `black 70%`, `rgba(255, 255, 255, 0.8)`) rather
than deriving them from tokens, so it does not follow Trance's surface treatment
the way panels and menus now do. That is a one-rule alignment in
`trance-chrome.css`'s panel section if it ever looks wrong, not a feature — and
Zen's declarations are `!important`, so it would need the ADR-015 technique
rather than a plain override. Not done now: it is not visibly wrong.

## 3. What it touches

- **DOM nodes:** `#statuspanel`, `#statuspanel-label`.
- **Zen modules:** none.
- **Chrome URLs it injects:** one stylesheet.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | **Yes** | It and Zen's own `zen.theme.styled-status-panel` block style the same two elements, and Zen's carries `!important`. With both active the result is whichever Zen's rules do not cover. |
| §3.2–§3.8 | No | Small CSS-only mod. |

## 5. Overlap

- **With stock Zen:** total. See §2.
- **With other mods:** Deta Loading Bar (6) reads `#statuspanel:not([hidden])`
  as its "a load is in flight" signal, so it is coupled to this element's
  visibility. Trance's loading bar uses the progress listener instead and has no
  such coupling.
- **Merge target:** none. Nothing to build.

## 6. Trance design

None. This is the `ZEN` verdict doing its job: TRANCE.md §8's legend defines it
as "Zen already does this; configure rather than build", and the correct amount
of code is zero.

`prefs/trance/feedback.yaml` records the finding in a comment so the next
session does not re-open it, and surfaces
`zen.theme.styled-status-panel` on the Trance settings page directly — the same
treatment SuperPins' lazy-pinned-tabs got in Phase 4, and for the same reason:
mirroring platform or Zen state into a `trance.*` pref creates the two-owners
problem (`docs/trance/mods/superpins.md` §6).

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `zen.theme.styled-status-panel` | bool | Zen's (`true` on macOS) | Float the link-target bar away from the window corner |

No `trance.*` pref.

### Teardown plan

Nothing to tear down.

## 7. Acceptance criteria

- [ ] No Trance code exists for this mod
- [ ] The Zen pref is reachable from `about:preferences#trance`
- [ ] `mods-inventory.json` verdict updated to `ZEN`
- [ ] `CREDITS.md` records AmirhBeigi and that nothing was copied or needed

## 8. Open questions for the user

1. Confirm Zen's own styled status panel is what you wanted from this mod. If
   the mod does something visibly different in your build that this reading
   misses, a screenshot settles it and the verdict can go back to NATIVE.
