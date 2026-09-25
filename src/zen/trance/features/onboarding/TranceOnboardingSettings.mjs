// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: persistent onboarding settings, independent of the first-run UI.
// Refs: TRANCE.md §6.5, §13 Phase 13; ADR-051; AUDIT.md Phase 5.

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "OnboardingSettings";
const PREF_MODS_CHANNEL = "trance.mods.channel";
const PREF_ARCH = "trance.perf.arch";

// All consumers use the shared system-global copy of this module. Window-local
// module state would duplicate observers and race writes to the same engine.
export class TranceOnboardingSettings extends TranceFeature {
  static prefName = "trance.onboarding.enabled";
  static featureName = "OnboardingSettings";

  onEnable() {
    const { TranceOnboardingSettingsService } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceOnboardingSettings.mjs"
    );
    // Runtime default-branch values live only in memory, so the persisted
    // answer is made the default again at every start.
    TranceOnboardingSettingsService.applyArchDefaults(
      Services.prefs.getStringPref(PREF_ARCH, "arm64")
    );
    this.addDisposer(TranceOnboardingSettingsService.acquire());
  }
}

let holders = 0;
let watchers = [];
let modWrites = Promise.resolve();
const writingChoices = new Set();

/**
 * Suppress only our own synchronous pref notification, not later edits.
 *
 * @param {string} pref
 * @param {string} value
 */
function writeChoice(pref, value) {
  writingChoices.add(pref);
  try {
    Services.prefs.setStringPref(pref, value);
  } finally {
    writingChoices.delete(pref);
  }
}

/** Shared actions also reapply a choice when its pref value is unchanged. */
export const TranceOnboardingSettingsService = {
  applyArch,
  applyArchDefaults,
  applyModChannel,

  /** One observer set for all enabled windows; released by the last holder. */
  acquire() {
    if (!holders) {
      try {
        for (const [pref, apply] of [
          [PREF_ARCH, applyArch],
          [PREF_MODS_CHANNEL, applyModChannel],
        ]) {
          const observer = {
            observe: () => {
              if (writingChoices.has(pref)) {
                return;
              }
              try {
                Promise.resolve(
                  apply(Services.prefs.getStringPref(pref, ""))
                ).catch(error =>
                  TranceLog.error(NS, `could not apply ${pref}`, error)
                );
              } catch (error) {
                TranceLog.error(NS, `could not apply ${pref}`, error);
              }
            },
          };
          Services.prefs.addObserver(pref, observer);
          watchers.push([pref, observer]);
        }
      } catch (error) {
        removeWatchers();
        throw error;
      }
    }
    holders++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        if (!--holders) {
          removeWatchers();
        }
      }
    };
  },
};

function removeWatchers() {
  for (const [pref, observer] of watchers) {
    Services.prefs.removeObserver(pref, observer);
  }
  watchers = [];
}

/**
 * Serialize read/modify/write so rapid channel changes finish in order.
 *
 * @param {string} channel
 * @returns {Promise<void>}
 */
async function applyModChannel(channel) {
  writeChoice(PREF_MODS_CHANNEL, channel);
  const result = modWrites.then(() => rewriteModChannel(channel));
  // An unexpected failure must not prevent a later settings change applying.
  modWrites = result.catch(() => {});
  return result;
}

/**
 * Switches the installed engine's channel by rewriting its own version.
 *
 * This is Sine's mechanism, not a workaround for it: the engine compares the
 * version in `engine.json` against its releases to decide what to update to,
 * and a Cosine release is one whose tag ends in `c`. Adding or removing that
 * suffix is therefore the supported way to move an installed engine between
 * channels, and it is exactly what `scripts/trance-cosine.py` relies on when
 * it says a Cosine engine keeps updating along Cosine.
 *
 * Nothing here installs, downloads or restarts. The engine picks the change
 * up on its next update check.
 *
 * @param {string} channel
 */
async function rewriteModChannel(channel) {
  let engine;
  let file;
  try {
    file = PathUtils.join(
      Services.dirsvc.get("ProfD", Ci.nsIFile).path,
      "chrome",
      "JS",
      "engine.json"
    );
    engine = await IOUtils.readJSON(file);
  } catch (error) {
    // No engine in this profile. The pref is the whole answer.
    return;
  }
  const current = String(engine?.version ?? "");
  if (!current) {
    return;
  }
  const base = current.replace(/c$/, "");
  const wanted = channel === "cosine" ? `${base}c` : base;
  if (wanted === current) {
    return;
  }
  try {
    await IOUtils.writeJSON(file, { ...engine, version: wanted });
    TranceLog.log(NS, `mod engine ${current} → ${wanted}`);
  } catch (error) {
    TranceLog.error(NS, "could not rewrite the mod engine version", error);
  }
}

/**
 * The surface prefs an Intel GPU wants different values for, and those values.
 *
 * These are the numbers the architecture page's own copy promises (ADR-072):
 * blur is the only Trance-drawn cost that scales with GPU class. They are
 * written to the *default* branch, so they are what a person gets until they
 * move one of these controls themselves; an explicit choice in Settings or the
 * theme picker is a user value and outranks the tuning, including when the
 * question is answered again.
 *
 * None of this is free on a platform that pays for blur, and on the three that
 * do not — macOS vibrancy, Windows Mica, transparent GTK — the radius is not
 * painted at all. See the Blur section of trance-surfaces.css.
 */
const ARCH_TUNING = Object.freeze({
  arm64: Object.freeze([
    { name: "trance.surface.blur.radius", type: "int", value: 24 },
    { name: "trance.surface.internal.blur", type: "bool", value: true },
    { name: "trance.chrome.urlbar.focus-blur", type: "bool", value: true },
    {
      name: "trance.surface.suspend-when-unfocused",
      type: "bool",
      value: true,
    },
  ]),
  x86_64: Object.freeze([
    { name: "trance.surface.blur.radius", type: "int", value: 10 },
    // The `about:` pages' own blur is a second full-viewport pass over content
    // that is already opaque behind it. It is the cheapest thing to give up.
    { name: "trance.surface.internal.blur", type: "bool", value: false },
    { name: "trance.chrome.urlbar.focus-blur", type: "bool", value: false },
    {
      name: "trance.surface.suspend-when-unfocused",
      type: "bool",
      value: true,
    },
  ]),
});

/**
 * Records the architecture answer and makes its tuning the default.
 *
 * @param {string} arch
 */
function applyArch(arch) {
  writeChoice(PREF_ARCH, arch);
  applyArchDefaults(arch);
  TranceLog.log(NS, "arch", arch);
}

/**
 * Writes the arch-tuned blur prefs to the default branch (see ARCH_TUNING).
 *
 * @param {string} arch
 */
function applyArchDefaults(arch) {
  const defaults = Services.prefs.getDefaultBranch(null);
  for (const entry of ARCH_TUNING[arch] ?? []) {
    try {
      if (entry.type === "int") {
        defaults.setIntPref(entry.name, entry.value);
      } else {
        defaults.setBoolPref(entry.name, entry.value);
      }
    } catch (error) {
      TranceLog.error(NS, `could not set ${entry.name}`, error);
    }
  }
}
