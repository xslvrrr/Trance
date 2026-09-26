// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: pure version ordering and GitHub release selection for updates.
//
// Refs: TRANCE.md §13 Phase 12

/**
 * Parse a numeric dotted version with an optional prerelease suffix.
 *
 * @param {string} value A tag or version, with or without a leading `v`.
 * @returns {{parts: number[], prerelease: string}|null}
 */
export function parseVersion(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = value
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    return null;
  }
  return {
    parts: match[1].split(".").map(Number),
    prerelease: match[2] || "",
  };
}

/**
 * Order two versions: numeric components, then a final release above any
 * prerelease of the same numbers.
 *
 * @param {string} left
 * @param {string} right
 * @returns {-1|0|1}
 */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) {
    throw new TypeError(
      "Versions must be numeric dotted versions with an optional prerelease suffix"
    );
  }
  const count = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < count; i++) {
    const av = a.parts[i] ?? 0;
    const bv = b.parts[i] ?? 0;
    if (av !== bv) {
      return av < bv ? -1 : 1;
    }
  }
  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (!a.prerelease) {
    return 1;
  }
  if (!b.prerelease) {
    return -1;
  }
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

/**
 * The highest eligible release newer than the running version, ignoring
 * malformed tags, drafts, the skipped tag and — when asked — prereleases.
 *
 * @param {object[]} releases GitHub release objects.
 * @param {object} options
 * @param {string} options.currentVersion The running version.
 * @param {boolean} [options.prereleases] Whether prereleases are eligible.
 * @param {string} [options.skipped] A tag the user chose to skip.
 * @returns {object|null}
 */
export function selectRelease(
  releases,
  { currentVersion, prereleases = true, skipped = "" }
) {
  let selected = null;
  for (const release of releases || []) {
    if (!release || release.draft || (release.prerelease && !prereleases)) {
      continue;
    }
    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    if (
      !parseVersion(tag) ||
      (skipped && normalizeVersion(tag) === normalizeVersion(skipped))
    ) {
      continue;
    }
    if (compareVersions(tag, currentVersion) <= 0) {
      continue;
    }
    if (!selected || compareVersions(tag, selected.tag_name) > 0) {
      selected = release;
    }
  }
  return selected;
}

/**
 * @param {string} value
 * @returns {string} The version without surrounding space or a leading `v`.
 */
export function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}
