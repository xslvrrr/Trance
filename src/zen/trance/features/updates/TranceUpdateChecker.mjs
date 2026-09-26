// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: process-wide GitHub release checker. Import without a global option.
//
// Refs: TRANCE.md §6, §13 Phase 12

import {
  compareVersions,
  normalizeVersion,
  selectRelease,
} from "./TranceUpdateLogic.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Updates";
const PREF_ENABLED = "trance.updates.enabled";
const PREF_PRERELEASES = "trance.updates.prereleases";
const PREF_SKIPPED = "trance.updates.skipped";
const PREF_LAST_CHECK = "trance.updates.last-check";
const CHECK_INTERVAL = 6 * 60 * 60;
const RELEASES_URL =
  "https://api.github.com/repos/xslvrrr/Trance/releases?per_page=20";
let inFlight = null;
let latestResult = null;
const notifiedVersions = new Set();

const disabledByAutomation = () =>
  Cu.isInAutomation ||
  !!Services.env.get("MOZ_AUTOMATION") ||
  Services.prefs.getBoolPref("marionette.enabled", false);

async function fetchGitHubReleases() {
  const response = await fetch(RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status}`);
  }
  return response.json();
}

export const TranceUpdateChecker = Object.freeze({
  get latestResult() {
    return latestResult;
  },
  /**
   * @param {object} [options]
   * @param {boolean} [options.force] Bypass interval and skipped-tag suppression.
   * @param {string} [options.currentVersion] Current running version (test seam).
   * @param {Function|Array} [options.fetchReleases] Injected release-list seam.
   */
  async check({
    force = false,
    currentVersion = Services.appinfo.version,
    fetchReleases,
  } = {}) {
    if (!Services.prefs.getBoolPref(PREF_ENABLED, true)) {
      return { status: "disabled", version: "", prerelease: false, url: "" };
    }
    // Automated runs may exercise the injected, local release-list seam; they
    // never invoke the network-backed checker.
    if (disabledByAutomation() && !fetchReleases) {
      return { status: "disabled", version: "", prerelease: false, url: "" };
    }
    if (
      !force &&
      Date.now() / 1000 - Services.prefs.getIntPref(PREF_LAST_CHECK, 0) <
        CHECK_INTERVAL
    ) {
      return (
        latestResult || {
          status: "current",
          version: currentVersion,
          prerelease: false,
          url: "",
        }
      );
    }
    if (inFlight) {
      return inFlight;
    }
    // Cleared by identity once the run settles, and never from inside it: an
    // injected release list makes the whole run synchronous, so a `finally`
    // inside the run would clear `inFlight` before this assignment set it and
    // leave every later check returning the first one's answer.
    const pending = runCheck({ force, currentVersion, fetchReleases });
    inFlight = pending;
    try {
      return await pending;
    } finally {
      if (inFlight === pending) {
        inFlight = null;
      }
    }
  },
});

async function runCheck({ force, currentVersion, fetchReleases }) {
  Services.prefs.setIntPref(PREF_LAST_CHECK, Math.floor(Date.now() / 1000));
  try {
    let releases;
    if (typeof fetchReleases === "function") {
      releases = await fetchReleases();
    } else if (fetchReleases) {
      releases = fetchReleases;
    } else {
      releases = await fetchGitHubReleases();
    }
    const skipped = force ? "" : Services.prefs.getStringPref(PREF_SKIPPED, "");
    const eligible = (releases || []).filter(
      release =>
        release &&
        !release.draft &&
        (Services.prefs.getBoolPref(PREF_PRERELEASES, true) ||
          !release.prerelease)
    );
    const skippedRelease =
      skipped &&
      eligible.find(
        release =>
          normalizeVersion(release.tag_name) === normalizeVersion(skipped) &&
          compareVersions(release.tag_name, currentVersion) > 0
      );
    const release = selectRelease(eligible, {
      currentVersion,
      prereleases: true,
      skipped,
    });
    let result;
    if (
      skippedRelease &&
      (!release ||
        compareVersions(release.tag_name, skippedRelease.tag_name) <= 0)
    ) {
      result = {
        status: "skipped",
        version: normalizeVersion(skippedRelease.tag_name),
        prerelease: !!skippedRelease.prerelease,
        url: skippedRelease.html_url || "",
      };
    } else if (release) {
      result = {
        status: "available",
        version: normalizeVersion(release.tag_name),
        prerelease: !!release.prerelease,
        url: release.html_url || "",
      };
    } else {
      result = {
        status: "current",
        version: currentVersion,
        prerelease: false,
        url: "",
      };
    }

    latestResult = result;
    if (
      result.status === "available" &&
      !notifiedVersions.has(result.version)
    ) {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      const feature = win?.gTrance?.ensureFeature("Updates");
      if (feature?.showUpdate(result)) {
        notifiedVersions.add(result.version);
      }
    }
    return result;
  } catch (error) {
    TranceLog.error(NS, "release check failed", error);
    latestResult = { status: "error", version: "", prerelease: false, url: "" };
    return latestResult;
  }
}
