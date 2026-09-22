// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the one owner of the stylesheets that are not per window.
//
// `TranceStyles` refcounts sheets loaded through `nsIDOMWindowUtils`, which is
// per window and therefore per instance — correct, because that is what the
// service it wraps is. `nsIStyleSheetService` is not: a USER sheet registered
// through it applies to every document in the *application*, including content
// documents, which is the only way to reach `about:` pages at all
// (trance-internal.css).
//
// The surface layer refcounted those with a `static` field, and a `static` field
// in a module imported with `{ global: "current" }` is per-window state
// (see TranceGlobalPrefs.mjs). So the first window to stop wanting the `about:`
// sheets unregistered them for every window, and two windows could hold two
// different generated alpha sheets at once with only one of them ever released
// (AUDIT.md Phase 3, "Internal-page opacity changes unregister/register an
// application-wide stylesheet").
//
// This module is loaded without a `global` option, so its registry is the
// process's. Reach it the same way — a static `import` from a window-global
// module would clone it and reintroduce the bug.
//
// Refs: TRANCE.md §6.5; AUDIT.md Phase 3; ADR-046, ADR-059

const NS = "GlobalSheets";

/**
 * `nsIStyleSheetService`.
 *
 * Not on `Services`: the lazy getters in Services.sys.mjs cover the services
 * chrome code reaches for constantly, and this is not one of them. Fetched on
 * first use so that a browser which never registers a sheet never instantiates
 * it.
 */
const styleSheetService = () =>
  Cc["@mozilla.org/content/style-sheet-service;1"].getService(
    Ci.nsIStyleSheetService
  );

/** url -> how many owners want it registered. */
const sheets = new Map();

/**
 * A slot is a sheet whose *contents* vary — the generated one-liner carrying the
 * internal-page alpha. Every window derives the same URL from the same global
 * pref, so the slot holds one URL for the process and swapping it is one
 * unregister plus one register, not one per window.
 *
 * @type {Map<string, {url: string|null, holders: Set<symbol>}>}
 */
const slots = new Map();

/**
 * @param {string} url
 */
const register = url => {
  try {
    const uri = Services.io.newURI(url);
    const service = styleSheetService();
    if (!service.sheetRegistered(uri, service.USER_SHEET)) {
      service.loadAndRegisterSheet(uri, service.USER_SHEET);
    }
  } catch (error) {
    console.error(
      `Trance ${NS}: could not register ${url.slice(0, 64)}`,
      error
    );
  }
};

/**
 * @param {string} url
 */
const unregister = url => {
  try {
    const uri = Services.io.newURI(url);
    const service = styleSheetService();
    if (service.sheetRegistered(uri, service.USER_SHEET)) {
      service.unregisterSheet(uri, service.USER_SHEET);
    }
  } catch (error) {
    console.error(
      `Trance ${NS}: could not unregister ${url.slice(0, 64)}`,
      error
    );
  }
};

/** A window's, or a feature's, hold on the application-wide sheets. */
export class TranceGlobalSheetOwner {
  #token = Symbol("TranceGlobalSheetOwner");
  /** @type {Set<string>} */
  #held = new Set();
  /** @type {Set<string>} */
  #slots = new Set();

  /**
   * Registers `url` as a USER sheet if nobody has yet, and records this owner's
   * interest in it.
   *
   * @param {string} url
   */
  hold(url) {
    if (this.#held.has(url)) {
      return;
    }
    this.#held.add(url);
    const count = sheets.get(url) ?? 0;
    sheets.set(url, count + 1);
    if (count === 0) {
      register(url);
    }
  }

  /**
   * @param {string} url
   */
  release(url) {
    if (!this.#held.delete(url)) {
      return;
    }
    const count = sheets.get(url) ?? 0;
    if (count <= 1) {
      sheets.delete(url);
      unregister(url);
      return;
    }
    sheets.set(url, count - 1);
  }

  /**
   * Points a named slot at `url`, registering it and unregistering whatever the
   * slot held before.
   *
   * The slot, not the URL, is what an owner holds: the URL is generated from a
   * global pref and every owner computes the same one, so a swap must not have
   * to be performed once per owner.
   *
   * @param {string} slot - A stable name, e.g. "internal-alpha".
   * @param {string} url
   */
  setSlot(slot, url) {
    let entry = slots.get(slot);
    if (!entry) {
      entry = { url: null, holders: new Set() };
      slots.set(slot, entry);
    }
    entry.holders.add(this.#token);
    this.#slots.add(slot);
    if (entry.url === url) {
      return;
    }
    const previous = entry.url;
    entry.url = url;
    register(url);
    if (previous) {
      unregister(previous);
    }
  }

  /**
   * @param {string} slot
   */
  releaseSlot(slot) {
    if (!this.#slots.delete(slot)) {
      return;
    }
    const entry = slots.get(slot);
    if (!entry) {
      return;
    }
    entry.holders.delete(this.#token);
    if (entry.holders.size) {
      return;
    }
    if (entry.url) {
      unregister(entry.url);
    }
    slots.delete(slot);
  }

  /** Gives up every sheet and slot this owner holds. */
  releaseAll() {
    for (const url of [...this.#held]) {
      this.release(url);
    }
    for (const slot of [...this.#slots]) {
      this.releaseSlot(slot);
    }
  }
}

/** The registry, for tests and for the §12.1 checks. */
export const TranceGlobalSheets = Object.freeze({
  get registered() {
    return [...sheets.keys()];
  },
  /**
   * @param {string} slot
   * @returns {string|null}
   */
  slotURL(slot) {
    return slots.get(slot)?.url ?? null;
  },
});
