# <Mod name> — investigation

> Copy this file to `docs/trance/mods/<store-id>.md` and fill it in **before writing any code**.
> See `TRANCE.md` §8.2.

| | |
|---|---|
| **Mod** | |
| **User's version** | |
| **Source** | |
| **License** | |
| **Verdict** | NATIVE / ADAPT / ZEN / DEFER |
| **Phase** | |
| **Cluster** | |
| **Investigated** | YYYY-MM-DD |

## 1. What it actually does

Discrete, user-visible behaviours. One line each. No implementation detail.

- [ ] B1 —
- [ ] B2 —
- [ ] B3 —

## 2. Keep / drop

The user takes small parts of most mods and disables the rest. Decide per behaviour.
Default to **drop**. Ask the user when unsure.

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 | | |
| B2 | | |

## 3. What it touches

- **DOM nodes:**
- **Zen modules it patches or depends on:**
- **Chrome URLs / stylesheets it injects:**

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | | |
| §3.2 Own `MutationObserver` | | |
| §3.3 `backdrop-filter` | | |
| §3.4 `infinite` animation | | |
| §3.5 Static `will-change` | | |
| §3.6 `setInterval` / `setTimeout` loop | | |
| §3.7 Load-order race | | |
| §3.8 Duplicate icons / fonts | | |

## 5. Overlap

- **With stock Zen:** (which existing Zen feature already does part of this?)
- **With other mods in the list:**
- **Merge target:** (which Trance module absorbs it)

## 6. Trance design

- **Module:** `src/zen/trance/features/<name>/Trance<Name>.mjs`
- **Stylesheet:** `src/zen/trance/styles/features/trance-<name>.css`
- **Base class:** `TranceFeature`
- **Scheduler use:** (frame / idle / wall-clock / none)
- **Observer use:** (which selectors, which mutation types)
- **New tokens required:** (must be added to `trance-tokens.css`, not inline)

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.<name>.enabled` | bool | | |

### Teardown plan

What `onDisable()` must undo so the disabled state costs zero.

## 7. Acceptance criteria

- [ ] Behaviours B<n> present and correct
- [ ] Disabled state: no stylesheet, no listener, no DOM, verified in profiler
- [ ] §12.1 budgets unchanged
- [ ] No `!important`, no private observer/timer, no new blur surface
- [ ] Attribution added to `CREDITS.md` (+ `THIRD-PARTY.md` if code was adapted)

## 8. Open questions for the user
