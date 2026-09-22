#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: resolve the Apple Team ID in the production entitlements.
#
# `com.apple.developer.web-browser.public-key-credential` is the entitlement
# that lets a browser reach the macOS platform authenticator — the passkeys in
# the system keychain, unlocked with Touch ID. macOS only honours it when the
# `com.apple.application-identifier` beside it is `<TeamID>.<bundle id>` for the
# bundle actually being signed.
#
# The bundle id is fixed and known: `--with-distribution-id=app.trance-browser`
# and `MOZ_MACBUNDLE_ID=trance` make it `app.trance-browser.trance`. The Team ID
# is not — it belongs to whoever is signing, and hard-coding somebody else's is
# how this file came to be: the entitlement was inherited from Zen and still
# named Zen's team and Zen's bundle, so on every Trance build the entitlement
# was present, inert, and silent. Platform passkeys simply did not work, with no
# error the browser could surface.
#
# So the checked-in entitlement carries `@TRANCE_APPLE_TEAM_ID@` — a value that
# cannot be mistaken for a working one — and this script writes the real Team ID
# in immediately before signing.
#
# Usage, from the release workflow, before `./mach macos-sign`:
#
#   TRANCE_APPLE_TEAM_ID=ABCDE12345 python3 scripts/trance-entitlements.py
#
# It is a no-op on a tree whose placeholder has already been resolved, so
# running it twice is safe. It is not needed for a local unsigned build: an
# ad-hoc signature carries no team, and the platform authenticator is
# unavailable to such a build no matter what the entitlement says.
#
# Refs: prefs/trance/passkeys.yaml; docs/trance/UPSTREAM-TOUCHPOINTS.md

import argparse
import os
import re
import sys
from pathlib import Path

PLACEHOLDER = "@TRANCE_APPLE_TEAM_ID@"
BUNDLE_ID = "app.trance-browser.trance"

# Everything the signer may hand to `mach macos-sign -e production`.
ENTITLEMENTS = ("engine/security/mac/hardenedruntime/production",)

# Apple Team IDs are ten characters of A-Z and 0-9.
TEAM_ID = re.compile(r"^[A-Z0-9]{10}$")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--team-id",
        default=os.environ.get("TRANCE_APPLE_TEAM_ID", ""),
        help="Apple Developer Team ID; defaults to $TRANCE_APPLE_TEAM_ID",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="repository root",
    )
    args = parser.parse_args()

    team_id = args.team_id.strip()
    if not team_id:
        print(
            "trance-entitlements: no Team ID given. Set TRANCE_APPLE_TEAM_ID or "
            "pass --team-id. Platform passkeys need a real team on the "
            "signature; nothing else in the build does.",
            file=sys.stderr,
        )
        return 2
    if not TEAM_ID.match(team_id):
        print(
            f"trance-entitlements: '{team_id}' is not an Apple Team ID "
            "(ten characters of A-Z and 0-9).",
            file=sys.stderr,
        )
        return 2

    written = 0
    for relative in ENTITLEMENTS:
        directory = args.root / relative
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.xml")):
            source = path.read_text()
            if PLACEHOLDER not in source:
                continue
            path.write_text(source.replace(PLACEHOLDER, team_id))
            print(f"  {path.relative_to(args.root)} -> {team_id}.{BUNDLE_ID}")
            written += 1

    if not written:
        print("trance-entitlements: nothing to resolve (already done).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
