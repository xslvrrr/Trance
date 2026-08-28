#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: provision the Sine mod manager into a Trance build + profile.
#
# Sine is not vendored into this tree. It is fetched at provisioning time from
# its own releases, exactly as its own installer would, and dropped into the
# places fx-autoconfig needs:
#
#   {app}/config.js                        bootloader, runs before the UI
#   {app}/defaults/pref/config-prefs.js    turns the bootloader on
#   {app}/trance-cosine/utils/             the profile payload, staged
#   {app}/trance-cosine/JS/                  "
#   {app}/trance-cosine/sine-mods/           "
#   {profile}/chrome/utils/                chrome.manifest + uc_api
#   {profile}/chrome/JS/                   the Sine engine itself
#   {profile}/chrome/sine-mods/            the mods Trance preinstalls
#
# ── Why the app keeps a copy of the profile half ──────────────────────────
#
# TRANCE.md §2 promises "fresh profile → the full experience", and §6 says
# Trance ships Cosine preinstalled. Half of Sine lives in the *profile*, and
# Gecko has not copied a `defaults/profile` template into new profiles for many
# years, so a new profile got the bootloader and nothing to boot: Cosine was
# preinstalled for exactly one profile, the one it was provisioned against.
#
# The fix is one stage directory and eight lines in `config.js`, which this
# script already owns and writes. `config.js` runs before the UI with chrome
# privileges, so it is the earliest and simplest place to notice that
# `{profile}/chrome/utils` is missing and copy the staged payload across. That
# keeps the whole thing inside files the provisioner owns — no new upstream
# touchpoint, no new startup component, and nothing at all to do at runtime
# once a profile has been seeded.
#
# The "Cosine" channel is Sine's pre-release channel: releases whose tag ends
# in `c`. Sine reads its own engine.json version to decide which channel to
# self-update on, so a Cosine engine keeps updating along Cosine.
#
# Layout comes from sineorg/Sine .browsercfg.json (the `import` section).
# Both Sine and its bootloader are MPL-2.0, the same licence as this tree.
#
# ── Do not leave this installed while running the mochitests ──────────────
#
# `config.js` is autoconfig: it runs with chrome privileges before the UI, in
# every profile, including the throwaway one `mach test` builds. Marionette then
# never comes up — the harness dies with "Timed out waiting for connection on
# 127.0.0.1:2828" and a crash stack that names nothing, which reads like a
# Trance bug and is not one.
#
# `--uninstall` before `npm test`, and provision again afterwards. Provisioning
# is a packaging step; it belongs to a build you are going to *run*, not to one
# you are going to test.
#
# Refs: TRANCE.md §7, §10, docs/trance/THIRD-PARTY.md

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
MARKETPLACE = "https://raw.githubusercontent.com/sineorg/store/main/marketplace.json"
USER_AGENT = "trance-cosine-provisioner"

# The *other* store. Sine installs from both: mods published to the Sine store
# have an entry in `marketplace.json` and live in their author's own repository,
# and mods published to the Zen theme store live in one folder of
# `zen-browser/theme-store` and have no repository of their own. Sine tells the
# two apart by `homepage`, which a Zen-store `theme.json` sets to the empty
# string; its updater then goes back to the theme store for that mod rather than
# to an author (`manager.sys.mjs: processModUpdate`), and its marketplace actor
# installs one by handing `installMod` the path
# `zen-browser/theme-store/tree/main/themes/<id>/`.
#
# This provisioner does the same thing by the shortest route that produces the
# same result on disk: the theme's own folder, file for file, rather than a zip
# of all seventy-odd themes with everything but one folder thrown away.
ZEN_STORE_RAW = "https://raw.githubusercontent.com/zen-browser/theme-store/main/themes"
ZEN_STORE_API = (
    "https://api.github.com/repos/zen-browser/theme-store/contents/themes"
)

# ── Mods Trance preinstalls ────────────────────────────────────────────────
#
# Trance reimplements seventeen mods natively and installs none of them. The six
# below are the exceptions, and they are exceptions for four different reasons.
#
# ── Two for a legal reason ────────────────────────────────────────────────
#
# In each case the thing the mod ships is a *drawing*, and its licence is what
# stops Trance shipping that drawing.
#
# "New Icons" (`qumeqa/zen-icons`) has no licence file, so under TRANCE.md §7.3
# no asset and no rule from it may be copied and its look may not be reproduced.
# Trance's answer to that was an original stroke set drawn from a written
# construction, which covered the same surfaces but was not the same icons. That
# is the best a clean-room reimplementation can do, and it is not what someone
# who wants this icon set wants — so it was withdrawn along with the other two
# packs (ADR-039), and this mod is the icon set.
#
# "Zen Folder Tree Connectors" (`JustAdumbPrsn/ZenFolderTreeConnectors`) is
# GPL-3.0, which under TRANCE.md §7.2 means no rule from it may be copied
# either. Trance did reimplement it — a trunk and an elbow, in CSS, with no
# script where the mod ships one — and the reimplementation was fine and was
# still an approximation of someone else's line. Same trade, same answer
# (ADR-027).
#
# ── Two because reimplementing them would buy nothing ─────────────────────
#
# "Zen Library" (`12th-devs/Zen-Library`) and "Live Calendar"
# (`Vertex-Mods/Zen-Live-Calendar`) were both scheduled as clean-room
# reimplementations for phase 7, and both had their verdict changed to
# PREINSTALL by their investigations (ADR-030).
#
# The argument that justifies every other reimplementation in this project is
# *ownership*: two stylesheets over one element, with a winner decided by load
# order (TRANCE.md §3.1). Neither of these mods is in that position. Each adds a
# surface of its own — a library shell, a calendar popup over a Google Calendar
# tab — and touches nothing any Trance feature owns. The conflict Trance exists
# to remove does not exist here, so removing the mod removes nothing.
#
# What is left is the second argument, cost, and the audit is in the two
# investigation docs. Zen Library is 7,500 lines across six scripts and seven
# stylesheets, and it holds no interval, no MutationObserver and no infinite
# animation; its one `will-change` is the only §3 offence in the whole mod. Live
# Calendar holds exactly one always-armed timer, a 60-second ICS refresh, which
# is the wakeup budget phase 7's own acceptance criterion allowed for it — plus
# a 1 Hz countdown that exists only while a reminder popup is on screen.
#
# So a reimplementation would cost weeks, would own a Places data layer and a
# virtual list that nothing else in Trance needs, and would come out at roughly
# the same runtime cost as the thing it replaced. That is not a trade worth
# making, and TRANCE.md §1 says so in as many words: Trance is not a "maximum
# features" browser, and every feature must earn its frame budget. These two
# earn it as they are.
#
# ── One because there was nothing to own ──────────────────────────────────
#
# "Pimp your PiP" (Zen theme store, `599a1599-…`) was phase 10's clean-room
# reimplementation. It is 88 lines of CSS over the Picture-in-Picture player —
# no script, no timer, no observer, no blur, no infinite animation — and Trance
# has no stylesheet in that window at all: every Trance sheet is loaded into
# `browser.xhtml`, and the one exception is a user sheet aimed at `about:`
# pages. So there was no second owner to remove and no cost to cut, and a
# rewrite would have been an approximation of someone else's drawing, which is
# the trade the two licence cases above already lost (ADR-033).
#
# ── What preinstalling actually is ────────────────────────────────────────
#
# Installing a mod is not copying it. Sine fetches each from the store's own
# source at provisioning time, exactly as its own installer would, and nothing
# from any of them enters this tree — the same arrangement Sine itself is under
# (see the header above). So Trance installs them and switches off what it had
# built to stand in for them: the Trance icon packs are gone and so is
# `trance.tabstrip.connectors`. The mod guard says so on each mod's card
# (ADR-024, ADR-027, ADR-030, ADR-033, ADR-039).
#
# `id` is the store's own id: a slug on the Sine store, a GUID on the Zen theme
# store. `store` says which one, and it decides where the files come from — an
# author's repository for the first, `zen-browser/theme-store` for the second.
# `pin` is the commit the store named when this was written: the provisioner
# records it so that a build is reproducible, but installs whatever the store
# currently lists, so a user gets the version the author is shipping rather than
# a frozen one. A Zen-store theme has no commit to pin; its `updatedAt` is the
# only version marker the store offers, and it is recorded in the same spirit.
PREINSTALLED_MODS = (
    {
        "id": "new-icons",
        "store": "sine",
        "expect_version": "1.4",
        "pin": "9525ce8de09211db2cb37a8da112199a8c0491b9",
    },
    {
        "id": "ZenFolderTreeConnectors",
        "store": "sine",
        "expect_version": "2.1",
        "pin": "912af66a325928af0365bb1a4fa70317a3891ed3",
    },
    {
        "id": "zen-library",
        "store": "sine",
        "expect_version": "1.0.0",
        "pin": "cd0cf2c0eb963cababf33e68ef260ae4d8cb518d",
    },
    {
        "id": "zen-live-calendar",
        "store": "sine",
        "expect_version": "1.0.0",
        "pin": "f1dd98a9a1667b30210e16444d3da213faf4be30",
    },
    {
        "id": "599a1599-e6ab-4749-ab22-de533860de2c",
        "store": "zen",
        "name": "Pimp your PiP",
        "expect_version": "1.0.0",
        "pin": "2025-05-13",
    },
    # ── And one from neither store ────────────────────────────────────────
    #
    # "Better New Tab button" is published to no marketplace index at all: it
    # is a repository, and Sine installs one of those by being handed
    # `author/repo` directly. Trance reimplemented one behaviour of it — the
    # unlabelled centred plus — and dropped the rest, which left the button
    # with two owners and a user with a third of a mod. Shipping the author's
    # own distribution gives the button one owner again, radius sliders
    # included (ADR-049).
    #
    # `id` is the id the mod's own `theme.json` declares, because that is what
    # Sine keys `mods.json` on and what its preferences are namespaced under.
    {
        "id": "bada16c1-3b14-483b",
        "store": "github",
        "repo": "themaster5209/zen-better-new-tab-button",
        "name": "Better New Tab button",
        # The version the author ships today. 1.0.6 is the version this was
        # investigated against (docs/trance/mods/better-new-tab-button.md).
        "expect_version": "1.0.8",
        "pin": "main",
    },
)

# Files the provisioner owns, relative to their install root. Anything listed
# here is removed by --uninstall; nothing else is touched.
APP_ARTIFACTS = ("config.js", "defaults/pref/config-prefs.js")
APP_TREES = ("trance-cosine",)
PROFILE_ARTIFACTS = ("chrome/utils", "chrome/JS")

# Where the app keeps its copy of the profile payload, and the loader that
# seeds a fresh profile from it. `GreD` is the directory `config.js` itself is
# read from, so this resolves the same way on every platform.
STAGE_DIR = "trance-cosine"

# What the staged `chrome.manifest` is called inside the app, and only inside
# it. See `install_bootloader` for why it cannot keep its own name there.
STAGED_MANIFEST = "chrome.manifest.in"

SEED_JS = """// Seeds a new profile with the Sine engine, then loads Sine.
//
// GENERATED by scripts/trance-cosine.py. Half of Sine lives in the profile and
// Gecko no longer copies a profile template into new profiles, so without this
// a fresh profile gets the bootloader and nothing to boot (TRANCE.md §2, §6).
// Runs once per profile: after the first copy, `chrome/utils` exists and this
// is two `exists()` calls and nothing else.
if (!Services.appinfo.inSafeMode) {
  try {
    const chromeDir = Services.dirsvc.get("UChrm", Ci.nsIFile);
    const stage = Services.dirsvc.get("GreD", Ci.nsIFile);
    stage.append("%(stage)s");

    // `sine-mods` is copied alongside the engine, not created empty: Trance
    // preinstalls one mod (see PREINSTALLED_MODS in the provisioner) and a
    // fresh profile has to get it too, or "fresh profile -> the full
    // experience" is true of everything except the icons. Sine rebuilds
    // chrome.css and content.css from mods.json on every startup, so the
    // absolute paths in the staged copy of those two files do not have to be
    // rewritten here — they are regenerated against this profile before
    // anything reads them.
    for (const name of ["utils", "JS", "sine-mods"]) {
      const target = chromeDir.clone();
      target.append(name);
      if (target.exists()) {
        continue;
      }
      const source = stage.clone();
      source.append(name);
      if (!source.exists()) {
        continue;
      }
      if (!chromeDir.exists()) {
        chromeDir.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
      }
      source.copyTo(chromeDir, name);
    }

    // Sine writes installed mods here and does not create it itself, so this
    // still has to exist even when there is no staged copy to seed from.
    const mods = chromeDir.clone();
    mods.append("sine-mods");
    if (!mods.exists()) {
      mods.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
    }

    // The staged manifest is called `chrome.manifest.in` inside the app,
    // because `mach package` absorbs anything named `chrome.manifest` into its
    // own registry instead of copying it through. Rename it back the moment it
    // lands in the profile, where nothing is scanning for manifests and the
    // name has to be the real one for `autoRegister` below.
    const seeded = chromeDir.clone();
    seeded.append("utils");
    seeded.append("chrome.manifest.in");
    if (seeded.exists()) {
      seeded.moveTo(null, "chrome.manifest");
    }

    const cmanifest = chromeDir.clone();
    cmanifest.append("utils");
    cmanifest.append("chrome.manifest");
    if (cmanifest.exists()) {
      Components.manager
        .QueryInterface(Ci.nsIComponentRegistrar)
        .autoRegister(cmanifest);
      ChromeUtils.importESModule("chrome://userscripts/content/sine.sys.mjs");
    }
  } catch (err) {
    console.error("Trance: could not start Sine", err);
  }
}
"""


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


def objdir_dist() -> Path:
    objdir = {
        ("Darwin", "arm64"): "obj-aarch64-apple-darwin",
        ("Darwin", "x86_64"): "obj-x86_64-apple-darwin",
    }.get((platform.system(), platform.machine()))
    root = Path(__file__).resolve().parent.parent / "engine"
    if objdir:
        return root / objdir / "dist"
    matches = sorted(root.glob("obj-*/dist"))
    if not matches:
        raise SystemExit("could not find a built Trance; pass --app explicitly")
    return matches[0]


def default_app() -> Path:
    return objdir_dist() / "Trance.app"


def package_app() -> Path:
    """The tree `mach package` reads, which is not the one `npm start` runs.

    On macOS the build assembles two copies of the same browser: `dist/Trance.app`,
    which is what `./mach run` launches, and `dist/bin`, which is what the
    packager walks to build the `.dmg`. Provisioning only ever touched the first,
    so Sine was in every development build and in no release — the same shape of
    bug as ADR-052, and found the same way.
    """
    return objdir_dist() / "bin"


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

    # `config.js` is Trance's, not the bootloader's: it does the same work plus
    # the profile seeding. Everything else the bootloader ships is copied as-is.
    for relative in APP_ARTIFACTS:
        if relative == "config.js":
            continue
        source = unpacked / "program" / relative
        destination = app_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        print(f"  app     {relative}")

    (app_root / "config.js").write_text(SEED_JS % {"stage": STAGE_DIR})
    print("  app     config.js (with profile seeding)")

    replace_tree(unpacked / "profile" / "utils", profile / "chrome" / "utils")

    stage_utils = app_root / STAGE_DIR / "utils"
    replace_tree(unpacked / "profile" / "utils", stage_utils)

    # The staged copy carries the manifest under a name the packager will leave
    # alone, and `config.js` renames it back after seeding a profile.
    #
    # `mach package` treats *any* file called `chrome.manifest` as a chrome
    # manifest: it reads it into its own registry and does not copy it through.
    # So the packaged app had `trance-cosine/utils/` with the three modules and
    # no manifest, `config.js` found no `chrome.manifest` to register, and Sine
    # silently never loaded — a seeded profile with a complete engine in it and
    # nothing to start it. ADR-058.
    staged_manifest = stage_utils / "chrome.manifest"
    if staged_manifest.exists():
        staged_manifest.rename(stage_utils / STAGED_MANIFEST)
    print("  profile chrome/utils")
    shutil.rmtree(staging)


def install_engine(release: dict, profile: Path, app_root: Path) -> str:
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

    # Staged *after* the fork patch, so a seeded profile gets a patched engine
    # rather than one that thinks Trance is Firefox and hides every Zen mod.
    replace_tree(js_dir, app_root / STAGE_DIR / "JS")
    print(f"  app     {STAGE_DIR}/ (staged for new profiles)")
    return version


def parse_github(homepage: str) -> tuple[str, str]:
    """`https://github.com/author/repo` -> `("author", "repo")`.

    Sine's own parser handles eight URL shapes; the store's `homepage` field is
    always the plain one, so this handles that and refuses anything else rather
    than guessing.
    """
    trimmed = homepage.strip().rstrip("/")
    prefix = "https://github.com/"
    if not trimmed.startswith(prefix):
        raise SystemExit(f"unsupported mod homepage: {homepage}")
    parts = trimmed[len(prefix) :].split("/")
    if len(parts) != 2:
        raise SystemExit(f"unsupported mod homepage: {homepage}")
    return parts[0], parts[1]


def install_zen_mod(entry: dict, mods_dir: Path, installed: dict) -> str:
    """Downloads one Zen-theme-store mod into `{profile}/chrome/sine-mods/<id>`.

    A Zen-store mod is one folder of `zen-browser/theme-store`, and its
    `theme.json` sets `homepage` to the empty string. That empty string is not
    an oversight — it is the flag Sine's updater reads to decide that this mod
    is updated from the theme store rather than from an author's repository, so
    it is preserved exactly as published.

    Sine installs one of these by handing its generic installer the path
    `zen-browser/theme-store/tree/main/themes/<id>/`, which downloads a zip of
    the entire theme store, keeps one folder, and deletes the other seventy-odd.
    The result on disk is a folder of files, and that is what this fetches
    directly.
    """
    mod_id = entry["id"]
    label = entry.get("name", mod_id)
    data = json.loads(fetch(f"{ZEN_STORE_RAW}/{mod_id}/theme.json"))

    expected = entry.get("expect_version")
    version = data.get("version", "?")
    if expected and version != expected:
        print(f"  ! {label} is now {version}, not {expected} — installing {version}")

    target = mods_dir / mod_id
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    files = download_zen_folder(f"{ZEN_STORE_API}/{mod_id}", target)

    # `style` is published as an absolute raw URL. Sine stores the path
    # *relative to the mod folder*, because that is what it later joins onto the
    # profile path when it rebuilds chrome.css — so the URL is reduced to the
    # part after `themes/<id>/`, and dropped if the repository does not actually
    # contain it.
    style = data.get("style")
    if isinstance(style, str):
        style = {"chrome": style}
    style = dict(style or {})
    resolved = {}
    for slot in ("chrome", "content"):
        resolved[slot] = zen_relative_path(style.get(slot), mod_id, files)

    record = dict(data)
    record["id"] = mod_id
    record["style"] = resolved
    record["preferences"] = zen_relative_path(
        data.get("preferences"), mod_id, files
    ) or ("preferences.json" if "preferences.json" in files else "")
    record["enabled"] = True
    record["no-updates"] = False
    # Deliberately no `origin`: Sine reserves "store" for the Sine store and
    # strips the field from anything that claims it (`syncModData`). A Zen-store
    # mod carries none, and its empty `homepage` is what identifies it.

    installed[mod_id] = record
    print(f"  profile chrome/sine-mods/{mod_id} ({label} {version})")
    return version


def download_zen_folder(api_url: str, target: Path) -> set[str]:
    """Copies one theme-store folder to `target`, recursing into subfolders.

    Returns the set of paths written, relative to `target`.
    """
    written: set[str] = set()
    for item in json.loads(fetch(api_url)):
        if item["type"] == "dir":
            child = target / item["name"]
            child.mkdir(parents=True, exist_ok=True)
            for nested in download_zen_folder(item["url"], child):
                written.add(f"{item['name']}/{nested}")
        elif item["type"] == "file":
            (target / item["name"]).write_bytes(fetch(item["download_url"]))
            written.add(item["name"])
    return written


def zen_relative_path(value, mod_id: str, files: set[str]) -> str:
    """A published `style`/`preferences` value as a path inside the mod folder.

    The store publishes these as absolute raw URLs; a few carry a plain
    filename. Both reduce to the same thing, and anything the folder does not
    actually contain reduces to "" rather than to a path that resolves to
    nothing at runtime.
    """
    if not isinstance(value, str) or not value:
        return ""
    marker = f"/themes/{mod_id}/"
    relative = value.split(marker, 1)[1] if marker in value else value
    relative = relative.split("?", 1)[0].lstrip("/")
    return relative if relative in files else ""


def unpack_repo(author: str, repo: str, branch: str, target: Path) -> None:
    """Unpacks a GitHub repository's branch into `target`, replacing it."""
    blob = fetch(f"https://codeload.github.com/{author}/{repo}/zip/refs/heads/{branch}")
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        # GitHub zips nest everything under one generated top-level directory.
        root = archive.namelist()[0].split("/")[0] + "/"
        for name in archive.namelist():
            if name.endswith("/") or not name.startswith(root):
                continue
            destination = target / name[len(root) :]
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(name) as handle, open(destination, "wb") as out:
                shutil.copyfileobj(handle, out)


def install_github_mod(entry: dict, mods_dir: Path, installed: dict) -> str:
    """Downloads one repository-only mod into `{profile}/chrome/sine-mods/<id>`.

    Neither marketplace indexes this one, so there is no store entry to read:
    the mod's own `theme.json` is the entry, which is exactly what Sine does
    when it is handed `author/repo` rather than a store id. `homepage` is set
    to the repository, because that is the field Sine's updater reads to decide
    where a mod's updates come from — an empty one would send it to the Zen
    theme store, which does not have this mod.

    `style` is absent from this mod's `theme.json`, and absent means Sine's own
    default: `userChrome.css` and `userContent.css` if the repository has them.
    """
    mod_id = entry["id"]
    author, repo = entry["repo"].split("/", 1)
    branch = entry.get("pin", "main")
    label = entry.get("name", mod_id)

    data = json.loads(
        fetch(
            f"https://raw.githubusercontent.com/{author}/{repo}/{branch}/theme.json"
        )
    )
    expected = entry.get("expect_version")
    version = data.get("version", "?")
    if expected and version != expected:
        print(f"  ! {label} is now {version}, not {expected} — installing {version}")

    target = mods_dir / mod_id
    unpack_repo(author, repo, branch, target)

    style = data.get("style")
    if isinstance(style, str):
        style = {"chrome": style}
    style = dict(style or {})
    style.setdefault("chrome", "userChrome.css")
    style.setdefault("content", "userContent.css")
    for slot in ("chrome", "content"):
        path = style.get(slot)
        style[slot] = path if path and (target / path).exists() else ""

    preferences = data.get("preferences") or "preferences.json"
    record = dict(data)
    record["id"] = mod_id
    record["name"] = data.get("name", label)
    record["style"] = style
    record["homepage"] = f"https://github.com/{author}/{repo}"
    record["preferences"] = (
        preferences if (target / preferences).exists() else ""
    )
    record["enabled"] = True
    record["no-updates"] = False
    # Deliberately no `origin`: Sine reserves "store" for the Sine store and
    # strips the field from anything else that claims it (`syncModData`).
    installed[mod_id] = record

    print(f"  profile chrome/sine-mods/{mod_id} ({label} {version})")
    return version


def install_mod(entry: dict, mods_dir: Path, installed: dict) -> str:
    """Downloads one store mod into `{profile}/chrome/sine-mods/<id>`.

    This is the same three steps Sine's own installer takes — read the store
    entry, unpack the repository at its default branch, record the entry in
    `mods.json` — with the fourth, rebuilding `chrome.css`, deliberately left
    out: Sine regenerates both entry-point stylesheets from `mods.json` on every
    startup (`manager.rebuildMods()` in `sine.sys.mjs`), and the paths in them
    are absolute, so writing them here would only produce a file that is wrong
    for every profile except the one it was written against.
    """
    mod_id = entry["id"]
    marketplace = json.loads(fetch(MARKETPLACE))
    data = marketplace.get(mod_id)
    if not data:
        raise SystemExit(f"the Sine store has no mod with id '{mod_id}'")

    expected = entry.get("expect_version")
    version = data.get("version", "?")
    if expected and version != expected:
        print(f"  ! {mod_id} is now {version}, not {expected} — installing {version}")

    author, repo = parse_github(data["homepage"])
    target = mods_dir / mod_id
    unpack_repo(author, repo, "main", target)

    # Sine stores the resolved style paths rather than the store's, because a
    # mod may declare them as URLs. Both of ours are plain filenames, so this
    # only has to drop the ones the repository does not actually contain.
    style = data.get("style")
    if isinstance(style, str):
        style = {"chrome": style}
    style = dict(style or {})
    for slot in ("chrome", "content"):
        path = style.get(slot)
        style[slot] = path if path and (target / path).exists() else ""

    record = dict(data)
    record["id"] = mod_id
    record["style"] = style
    record["origin"] = "store"
    record["enabled"] = True
    record["no-updates"] = False
    record.setdefault("preferences", "")
    installed[mod_id] = record

    print(f"  profile chrome/sine-mods/{mod_id} ({version})")
    return version


def install_mods(profile: Path, app_root: Path) -> None:
    """Installs every mod in PREINSTALLED_MODS, and stages them for new profiles."""
    if not PREINSTALLED_MODS:
        return

    mods_dir = profile / "chrome" / "sine-mods"
    mods_dir.mkdir(parents=True, exist_ok=True)
    data_file = mods_dir / "mods.json"

    # Merge rather than replace: this profile may have mods of its own, and a
    # provisioner that removed them would be a mod manager with an opinion.
    installed = {}
    if data_file.exists():
        try:
            installed = json.loads(data_file.read_text())
        except json.JSONDecodeError:
            print("  ! mods.json is not valid JSON; starting a new one")

    for entry in PREINSTALLED_MODS:
        store = entry.get("store", "sine")
        if store == "zen":
            install_zen_mod(entry, mods_dir, installed)
        elif store == "github":
            install_github_mod(entry, mods_dir, installed)
        else:
            install_mod(entry, mods_dir, installed)

    data_file.write_text(json.dumps(installed))

    # The staged copy a fresh profile is seeded from carries only the mods this
    # provisioner installed — seeding someone else's profile with the mods on
    # this machine would be a surprise, not a feature.
    stage = app_root / STAGE_DIR / "sine-mods"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    staged = {}
    for entry in PREINSTALLED_MODS:
        mod_id = entry["id"]
        shutil.copytree(mods_dir / mod_id, stage / mod_id)
        staged[mod_id] = installed[mod_id]
    (stage / "mods.json").write_text(json.dumps(staged))
    print(f"  app     {STAGE_DIR}/sine-mods/ (staged for new profiles)")


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
    for relative in APP_TREES:
        target = app_root / relative
        if target.exists():
            shutil.rmtree(target)
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
        default=None,
        help="Profile directory to install the engine into. Other profiles, "
        "including ones created later, are seeded from the copy this stages "
        "inside the app. Optional with --for-package, which is provisioning a "
        "build rather than a browser anybody is about to run.",
    )
    parser.add_argument(
        "--for-package",
        action="store_true",
        help="Provision the tree `mach package` reads (dist/bin) instead of "
        "the one `npm start` launches. Run this before `npm run package`, or "
        "the `.dmg` ships without Sine.",
    )
    parser.add_argument(
        "--channel",
        choices=("cosine", "sine"),
        default="cosine",
        help="cosine = Sine's pre-release channel (default); sine = stable.",
    )
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()

    app = args.app or (package_app() if args.for_package else default_app())
    app_root = resolve_app_root(app)
    if not app_root.is_dir():
        raise SystemExit(f"not a directory: {app_root}")

    # A packaging run still writes a profile half, because `install_engine`
    # patches the engine in the profile and stages the patched copy. The
    # scratch directory is that intermediate and nothing else — it is not
    # packaged, and `mach package` never looks at it.
    profile = args.profile
    if profile is None:
        if not args.for_package:
            raise SystemExit("--profile is required without --for-package")
        profile = objdir_dist() / "trance-cosine-scratch"
    profile.mkdir(parents=True, exist_ok=True)

    if args.uninstall:
        # Both trees, unless one was named explicitly.
        #
        # `mach build` copies `dist/bin` into `dist/Trance.app`, so provisioning
        # for packaging lands in the development app on the next build whether or
        # not that was asked for. Cleaning only the tree that was provisioned
        # left `config.js` in the `.app` — which is the tree `mach test`
        # launches, so the whole mochitest suite died on "Timed out waiting for
        # connection on 127.0.0.1:2828" with nothing to say why.
        roots = [app_root]
        if args.app is None:
            other = resolve_app_root(
                default_app() if args.for_package else package_app()
            )
            if other.is_dir() and other != app_root:
                roots.append(other)
        for root in roots:
            print(f"Removing Sine from {root} and {profile}")
            uninstall(root, profile)
        return 0

    release = resolve_release(args.channel)
    print(f"Installing Sine {release['tag_name']} ({args.channel}) ")
    print(f"  app root  {app_root}")
    print(f"  profile   {profile}")
    install_bootloader(app_root, profile)
    install_engine(release, profile, app_root)
    install_mods(profile, app_root)
    print("Done. Sine lives in about:preferences#sineMods.")
    print("New profiles are seeded from the staged copy on first run.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
