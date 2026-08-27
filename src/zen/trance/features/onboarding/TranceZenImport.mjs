// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: finding an installed Zen and taking its sidebar with you.
//
// Firefox's migration wizard imports bookmarks, history, passwords and cookies.
// It knows nothing about spaces, folders, essentials or pinned tabs, because
// those are not Firefox's — they are Zen's, and they are the only reason
// somebody who already runs Zen would hesitate before switching. Importing
// everything *except* the thing that makes the browser theirs is the same as
// not importing.
//
// ── Where the data actually is ────────────────────────────────────────────
//
// It used to be in `places.sqlite`, in `zen_workspaces` and `zen_pins`. It is
// not any more: `ZenSessionManager` migrates both tables into
// `zen-sessions.jsonlz4` in the profile directory on the first run after the
// update, and everything since is written there. The SQL tables survive in
// older profiles as a stale copy of a state the browser stopped reading, so a
// reader that preferred them would import whatever the profile looked like on
// the day it upgraded.
//
// So this reads the session file, and only the session file. A profile old
// enough to have no session file reports no importable data rather than
// silently importing a year-old sidebar.
//
// ── What "detect an install" means ────────────────────────────────────────
//
// Zen keeps every channel's profiles in one root — `zen` next to Trance's own
// vendor directory — and `profiles.ini` does not record which build wrote which
// profile. `compatibility.ini` does: `LastPlatformDir` is the app bundle that
// last ran the profile, so `/Applications/Twilight.app/...` is Twilight's and
// `/Applications/Zen.app/...` is stable Zen's. `LastVersion` carries the same
// answer a second way — Twilight's is `1.22t_…`, stable's is `1.18.10b_…` — and
// it is used as the fallback when the platform directory says nothing useful,
// which is what happens on Linux where both channels install to /opt/zen.
//
// A profile the user never opened has no `compatibility.ini` at all. It is
// still listed, as "Zen" with no channel, because a profile with spaces in it
// is worth offering whatever wrote it.
//
// ── Why staging rather than applying ──────────────────────────────────────
//
// The session manager reads its file once, at startup, before any window
// exists — `readFile()` is called from `SessionFileInternal.read`. By the time
// onboarding is on screen the sidebar object is built, and there is no public
// way to replace it; the setter is private and everything that consumes it has
// already run.
//
// So the import is written next to the session file as
// `trance-zen-import.jsonlz4` and `trance.import.staged` is set. One `if` in
// `ZenSessionManager.readFile` adopts it on the next startup and deletes it
// (touchpoint #25, ADR-053). Onboarding restarts the browser at the end of the
// flow, so "next startup" is a few seconds away rather than a thing the user
// has to be told about.
//
// Refs: TRANCE.md §13 Phase 13; ADR-053

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "ZenImport";

/**
 * The staged import, in the profile directory, next to `zen-sessions.jsonlz4`.
 *
 * A constant rather than a pref value on purpose. The touchpoint that reads it
 * runs before any window exists, and it joins this onto `PathUtils.profileDir`
 * — a pref holding a path would be a pref that can name any file on the disk
 * for a privileged early-startup read.
 */
export const STAGED_FILE = "trance-zen-import.jsonlz4";

/** Set when {@link STAGED_FILE} is waiting to be adopted. */
export const PREF_STAGED = "trance.import.staged";

/** The label of whatever was imported, kept so Settings can show it. */
export const PREF_SOURCE = "trance.import.source";

/** Zen's session file, in each candidate profile. */
const SESSION_FILE = "zen-sessions.jsonlz4";

/**
 * Vendor directory names Zen has shipped, in the order they are tried.
 *
 * `zen` on macOS and Windows, `.zen` on Linux. Both are probed everywhere
 * rather than switched on `AppConstants.platform`, because the cost of a
 * `IOUtils.exists` on a path that is not there is nothing, and a build that
 * moved the directory would otherwise silently detect nothing at all.
 */
const ZEN_ROOT_NAMES = Object.freeze(["zen", ".zen", "Zen"]);

/** The keys of the sidebar object an import carries over. */
const SIDEBAR_KEYS = Object.freeze([
  "spaces",
  "folders",
  "groups",
  "splitViewData",
]);

/**
 * Reads an INI file into `{ section: { key: value } }`.
 *
 * `nsIINIParser` rather than a regex: `profiles.ini` section names contain
 * spaces and parentheses ("Default (twilight)"), values contain `=`, and the
 * file is written by a component that owns the format. `initFromString` is used
 * rather than `createINIParser(file)` so the read stays on `IOUtils` and off
 * the main thread.
 *
 * @param {string} path
 * @returns {Promise<Record<string, Record<string, string>>|null>}
 */
async function readIni(path) {
  let text;
  try {
    text = await IOUtils.readUTF8(path);
  } catch {
    return null;
  }
  try {
    const parser = Cc["@mozilla.org/xpcom/ini-parser-factory;1"]
      .getService(Ci.nsIINIParserFactory)
      .createINIParser();
    parser.initFromString(text);
    const result = {};
    const sections = parser.getSections();
    while (sections.hasMore()) {
      const section = sections.getNext();
      const values = {};
      const keys = parser.getKeys(section);
      while (keys.hasMore()) {
        const key = keys.getNext();
        values[key] = parser.getString(section, key);
      }
      result[section] = values;
    }
    return result;
  } catch (error) {
    TranceLog.error(NS, `could not parse ${path}`, error);
    return null;
  }
}

/**
 * The directory Zen's vendor folder would sit in, next to Trance's own.
 *
 * Derived from `PathUtils.profileDir` rather than from `Services.dirsvc`,
 * because the directory service answers for *this* application and the
 * question here is about a different one. Three levels up from
 * `…/Trance/Profiles/xxxx.Default (trance)` is the container both vendors
 * share on every platform Zen ships for.
 *
 * @returns {string|null}
 */
function vendorContainer() {
  let dir = PathUtils.profileDir;
  for (let i = 0; i < 3; i++) {
    const up = PathUtils.parent(dir);
    if (!up || up === dir) {
      return null;
    }
    dir = up;
  }
  return dir;
}

/**
 * Which Zen build last ran a profile.
 *
 * @param {Record<string, Record<string, string>>|null} compatibility
 * @param {string} profileName
 * @returns {"stable"|"twilight"|"unknown"}
 */
function channelOf(compatibility, profileName) {
  const section = compatibility?.Compatibility ?? {};
  const platformDir = section.LastPlatformDir ?? "";
  const version = section.LastVersion ?? "";

  if (/twilight/i.test(platformDir) || /twilight/i.test(profileName)) {
    return "twilight";
  }
  // `1.22t_20260826111626/20260826111626`. The `t` is the whole signal, and it
  // is only meaningful immediately before the underscore — `1.18.10b_…` is
  // stable and contains no `t` there.
  if (/^[\d.]+t_/.test(version)) {
    return "twilight";
  }
  if (
    /zen(\.app|-browser)?/i.test(platformDir) ||
    /release/i.test(profileName)
  ) {
    return "stable";
  }
  return "unknown";
}

/** @param {"stable"|"twilight"|"unknown"} channel */
function channelLabel(channel) {
  switch (channel) {
    case "twilight":
      return "Zen Twilight";
    case "stable":
      return "Zen";
    default:
      return "Zen (unknown build)";
  }
}

/**
 * Counts the parts of a sidebar object worth putting in front of the user.
 *
 * Pinned and essential tabs are counted separately from the rest because they
 * are the two the sidebar shows permanently, and because they are the two an
 * import always carries — an open tab is a thing you were doing, a pinned tab
 * is a thing you keep.
 *
 * @param {object} sidebar
 */
function summarise(sidebar) {
  const tabs = Array.isArray(sidebar?.tabs) ? sidebar.tabs : [];
  return {
    spaces: Array.isArray(sidebar?.spaces) ? sidebar.spaces.length : 0,
    folders: Array.isArray(sidebar?.folders) ? sidebar.folders.length : 0,
    groups: Array.isArray(sidebar?.groups) ? sidebar.groups.length : 0,
    essentials: tabs.filter(tab => tab?.zenEssential).length,
    pinned: tabs.filter(tab => tab?.pinned && !tab?.zenEssential).length,
    open: tabs.filter(tab => !tab?.pinned && !tab?.zenEssential).length,
  };
}

/**
 * Reads one profile's session file, or gives up on it.
 *
 * Every failure path returns `null`. A profile that cannot be read is a profile
 * that is not offered — this builds one page of a first-run flow, and a
 * malformed `compatibility.ini` in somebody's five-year-old profile directory is
 * not a reason for that page to be empty.
 *
 * @param {string} path
 * @param {string} profileName
 * @returns {Promise<object|null>}
 */
async function inspectProfile(path, profileName) {
  const session = PathUtils.join(path, SESSION_FILE);
  let sidebar;
  let lastUsed = 0;
  try {
    lastUsed = (await IOUtils.stat(session)).lastModified ?? 0;
    sidebar = await IOUtils.readJSON(session, { decompress: true });
  } catch {
    // No session file, or one written by a crash mid-write. Either way there is
    // nothing here to offer.
    return null;
  }

  const counts = summarise(sidebar);
  if (!counts.spaces) {
    // A session file with no spaces is a profile that was created and never
    // used. Zen writes at least one space for any profile that has been opened,
    // so this is the cheapest "is there anything here" test there is.
    return null;
  }

  const compatibility = await readIni(
    PathUtils.join(path, "compatibility.ini")
  );
  const channel = channelOf(compatibility, profileName);
  return {
    id: path,
    path,
    name: profileName,
    channel,
    label: channelLabel(channel),
    version: (compatibility?.Compatibility?.LastVersion ?? "").split("_")[0],
    lastUsed,
    counts,
  };
}

export const TranceZenImport = {
  /**
   * Every Zen profile on this machine that has something to import.
   *
   * Never throws and never rejects: this runs to build one page of a first-run
   * flow, and a profile directory that cannot be read is a profile that is not
   * offered, not a flow that stops.
   *
   * @returns {Promise<object[]>} newest first
   */
  async detect() {
    const container = vendorContainer();
    if (!container) {
      return [];
    }

    const candidates = [];
    for (const vendorName of ZEN_ROOT_NAMES) {
      const root = PathUtils.join(container, vendorName);
      // Trance's own vendor directory is a sibling, never one of these names,
      // but a fork that renamed itself into one would otherwise offer to import
      // its own profile into itself.
      if (root === PathUtils.parent(PathUtils.parent(PathUtils.profileDir))) {
        continue;
      }
      candidates.push(...(await this.detectIn(root)));
    }

    candidates.sort((a, b) => b.lastUsed - a.lastUsed);
    TranceLog.log(NS, `found ${candidates.length} importable Zen profile(s)`);
    return candidates;
  },

  /**
   * Every importable profile under one vendor directory.
   *
   * Public, and not only because {@link detect} calls it: it is the seam a test
   * can point at a fixture. The alternative is a suite that only passes on a
   * machine with Zen installed, which tests the machine rather than the code.
   *
   * @param {string} root - a vendor directory, e.g. `…/Application Support/zen`
   * @returns {Promise<object[]>}
   */
  async detectIn(root) {
    const profiles = await readIni(PathUtils.join(root, "profiles.ini"));
    if (!profiles) {
      return [];
    }

    const found = [];
    for (const [section, values] of Object.entries(profiles)) {
      // `[Profile0]` and friends, never `[General]` or `[InstallXXXX]`. The
      // install sections name a default profile by path and would otherwise be
      // read as a second copy of a profile already in the list.
      if (!/^Profile\d+$/.test(section) || !values.Path) {
        continue;
      }
      const path =
        values.IsRelative === "0"
          ? values.Path
          : PathUtils.join(root, ...values.Path.split("/"));

      const candidate = await inspectProfile(path, values.Name || section);
      if (candidate) {
        found.push(candidate);
      }
    }
    return found;
  },

  /**
   * Writes a candidate's sidebar out as the next startup's session.
   *
   * @param {object} candidate - one entry from {@link detect}
   * @param {object} [options]
   * @param {boolean} [options.includeOpenTabs] - carry unpinned tabs too
   * @returns {Promise<boolean>} whether anything was staged
   */
  async stage(candidate, { includeOpenTabs = false } = {}) {
    let sidebar;
    try {
      sidebar = await IOUtils.readJSON(
        PathUtils.join(candidate.path, SESSION_FILE),
        { decompress: true }
      );
    } catch (error) {
      TranceLog.error(NS, "could not read the Zen session file", error);
      return false;
    }

    const tabs = (Array.isArray(sidebar?.tabs) ? sidebar.tabs : []).filter(
      tab => includeOpenTabs || tab?.pinned || tab?.zenEssential
    );

    const staged = { tabs, lastCollected: Date.now() };
    for (const key of SIDEBAR_KEYS) {
      if (Array.isArray(sidebar?.[key])) {
        staged[key] = sidebar[key];
      }
    }
    if (!staged.spaces?.length) {
      TranceLog.warn(NS, "the chosen profile has no spaces; nothing staged");
      return false;
    }

    try {
      await IOUtils.writeJSON(
        PathUtils.join(PathUtils.profileDir, STAGED_FILE),
        staged,
        {
          compress: true,
          tmpPath: PathUtils.join(PathUtils.profileDir, `${STAGED_FILE}.tmp`),
        }
      );
    } catch (error) {
      TranceLog.error(NS, "could not write the staged import", error);
      return false;
    }

    Services.prefs.setBoolPref(PREF_STAGED, true);
    Services.prefs.setStringPref(
      PREF_SOURCE,
      `${candidate.label} — ${candidate.name}`
    );
    TranceLog.log(
      NS,
      `staged ${staged.spaces.length} space(s) and ${tabs.length} tab(s) from ${candidate.path}`
    );
    return true;
  },

  /** Drops a staged import that has not been adopted yet. */
  async unstage() {
    Services.prefs.clearUserPref(PREF_STAGED);
    Services.prefs.clearUserPref(PREF_SOURCE);
    try {
      await IOUtils.remove(PathUtils.join(PathUtils.profileDir, STAGED_FILE), {
        ignoreAbsent: true,
      });
    } catch (error) {
      TranceLog.error(NS, "could not remove the staged import", error);
    }
  },

  /** @returns {boolean} */
  get isStaged() {
    return Services.prefs.getBoolPref(PREF_STAGED, false);
  },
};
