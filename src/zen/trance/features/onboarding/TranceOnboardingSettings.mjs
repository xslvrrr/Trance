// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: persistent onboarding settings, independent of the first-run UI.
// Refs: TRANCE.md §6.5, §13 Phase 13; ADR-051; AUDIT.md Phase 5.

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

// Named `lazyAppConstants` only because the chrome window already has a global
// `AppConstants`; this module is also loaded into the shared system global,
// where that global does not exist, so it imports its own.
const { AppConstants: lazyAppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);

const NS = "OnboardingSettings";
const PREF_CHANNEL = "trance.onboarding.channel";
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
  applyChannel,
  applyArch,
  applyModChannel,

  /** One observer set for all enabled windows; released by the last holder. */
  acquire() {
    if (!holders) {
      try {
        for (const [pref, apply] of [
          [PREF_CHANNEL, applyChannel],
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
 * The `zen.*` prefs upstream gates on the build-time `@IS_TWILIGHT@` constant,
 * and the value each takes on the twilight side of it.
 *
 * Read out of `prefs/zen/{view,theme,sync}.yaml` rather than guessed. The
 * stable side is not listed because it is "whatever the pref file already set",
 * which is what a Trance build boots with — so choosing "stable" clears the
 * user branch instead of writing the same value back, and a later upstream
 * change to a default is inherited rather than frozen.
 *
 * `zen.theme.styled-status-panel` is deliberately absent. Its yaml has a second
 * entry, `value: true` under `defined(XP_MACOSX)`, so on macOS it is already
 * true on both channels and writing it here would be a no-op that looks like a
 * decision. On other platforms it follows the constant, which is what
 * `TWILIGHT_ONLY_PREFS` below covers.
 */
const TWILIGHT_PREFS = Object.freeze([
  { name: "zen.view.context-menu.refresh", twilight: true },
  // `prefs/zen/sync.yaml` writes this one twice: `true` on the twilight side,
  // and `false` *locked* on the other. A locked pref cannot be set from the
  // user branch at all — `setBoolPref` throws — so this is the one entry where
  // "write the twilight value" means unlock first, and where going back to
  // stable means clearing *and* putting the lock back. Without the flag the
  // page would silently fail on a third of what its copy promises.
  { name: "services.sync.engine.spaces", twilight: true, locked: true },
]);

/** Same list, minus the ones another yaml entry already decides on this OS. */
const TWILIGHT_ONLY_PREFS = Object.freeze([
  { name: "zen.theme.styled-status-panel", twilight: true },
]);

/**
 * The surface prefs an Intel GPU wants different values for, and those values.
 *
 * These are the numbers the architecture page's own copy promises, and for a
 * while they were not: a performance pass flattened both columns to a
 * filter-free baseline, which left a page offering a choice between "full
 * frost" and "a 10px blur" that wrote the same four values either way
 * (ADR-072). A question whose two answers do the same thing is worse than no
 * question.
 *
 * Both columns are the shipped default from `prefs/trance/`, restated so
 * that switching back is a write rather than a clear — a user who edited the
 * radius by hand and then re-ran the flow should get the tuning they picked,
 * not their own old value silently kept.
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
 * Writes the twilight-gated prefs, or clears them.
 *
 * Clearing rather than writing the stable value is deliberate: the stable
 * value *is* the default the pref file set, so clearing the user branch means
 * a later change to that default is inherited. Writing it would freeze
 * today's answer into the profile forever.
 *
 * @param {string} channel
 */
function applyChannel(channel) {
  const twilight = channel === "twilight";
  writeChoice(PREF_CHANNEL, channel);

  const entries = [
    ...TWILIGHT_PREFS,
    ...(lazyAppConstants.platform === "macosx" ? [] : TWILIGHT_ONLY_PREFS),
  ];
  for (const entry of entries) {
    try {
      if (Services.prefs.prefIsLocked(entry.name)) {
        Services.prefs.unlockPref(entry.name);
      }
      if (twilight) {
        Services.prefs.setBoolPref(entry.name, entry.twilight);
      } else {
        Services.prefs.clearUserPref(entry.name);
        if (entry.locked) {
          // Put upstream's lock back rather than leaving a pref that Zen
          // means to be immovable on this channel merely *set* to the right
          // value. The difference shows up in about:config and in anything
          // that asks whether the user may change it.
          Services.prefs.lockPref(entry.name);
        }
      }
    } catch (error) {
      TranceLog.error(NS, `could not set ${entry.name}`, error);
    }
  }
  TranceLog.log(NS, "channel", channel);
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
 * Writes the arch-tuned blur prefs.
 *
 * Both columns are written, always. Clearing the user branch would be the
 * `applyChannel` treatment, and it is wrong here: a user who moved the blur
 * radius by hand and then answered this question has asked for the tuning,
 * and inheriting their own old value instead would look like the question did
 * nothing.
 *
 * @param {string} arch
 */
function applyArch(arch) {
  writeChoice(PREF_ARCH, arch);
  for (const entry of ARCH_TUNING[arch] ?? []) {
    try {
      if (entry.type === "int") {
        Services.prefs.setIntPref(entry.name, entry.value);
      } else {
        Services.prefs.setBoolPref(entry.name, entry.value);
      }
    } catch (error) {
      TranceLog.error(NS, `could not set ${entry.name}`, error);
    }
  }
  TranceLog.log(NS, "arch", arch);
}
