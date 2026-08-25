# Hide Extension Name — investigation

| | |
|---|---|
| **Mod** | Hide Extension Name |
| **User's version** | 1.0.0 |
| **Source** | `ch4og/zenbrowser-themes` → `Hide Extension Name/` (Zen store) |
| **License** | **MIT** |
| **Verdict** | ADAPT |
| **Phase** | 5 |
| **Cluster** | chrome-furniture |
| **Investigated** | 2026-08-25 |

## 1. What it actually does

The whole mod is three lines:

```css
#urlbar #identity-box.extensionPage #identity-icon-label {
  display: none !important;
}
```

- [x] B1 — **Hides the extension's name in the identity box** when the current
      page is served by an extension (`moz-extension://`), leaving the puzzle
      icon and the URL.

That is all of it. There is no script, no pref, no second rule.

## 2. Keep / drop

| Behaviour | Keep? | Reason |
|---|---|---|
| B1 | **Keep** | One rule, no cost, and it fixes a real annoyance: the identity box otherwise eats a third of the address bar with an add-on's full name every time you open its options page. |

## 3. What it touches

- **DOM nodes:** `#urlbar #identity-box.extensionPage #identity-icon-label`.
- **Zen modules:** none.
- **Chrome URLs it injects:** one `userChrome.css` fragment.

## 4. Failure modes present (TRANCE.md §3)

| Mode | Present? | Detail |
|---|---|---|
| §3.1 Cascade / `!important` conflicts | Nominally | The `!important` is only there because a `userChrome.css` rule has to beat Firefox's. Trance's sheet is an author sheet loaded last, so it needs none. |
| §3.2 Own `MutationObserver` | No | |
| §3.3 `backdrop-filter` | No | |
| §3.4 `infinite` animation | No | |
| §3.5 Static `will-change` | No | |
| §3.6 timer loop | No | |
| §3.7 Load-order race | No | |
| §3.8 Duplicate icons / fonts | No | |

The cleanest mod in the set. It is here because it is on the user's daily path,
not because it is a problem.

## 5. Overlap

- **With stock Zen:** Zen has `zen.theme.hide-unified-extensions-button`, which
  hides the *toolbar* button. Different element, different problem — no overlap.
- **With other mods:** Zen Custom URL Bar (21) restyles the same `#urlbar` but
  not this element.
- **Merge target:** `TranceChrome`.

## 6. Trance design

- **Module:** `TranceChrome` (urlbar sub-feature)
- **Stylesheet:** `trance-chrome.css`
- **Scheduler use:** none
- **Observer use:** none
- **New tokens:** none

MIT permits adapting the rule verbatim. It is three lines of the most obvious
possible CSS, so Trance writes its own — with the `!important` removed, and the
attribution recorded either way.

### Prefs

| Pref | Type | Default | Settings-page label |
|---|---|---|---|
| `trance.chrome.urlbar.hide-extension-name` | bool | `true` | Hide add-on names in the address bar |

### Teardown plan

Remove the `trance-chrome-urlbar-noextname` attribute.

## 7. Acceptance criteria

- [ ] An extension page shows its icon and URL, not its name
- [ ] An ordinary page's identity box is unchanged
- [ ] No `!important`
- [ ] `CREDITS.md` records ch4og's MIT licence

## 8. Open questions for the user

None.
