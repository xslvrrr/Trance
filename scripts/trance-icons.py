#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: regenerate the icon mapping stylesheets.
#
# The Trance icon set is adapted from "Context Menu Icons" by Starry
# (https://github.com/Starry-AXQG/Context-Menu-Icons), MIT licensed. That mod
# ships two complete packs — FluentUI and ZenUI — and, more usefully, a mapping
# from roughly three hundred browser element ids to a glyph in each. The glyphs
# are assets; the mapping is the part that took the work.
#
# Trance cannot use the mod's stylesheets directly. Every declaration in them
# carries `!important`, because a mod stylesheet injected through Sine has no
# other way to beat Firefox's own `list-style-image`. Trance ships inside the
# browser and loads its sheets last as author sheets, so it needs none, and
# `!important` is banned outright in `src/zen/trance/**` (TRANCE.md §6.2 rule 1)
# precisely because that arms race is what made the mod stack nondeterministic.
#
# So the mapping is extracted rather than copied: this script reads the mod's
# own CSS, pulls out the selector-to-glyph pairs, drops everything else, and
# re-emits them nested under Trance's feature attribute with no `!important` and
# chrome:// URLs. Re-running it against a newer release of the mod produces a
# diff to review, not a merge to resolve.
#
# Usage:
#     python3 scripts/trance-icons.py --source <path-to-Context-Menu-Icons>
#
# Writes:
#     src/zen/trance/styles/trance-icons-fluent.css
#     src/zen/trance/styles/trance-icons-zen.css
#
# The SVG assets themselves are vendored once, by hand, into
# src/zen/trance/icons/{fluent,zen}/ — they are files, not generated.
#
# Refs: TRANCE.md §3.8, §6.2, §13 Phase 5; docs/trance/mods/context-menu-icons.md

import argparse
import pathlib
import re
import sys

PACKS = {
    "fluent": ("CMI/FluentUI", "Fluent-icons.css"),
    "zen": ("CMI/ZenUI", "Zen-icons.css"),
}

ICON_ROOT = "chrome://browser/content/trance-icons"

FEATURE_SELECTOR = ':root[trance="true"][trance-chrome-icons="true"]'

# `list-style-image` is how a XUL menu item, toolbar button or subview button
# takes an icon. `--menu-image` is CMI's own indirection for checkable items,
# whose native tick occupies the icon slot; Trance keeps the same name so the
# checkbox rules in trance-chrome.css read the same way.
DECL = re.compile(
    r'(?P<prop>list-style-image|--menu-image)\s*:\s*url\(\s*["\']?'
    r'(?P<icon>[^"\')]+?)\.svg["\']?\s*\)',
    re.IGNORECASE,
)

# Anything that is not a plain selector: at-rules, and CMI's own pref gates.
AT_RULE = re.compile(r"^\s*@")

# Elements belonging to the mod itself or to other mods it interoperates with.
# They never exist in a Trance build, so carrying the rules over would leave
# permanently dead selectors in a project whose whole argument is that dead and
# conflicting rules are the problem.
FOREIGN = re.compile(r"#(?:cmi-|quicktabs-|quicksearch-)")

HEADER = """/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Trance: the {label} icon mapping. GENERATED — do not edit.
 *   Regenerate with `python3 scripts/trance-icons.py`.
 *
 * Adapted from "Context Menu Icons" by Starry
 * (https://github.com/Starry-AXQG/Context-Menu-Icons), MIT licensed. The glyphs
 * and this selector-to-glyph mapping are that project's work; see
 * docs/trance/THIRD-PARTY.md for the licence text and docs/trance/CREDITS.md
 * for the attribution.
 *
 * What changed on the way in, and why:
 *
 *   - Every `!important` is gone. A mod stylesheet needs them to beat Firefox's
 *     own `list-style-image`; Trance ships inside the browser and loads this as
 *     an author sheet after the document's own, so equal specificity is enough
 *     (TRANCE.md §3.1, §6.2 rule 1).
 *   - Relative `url("save.svg")` became `chrome://` URLs against real files in
 *     the chrome jar, so one copy is parsed and cached rather than one per rule
 *     (TRANCE.md §3.8).
 *   - Everything that was not an icon assignment — layout overrides, the
 *     item-hiding rules, the fold-menu script's hooks — was dropped. Those are
 *     separate behaviours and they were investigated separately
 *     (docs/trance/mods/context-menu-icons.md §2).
 *
 * There are two of these files, one per pack, and TranceChrome loads exactly
 * one. Gating both on a root attribute inside a single sheet would mean parsing
 * {double} rules to use {count}; loading by URL means the pack you are not using
 * costs nothing at all (TRANCE.md §6.5).
 *
 * {count} assignments.
 */

"""


def flatten(stack, selector):
    """Resolve a nested selector against its ancestors, CSS-nesting style."""
    parent = stack[-1] if stack else ""
    parts = []
    for piece in split_selectors(selector):
        if "&" in piece:
            if not parent:
                parts.append(piece.replace("&", "").strip())
                continue
            resolved = ", ".join(
                piece.replace("&", p.strip()) for p in split_selectors(parent)
            )
            parts.append(resolved)
        elif parent:
            parts.extend(
                f"{p.strip()} {piece}" for p in split_selectors(parent)
            )
        else:
            parts.append(piece)
    return ", ".join(part for part in parts if part)


def split_selectors(selector):
    """Split on commas that are not inside brackets or parentheses."""
    out, depth, current = [], 0, ""
    for char in selector:
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        if char == "," and depth == 0:
            out.append(current.strip())
            current = ""
        else:
            current += char
    if current.strip():
        out.append(current.strip())
    return out


def strip_comments(text):
    return re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)


def extract(css):
    """
    Walk the stylesheet and yield (selector, property, icon-name).

    A brace-matching walk rather than a real parser: the input is one known
    file whose shape does not change between releases, and a dependency on
    postcss from a Python script in a Firefox tree is not worth the accuracy.
    At-rules contribute no selector — CMI's are `@media` pref gates and a
    `prefers-reduced-motion` block, none of which Trance carries over.
    """
    css = strip_comments(css)
    stack, buffer, index = [], "", 0

    while index < len(css):
        char = css[index]
        if char == "{":
            head = buffer.strip()
            buffer = ""
            if AT_RULE.match(head):
                # Keep the ancestor context, add nothing.
                stack.append(stack[-1] if stack else "")
            else:
                stack.append(flatten(stack, head))
            index += 1
            continue
        if char == "}":
            yield from declarations(stack, buffer)
            buffer = ""
            if stack:
                stack.pop()
            index += 1
            continue
        if char == ";":
            yield from declarations(stack, buffer)
            buffer = ""
            index += 1
            continue
        buffer += char
        index += 1


def declarations(stack, buffer):
    selector = stack[-1] if stack else ""
    if not selector:
        return
    match = DECL.search(buffer)
    if not match:
        return
    icon = match.group("icon").strip()
    # Some of the mod's assignments point at `chrome://browser/skin/...` — the
    # browser's own glyph, reused. Those are not pack assets and there is
    # nothing to adapt: leaving the element alone produces the same icon at no
    # cost. Skipped rather than rewritten.
    if "://" in icon:
        return
    yield selector, match.group("prop"), icon


def normalise(icon):
    """
    The mod's file names mix conventions — `TabGroup-add`, `unloadTab`,
    `folder_sync_convert`, `privateBrowsing`. TranceIcons' contract is
    kebab-case (TRANCE.md §14.2), and the vendored assets are renamed to match,
    so the mapping is renamed the same way.
    """
    icon = icon.split("/")[-1]
    icon = icon.replace("_", "-")
    icon = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", icon)
    return icon.lower()


def nest(part):
    """
    Rewrite one of the mod's selectors as a child of the feature selector.

    A selector that already starts at `:root` — CMI has several, for Zen's
    right-hand sidebar — must compound onto the feature selector rather than
    descend from it. `:root[trance] :root[zen-right-side]` matches nothing: a
    document has one root and it cannot be its own descendant.
    """
    part = part.strip()
    if part.startswith(":root"):
        return "&" + part[len(":root") :]
    return f"& {part}"


# The stylelint budget is one ID or three classes/attributes per selector
# (TRANCE.md §6.2 rule 7). A handful of the mod's selectors are longer than
# that — urlbar result rows, mostly — and they are longer because that is where
# the element actually is, not because anyone was winning an argument. They get
# the documented opt-out rather than a rewrite.
ID = re.compile(r"#[\w-]+")
CLASS_OR_ATTR = re.compile(r"\.[\w-]+|\[[^\]]+\]")
FUNCTIONAL_PSEUDO = re.compile(r":(?:is|where|not|has|matches)\([^)]*\)", re.I)


def over_budget(part):
    flat = FUNCTIONAL_PSEUDO.sub(":x", part)
    return len(ID.findall(flat)) > 1 or len(CLASS_OR_ATTR.findall(flat)) > 3


def emit(pairs, pack, label):
    lines = [
        HEADER.format(
            label=label,
            count=len(pairs),
            double=len(pairs) * 2,
        ),
        f"{FEATURE_SELECTOR} {{\n",
    ]
    for selector, prop, icon in pairs:
        url = f'url("{ICON_ROOT}/{pack}/{icon}.svg")'
        parts = [nest(part) for part in split_selectors(selector)]
        nested = ",\n  ".join(parts)
        note = ""
        if any(over_budget(part) for part in parts):
            note = (
                "  /* trance-specificity: the element's own position in the\n"
                "   * tree, carried over from the upstream mapping. */\n"
            )
        lines.append(f"{note}  {nested} {{\n    {prop}: {url};\n  }}\n\n")
    lines.append("}\n")
    return "".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        required=True,
        type=pathlib.Path,
        help="checkout of Starry-AXQG/Context-Menu-Icons",
    )
    parser.add_argument(
        "--out",
        type=pathlib.Path,
        default=pathlib.Path(__file__).resolve().parent.parent
        / "src/zen/trance/styles",
    )
    args = parser.parse_args()

    for pack, (directory, filename) in PACKS.items():
        source = args.source / directory / filename
        if not source.is_file():
            sys.exit(f"missing {source}")

        assets = {
            path.stem
            for path in (args.out.parent / "icons" / pack).glob("*.svg")
        }
        if not assets:
            sys.exit(
                f"no vendored assets in {args.out.parent / 'icons' / pack}"
            )

        seen, pairs, gaps = set(), [], set()
        for selector, prop, icon in extract(source.read_text("utf-8")):
            key = (selector, prop)
            if key in seen:
                continue
            seen.add(key)
            selector = ", ".join(
                part
                for part in split_selectors(selector)
                if not FOREIGN.search(part)
            )
            if not selector:
                continue
            icon = normalise(icon)
            # A pack is allowed to be incomplete. The two packs do not have the
            # same glyph list — ZenUI has 31 Fluent does not, Fluent has 22
            # ZenUI does not — and filling a gap from the other pack would put
            # two drawing styles in one menu. The element keeps the browser's
            # own icon instead (docs/trance/mods/context-menu-icons.md §8).
            if icon not in assets:
                gaps.add(icon)
                continue
            pairs.append((selector, prop, icon))

        label = "Fluent UI" if pack == "fluent" else "Zen UI"
        target = args.out / f"trance-icons-{pack}.css"
        target.write_text(emit(pairs, pack, label), "utf-8")
        print(f"{target}: {len(pairs)} assignments")
        if gaps:
            print(
                f"  {len(gaps)} not in this pack, left to the browser: "
                + ", ".join(sorted(gaps))
            )


if __name__ == "__main__":
    main()
