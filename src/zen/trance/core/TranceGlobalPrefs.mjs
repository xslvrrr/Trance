// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the one owner of every preference Trance does not own.
//
// ── Why this module exists ────────────────────────────────────────────────────
//
// Several Trance features have to hold a pref that belongs to Zen, to Firefox
// or to the platform: Zen's loading indicator has to be off while Trance draws
// its own bar, Zen's acrylic has to be off while Trance owns the blur budget,
// the platform's own translucency switch has to follow the surface switch. Each
// of those is a *claim*: read what it said, write what this browser needs, and
// give the old value back the moment nothing needs it any more (ADR-011).
//
// Every one of them was refcounted, and none of them was refcounted correctly.
// `ZenPreloadedScripts` imports Trance with `{ global: "current" }`, so a Trance
// module is instantiated once *per chrome window*: a module-scope `let` and a
// `static` class field are per-window state wearing process-wide clothes. Two
// windows therefore each believed they were the first and only claimant, each
// recorded the *claimed* value as "what it said before", and the first window to
// close handed that back — leaving the second window's feature running against
// a pref that says the opposite of what it needs, permanently
// (AUDIT.md "Confirmed bugs and overlap").
//
// This module is loaded with `ChromeUtils.importESModule(url)` and **no**
// `global` option, which is the whole point: the default is the shared system
// global, so there is exactly one registry for the process no matter how many
// windows exist. Callers must reach it the same way — a static `import` from a
// module that was itself loaded with `{ global: "current" }` would clone it back
// into that window's global and reintroduce the bug this file removes.
//
// ── What "ownership" means here ───────────────────────────────────────────────
//
// Stronger than "set it once". While a pref is claimed the registry watches it
// and puts its value back if something else changes it, because a one-time write
// is not ownership — Zen's compact mode re-enabling acrylic behind Trance's back
// is exactly that bug. Release is what gives the pref up, and release restores
// the value the *first* claimant saw, not the value the last writer left.
//
// Refs: TRANCE.md §3.1, §6.2, §6.6; AUDIT.md Phase 3; ADR-011, ADR-059

const NS = "GlobalPrefs";

/** Which branch a claim writes to. */
const BRANCHES = Object.freeze(["user", "default"]);

/** What a claim's value is. Derived from the value unless stated. */
const TYPES = Object.freeze(["bool", "int", "string"]);

/**
 * @param {any} value
 * @returns {"bool"|"int"|"string"}
 */
const typeOf = value => {
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "number") {
    return "int";
  }
  return "string";
};

/**
 * The branch object a claim reads and writes through.
 *
 * The default branch is not a fallback for the user branch — it is a different
 * question. Writing a default means "this is what the browser ships with", so a
 * user who has deliberately set the pref still wins and nothing lands in
 * prefs.js; writing the user branch means "this is what it is now". Zen's
 * loading indicator is the first kind, the platform's translucency switch is the
 * second.
 *
 * @param {"user"|"default"} branch
 * @returns {nsIPrefBranch}
 */
const branchFor = branch =>
  branch === "default" ? Services.prefs.getDefaultBranch("") : Services.prefs;

/**
 * @param {"user"|"default"} branch
 * @param {string} pref
 * @param {"bool"|"int"|"string"} type
 * @param {any} fallback
 * @returns {any}
 */
const readPref = (branch, pref, type, fallback) => {
  const target = branchFor(branch);
  try {
    switch (type) {
      case "bool":
        return target.getBoolPref(pref, fallback ?? false);
      case "int":
        return target.getIntPref(pref, fallback ?? 0);
      default:
        return target.getStringPref(pref, fallback ?? "");
    }
  } catch {
    // A default-branch read of a pref with no default throws rather than
    // returning the fallback on some branches. Treat it as "no previous value".
    return fallback ?? null;
  }
};

/**
 * @param {"user"|"default"} branch
 * @param {string} pref
 * @param {"bool"|"int"|"string"} type
 * @param {any} value
 */
const writePref = (branch, pref, type, value) => {
  const target = branchFor(branch);
  switch (type) {
    case "bool":
      target.setBoolPref(pref, Boolean(value));
      return;
    case "int":
      target.setIntPref(pref, Math.trunc(Number(value)));
      return;
    default:
      target.setStringPref(pref, String(value));
  }
};

/**
 * One claimed pref: who wants it, what they want, and what it said first.
 *
 * @typedef {object} Registration
 * @property {"user"|"default"} branch Which branch the claim was written to.
 * @property {"bool"|"int"|"string"} type The preference's value type.
 * @property {any} previous The value the first claimant found.
 * @property {boolean} hadUserValue Whether that value was an explicit user
 *   value rather than the shipped default. Restoring the *value* of a pref that
 *   only had a default turns it into a permanent user override that survives
 *   every future upstream default change, which is a slower version of the bug
 *   the restore exists to prevent.
 * @property {any} wanted The value currently enforced.
 * @property {Map<symbol, any>} holders Owner token -> the value that owner asked for.
 * @property {object|null} observer The nsIObserver enforcing `wanted`, if any.
 * @property {boolean} writing Re-entrancy guard while this module writes.
 */

/** @type {Map<string, Registration>} */
const registry = new Map();

/**
 * Diagnostics for the §12.1 checks and for tests. Deliberately a plain object
 * rather than a class: nothing here has behaviour, and a snapshot that can be
 * mutated by its reader would be a second owner for the registry.
 *
 * @returns {Array<{pref: string, branch: string, holders: number, wanted: any, previous: any}>}
 */
const snapshot = () =>
  [...registry.entries()].map(([pref, entry]) => ({
    pref,
    branch: entry.branch,
    holders: entry.holders.size,
    wanted: entry.wanted,
    previous: entry.previous,
  }));

/**
 * Re-asserts `wanted` when something else writes the pref.
 *
 * Armed only while a pref is claimed, so an unclaimed pref costs no observer.
 * The guard is what keeps this from recursing on its own writes: the observer
 * fires synchronously from `setBoolPref`, so without it a claim would re-enter
 * itself once per write.
 *
 * @param {string} pref
 * @param {Registration} entry
 */
const enforce = (pref, entry) => {
  if (entry.writing) {
    return;
  }
  const current = readPref(entry.branch, pref, entry.type, entry.previous);
  if (current === entry.wanted) {
    return;
  }
  entry.writing = true;
  try {
    writePref(entry.branch, pref, entry.type, entry.wanted);
  } finally {
    entry.writing = false;
  }
};

/**
 * A handle on the claims one owner has made.
 *
 * An owner is a feature in a window, not a window: two features in the same
 * window that both want the same pref are two holders, and the pref is given
 * back when the second of them lets go — which is the same rule that applies
 * across windows, so there is only one rule.
 */
export class TranceGlobalPrefOwner {
  /** Distinct per instance, so two owners can never be confused for one. */
  #token = Symbol("TranceGlobalPrefOwner");
  #label;
  /** @type {Set<string>} Prefs this owner currently holds. */
  #held = new Set();
  #released = false;

  /**
   * @param {string} label - Feature and window, for logs. Not an identity.
   */
  constructor(label = "anonymous") {
    this.#label = label;
  }

  get label() {
    return this.#label;
  }

  /** The prefs this owner currently holds. */
  get held() {
    return [...this.#held];
  }

  /**
   * Takes — or updates — this owner's claim on `pref`.
   *
   * Idempotent: claiming a pref this owner already holds changes the value it
   * asks for rather than adding a second hold, so a feature may call this from
   * its "apply the prefs" method on every pref change without counting.
   *
   * @param {string} pref
   * @param {any} value - What this owner needs the pref to say.
   * @param {object} [options]
   * @param {"user"|"default"} [options.branch] - Defaults to the user branch.
   * @param {"bool"|"int"|"string"} [options.type] - Inferred from `value`.
   */
  claim(pref, value, { branch = "user", type = typeOf(value) } = {}) {
    if (this.#released) {
      return;
    }
    if (!BRANCHES.includes(branch) || !TYPES.includes(type)) {
      throw new Error(`${NS}: bad claim on ${pref} (${branch}/${type})`);
    }

    let entry = registry.get(pref);
    if (!entry) {
      entry = {
        branch,
        type,
        previous: readPref(branch, pref, type, null),
        hadUserValue:
          branch === "user" && Services.prefs.prefHasUserValue(pref),
        wanted: value,
        holders: new Map(),
        observer: null,
        writing: false,
      };
      registry.set(pref, entry);
      entry.observer = { observe: () => enforce(pref, entry) };
      Services.prefs.addObserver(pref, entry.observer);
    } else if (entry.branch !== branch || entry.type !== type) {
      // Two owners disagreeing about *what kind of thing* a pref is cannot be
      // reconciled by taking one of them; it is a programming error, and a
      // silent one would corrupt the restore value.
      throw new Error(
        `${NS}: ${pref} is claimed as ${entry.branch}/${entry.type}, ` +
          `not ${branch}/${type}`
      );
    }

    entry.holders.set(this.#token, value);
    this.#held.add(pref);

    // The most recent claim decides. Disagreement is possible — the loading
    // indicator is claimed by every window that draws a bar — but every
    // claimant asks for the same value in practice, so a differing one is worth
    // saying out loud rather than resolving quietly.
    if (entry.wanted !== value) {
      for (const held of entry.holders.values()) {
        if (held !== value) {
          console.warn(
            `Trance ${NS}: ${pref} claimed as both ${held} and ${value}; ` +
              `${this.#label} wins`
          );
          break;
        }
      }
      entry.wanted = value;
    }

    entry.writing = true;
    try {
      if (readPref(branch, pref, type, entry.previous) !== value) {
        writePref(branch, pref, type, value);
      }
    } finally {
      entry.writing = false;
    }
  }

  /**
   * Gives this owner's hold on `pref` up. The pref goes back to what the first
   * claimant found only when the last holder lets go.
   *
   * @param {string} pref
   */
  release(pref) {
    if (!this.#held.delete(pref)) {
      return;
    }
    const entry = registry.get(pref);
    if (!entry) {
      return;
    }
    entry.holders.delete(this.#token);
    if (entry.holders.size) {
      // Someone else still wants it. Their value wins now, which matters when
      // the departing owner was the one that changed it last.
      const [remaining] = [...entry.holders.values()].slice(-1);
      entry.wanted = remaining;
      enforce(pref, entry);
      return;
    }

    Services.prefs.removeObserver(pref, entry.observer);
    registry.delete(pref);

    entry.writing = true;
    try {
      if (entry.branch === "user" && !entry.hadUserValue) {
        // It only ever had a default. Writing the value back would freeze
        // today's default into prefs.js forever; clearing it is what actually
        // restores the state the first claimant found.
        Services.prefs.clearUserPref(pref);
      } else if (entry.previous !== null) {
        writePref(entry.branch, pref, entry.type, entry.previous);
      }
    } catch (error) {
      console.error(`Trance ${NS}: could not restore ${pref}`, error);
    } finally {
      entry.writing = false;
    }
  }

  /** Gives up every pref this owner holds. Safe to call more than once. */
  releaseAll() {
    for (const pref of [...this.#held]) {
      this.release(pref);
    }
  }

  /**
   * Releases everything and refuses further claims.
   *
   * Called when the feature that made the claims is destroyed rather than
   * merely disabled, so that a stale owner cannot resurrect a claim after its
   * window has gone.
   */
  destroy() {
    this.releaseAll();
    this.#released = true;
  }
}

/**
 * The registry itself, for tests and for the §12.1 checks.
 *
 * `claimedPrefs` answers "is anything still held?", which is the question a
 * teardown assertion actually asks; `snapshot` answers "held by how many, and
 * what will it go back to?", which is the one a bug report asks.
 */
export const TranceGlobalPrefs = Object.freeze({
  snapshot,
  get claimedPrefs() {
    return [...registry.keys()];
  },
  /**
   * @param {string} pref
   * @returns {boolean}
   */
  isClaimed(pref) {
    return registry.has(pref);
  },
});
