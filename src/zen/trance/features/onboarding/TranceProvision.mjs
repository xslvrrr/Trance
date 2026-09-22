// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the runtime half of provisioning.
//
// `scripts/trance-cosine.py` provisions a *build*: it fetches the Sine engine
// and the mods Trance preinstalls and writes them into the app and into one
// profile. That is the right place for it, and it is the wrong place for the
// two questions the onboarding flow asks, because both of them are asked after
// the build exists:
//
//   - "Cosine or Sine" chose a channel and then wrote a pref and rewrote one
//     version string in `engine.json`. That is Sine's own channel-switching
//     mechanism and it does work — on the next update check, which may be days
//     away and which silently does nothing at all if the profile has no engine
//     in it. Someone who picked "Sine" on the first screen and opened the mod
//     manager a minute later was still on Cosine, and nothing said so.
//
//   - "Stable or Twilight" wrote prefs and nothing else, so the Zen-store mods
//     the browser ships with came from whenever the build was provisioned and
//     could not be moved.
//
// This module is what those two pages call instead. It is the same work the
// Python provisioner does, expressed against `IOUtils`, `fetch` and
// `nsIZipReader`, and confined to the parts of the profile the provisioner
// already owns:
//
//   {profile}/chrome/JS/          the Sine engine
//   {profile}/chrome/sine-mods/   the mods, and their `mods.json`
//
// It does not touch `{app}/config.js`, `{app}/trance-cosine/` or
// `{profile}/chrome/utils/`. Those are the bootloader, they are installed by
// the packaging step, and a browser that rewrote its own loader while running
// on it is a browser that can brick its own profile from a first-run screen.
//
// ── One download, not seventy requests ────────────────────────────────────
//
// The provisioner walks the theme store through the GitHub contents API, one
// request per folder and one per file. That is fine for a build step with a
// token in the environment; from a browser it is sixty-odd unauthenticated
// requests against a limit of sixty an hour. So this fetches the repository
// once, as a zip, at whatever ref was asked for — which is also what makes
// "pin to a commit" a feature rather than a special case, because a commit SHA
// is just another ref to `codeload`.
//
// Refs: TRANCE.md §7, §9, §13 Phase 13; ADR-018, ADR-051, ADR-073

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const { FileUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/FileUtils.sys.mjs"
);

const NS = "Provision";

const SINE_REPO = "CosmoCreeper/Sine";
const SINE_RELEASES = `https://api.github.com/repos/${SINE_REPO}/releases?per_page=30`;
const SINE_TAG = `https://api.github.com/repos/${SINE_REPO}/releases/tags/`;

const ZEN_STORE = "zen-browser/theme-store";
const ZEN_STORE_ZIP = `https://codeload.github.com/${ZEN_STORE}/zip/`;

/**
 * The store commit a Trance build installs from unless it is told otherwise.
 *
 * The same value as `ZEN_STORE_REF` in `scripts/trance-cosine.py`, and it has
 * to be: the provisioner decides what a *build* ships and this decides what a
 * *reinstall* fetches, so the two disagreeing means a reinstall silently
 * changes the mods. Restated rather than shared because one is a build script
 * in Python and the other is a browser module, and they have no artefact in
 * common but the profile.
 *
 * `main` is still reachable — the feature-set page offers it, and
 * `--unpinned` is the provisioner's version of the same question. It is just
 * not the default any more (AUDIT.md Phase 6).
 */
const ZEN_STORE_PIN = "7173dba5d060417fd65764b706856ae609496e31";

/**
 * The Zen-theme-store mods Trance preinstalls.
 *
 * One entry, and it is the same one `PREINSTALLED_MODS` in
 * `scripts/trance-cosine.py` lists with `"store": "zen"`. It is restated here
 * rather than read from anywhere because there is nowhere to read it from: the
 * provisioner is a build script and this is a browser, and the only artefact
 * they share is the profile itself.
 *
 * That would be a two-owner problem (TRANCE.md §3.1) if this were the whole
 * list. It is not: `zenStoreIds` below starts from what the profile already
 * has — every mod whose `theme.json` carries the empty `homepage` that marks a
 * theme-store mod — and falls back to this only for a profile that has none
 * yet. So the provisioner stays the owner of what a *build* ships, and this
 * stays the owner of nothing.
 */
const ZEN_STORE_FALLBACK = Object.freeze([
  "599a1599-e6ab-4749-ab22-de533860de2c",
]);

/** A git ref this module is willing to put in a URL. */
const REF = /^[\w.][\w.\-/]{0,99}$/;

/** Ten minutes is not a network timeout, it is a "something is wrong" timeout. */
const FETCH_TIMEOUT = 600000;

/**
 * Sine derives its fork id from `AppConstants.MOZ_APP_NAME` against a fixed
 * table, and Trance is not in it — so Sine decides Trance is Firefox and hides
 * every Zen-only mod. One row, the same row `patch_fork_id` in the provisioner
 * adds, reapplied here because installing an engine replaces the file it is in.
 */
const FORK_ANCHOR = '      zen: "zen",\n';
const FORK_ROW = '      trance: "zen",\n';

export const TranceProvision = {
  // --- Where things live -----------------------------------------------------

  get profileChrome() {
    return PathUtils.join(
      Services.dirsvc.get("ProfD", Ci.nsIFile).path,
      "chrome"
    );
  },

  get engineDir() {
    return PathUtils.join(this.profileChrome, "JS");
  },

  get engineFile() {
    return PathUtils.join(this.engineDir, "engine.json");
  },

  get modsDir() {
    return PathUtils.join(this.profileChrome, "sine-mods");
  },

  get modsFile() {
    return PathUtils.join(this.modsDir, "mods.json");
  },

  /**
   * The installed engine's version, or null when there is no engine.
   *
   * @returns {Promise<string | null>}
   */
  async engineVersion() {
    try {
      const engine = await IOUtils.readJSON(this.engineFile);
      return engine?.version ?? null;
    } catch (error) {
      return null;
    }
  },

  /**
   * Whether this profile has been seeded with the bootloader at all.
   *
   * `chrome/utils/chrome.manifest` is what `config.js` copies across on a first
   * start, and it is what registers `chrome://userscripts`. Without it an
   * installed engine is a directory of files nothing will ever load, and saying
   * so is more use than installing one anyway.
   *
   * @returns {Promise<boolean>}
   */
  async hasBootloader() {
    return IOUtils.exists(
      PathUtils.join(this.profileChrome, "utils", "chrome.manifest")
    );
  },

  // --- Sine ------------------------------------------------------------------

  /**
   * The release to install: the newest on a channel, or one named tag.
   *
   * Cosine is Sine's pre-release channel and its tags end in `c` before the
   * version digits — the same test the provisioner makes, made against the same
   * API.
   *
   * @param {{channel?: string, tag?: string}} request
   * @returns {Promise<{tag: string, url: string}>}
   */
  async resolveSineRelease({ channel = "cosine", tag = "" } = {}) {
    if (tag) {
      if (!REF.test(tag)) {
        throw new Error(`not a usable release tag: ${tag}`);
      }
      const release = await fetchJSON(SINE_TAG + encodeURIComponent(tag));
      return { tag: release.tag_name, url: engineAsset(release) };
    }

    const releases = await fetchJSON(SINE_RELEASES);
    for (const release of releases) {
      if (release.draft) {
        continue;
      }
      const isCosine = release.tag_name.replace(/[.0-9]+$/, "").endsWith("c");
      if (channel === "cosine" && isCosine) {
        return { tag: release.tag_name, url: engineAsset(release) };
      }
      if (channel === "sine" && !isCosine && !release.prerelease) {
        return { tag: release.tag_name, url: engineAsset(release) };
      }
    }
    throw new Error(`no release found on channel '${channel}'`);
  },

  /**
   * Replaces `{profile}/chrome/JS` with the engine from one release.
   *
   * Written to a sibling directory and moved into place, because the engine is
   * loaded from this path at every startup and a browser killed halfway through
   * writing thirty files into it would come back with half an engine.
   *
   * @param {{tag: string, url: string}} release
   * @returns {Promise<string>} the installed engine's version
   */
  async installSineEngine(release) {
    const staging = `${this.engineDir}.trance-staging`;
    await IOUtils.remove(staging, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(staging, { createAncestors: true });

    const archive = await downloadToTemp(release.url, "trance-engine.zip");
    try {
      await extractZip(archive, staging, "JS/");
    } finally {
      await IOUtils.remove(archive, { ignoreAbsent: true });
    }

    const manifest = PathUtils.join(staging, "engine.json");
    if (!(await IOUtils.exists(manifest))) {
      await IOUtils.remove(staging, { recursive: true, ignoreAbsent: true });
      throw new Error(`${release.tag} has no engine.json inside engine.zip`);
    }
    await patchForkId(staging);

    await IOUtils.remove(this.engineDir, {
      recursive: true,
      ignoreAbsent: true,
    });
    await IOUtils.move(staging, this.engineDir);
    await IOUtils.makeDirectory(this.modsDir, { createAncestors: true });

    const version = (await IOUtils.readJSON(this.engineFile))?.version ?? "";
    TranceLog.log(NS, `installed Sine engine ${release.tag} (${version})`);
    return version;
  },

  // --- Zen theme store -------------------------------------------------------

  /**
   * Reinstalls this profile's theme-store mods from one ref of the store.
   *
   * The ref is a branch, a tag or a commit SHA, and all three are the same
   * thing to `codeload` — which is why pinning to a commit needs no code of its
   * own.
   *
   * Returns what it did rather than throwing on a mod that is not in the store
   * at that ref: a pinned commit predating a mod is a true answer to the
   * question the page asked, and the page can say so.
   *
   * @param {string} ref
   * @returns {Promise<{ref: string, installed: string[], missing: string[]}>}
   */
  async installZenStoreMods(ref = ZEN_STORE_PIN) {
    if (!REF.test(ref)) {
      throw new Error(`not a usable ref: ${ref}`);
    }
    const ids = await this.zenStoreIds();
    if (!ids.length) {
      return { ref, installed: [], missing: [] };
    }

    const archive = await downloadToTemp(
      ZEN_STORE_ZIP + encodeURIComponent(ref),
      "trance-theme-store.zip"
    );
    const staging = PathUtils.join(
      PathUtils.tempDir,
      "trance-theme-store-unpacked"
    );
    await IOUtils.remove(staging, { recursive: true, ignoreAbsent: true });

    try {
      // `codeload` wraps everything in one `<repo>-<ref>/` directory whose name
      // depends on the ref, so the prefix cannot be known in advance — it is
      // read off the first entry instead.
      const root = await extractZip(archive, staging, null);
      const themes = PathUtils.join(staging, root, "themes");

      const installed = [];
      const missing = [];
      const records = await this.readMods();

      for (const id of ids) {
        const source = PathUtils.join(themes, id);
        if (!(await IOUtils.exists(PathUtils.join(source, "theme.json")))) {
          missing.push(id);
          continue;
        }
        records[id] = await this.installOneZenMod(id, source, records[id]);
        installed.push(id);
      }

      await this.writeMods(records);
      TranceLog.log(NS, `theme store ${ref}: ${installed.length} installed`);
      return { ref, installed, missing };
    } finally {
      await IOUtils.remove(archive, { ignoreAbsent: true });
      await IOUtils.remove(staging, { recursive: true, ignoreAbsent: true });
    }
  },

  /**
   * The theme-store mods this profile has, or the shipped list for a profile
   * that has none yet.
   *
   * A theme-store mod is identified by an empty `homepage` — not by a flag
   * Trance invents. That empty string is Sine's own marker: its updater reads
   * it to decide that a mod is updated from the store rather than from an
   * author's repository.
   *
   * @returns {Promise<string[]>}
   */
  async zenStoreIds() {
    const records = await this.readMods();
    const present = Object.entries(records)
      .filter(([, record]) => record && record.homepage === "")
      .map(([id]) => id);
    return present.length ? present : [...ZEN_STORE_FALLBACK];
  },

  async readMods() {
    try {
      const records = await IOUtils.readJSON(this.modsFile);
      return records && typeof records === "object" ? records : {};
    } catch (error) {
      return {};
    }
  },

  async writeMods(records) {
    await IOUtils.makeDirectory(this.modsDir, { createAncestors: true });
    await IOUtils.writeJSON(this.modsFile, records);
  },

  /**
   * One theme-store mod: its folder, then its `mods.json` record.
   *
   * The record is built the way `install_zen_mod` in the provisioner builds it,
   * and for the same reasons — `style` reduced to paths relative to the mod's
   * own folder because that is what Sine joins onto the profile path when it
   * rebuilds `chrome.css`, no `origin` because Sine reserves that field for its
   * own store, and `homepage` preserved exactly as published because it is the
   * marker above.
   *
   * `enabled` is carried over from whatever the profile already said, so
   * repinning the store does not switch a mod the user turned off back on.
   *
   * @param {string} id
   * @param {string} source
   * @param {object} [previous]
   */
  async installOneZenMod(id, source, previous) {
    const target = PathUtils.join(this.modsDir, id);
    await IOUtils.remove(target, { recursive: true, ignoreAbsent: true });
    await IOUtils.copy(source, target, { recursive: true });

    const data = await IOUtils.readJSON(PathUtils.join(target, "theme.json"));
    const files = await IOUtils.getChildren(target);
    const names = new Set(files.map(path => PathUtils.filename(path)));

    const style =
      typeof data.style === "string"
        ? { chrome: data.style }
        : (data.style ?? {});

    return {
      ...data,
      id,
      style: {
        chrome: relativeToMod(style.chrome, id, names),
        content: relativeToMod(style.content, id, names),
      },
      preferences:
        relativeToMod(data.preferences, id, names) ||
        (names.has("preferences.json") ? "preferences.json" : ""),
      enabled: previous?.enabled ?? true,
      "no-updates": previous?.["no-updates"] ?? false,
    };
  },
};

// --- Plumbing ---------------------------------------------------------------

/**
 * The published `style` path, reduced to something under the mod's own folder.
 *
 * The store publishes it as an absolute raw URL. Sine wants the part after
 * `themes/<id>/`, and wants nothing at all when the repository does not
 * actually contain that file.
 *
 * @param {unknown} value
 * @param {string} id
 * @param {Set<string>} names
 * @returns {string}
 */
function relativeToMod(value, id, names) {
  if (typeof value !== "string" || !value) {
    return "";
  }
  const marker = `themes/${id}/`;
  const index = value.indexOf(marker);
  const relative = index === -1 ? value : value.slice(index + marker.length);
  const [head] = relative.split("/");
  return names.has(head) ? relative : "";
}

/**
 * @param {object} release
 * @returns {string}
 */
function engineAsset(release) {
  const asset = (release.assets ?? []).find(item => item.name === "engine.zip");
  if (!asset) {
    throw new Error(`release ${release.tag_name} has no engine.zip`);
  }
  return asset.browser_download_url;
}

/**
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJSON(url) {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  return response.json();
}

/**
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response;
}

/**
 * Downloads to the temp directory and returns the path.
 *
 * To disk rather than kept in memory because `nsIZipReader` reads a file, and
 * because the theme store is a repository — holding it as one `ArrayBuffer` in
 * the parent process is the kind of allocation that shows up in a memory graph
 * long after the first run is over.
 *
 * @param {string} url
 * @param {string} fileName
 * @returns {Promise<string>}
 */
async function downloadToTemp(url, fileName) {
  const response = await fetchWithTimeout(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const path = PathUtils.join(PathUtils.tempDir, fileName);
  await IOUtils.write(path, bytes, { tmpPath: `${path}.tmp` });
  return path;
}

/**
 * Extracts a zip, optionally keeping only one prefix.
 *
 * Returns the first path component every entry shares, which is what a GitHub
 * archive wraps its contents in and what the caller needs in order to find
 * anything inside it. With a `prefix` that component is stripped instead and
 * the return value is the empty string.
 *
 * Entries are checked against the destination rather than trusted: a zip is an
 * untrusted list of paths, and `../` in one of them is how an archive writes
 * outside the directory it was told to write into.
 *
 * @param {string} archivePath
 * @param {string} destination
 * @param {string | null} prefix
 * @returns {Promise<string>}
 */
async function extractZip(archivePath, destination, prefix) {
  const reader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
    Ci.nsIZipReader
  );
  reader.open(new FileUtils.File(archivePath));
  try {
    let root = "";
    // The one character `PathUtils.join` puts between two components on this
    // platform. Asked rather than assumed, because the containment check below
    // is the only thing standing between a hostile archive and the rest of the
    // profile, and `\` is not `/`.
    const separator = PathUtils.join(destination, "x").slice(
      destination.length,
      destination.length + 1
    );
    const entries = reader.findEntries("*");
    while (entries.hasMore()) {
      const entry = entries.getNext();
      if (entry.endsWith("/")) {
        continue;
      }
      let relative = entry;
      if (prefix) {
        if (!entry.startsWith(prefix)) {
          continue;
        }
        relative = entry.slice(prefix.length);
      } else {
        root ||= entry.split("/")[0];
      }
      if (!relative) {
        continue;
      }

      const target = PathUtils.join(destination, ...relative.split("/"));
      // `PathUtils.join` normalises, so a `..` in the entry name lands outside
      // `destination` — and this is where that stops being possible.
      if (!target.startsWith(destination + separator)) {
        throw new Error(`refusing to extract outside the target: ${entry}`);
      }

      await IOUtils.makeDirectory(PathUtils.parent(target), {
        createAncestors: true,
      });
      reader.extract(entry, new FileUtils.File(target));
    }
    return root;
  } finally {
    reader.close();
  }
}

/**
 * Adds Trance to Sine's fork table in a freshly-unpacked engine.
 *
 * A missing anchor is logged and not thrown: an engine whose table moved is
 * still a working mod manager, it just hides the Zen-only half of the store,
 * and failing the whole install over it would leave the profile with no engine
 * at all.
 *
 * @param {string} engineDir
 */
async function patchForkId(engineDir) {
  const path = PathUtils.join(engineDir, "utils", "uc_api.sys.mjs");
  try {
    const source = await IOUtils.readUTF8(path);
    if (!source.includes(FORK_ANCHOR)) {
      TranceLog.error(NS, "fork table not found in uc_api.sys.mjs");
      return;
    }
    if (source.includes(FORK_ROW)) {
      return;
    }
    await IOUtils.writeUTF8(
      path,
      source.replace(FORK_ANCHOR, FORK_ANCHOR + FORK_ROW)
    );
  } catch (error) {
    TranceLog.error(NS, "could not patch the Sine fork table", error);
  }
}
