// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: ref-counted dynamic stylesheet loading.
//
// Trance stylesheets are *not* `@import`ed from `zen-theme.css`. A static
// import would mean every Trance rule is parsed, matched and kept in the style
// set even with `trance.enabled=false`, which contradicts the hard requirement
// that a disabled feature costs zero (TRANCE.md §6.5, §13 Phase 2 acceptance).
// Loading through `nsIDOMWindowUtils` instead makes enable/disable symmetric
// and instant, and removes an upstream touchpoint (see ADR-010).
//
// Sheets load as AUTHOR sheets so they land after the document's own linked
// stylesheets in the cascade. That is what lets Trance win against Zen's rules
// on equal specificity without `!important` (TRANCE.md §3.1, §6.2 rule 1).
//
// Refs: TRANCE.md §3.1, §6.2, §6.5

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Styles";

export class TranceStyles {
  #window;
  /** @type {Map<string, number>} url -> refcount */
  #loaded = new Map();

  /**
   * @param {Window} win
   */
  constructor(win) {
    this.#window = win;
  }

  /**
   * @param {string} url - A `chrome://` stylesheet URL.
   */
  load(url) {
    const count = this.#loaded.get(url) ?? 0;
    if (count === 0) {
      const utils = this.#window.windowUtils;
      try {
        utils.loadSheetUsingURIString(url, utils.AUTHOR_SHEET);
      } catch (error) {
        TranceLog.error(NS, `failed to load ${url}`, error);
        return;
      }
      TranceLog.log(NS, "loaded", url);
    }
    this.#loaded.set(url, count + 1);
  }

  /**
   * @param {string} url
   */
  unload(url) {
    const count = this.#loaded.get(url) ?? 0;
    if (count <= 1) {
      this.#loaded.delete(url);
      if (count === 1) {
        const utils = this.#window.windowUtils;
        try {
          utils.removeSheetUsingURIString(url, utils.AUTHOR_SHEET);
        } catch (error) {
          TranceLog.error(NS, `failed to unload ${url}`, error);
        }
        TranceLog.log(NS, "unloaded", url);
      }
      return;
    }
    this.#loaded.set(url, count - 1);
  }

  /**
   * @param {string[]} urls
   */
  loadAll(urls) {
    for (const url of urls) {
      this.load(url);
    }
  }

  /**
   * @param {string[]} urls
   */
  unloadAll(urls) {
    for (const url of urls) {
      this.unload(url);
    }
  }

  /** Every stylesheet Trance currently has loaded in this window. */
  get loadedSheets() {
    return [...this.#loaded.keys()];
  }

  destroy() {
    for (const url of [...this.#loaded.keys()]) {
      this.#loaded.set(url, 1);
      this.unload(url);
    }
  }
}
