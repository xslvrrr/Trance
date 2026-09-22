#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: inventory integrity.
#
# `docs/trance/mods-inventory.json` calls itself the machine-readable source of
# truth for the 23 mods, and carries a `generatedAt` field. Nothing generated
# it. It was written by hand and then edited by hand a dozen times, alongside
# three files that hold the same facts and are the ones the browser actually
# reads:
#
#   * `scripts/trance-cosine.py`  — PREINSTALLED_MODS: which mods a build ships
#   * `src/zen/trance/distribution/policies.json` — which extensions it installs
#   * `docs/trance/mods/<id>.md`  — the investigation each verdict rests on
#
# Two owners for one fact is the problem this whole project exists to remove
# (TRANCE.md §3.1), and a documentation copy is not exempt from it: the copy is
# what a future session reads before deciding something.
#
# AUDIT.md Phase 6 asks for generated inventories to be reproducible. This is
# the honest version of that for a file whose prose cannot be generated: every
# *mechanical* field is checked against the owner that decides it, so the
# inventory cannot drift silently even though a human still writes the notes.
#
# Usage:
#   python3 scripts/trance-inventory.py check     # exits non-zero on drift

import argparse
import ast
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
INVENTORY = REPO / "docs" / "trance" / "mods-inventory.json"
PROVISIONER = REPO / "scripts" / "trance-cosine.py"
POLICIES = REPO / "src" / "zen" / "trance" / "distribution" / "policies.json"


def preinstalled_mods():
    """`PREINSTALLED_MODS` out of the provisioner, without importing it.

    Read with `ast` rather than by executing the module: the provisioner's
    import side effects are a build script's, and this is a checker.
    """
    tree = ast.parse(PROVISIONER.read_text(encoding="utf-8"))
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if "PREINSTALLED_MODS" not in names:
            continue
        entries = []
        for element in node.value.elts:
            entry = {}
            for key, value in zip(element.keys, element.values):
                if not isinstance(key, ast.Constant):
                    continue
                if isinstance(value, ast.Constant):
                    entry[key.value] = value.value
                elif isinstance(value, ast.Name):
                    # `"pin": ZEN_STORE_REF` — the name is enough for a
                    # cross-check that never compares pins.
                    entry[key.value] = f"<{value.id}>"
            entries.append(entry)
        return entries
    raise SystemExit("PREINSTALLED_MODS not found in the provisioner")


def policy_extensions():
    data = json.loads(POLICIES.read_text(encoding="utf-8"))
    return data["policies"]["ExtensionSettings"]


def check():
    problems = []
    inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
    mods = inventory["mods"]

    def fail(message):
        problems.append(message)

    # --- shape -------------------------------------------------------------
    numbers = [m["n"] for m in mods]
    if numbers != sorted(numbers):
        fail("mods are not in ascending `n` order")
    if len(set(numbers)) != len(numbers):
        fail("two mods share an `n`")
    legend = set(inventory["verdictLegend"])
    clusters = set(inventory["clusters"])
    for mod in mods:
        if mod["verdict"] not in legend:
            fail(f"{mod['name']}: verdict {mod['verdict']} is not in the legend")
        if mod.get("cluster"):
            if mod["cluster"] not in clusters:
                fail(f"{mod['name']}: cluster {mod['cluster']} is not defined")
            elif mod["n"] not in inventory["clusters"][mod["cluster"]]:
                fail(
                    f"{mod['name']} says it is in cluster {mod['cluster']}, "
                    f"which does not list {mod['n']}"
                )
        doc = mod.get("investigationDoc")
        if doc and not (REPO / doc).exists():
            fail(f"{mod['name']}: investigation doc {doc} does not exist")

    # --- what a build actually installs ------------------------------------
    shipped = {entry["id"]: entry for entry in preinstalled_mods()}
    claimed = {
        mod["storeId"]: mod for mod in mods if mod["verdict"] == "PREINSTALL"
    }
    for mod_id, entry in shipped.items():
        mod = claimed.get(mod_id)
        if not mod:
            fail(
                f"the provisioner installs '{mod_id}' and no PREINSTALL mod in "
                "the inventory claims that storeId"
            )
            continue
        if mod["store"] != entry["store"]:
            fail(
                f"{mod['name']}: inventory says store '{mod['store']}', the "
                f"provisioner installs from '{entry['store']}'"
            )

        # The version a build actually installs. `userVersion` is the version
        # the investigation was written against and is deliberately allowed to
        # lag; `storeVersion` is what ships, so it is the one that has to agree
        # with the provisioner.
        shipped_version = mod.get("storeVersion", mod.get("userVersion"))
        if entry.get("expect_version") and shipped_version != entry["expect_version"]:
            fail(
                f"{mod['name']}: inventory ships {shipped_version!r}, the "
                f"provisioner expects {entry['expect_version']!r}. Set "
                "`storeVersion` to what the build installs."
            )

        # Where it comes from. Only the GitHub-direct entries name a repository;
        # for the two stores the id is the address.
        if entry.get("repo"):
            expected_source = f"https://github.com/{entry['repo']}"
            if mod.get("source") != expected_source:
                fail(
                    f"{mod['name']}: inventory source {mod.get('source')!r} is "
                    f"not the repository the provisioner clones ({expected_source})"
                )

        # AUDIT.md Phase 6 asks for external payloads to be pinned. A
        # preinstalled mod with no pin installs whatever `main` holds on the
        # day the build runs, which no inventory can describe.
        pin = entry.get("pin")
        if not pin:
            fail(
                f"{mod['name']}: the provisioner installs it with no `pin`, so "
                "the build is not reproducible"
            )
        elif not (
            re.fullmatch(r"[0-9a-f]{40}", pin) or re.fullmatch(r"<[A-Z_]+>", pin)
        ):
            fail(
                f"{mod['name']}: pin {pin!r} is neither a full commit hash nor "
                "a named constant"
            )
    for mod_id, mod in claimed.items():
        if mod_id not in shipped:
            fail(
                f"{mod['name']} is PREINSTALL in the inventory and the "
                "provisioner does not install it"
            )

    # --- what a build actually enables -------------------------------------
    policy = policy_extensions()
    listed = {ext["guid"]: ext for ext in inventory["extensions"]}
    for guid, settings in policy.items():
        ext = listed.get(guid)
        if not ext:
            fail(f"policies.json installs {guid} and the inventory omits it")
            continue
        if ext["policy"] != settings.get("installation_mode"):
            fail(
                f"{ext['name']}: inventory says {ext['policy']}, policies.json "
                f"says {settings.get('installation_mode')}"
            )
        if ext["installUrl"] != settings.get("install_url"):
            fail(f"{ext['name']}: install_url differs from policies.json")
    for guid, ext in listed.items():
        if guid not in policy:
            fail(f"the inventory lists {ext['name']} and policies.json does not")

    # --- the field that was never true -------------------------------------
    if "generatedAt" in inventory:
        fail(
            "`generatedAt` claims this file is generated. Nothing generates it "
            "— remove the field, or make it true"
        )

    for message in problems:
        print(f"error: {message}", file=sys.stderr)
    if not problems:
        print(
            f"mods-inventory.json agrees with its owners "
            f"({len(mods)} mods, {len(shipped)} preinstalled, "
            f"{len(policy)} extensions)."
        )
    return 1 if problems else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="cross-check the inventory against its owners")
    args = parser.parse_args(argv)
    if args.command == "check":
        return check()
    return 2


if __name__ == "__main__":
    sys.exit(main())
