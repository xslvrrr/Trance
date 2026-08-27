#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: generate the whole shipped brand asset set from two source PNGs.
#
#   python3 scripts/trance-branding.py
#
# ── Why a generator and not thirty hand-made files ────────────────────────
#
# TRANCE.md §7.4 requires original artwork everywhere before Phase 12, and
# "everywhere" is thirty-odd files in four raster formats at eleven sizes, plus
# two vector files and a Windows bitmap. Hand-maintaining that set is how brand
# assets drift: the 32px icon keeps the old mark for a year because nobody
# re-exports it. Everything under `configs/branding/trance/` is therefore
# derived, by this script, from exactly two files in `docs/trance/brand/` — and
# re-derived whenever the mark changes.
#
# ADR-008 tracked "original icon artwork" as the one Phase 1 deliverable left
# open. This closes it.
#
# ── The mark is monochrome, so the icons get a plate ──────────────────────
#
# The Trance mark is a single-colour quatrefoil knot with a transparent
# background. Firefox's own `logo.png` is a bare mark on transparency, and that
# works for a fox drawn in six colours; it does not work for one flat colour,
# which disappears into whichever of the two desktop themes matches it. So every
# *application* icon Trance ships is the white mark on a superellipse plate in
# `#0D0F14` — the `backgroundColor` already declared for the brand in
# `surfer.json`, so the icon and the installer agree without a second constant.
#
# Private-browsing variants use the same plate in violet, which is the one piece
# of Firefox iconography convention worth keeping: users read purple as "this
# window is private" before they read anything else.
#
# ── The vector half ───────────────────────────────────────────────────────
#
# `about-logo.svg` and `src/zen/trance/icons/trance-mark.svg` are real paths,
# not an embedded raster: the mark is drawn in browser UI at sizes nobody
# enumerated in advance (the onboarding flow scales it with the window), and a
# 2160px PNG scaled to 28px costs a megabyte to draw a glyph.
#
# There is no vector master — the source is a PNG — so the outline is traced
# here: alpha threshold, crack-following contour walk, Ramer-Douglas-Peucker
# simplification, then quadratic smoothing through the surviving points. At the
# default tolerance the result is a ~20KB path that is visually identical to the
# 2160px source at every size the browser draws it.
#
# ── Dependencies ──────────────────────────────────────────────────────────
#
# ImageMagick (`magick`), and on macOS `iconutil` for the `.icns`. Both are
# developer-machine tools, not build dependencies: the outputs are committed.
# Surfer regenerates `firefox.icns` from `logo-mac.png` itself when it builds on
# macOS (`branding-patch.js`), so the committed `.icns` is what cross-compiled
# and non-macOS builds use.
#
# ── What is deliberately not derived ──────────────────────────────────────
#
# The wordmarks (`content/about-wordmark.svg`, `content/firefox-wordmark.svg`)
# are type, not artwork, and they are hand-written. `docs/trance/brand/
# trance.icon/` is the macOS 26 Icon Composer source for the Liquid Glass app
# icon; nothing in the Firefox build consumes a `.icon` bundle, so it is kept as
# a design source and not installed.
#
# Refs: TRANCE.md §7.4, §13 Phase 1; ADR-008, ADR-050

import argparse
import math
import shutil
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "docs" / "trance" / "brand"
BRANDING_DIR = ROOT / "configs" / "branding" / "trance"
CONTENT_DIR = BRANDING_DIR / "content"
ICONS_DIR = ROOT / "src" / "zen" / "trance" / "icons"

MARK_BLACK = SOURCE_DIR / "mark-black.png"
MARK_WHITE = SOURCE_DIR / "mark-white.png"

# The brand plate. `#0D0F14` is `brands.trance.backgroundColor` in surfer.json;
# the violet is the private-browsing variant and exists nowhere else.
PLATE = "#0D0F14"
PLATE_PRIVATE = "#2B1150"
MARK_INK = "#FFFFFF"
PDF_TAG = "#E5484D"

# Superellipse exponent. Apple's squircle is not a superellipse, but n=5 is
# within a pixel of it at 1024 and needs no special cases.
SQUIRCLE_N = 5.0

# Firefox reads default<size>.png for these; surfer copies logo<size>.png across
# one for one and fails the build if any is missing (branding-patch.js).
LOGO_SIZES = (16, 22, 24, 32, 48, 64, 128, 256, 512, 1024)
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICNS_SIZES = (16, 32, 64, 128, 256, 512, 1024)

# The mark's share of the plate's width. Smaller than it looks right in
# isolation: the plate is what the eye measures, and a mark that fills it reads
# as cramped at 16px, which is the size that matters most.
MARK_SCALE_PLATE = 0.56
# macOS artwork is 824/1024 of the canvas, and the mark is then measured against
# the artwork rather than the canvas.
MACOS_ARTWORK = 824 / 1024


# --- Shelling out ------------------------------------------------------------


def magick(*args):
    """Runs ImageMagick, raising with its own message if it fails."""
    result = subprocess.run(
        ["magick", *[str(arg) for arg in args]],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"magick {' '.join(str(a) for a in args)}\n{result.stderr}")
    return result.stdout


def require(tool):
    if shutil.which(tool) is None:
        sys.exit(f"trance-branding: {tool} is not on PATH")


# --- Geometry ----------------------------------------------------------------


def squircle_points(size, inset=0.0, steps=512):
    """
    A superellipse inscribed in a `size` box, as `magick -draw polygon` points.

    Parametric rather than implicit so that the point spacing stays even around
    the corners, which is where a coarse polygon shows.
    """
    radius = size / 2 - inset
    centre = size / 2
    points = []
    for index in range(steps):
        theta = 2 * math.pi * index / steps
        cos_t, sin_t = math.cos(theta), math.sin(theta)
        x = centre + radius * math.copysign(
            abs(cos_t) ** (2 / SQUIRCLE_N), cos_t
        )
        y = centre + radius * math.copysign(
            abs(sin_t) ** (2 / SQUIRCLE_N), sin_t
        )
        points.append(f"{x:.2f},{y:.2f}")
    return " ".join(points)


def squircle_path(size, inset=0.0, steps=256):
    """The same shape as an SVG path, for the vector outputs."""
    radius = size / 2 - inset
    centre = size / 2
    parts = []
    for index in range(steps):
        theta = 2 * math.pi * index / steps
        cos_t, sin_t = math.cos(theta), math.sin(theta)
        x = centre + radius * math.copysign(abs(cos_t) ** (2 / SQUIRCLE_N), cos_t)
        y = centre + radius * math.copysign(abs(sin_t) ** (2 / SQUIRCLE_N), sin_t)
        parts.append(f"{'M' if index == 0 else 'L'}{x:.2f} {y:.2f}")
    parts.append("Z")
    return "".join(parts)


# --- Plate composition -------------------------------------------------------


def build_plate(destination, size, plate_colour, mark, mark_fraction, artwork=1.0):
    """
    One plate icon: superellipse in `plate_colour`, `mark` centred on top.

    `artwork` shrinks the plate inside the canvas without shrinking the canvas,
    which is what macOS wants and what every other platform does not.
    """
    plate_size = size * artwork
    offset = (size - plate_size) / 2
    mark_size = max(1, round(plate_size * mark_fraction))

    magick(
        "-size",
        f"{size}x{size}",
        "xc:none",
        "-fill",
        plate_colour,
        "-draw",
        f"translate {offset:.2f},{offset:.2f} "
        f"polygon {squircle_points(plate_size)}",
        "(",
        mark,
        "-resize",
        f"{mark_size}x{mark_size}",
        ")",
        "-gravity",
        "center",
        "-compose",
        "over",
        "-composite",
        destination,
    )


def tint(source, destination, colour, size):
    """The mark alone, recoloured, on transparency."""
    magick(
        source,
        "-resize",
        f"{size}x{size}",
        "-fill",
        colour,
        "-colorize",
        "100",
        destination,
    )


def resize(source, destination, size):
    magick(source, "-resize", f"{size}x{size}", "-strip", destination)


# --- Contour tracing ---------------------------------------------------------


def read_alpha_bitmap(source, resolution):
    """
    The mark's alpha channel as a `resolution`-wide binary grid.

    Goes through PGM rather than a Python PNG decoder because ImageMagick is
    already a dependency and `P5` is four lines of parsing.
    """
    raw = subprocess.run(
        [
            "magick",
            str(source),
            "-alpha",
            "extract",
            "-resize",
            f"{resolution}x{resolution}",
            "-threshold",
            "50%",
            "-depth",
            "8",
            "pgm:-",
        ],
        capture_output=True,
    )
    if raw.returncode != 0:
        raise RuntimeError(raw.stderr.decode("utf-8", "replace"))

    data = raw.stdout
    fields = []
    cursor = 0
    while len(fields) < 4:
        while cursor < len(data) and data[cursor : cursor + 1].isspace():
            cursor += 1
        if data[cursor : cursor + 1] == b"#":
            while cursor < len(data) and data[cursor] != 0x0A:
                cursor += 1
            continue
        start = cursor
        while cursor < len(data) and not data[cursor : cursor + 1].isspace():
            cursor += 1
        fields.append(data[start:cursor])
    cursor += 1

    if fields[0] != b"P5":
        raise RuntimeError(f"expected a P5 bitmap, got {fields[0]!r}")
    width, height = int(fields[1]), int(fields[2])
    pixels = data[cursor : cursor + width * height]
    grid = [
        [pixels[y * width + x] > 127 for x in range(width)] for y in range(height)
    ]
    return grid, width, height


def contours(grid, width, height):
    """
    Every boundary loop in the bitmap, as integer corner polygons.

    Crack following: each foreground pixel contributes one directed edge per
    background-facing side, oriented so the foreground is consistently on one
    side. Linking those edges head to tail yields outer boundaries in one
    winding and holes in the other, which is exactly what `fill-rule="evenodd"`
    wants — so no containment test is needed.
    """
    edges = {}

    def add(start, end):
        edges.setdefault(start, []).append(end)

    def filled(x, y):
        return 0 <= x < width and 0 <= y < height and grid[y][x]

    for y in range(height):
        row = grid[y]
        for x in range(width):
            if not row[x]:
                continue
            if not filled(x, y - 1):
                add((x, y), (x + 1, y))
            if not filled(x + 1, y):
                add((x + 1, y), (x + 1, y + 1))
            if not filled(x, y + 1):
                add((x + 1, y + 1), (x, y + 1))
            if not filled(x - 1, y):
                add((x, y + 1), (x, y))

    loops = []
    for origin in list(edges):
        while edges.get(origin):
            loop = [origin]
            current = origin
            while True:
                candidates = edges.get(current)
                if not candidates:
                    break
                # At a diagonal pinch a vertex has two exits. Taking the last
                # one added keeps the two lobes separate rather than welding
                # them into a figure eight.
                nxt = candidates.pop()
                if not candidates:
                    del edges[current]
                if nxt == origin:
                    break
                loop.append(nxt)
                current = nxt
            if len(loop) > 3:
                loops.append(loop)
    return loops


def simplify(points, epsilon):
    """Ramer-Douglas-Peucker, iterative so a long staircase cannot blow the stack."""
    if len(points) < 3:
        return points

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]

    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, ay = points[first]
        bx, by = points[last]
        dx, dy = bx - ax, by - ay
        span = math.hypot(dx, dy)
        worst, worst_index = 0.0, -1
        for index in range(first + 1, last):
            px, py = points[index]
            if span == 0:
                distance = math.hypot(px - ax, py - ay)
            else:
                distance = abs(dy * px - dx * py + bx * ay - by * ax) / span
            if distance > worst:
                worst, worst_index = distance, index
        if worst > epsilon:
            keep[worst_index] = True
            stack.append((first, worst_index))
            stack.append((worst_index, last))

    return [point for point, kept in zip(points, keep) if kept]


def smooth_path(points, scale, offset):
    """
    A closed polygon as quadratic beziers through its edge midpoints.

    Each surviving vertex becomes a control point and each midpoint an anchor,
    which is the standard trick for turning a simplified polyline back into a
    curve without fitting anything. On a staircase from a threshold it removes
    the stair without rounding real corners, because a real corner survives
    simplification as two nearly collinear midpoints on either side of it.
    """

    def place(point):
        x, y = point
        return (x * scale + offset, y * scale + offset)

    count = len(points)
    if count < 3:
        return ""

    def midpoint(index):
        ax, ay = place(points[index % count])
        bx, by = place(points[(index + 1) % count])
        return ((ax + bx) / 2, (ay + by) / 2)

    start = midpoint(0)
    parts = [f"M{start[0]:.2f} {start[1]:.2f}"]
    for index in range(1, count + 1):
        cx, cy = place(points[index % count])
        mx, my = midpoint(index)
        parts.append(f"Q{cx:.2f} {cy:.2f} {mx:.2f} {my:.2f}")
    parts.append("Z")
    return "".join(parts)


def trace_mark(source, resolution, epsilon, view, inset):
    """
    The mark as one SVG path string in a `view`-unit box.

    `inset` is padding inside the viewBox, in view units, so a caller can put
    the mark on a plate without doing the arithmetic twice.
    """
    grid, width, height = read_alpha_bitmap(source, resolution)
    scale = (view - 2 * inset) / max(width, height)
    parts = []
    for loop in contours(grid, width, height):
        reduced = simplify(loop, epsilon)
        if len(reduced) < 3:
            continue
        parts.append(smooth_path(reduced, scale, inset))
    if not parts:
        raise RuntimeError("traced nothing — is the source fully transparent?")
    return "".join(parts)


# --- Windows bitmap ----------------------------------------------------------


def write_bmp32(source, destination, width, height, background):
    """
    The installer watermark, as an uncompressed 32-bit BGRA bottom-up BMP.

    ImageMagick writes BMP3 by default and NSIS wants the alpha channel, so the
    header is written here rather than argued with.
    """
    raw = subprocess.run(
        [
            "magick",
            "-size",
            f"{width}x{height}",
            f"xc:{background}",
            "(",
            str(source),
            "-resize",
            f"{int(width * 0.62)}x{int(width * 0.62)}",
            ")",
            "-gravity",
            "center",
            "-composite",
            "-depth",
            "8",
            "RGBA:-",
        ],
        capture_output=True,
    )
    if raw.returncode != 0:
        raise RuntimeError(raw.stderr.decode("utf-8", "replace"))

    rgba = raw.stdout
    rows = []
    for y in range(height - 1, -1, -1):
        row = bytearray()
        for x in range(width):
            index = (y * width + x) * 4
            r, g, b, a = rgba[index : index + 4]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    pixels = b"".join(rows)

    header_size = 14 + 40
    file_header = b"BM" + struct.pack(
        "<IHHI", header_size + len(pixels), 0, 0, header_size
    )
    info_header = struct.pack(
        "<IiiHHIIiiII", 40, width, height, 1, 32, 0, len(pixels), 2835, 2835, 0, 0
    )
    Path(destination).write_bytes(file_header + info_header + pixels)


# --- Outputs -----------------------------------------------------------------

SVG_HEADER = """<?xml version="1.0" encoding="UTF-8"?>
<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->
<!-- Generated by scripts/trance-branding.py from docs/trance/brand/mark-black.png.
   - Do not edit by hand; edit the source mark and run the script. -->
"""


def write_svg(destination, body):
    Path(destination).write_text(SVG_HEADER + body, encoding="utf-8")


def build_icns(logo_mac, destination, work):
    """`.icns` via `iconutil`, which needs a directory laid out exactly like this."""
    iconset = work / "trance.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir(parents=True)
    for size in ICNS_SIZES:
        resize(logo_mac, iconset / f"icon_{size}x{size}.png", size)
        if size * 2 <= 1024:
            resize(logo_mac, iconset / f"icon_{size}x{size}@2x.png", size * 2)
    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(destination)], check=True
    )
    shutil.rmtree(iconset)


def build_ico(plate_png, destination, sizes=ICO_SIZES):
    magick(
        plate_png,
        "-define",
        f"icon:auto-resize={','.join(str(size) for size in sizes)}",
        destination,
    )


def build_document_icon(destination, work, tag=None):
    """
    A document icon: a white page with the mark on it, and an optional tag band.

    Not the mark on a plate. A file-type icon that looks like the application
    icon is the one thing a file manager cannot use, because every Trance
    document then looks like Trance itself.
    """
    page = work / f"page-{'pdf' if tag else 'html'}.png"
    args = [
        "-size",
        "1024x1024",
        "xc:none",
        "-fill",
        "#F5F6F8",
        "-stroke",
        "#C7CBD4",
        "-strokewidth",
        "8",
        "-draw",
        "roundrectangle 170,60 854,964 40,40",
        "-stroke",
        "none",
        "(",
        str(MARK_BLACK),
        "-resize",
        "420x420",
        "-fill",
        PLATE,
        "-colorize",
        "100",
        ")",
        "-gravity",
        "center",
        "-composite",
    ]
    if tag:
        args += [
            "-fill",
            tag,
            "-draw",
            "roundrectangle 170,700 620,880 24,24",
        ]
    magick(*args, page)
    build_ico(page, destination)
    page.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--resolution",
        type=int,
        default=1080,
        help="tracing resolution; higher is more faithful and larger (default 1080)",
    )
    parser.add_argument(
        "--epsilon",
        type=float,
        default=1.1,
        help="tracing tolerance in source pixels (default 1.1)",
    )
    args = parser.parse_args()

    require("magick")
    for source in (MARK_BLACK, MARK_WHITE):
        if not source.exists():
            sys.exit(f"trance-branding: missing source mark {source}")

    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    work = ROOT / "build" / "trance-branding"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    print("· application icon")
    master = work / "logo-master.png"
    build_plate(master, 1024, PLATE, MARK_WHITE, MARK_SCALE_PLATE)
    for size in LOGO_SIZES:
        resize(master, BRANDING_DIR / f"logo{size}.png", size)
    shutil.copyfile(BRANDING_DIR / "logo1024.png", BRANDING_DIR / "logo.png")

    print("· macOS icon")
    logo_mac = BRANDING_DIR / "logo-mac.png"
    build_plate(logo_mac, 1024, PLATE, MARK_WHITE, MARK_SCALE_PLATE, MACOS_ARTWORK)
    if shutil.which("iconutil"):
        build_icns(logo_mac, BRANDING_DIR / "firefox.icns", work)
    else:
        print("  (no iconutil — firefox.icns left as it was)")

    print("· Windows icons")
    build_ico(master, BRANDING_DIR / "firefox.ico")
    shutil.copyfile(BRANDING_DIR / "firefox.ico", BRANDING_DIR / "firefox64.ico")

    private_master = work / "logo-private.png"
    build_plate(private_master, 1024, PLATE_PRIVATE, MARK_WHITE, MARK_SCALE_PLATE)
    build_ico(private_master, BRANDING_DIR / "pbmode.ico")

    build_document_icon(BRANDING_DIR / "document.ico", work)
    build_document_icon(BRANDING_DIR / "document_pdf.ico", work, tag=PDF_TAG)

    print("· Windows tiles and watermark")
    for size in (70, 150):
        # Tiles sit on a colour the OS picks, so they ship the bare mark.
        tint(MARK_WHITE, BRANDING_DIR / f"VisualElements_{size}.png", MARK_INK, size)
        resize(private_master, BRANDING_DIR / f"PrivateBrowsing_{size}.png", size)
    write_bmp32(MARK_WHITE, BRANDING_DIR / "wizWatermark.bmp", 164, 314, PLATE)

    print("· about: art")
    about = work / "about-logo.png"
    shutil.copyfile(master, about)
    resize(about, CONTENT_DIR / "about-logo.png", 512)
    resize(about, CONTENT_DIR / "about-logo@2x.png", 1024)
    resize(private_master, CONTENT_DIR / "about-logo-private.png", 192)
    resize(private_master, CONTENT_DIR / "about-logo-private@2x.png", 384)

    print(f"· tracing the mark at {args.resolution}px, epsilon {args.epsilon}")
    glyph = trace_mark(MARK_BLACK, args.resolution, args.epsilon, 1024, 224)
    plate = squircle_path(1024)

    write_svg(
        CONTENT_DIR / "about-logo.svg",
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
        f'width="1024" height="1024" role="img" aria-label="Trance">\n'
        f'  <path d="{plate}" fill="{PLATE}"/>\n'
        f'  <path d="{glyph}" fill="{MARK_INK}" fill-rule="evenodd"/>\n'
        f"</svg>\n",
    )
    write_svg(
        CONTENT_DIR / "about-logo-private.svg",
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
        f'width="1024" height="1024" role="img" aria-label="Trance private browsing">\n'
        f'  <path d="{plate}" fill="{PLATE_PRIVATE}"/>\n'
        f'  <path d="{glyph}" fill="{MARK_INK}" fill-rule="evenodd"/>\n'
        f"</svg>\n",
    )

    # The chrome copy is the bare mark in `currentColor`, with no plate and no
    # padding: it is drawn inside Trance's own UI, which already has a surface
    # under it and sets its own colour (TRANCE.md §3.8).
    bare = trace_mark(MARK_BLACK, args.resolution, args.epsilon, 24, 0)
    write_svg(
        ICONS_DIR / "trance-mark.svg",
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
        f'width="24" height="24" fill="currentColor">\n'
        f'  <path d="{bare}" fill-rule="evenodd"/>\n'
        f"</svg>\n",
    )

    print("· installer background")
    write_svg(
        BRANDING_DIR / "MacOSInstaller.svg",
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" '
        f'width="640" height="400">\n'
        f'  <rect width="640" height="400" fill="{PLATE}"/>\n'
        f'  <g transform="translate(288 120) scale(0.0625)">\n'
        f'    <path d="{glyph}" fill="{MARK_INK}" fill-rule="evenodd" opacity="0.14"/>\n'
        f"  </g>\n"
        f"</svg>\n",
    )

    shutil.rmtree(work)
    total = sum(
        path.stat().st_size
        for path in [*BRANDING_DIR.glob("*"), *CONTENT_DIR.glob("*")]
        if path.is_file()
    )
    print(f"done — {total / 1024:.0f}KB across configs/branding/trance/")


if __name__ == "__main__":
    main()
