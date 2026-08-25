#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: provision the Sine mod manager into a Trance build + profile.
#
# Sine is not vendored into this tree. It is fetched at provisioning time from
# its own releases, exactly as its own installer would, and dropped into the
# two places fx-autoconfig needs:
#
#   {app}/config.js                        bootloader, runs before the UI
#   {app}/defaults/pref/config-prefs.js    turns the bootloader on
#   {profile}/chrome/utils/                chrome.manifest + uc_api
#   {profile}/chrome/JS/                   the Sine engine itself
#
# The "Cosine" channel is Sine's pre-release channel: releases whose tag ends
# in `c`. Sine reads its own engine.json version to decide which channel to
# self-update on, so a Cosine engine keeps updating along Cosine.
#
# Layout comes from sineorg/Sine .browsercfg.json (the `import` section).
# Both Sine and its bootloader are MPL-2.0, the same licence as this tree.
#
# Refs: TRANCE.md §7, docs/trance/THIRD-PARTY.md

import argparse
import io
import json
import os
import platform
import shutil
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

SINE_REPO = "CosmoCreeper/Sine"
BOOTLOADER_TARBALL = "https://api.github.com/repos/sineorg/bootloader/tarball/main"
USER_AGENT = "trance-cosine-provisioner"

# Files the provisioner owns, relative to their install root. Anything listed
# here is removed by --uninstall; nothing else is touched.
APP_ARTIFACTS = ("config.js", "defaults/pref/config-prefs.js")
PROFILE_ARTIFACTS = ("chrome/utils", "chrome/JS")


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token and "api.github.com" in url:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request) as response:
        return response.read()


def resolve_release(channel: str) -> dict:
    """Newest release on the requested channel.

    Cosine tags end in `c` and are marked prerelease; stable Sine is neither.
    """
    releases = json.loads(fetch(f"https://api.github.com/repos/{SINE_REPO}/releases?per_page=30"))
    for release in releases:
        if release.get("draft"):
            continue
        is_cosine = release["tag_name"].rstrip(".0123456789").endswith("c")
        if channel == "cosine" and is_cosine:
            return release
        if channel == "sine" and not is_cosine and not release.get("prerelease"):
            return release
    raise SystemExit(f"no release found on channel '{channel}'")


def asset_url(release: dict, name: str) -> str:
    for asset in release["assets"]:
        if asset["name"] == name:
            return asset["browser_download_url"]
    raise SystemExit(f"release {release['tag_name']} has no asset named {name}")


def resolve_app_root(app: Path) -> Path:
    """The directory Firefox looks in for config.js.

    macOS puts it inside the bundle; every other platform uses the directory
    holding the binary.
    """
    if app.suffix == ".app":
        return app / "Contents" / "Resources"
    return app


def default_app() -> Path:
    objdir = {
        ("Darwin", "arm64"): "obj-aarch64-apple-darwin",
        ("Darwin", "x86_64"): "obj-x86_64-apple-darwin",
    }.get((platform.system(), platform.machine()))
    root = Path(__file__).resolve().parent.parent / "engine"
    if objdir:
        return root / objdir / "dist" / "Trance.app"
    matches = sorted(root.glob("obj-*/dist"))
    if not matches:
        raise SystemExit("could not find a built Trance; pass --app explicitly")
    return matches[0]


def replace_tree(source: Path, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)


def install_bootloader(app_root: Path, profile: Path) -> None:
    blob = fetch(BOOTLOADER_TARBALL)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as archive:
        # GitHub tarballs nest everything under one generated top-level dir.
        root = archive.getnames()[0].split("/")[0]
        staging = Path(os.environ.get("TMPDIR", "/tmp")) / "trance-cosine-bootloader"
        if staging.exists():
            shutil.rmtree(staging)
        archive.extractall(staging, filter="data")
    unpacked = staging / root

    for relative in APP_ARTIFACTS:
        source = unpacked / "program" / relative
        destination = app_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        print(f"  app     {relative}")

    replace_tree(unpacked / "profile" / "utils", profile / "chrome" / "utils")
    print("  profile chrome/utils")
    shutil.rmtree(staging)


def install_engine(release: dict, profile: Path) -> str:
    blob = fetch(asset_url(release, "engine.zip"))
    js_dir = profile / "chrome" / "JS"
    if js_dir.exists():
        shutil.rmtree(js_dir)
    js_dir.mkdir(parents=True)

    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        for entry in archive.namelist():
            if entry.endswith("/") or not entry.startswith("JS/"):
                continue
            target = js_dir / entry[len("JS/") :]
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as handle, open(target, "wb") as out:
                shutil.copyfileobj(handle, out)

    version = json.loads((js_dir / "engine.json").read_text())["version"]
    print(f"  profile chrome/JS (engine {version})")
    (profile / "chrome" / "sine-mods").mkdir(parents=True, exist_ok=True)
    patch_fork_id(js_dir)
    return version


def patch_fork_id(js_dir: Path) -> None:
    """Teach Sine that Trance is a Zen fork.

    Sine derives its fork id from AppConstants.MOZ_APP_NAME against a fixed
    table. Trance's app name is "trance", so Sine falls back to "firefox" and
    then hides every Zen-only mod from the marketplace and skips the Zen
    branches in its own settings and browser code.

    Sine has no override pref for this, so the table gets one extra row. Sine's
    self-updater replaces this file, so re-run the provisioner after an engine
    update.
    """
    target = js_dir / "utils" / "uc_api.sys.mjs"
    source = target.read_text()
    anchor = '      zen: "zen",\n'
    if anchor not in source:
        print("  ! fork table not found in uc_api.sys.mjs; skipping fork patch")
        return
    target.write_text(source.replace(anchor, anchor + '      trance: "zen",\n', 1))
    print("  patched fork id -> zen")


def uninstall(app_root: Path, profile: Path) -> None:
    for relative in APP_ARTIFACTS:
        target = app_root / relative
        if target.exists():
            target.unlink()
            print(f"  removed {target}")
    for relative in PROFILE_ARTIFACTS:
        target = profile / relative
        if target.exists():
            shutil.rmtree(target)
            print(f"  removed {target}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--app",
        type=Path,
        default=None,
        help="Trance.app (macOS) or the directory holding the binary. "
        "Defaults to the local build in engine/obj-*/dist.",
    )
    parser.add_argument(
        "--profile",
        type=Path,
        required=True,
        help="Profile directory to install the engine into.",
    )
    parser.add_argument(
        "--channel",
        choices=("cosine", "sine"),
        default="cosine",
        help="cosine = Sine's pre-release channel (default); sine = stable.",
    )
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()

    app = args.app or default_app()
    app_root = resolve_app_root(app)
    if not app_root.is_dir():
        raise SystemExit(f"not a directory: {app_root}")

    profile = args.profile
    profile.mkdir(parents=True, exist_ok=True)

    if args.uninstall:
        print(f"Removing Sine from {app_root} and {profile}")
        uninstall(app_root, profile)
        return 0

    release = resolve_release(args.channel)
    print(f"Installing Sine {release['tag_name']} ({args.channel}) ")
    print(f"  app root  {app_root}")
    print(f"  profile   {profile}")
    install_bootloader(app_root, profile)
    install_engine(release, profile)
    print("Done. Sine lives in about:preferences#sineMods.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
