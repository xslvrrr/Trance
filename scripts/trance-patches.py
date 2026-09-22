#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: patch-set integrity.
#
# AUDIT.md Phase 6 asks for four things this script provides:
#
#   * one canonical *ordered* patch manifest, with the base and result blob
#     hashes each patch declares;
#   * an import that fails when a declared patch is not reflected in `engine/`;
#   * no absolute symlinks inside `engine/`;
#   * a named list of files with more than one patch owner.
#
# Why an explicit order is needed at all. `surfer import` collects patches with
# `tiny-glob('**/*.patch')` over `src/`, which returns directory-read order —
# a property of the filesystem, not of the repository. It then runs
# `git apply -R` (ignoring failure) followed by `git apply` for each one, with
# `--ignore-space-change --ignore-whitespace` and no `--3way`, so the `index`
# hashes in the patch headers are never checked. For the 294 files exactly one
# patch touches, that is harmless. For the handful two patches touch, the order
# two machines pick can differ, and nothing reports it.
#
# This script does not change how surfer applies patches. It records what the
# patches *claim*, and checks the engine against that claim afterwards, which
# is the half that was missing.
#
# Usage:
#   python3 scripts/trance-patches.py manifest   # regenerate the manifest
#   python3 scripts/trance-patches.py verify     # check engine/ against it
#   python3 scripts/trance-patches.py relink     # absolute symlinks -> relative
#   python3 scripts/trance-patches.py overlaps   # files with >1 patch owner
#
# `verify` and `relink` are what `npm run import` runs; `manifest` is run by a
# human after adding, removing or re-exporting a patch.

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "src"
TESTS = REPO / "tests"
ENGINE = REPO / "engine"
MANIFEST = REPO / "docs" / "trance" / "patch-manifest.json"

SCHEMA = 1

# Ownership, decided by where the patch lives. The distinction is not cosmetic:
# a `zen` patch is Zen's and conflicts on every upstream rebase, a `trance`
# patch is ours, and an `external` patch is a third party's and is governed by
# `src/external-patches/manifest.json` rather than by this tree.
OWNERS = (
    ("src/external-patches/firefox/", "external:firefox"),
    ("src/external-patches/librewolf/", "external:librewolf"),
    ("src/zen/trance/", "trance"),
)
DEFAULT_OWNER = "zen"

# Engine files more than one patch writes to, and why each one is allowed to
# stay that way.
#
# AUDIT.md Phase 6 asks to "resolve overlapping patch owners". Resolving does
# not mean merging: every overlap below is a third-party Firefox patch meeting
# a fork patch in one upstream file, and folding the third-party half into the
# fork half would destroy the provenance that lets it be dropped when Firefox
# lands it. What was actually missing is that the overlaps were unnamed and
# unbounded — nothing said which files had two owners, and a seventh could
# appear without a word. So they are declared here, and an undeclared one
# fails `manifest --check` and `verify`.
#
KNOWN_OVERLAPS = {
    "gfx/wr/webrender/src/renderer/mod.rs": (
        "Two unrelated Firefox patches in one WebRender file: the "
        "opaque-backdrop fallback (ADR-065) and corner-shape rendering."
    ),
    "modules/libpref/init/StaticPrefList.yaml": (
        "The opaque-backdrop patch declares `gfx.webrender."
        "opaque-backdrop-fallback`; Zen's own patch declares Zen's static "
        "prefs. Both append entries to a long list and never touch each "
        "other's."
    ),
    "toolkit/components/pictureinpicture/PictureInPicture.sys.mjs": (
        "A Firefox fix (issue 14710) meeting Zen's own PiP patch."
    ),
    "toolkit/moz.configure": (
        "LibreWolf's `firefox-in-ua` patch meeting the configure patch that "
        "carries MOZ_APP_PROFILE and MOZ_APP_VENDOR (ADR-014)."
    ),
    "widget/cocoa/nsCocoaWindow.h": (
        "The native-popovers Firefox fix meeting Zen's Cocoa window patch."
    ),
    "widget/cocoa/nsCocoaWindow.mm": (
        "Three owners: the native-popovers fix, the tiled-attribute patch, "
        "and Zen's Cocoa window patch — which Trance extends with "
        "ZenWindowMaterialView's occlusion states (touchpoint 37, ADR-061)."
    ),
}

# Order.
#
# Surfer applies `**/*.patch` in the order tiny-glob returns it, which is
# readdir order — a property of the filesystem, not of this repository. The
# manifest's order is the canonical one and surfer does not read it, so for
# most of the tree the two only agree by accident.
#
# For 250 of the 256 patches that is harmless, because no two of them write to
# the same file: any order produces the same engine. It stops being harmless
# where two patches share a file *and* edit the same region, because then one
# of them is applying to text the other rewrote.
#
# `order_sensitive_files()` computes that set from the hunk headers rather than
# assuming it: two patches on one file whose pre-image ranges come within
# ORDER_MARGIN lines of each other are order-sensitive, everything else is
# provably not. Each one found has to be declared below, saying which patch
# goes first and why that is the order that survives. An undeclared one fails
# `manifest --check` and `verify`, which is the "fail when order cannot be
# proven" half of AUDIT.md Phase 6 — the half that is achievable without
# forking surfer.
#
# The other half is that a wrong order cannot pass unnoticed: every patch must
# reverse-apply cleanly out of the finished engine (`_is_reflected`), and a
# patch applied to text a later patch had already rewritten does not.
ORDER_MARGIN = 3  # git's default context, in lines

ORDER_RULES = {
    "toolkit/components/pictureinpicture/PictureInPicture.sys.mjs": (
        "Firefox issue 14710 and Zen's own PiP patch both edit the block "
        "around line 120. Both reverse-apply cleanly out of the finished "
        "engine, so whichever order surfer used produced a file that contains "
        "both edits; a swap that broke either one would fail `verify`."
    ),
    "widget/cocoa/nsCocoaWindow.mm": (
        "The tiled-attribute patch adds ~5 lines above the window-visibility "
        "block, and Zen's Cocoa patch — which Trance extends with "
        "ZenWindowMaterialView (ADR-061) — carries hunks at 6953/6966/7060 "
        "against the tiled patch's 6948/6961/7055. The fork patch's pre-image "
        "*is* the tiled patch's post-image, so the tiled patch applies first. "
        "A swap is caught rather than guessed at: the fork patch would not "
        "reverse-apply out of the finished engine, which is `verify`'s "
        "not-reflected failure."
    ),
    "toolkit/moz.configure": (
        "LibreWolf's `firefox-in-ua` patch and the configure patch carrying "
        "MOZ_APP_PROFILE and MOZ_APP_VENDOR (ADR-014) both edit the app-name "
        "block at the top of the file. Both reverse-apply cleanly out of the "
        "finished engine; a swap that dropped either edit would fail "
        "`verify`."
    ),
}

# Constant conditions a patch *adds*, which is what makes the code after them
# unreachable. AUDIT.md Phase 6 asks for these to be removed, and the rule this
# tool enforces is narrower than that, deliberately:
#
#   remove a dead path when removing it makes the patch smaller;
#   leave it, recorded, when removing it makes the patch bigger.
#
# Every constant condition below is Zen switching off a block of Firefox's own
# code. Deleting the block turns a one-line edit into thirty lines of deletion
# against a file Firefox actively churns, so it trades a dead branch nobody
# executes for a rebase conflict somebody has to resolve every few weeks —
# which is the opposite of retiring debt. The first case does exist and this
# phase took it: `drag-and-drop.js` had three teardown statements deleted, and
# restoring them removed three whole hunks (ADR-076).
#
# So these are inventoried and ratcheted rather than removed. A new one fails
# `verify`, including one Trance adds.
DEAD_PATH_PATTERNS = (
    ("false-and", re.compile(r"^\+.*\bfalse\s*&&")),
    ("and-false", re.compile(r"^\+.*&&\s*false\b")),
    ("if-false", re.compile(r"^\+\s*(\}\s*)?(else\s+)?if\s*\(\s*false\s*\)")),
    ("true-or", re.compile(r"^\+.*\(\s*true\s*\|\|")),
    ("or-true", re.compile(r"^\+.*\|\|\s*true\s*\)")),
)

DIFF_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+)$")
INDEX_LINE = re.compile(r"^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$")
HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,(\d+))? ")

# Directories `surfer import` symlinks into the engine wholesale rather than
# patching. Mirrors copy-patches.js: everything under src/ that is not a
# `.patch`, plus everything under tests/.
SKIP_DIR_PARTS = {"node_modules", "__pycache__"}


def rel(path):
    return str(Path(path).resolve().relative_to(REPO)).replace(os.sep, "/")


def owner_of(patch_rel):
    for prefix, name in OWNERS:
        if patch_rel.startswith(prefix):
            return name
    return DEFAULT_OWNER


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def external_sources():
    """`src/external-patches/manifest.json`, keyed by the file it produces.

    That manifest names where each third-party patch came from and never says
    which revision of it was taken: a `phabricator` entry is a revision id whose
    download is whatever diff is current, and the LibreWolf entry is a
    `branch/main` URL. Re-running `scripts/update_external_patches.py` can
    therefore change the fork's Firefox patches with no diff in this repository
    beyond the patch bodies themselves — which is exactly what "pin external
    patches to immutable revisions" (AUDIT.md Phase 6) is about.

    Recording the origin here and the content hash beside it makes the checked
    -in bytes the pin: a re-download that changes them fails
    `manifest --check` until somebody regenerates the manifest on purpose.

    Every failure here is fatal rather than skipped. A manifest that cannot be
    parsed, an entry whose `type` this does not understand, or a patch file
    with no entry that produces it, all mean the same thing: a third-party
    patch is in the tree and nothing records where it came from. Degrading to
    an unpinned `{"type": "?"}` would write that ignorance into the manifest
    and call it a pin.
    """
    source = REPO / "src" / "external-patches" / "manifest.json"
    if not source.exists():
        raise SystemExit(f"error: {rel(source)} does not exist")
    # The file is JSON with `//` comments (Zen reads it with its own decoder).
    text = re.sub(r"^\s*//.*$", "", source.read_text(encoding="utf-8"), flags=re.M)
    try:
        entries = json.loads(text)
    except json.JSONDecodeError as error:
        raise SystemExit(f"error: {rel(source)} is not parseable JSON: {error}")
    origins = {}
    for index, entry in enumerate(entries):
        kind = entry.get("type")
        if kind == "local":
            name = f"src/external-patches/{entry['path']}"
            origins[name] = {"type": "local"}
        elif kind == "phabricator":
            ids = entry.get("ids") or ([entry["id"]] if entry.get("id") else [])
            if not ids:
                raise SystemExit(
                    f"error: {rel(source)} entry {index} is a phabricator entry "
                    "with no revision id"
                )
            slug = re.sub(r"[^a-z0-9]+", "_", entry.get("name", "").lower()).strip("_")
            name = f"src/external-patches/firefox/{slug}.patch"
            origins[name] = {"type": "phabricator", "revisions": ids}
        elif kind == "patch":
            dest = entry.get("dest", "firefox")
            leaf = entry["url"].rsplit("/", 1)[-1]
            name = f"src/external-patches/{dest}/{leaf}"
            origins[name] = {"type": "url", "url": entry["url"]}
        else:
            raise SystemExit(
                f"error: {rel(source)} entry {index} has unknown type {kind!r}. "
                "Teach external_sources() what it produces, or remove it."
            )

    # The other direction: a patch file that no entry accounts for.
    on_disk = {
        rel(path)
        for path in (REPO / "src" / "external-patches").rglob("*.patch")
    }
    unaccounted = sorted(on_disk - set(origins))
    if unaccounted:
        raise SystemExit(
            "error: external patches with no entry in "
            f"{rel(source)}:\n  " + "\n  ".join(unaccounted)
        )
    return origins


def git_blob_hash(path):
    """The SHA-1 git would record for this file's contents.

    Recomputed here rather than shelled out to `git hash-object`, because
    `verify` runs it once per patched file and 300 subprocesses is the
    difference between a check that runs on every import and one that does not.
    """
    data = path.read_bytes()
    digest = hashlib.sha1()
    digest.update(b"blob %d\0" % len(data))
    digest.update(data)
    return digest.hexdigest()


def parse_patch(patch_path):
    """Return the targets a patch declares.

    Each target carries the base and result blob hashes from the `index` line,
    which is what makes an after-the-fact check possible: the result hash is
    exactly what `engine/<path>` should hash to once the patch has applied and
    nothing else has touched the file.
    """
    targets = []
    current = None
    text = patch_path.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        header = DIFF_HEADER.match(line)
        if header:
            if current:
                targets.append(current)
            current = {
                "path": header.group(2).strip(),
                "base": None,
                "result": None,
                "creates": False,
                "deletes": False,
            }
            continue
        if current is None:
            continue
        if line.startswith("new file mode"):
            current["creates"] = True
        elif line.startswith("deleted file mode"):
            current["deletes"] = True
        else:
            index = INDEX_LINE.match(line)
            if index and current["base"] is None:
                current["base"] = index.group(1)
                current["result"] = index.group(2)
    if current:
        targets.append(current)
    return targets


def dead_paths(patch_path):
    """Constant conditions this patch introduces, as (kind, text) pairs."""
    found = []
    for line in patch_path.read_text(encoding="utf-8", errors="replace").splitlines():
        for kind, pattern in DEAD_PATH_PATTERNS:
            if pattern.match(line):
                found.append({"kind": kind, "line": line.strip()[:120]})
    return found


def iter_patches():
    """Every patch in the tree, in one canonical order.

    Sorted by owner rank and then by path, so the sequence is a property of the
    repository rather than of the machine reading it. Overlapping files apply
    external-first, which is the order the checked-in patches were exported in:
    Zen's own patches were taken against a tree that already had the external
    ones.
    """
    rank = {"external:firefox": 0, "external:librewolf": 1, "zen": 2, "trance": 3}
    found = []
    for path in SRC.rglob("*.patch"):
        if SKIP_DIR_PARTS & set(path.parts):
            continue
        patch_rel = rel(path)
        found.append((rank[owner_of(patch_rel)], patch_rel, path))
    found.sort(key=lambda row: (row[0], row[1]))
    return [(patch_rel, path) for _, patch_rel, path in found]


def iter_manual():
    """Files surfer symlinks into the engine instead of patching.

    copy-patches.js globs `**/*` over `src/` (minus `.patch` files and
    `node_modules`) and over `tests/`, and symlinks each one into `engine/`.
    Those are Trance's own new files, so a missing one is exactly the failure
    mode this check exists for: it is in the tree, it is in `jar.inc.mn`, and
    it never reached the build.
    """
    entries = []
    for root, dest_root in ((SRC, ""), (TESTS, "browser/base/zen-components")):
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix == ".patch":
                continue
            if SKIP_DIR_PARTS & set(path.parts):
                continue
            # tiny-glob is called without `dot: true`, so surfer never imports a
            # path with a dot-prefixed segment. `.hgignore`, `.stylelintrc.js`
            # and friends reach the engine as `src/-<name>.patch` instead, which
            # is why that naming convention exists.
            if any(
                part.startswith(".")
                for part in path.relative_to(root).parts
            ):
                continue
            source = rel(path)
            inner = path.relative_to(root if root is SRC else REPO)
            target = str(Path(dest_root) / inner).replace(os.sep, "/")
            entries.append({"source": source, "engine": target})
    entries.sort(key=lambda row: row["engine"])
    return entries


def build_manifest():
    origins = external_sources()
    patches = []
    for patch_rel, path in iter_patches():
        pin = (
            {"sha256": sha256(path), "origin": origins.get(patch_rel, {"type": "?"})}
            if owner_of(patch_rel).startswith("external:")
            else None
        )
        targets = parse_patch(path)
        if not targets:
            # A patch that declares no `diff --git` header patches nothing.
            # Recorded rather than dropped, so `verify` can say so out loud.
            patches.append(
                {
                    "patch": patch_rel,
                    "owner": owner_of(patch_rel),
                    **({"pin": pin} if pin else {}),
                    "targets": [],
                }
            )
            continue
        patches.append(
            {
                "patch": patch_rel,
                "owner": owner_of(patch_rel),
                **({"pin": pin} if pin else {}),
                "targets": [
                    {
                        "path": t["path"],
                        "base": t["base"],
                        "result": t["result"],
                        **({"creates": True} if t["creates"] else {}),
                        **({"deletes": True} if t["deletes"] else {}),
                    }
                    for t in targets
                ],
            }
        )

    manual = iter_manual()
    overlaps = compute_overlaps(patches)
    sensitive = order_sensitive_files(overlaps)
    dead = {
        entry["patch"]: found
        for entry in patches
        if (found := dead_paths(REPO / entry["patch"]))
    }
    return {
        "$comment": (
            "Canonical ordered patch manifest. Generated by "
            "`python3 scripts/trance-patches.py manifest`; do not hand-edit. "
            "`order` is a property of this repository, not of the filesystem "
            "surfer happens to glob — surfer does not read this file, so "
            "`orderSensitiveFiles` names the only places where the "
            "difference can matter, and each one has to be ruled on. "
            "`base` and `result` are the blob hashes "
            "the patch header declares; `verify` hashes engine/<path> and "
            "compares it to `result`. See AUDIT.md Phase 6."
        ),
        "schema": SCHEMA,
        "generator": "scripts/trance-patches.py manifest",
        "counts": {
            "patches": len(patches),
            "patchedFiles": len({t["path"] for p in patches for t in p["targets"]}),
            "symlinkedFiles": len(manual),
            "filesWithMultipleOwners": len(overlaps),
            "orderSensitiveFiles": len(sensitive),
            "deadPaths": sum(len(v) for v in dead.values()),
        },
        "overlappingFiles": overlaps,
        "orderSensitiveFiles": sensitive,
        "deadPaths": dead,
        "patches": patches,
        "symlinked": manual,
    }


def compute_overlaps(patches):
    by_file = {}
    for entry in patches:
        for target in entry["targets"]:
            by_file.setdefault(target["path"], []).append(entry["patch"])
    return {
        path: {
            "patches": owners,
            "reason": KNOWN_OVERLAPS.get(path, "UNDECLARED — add it to "
                                               "KNOWN_OVERLAPS with a reason"),
            "declared": path in KNOWN_OVERLAPS,
        }
        for path, owners in sorted(by_file.items())
        if len(owners) > 1
    }


def hunk_ranges(patch_path):
    """Pre-image line ranges this patch touches, keyed by engine path."""
    ranges = {}
    current = None
    text = patch_path.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        header = DIFF_HEADER.match(line)
        if header:
            current = header.group(2).strip()
            continue
        if current is None:
            continue
        hunk = HUNK_HEADER.match(line)
        if hunk:
            start = int(hunk.group(1))
            length = int(hunk.group(2) or 1)
            ranges.setdefault(current, []).append((start, start + max(length, 1) - 1))
    return ranges


def order_sensitive_files(overlaps):
    """Overlapping files where two patches edit the same region.

    Ranges are compared with ORDER_MARGIN slack, because a hunk applies
    against its context lines as well as its changed ones.
    """
    sensitive = {}
    for path, row in overlaps.items():
        by_patch = {
            patch: hunk_ranges(REPO / patch).get(path, [])
            for patch in row["patches"]
        }
        patches = row["patches"]
        collisions = []
        for index, first in enumerate(patches):
            for second in patches[index + 1 :]:
                if any(
                    a_start - ORDER_MARGIN <= b_end
                    and b_start - ORDER_MARGIN <= a_end
                    for a_start, a_end in by_patch[first]
                    for b_start, b_end in by_patch[second]
                ):
                    collisions.append([first, second])
        if collisions:
            sensitive[path] = {
                "patches": collisions,
                "rule": ORDER_RULES.get(
                    path, "UNDECLARED — add it to ORDER_RULES with a reason"
                ),
                "declared": path in ORDER_RULES,
            }
    return sensitive


def unproven_order(sensitive):
    """Order-sensitive files nobody has ruled on, plus rules with no overlap."""
    new = sorted(p for p, row in sensitive.items() if not row["declared"])
    stale = sorted(set(ORDER_RULES) - set(sensitive))
    return new, stale


def undeclared_overlaps(overlaps):
    """Overlaps nobody has written a reason for, plus reasons with no overlap."""
    new = sorted(p for p, row in overlaps.items() if not row["declared"])
    stale = sorted(set(KNOWN_OVERLAPS) - set(overlaps))
    return new, stale


def write_manifest(manifest):
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8"
    )


def load_manifest():
    if not MANIFEST.exists():
        raise SystemExit(
            f"{rel(MANIFEST)} is missing. Run "
            "`python3 scripts/trance-patches.py manifest` first."
        )
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("schema") != SCHEMA:
        raise SystemExit(
            f"{rel(MANIFEST)} is schema {manifest.get('schema')}; this script "
            f"speaks schema {SCHEMA}. Regenerate it."
        )
    return manifest


# ---------------------------------------------------------------------------
# Commands


def cmd_manifest(args):
    manifest = build_manifest()
    if args.check:
        if not MANIFEST.exists():
            print(f"error: {rel(MANIFEST)} does not exist", file=sys.stderr)
            return 1
        current = MANIFEST.read_text(encoding="utf-8")
        wanted = json.dumps(manifest, indent=2, sort_keys=False) + "\n"
        if current != wanted:
            print(
                f"error: {rel(MANIFEST)} is stale. Run "
                "`python3 scripts/trance-patches.py manifest`.",
                file=sys.stderr,
            )
            return 1
        print(f"{rel(MANIFEST)} is up to date.")
        return 0
    write_manifest(manifest)
    counts = manifest["counts"]
    print(
        f"{rel(MANIFEST)}: {counts['patches']} patches, "
        f"{counts['patchedFiles']} patched files, "
        f"{counts['symlinkedFiles']} symlinked files, "
        f"{counts['filesWithMultipleOwners']} files with more than one owner."
    )
    return 0


def cmd_overlaps(args):
    manifest = load_manifest() if args.from_manifest else build_manifest()
    overlaps = manifest["overlappingFiles"]
    if not overlaps:
        print("No engine file has more than one patch owner.")
        return 0
    print(f"{len(overlaps)} engine files have more than one patch owner:")
    for path, row in overlaps.items():
        mark = " " if row["declared"] else "!"
        print(f" {mark}{path}")
        for patch in row["patches"]:
            print(f"      {patch}")
        print(f"      -> {row['reason']}")
    sensitive = manifest.get("orderSensitiveFiles") or order_sensitive_files(overlaps)
    if sensitive:
        print(
            f"\n{len(sensitive)} of them are order-sensitive — two patches "
            "edit the same region:"
        )
        for path, row in sensitive.items():
            mark = " " if row["declared"] else "!"
            print(f" {mark}{path}")
            for first, second in row["patches"]:
                print(f"      {first}")
                print(f"      {second}")
            print(f"      -> {row['rule']}")

    new, stale = undeclared_overlaps(overlaps)
    unproven, stale_rules = unproven_order(sensitive)
    for path in new:
        print(f"error: {path} has two owners and no recorded reason")
    for path in stale:
        print(f"error: {path} is declared in KNOWN_OVERLAPS but has one owner")
    for path in unproven:
        print(f"error: {path} is order-sensitive and has no ORDER_RULES entry")
    for path in stale_rules:
        print(f"error: {path} is in ORDER_RULES and is no longer order-sensitive")
    return 1 if (new or stale or unproven or stale_rules) else 0


def _is_reflected(patch_rel):
    """Is this patch present in the engine right now?

    Asked of git rather than answered by comparing hashes, and the difference
    matters. A blob hash proves the engine file is byte-identical to the tree
    the patch was exported from, which stops being true the moment upstream
    bumps the Firefox base under it — 152 of 256 patches fail that test today
    and every one of them is applied. Reverse-applying with the same arguments
    surfer used to apply it asks the question that was actually being asked:
    are these changes in the file?

    `--check` writes nothing.
    """
    result = subprocess.run(
        [
            "git",
            "apply",
            "-R",
            "--check",
            "--ignore-space-change",
            "--ignore-whitespace",
            str(REPO / patch_rel),
        ],
        cwd=ENGINE,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0, result.stderr.strip()


def _verify_patches(manifest, overlapping, strict_hashes):
    problems = []
    checked = 0
    for entry in manifest["patches"]:
        if not entry["targets"]:
            problems.append(("empty-patch", entry["patch"], "declares no target"))
            continue

        # A patch whose target files are absent has not half-applied; it has
        # not applied at all, and that is a clearer message than whatever git
        # says about a missing file.
        absent = [
            t["path"]
            for t in entry["targets"]
            if not t.get("deletes") and not (ENGINE / t["path"]).exists()
        ]
        if absent:
            problems.append(
                (
                    "missing-target",
                    entry["patch"],
                    "engine has no " + ", ".join(sorted(absent)[:3]),
                )
            )
            continue

        for target in entry["targets"]:
            if target.get("deletes") and (ENGINE / target["path"]).exists():
                problems.append(
                    (
                        "not-deleted",
                        target["path"],
                        f"declared deleted by {entry['patch']}",
                    )
                )

        reflected, detail = _is_reflected(entry["patch"])
        checked += 1
        if not reflected:
            problems.append(
                (
                    "not-reflected",
                    entry["patch"],
                    detail.splitlines()[0] if detail else "reverse-apply failed",
                )
            )
            continue

        if strict_hashes:
            for target in entry["targets"]:
                path = target["path"]
                if target.get("deletes") or path in overlapping:
                    continue
                result = target.get("result")
                if not result:
                    continue
                actual = git_blob_hash(ENGINE / path)
                if not actual.startswith(result) and not result.startswith(actual):
                    problems.append(
                        (
                            "hash-drift",
                            path,
                            f"{entry['patch']} was exported against "
                            f"{result[:12]}, engine has {actual[:12]}",
                        )
                    )
    return problems, checked


def _verify_symlinks(manifest):
    problems = []
    for entry in manifest["symlinked"]:
        engine_path = ENGINE / entry["engine"]
        if not engine_path.exists() and not engine_path.is_symlink():
            problems.append(
                ("not-imported", entry["engine"], f"from {entry['source']}")
            )
            continue
        if engine_path.is_symlink():
            target = os.readlink(engine_path)
            resolved = (engine_path.parent / target).resolve()
            if resolved != (REPO / entry["source"]).resolve():
                problems.append(
                    (
                        "wrong-link",
                        entry["engine"],
                        f"points at {target}, expected {entry['source']}",
                    )
                )
            elif os.path.isabs(target):
                problems.append(
                    ("absolute-link", entry["engine"], "absolute symlink target")
                )
    return problems


def cmd_verify(args):
    if not ENGINE.exists():
        print(
            "engine/ does not exist; nothing to verify. Run `npm run download`.",
            file=sys.stderr,
        )
        return 0 if args.allow_missing_engine else 1

    manifest = load_manifest()
    overlapping = set(manifest["overlappingFiles"])

    problems, checked = _verify_patches(manifest, overlapping, args.strict_hashes)
    if not args.patches_only:
        problems += _verify_symlinks(manifest)

    for entry in manifest["patches"]:
        pin = entry.get("pin")
        if not pin:
            continue
        path = REPO / entry["patch"]
        if not path.exists():
            problems.append(("pin-missing", entry["patch"], "pinned but absent"))
        elif sha256(path) != pin["sha256"]:
            problems.append(
                (
                    "pin-broken",
                    entry["patch"],
                    "third-party patch changed; re-run "
                    "`npm run patches:manifest` if that was deliberate",
                )
            )

    recorded = manifest.get("deadPaths", {})
    for patch_rel in sorted(
        {e["patch"] for e in manifest["patches"]} | set(recorded)
    ):
        path = REPO / patch_rel
        if not path.exists():
            continue
        was = len(recorded.get(patch_rel, []))
        now = len(dead_paths(path))
        if now > was:
            problems.append(
                (
                    "new-dead-path",
                    patch_rel,
                    f"{now} constant conditions, was {was}. Removing dead code "
                    "is the fix; recording it is not",
                )
            )

    new, stale = undeclared_overlaps(manifest["overlappingFiles"])
    problems += [
        ("undeclared-overlap", path, "two patch owners and no recorded reason")
        for path in new
    ]
    problems += [
        ("stale-overlap", path, "declared in KNOWN_OVERLAPS but has one owner")
        for path in stale
    ]

    unproven, stale_rules = unproven_order(
        manifest.get("orderSensitiveFiles", order_sensitive_files(
            manifest["overlappingFiles"]
        ))
    )
    problems += [
        (
            "order-unproven",
            path,
            "two patches edit the same region and no ORDER_RULES entry says "
            "which order is the right one",
        )
        for path in unproven
    ]
    problems += [
        ("stale-order-rule", path, "declared in ORDER_RULES but no longer overlaps")
        for path in stale_rules
    ]

    if args.json:
        print(
            json.dumps(
                {
                    "checked": checked,
                    "problems": [
                        {"kind": k, "path": p, "detail": d} for k, p, d in problems
                    ],
                },
                indent=2,
            )
        )
    else:
        by_kind = {}
        for kind, path, detail in problems:
            by_kind.setdefault(kind, []).append((path, detail))
        if not problems:
            print(
                f"engine/ reflects the declared patch set "
                f"({checked} patches reverse-applied, "
                f"{len(manifest['symlinked'])} links)."
            )
        else:
            for kind in sorted(by_kind):
                rows = by_kind[kind]
                print(f"{kind}: {len(rows)}")
                for path, detail in rows[: args.limit]:
                    print(f"  {path} — {detail}")
                if len(rows) > args.limit:
                    print(f"  … {len(rows) - args.limit} more")
    return 1 if problems else 0


def cmd_relink(args):
    """Rewrite absolute symlinks under engine/ that point into this repo.

    surfer's `ensureSymlink` is handed two absolute paths and stores the target
    verbatim, so a checkout that is moved, mounted at a different path, or
    copied into a container has an engine full of links to a directory that is
    not there. Nothing warns; the build simply misses the files.
    """
    if not ENGINE.exists():
        print("engine/ does not exist; nothing to relink.")
        return 0

    manifest = load_manifest()
    changed = 0
    skipped = 0
    for entry in manifest["symlinked"]:
        engine_path = ENGINE / entry["engine"]
        if not engine_path.is_symlink():
            continue
        target = os.readlink(engine_path)
        if not os.path.isabs(target):
            continue
        resolved = Path(target).resolve()
        try:
            resolved.relative_to(REPO)
        except ValueError:
            # Points outside the repository. Not ours to rewrite.
            skipped += 1
            continue
        relative = os.path.relpath(resolved, engine_path.parent)
        if args.dry_run:
            print(f"would relink {entry['engine']} -> {relative}")
        else:
            engine_path.unlink()
            engine_path.symlink_to(relative)
        changed += 1
    verb = "would relink" if args.dry_run else "relinked"
    print(f"{verb} {changed} absolute symlinks; {skipped} point outside the repo.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_manifest = sub.add_parser("manifest", help="regenerate the patch manifest")
    p_manifest.add_argument(
        "--check",
        action="store_true",
        help="fail if the checked-in manifest is stale, instead of rewriting it",
    )
    p_manifest.set_defaults(func=cmd_manifest)

    p_verify = sub.add_parser("verify", help="check engine/ against the manifest")
    p_verify.add_argument("--json", action="store_true")
    p_verify.add_argument("--limit", type=int, default=20)
    p_verify.add_argument(
        "--patches-only",
        action="store_true",
        help="skip the symlink checks",
    )
    p_verify.add_argument(
        "--strict-hashes",
        action="store_true",
        help=(
            "also require every patched file to hash to the blob the patch "
            "was exported against. Expect failures after any Firefox bump; "
            "this is a provenance report, not an import gate"
        ),
    )
    p_verify.add_argument(
        "--allow-missing-engine",
        action="store_true",
        help="exit 0 when engine/ has not been downloaded yet",
    )
    p_verify.set_defaults(func=cmd_verify)

    p_relink = sub.add_parser("relink", help="absolute engine symlinks -> relative")
    p_relink.add_argument("--dry-run", action="store_true")
    p_relink.set_defaults(func=cmd_relink)

    p_overlaps = sub.add_parser("overlaps", help="files with more than one owner")
    p_overlaps.add_argument(
        "--from-manifest",
        action="store_true",
        help="read the checked-in manifest instead of re-reading the patches",
    )
    p_overlaps.set_defaults(func=cmd_overlaps)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
