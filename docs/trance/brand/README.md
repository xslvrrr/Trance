# Trance brand source art

Source files. **Nothing here ships.** Everything the build installs is generated
from these by `scripts/trance-branding.py` and lives in
`configs/branding/trance/` and `src/zen/trance/icons/`.

```bash
python3 scripts/trance-branding.py
```

Needs ImageMagick (`magick`), and `iconutil` for the `.icns` on macOS. Neither is
a build dependency — the outputs are committed.

## Files

| File | What it is |
|---|---|
| `mark-black.png` | The mark, black on transparency, 2160². The tracing source. |
| `mark-white.png` | The same mark in white. What every generated icon composites. |
| `trance.icon/` | macOS 26 Icon Composer bundle — Liquid Glass app icon. |
| `topo-source.png` | The chrome background texture at full size, 20833×12500. |

## Why the source is here and not in `configs/branding/trance/`

Surfer's branding patch (`node_modules/@zen-browser/surfer/dist/commands/
patches/branding-patch.js`, `addOptionalIcons`) copies every entry of the
branding directory that is not named `content` with `copyFileSync`, which throws
`EISDIR` on a subdirectory. A `source/` folder there would break `npm run import`
rather than be ignored. See ADR-050.

## Why `trance.icon/` is not installed

No part of the Firefox build consumes a macOS 26 `.icon` bundle; macOS gets a
`.icns`, which the script generates from `logo-mac.png`. The bundle is kept so
that the day a build does consume one, the source is already in the tree.

## Why `topo-source.png` is not installed

`src/zen/trance/images/topo.png` is this file downscaled to 1600px on its long
edge. It is painted at 15% opacity behind an 8px blur, so every pixel past about
1600 is a megabyte spent on detail the blur removes.

## Design constants

Both live in `scripts/trance-branding.py` and are stated once each:

- **Plate** `#0D0F14` — the same value as `brands.trance.backgroundColor` in
  `surfer.json`, so the app icon and the Windows installer agree without a
  second constant.
- **Private-browsing plate** `#2B1150` — used nowhere else.

Every application icon is the white mark on a superellipse plate. Firefox's own
convention is a bare mark on transparency, which works for a fox drawn in six
colours and not for one flat colour: a monochrome mark disappears into whichever
desktop theme matches it.

The one place the mark is drawn *without* a plate is Trance's own chrome —
`src/zen/trance/icons/trance-mark.svg`, in `currentColor`, masked onto the
app-menu button and the onboarding splash. A mask reads alpha, so artwork with a
plate behind it would paint a solid rounded square.
