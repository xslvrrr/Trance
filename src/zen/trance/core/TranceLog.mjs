// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: namespaced, pref-gated logging.
//
// Everything Trance prints goes through here so that a production profile is
// silent and `trance.debug` turns the whole subsystem on at once. The counters
// exist to verify the TRANCE.md §12.1 budgets (observer callbacks per tab open,
// timers at idle) without shipping instrumentation that costs anything when the
// pref is off.
//
// Refs: TRANCE.md §6.1, §12.1

// `XPCOMUtils` is a browser-window global; importing it here would shadow it.
const lazy = {};

if (typeof XPCOMUtils === "undefined") {
  // about:preferences is not a browser window and has no XPCOMUtils global,
  // but it does load Trance modules (the mod guard pulls in the scheduler and
  // the observer hub, both of which log). One pref read per call is fine on a
  // settings page; the browser window still gets the cached getter.
  Object.defineProperty(lazy, "DEBUG", {
    get: () => Services.prefs.getBoolPref("trance.debug", false),
  });
} else {
  XPCOMUtils.defineLazyPreferenceGetter(lazy, "DEBUG", "trance.debug", false);
}

const PREFIX = "Trance";

/** @type {Map<string, number>} */
const counters = new Map();

export const TranceLog = {
  get enabled() {
    return lazy.DEBUG;
  },

  /**
   * @param {string} namespace - Subsystem name, e.g. "Scheduler".
   * @param {...any} args - Passed straight through to the console.
   */
  log(namespace, ...args) {
    if (!lazy.DEBUG) {
      return;
    }
    // A debug logger is the one place a console.log is the point, and it is
    // unreachable unless `trance.debug` is on.
    // eslint-disable-next-line no-console
    console.log(`[${PREFIX}/${namespace}]`, ...args);
  },

  /**
   * @param {string} namespace
   * @param {...any} args
   */
  warn(namespace, ...args) {
    if (!lazy.DEBUG) {
      return;
    }
    console.warn(`[${PREFIX}/${namespace}]`, ...args);
  },

  /**
   * Errors are always reported. A Trance failure that is invisible without a
   * pref flip is a Trance failure nobody fixes.
   */
  /**
   * @param {string} namespace
   * @param {...any} args
   */
  error(namespace, ...args) {
    console.error(`[${PREFIX}/${namespace}]`, ...args);
  },

  /**
   * Increments a named counter. Free when `trance.debug` is off.
   *
   * @param {string} counterName
   * @param {number} [by]
   */
  count(counterName, by = 1) {
    if (!lazy.DEBUG) {
      return;
    }
    counters.set(counterName, (counters.get(counterName) ?? 0) + by);
  },

  /**
   * @returns {object} A snapshot of every counter, for the budget checks.
   */
  snapshot() {
    return Object.fromEntries(counters);
  },

  resetCounters() {
    counters.clear();
  },
};
