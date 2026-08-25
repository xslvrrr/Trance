// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the JS half of the design-token layer.
//
// `trance-tokens.css` is the only stylesheet allowed to write to `:root`. Where
// a token has to follow a pref, this module is the only thing allowed to write
// it at runtime — so there is still exactly one owner per custom property, and
// a pref change costs one `setProperty` rather than a stylesheet rebuild
// (which is how Zen's mods system invalidates the whole chrome, TRANCE.md §3.1).
//
// Refs: TRANCE.md §3.1, §6.1, §6.2

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Tokens";

/** @typedef {"bool"|"int"|"string"} TrancePrefType */

export class TranceTokens {
  #window;
  #nextHandle = 1;

  /**
   * @type {Map<number, {
   *   pref: string,
   *   cssVar: string,
   *   type: TrancePrefType,
   *   fallback: any,
   *   format: (value: any) => string,
   *   observer: object,
   * }>}
   */
  #bindings = new Map();

  /**
   * @param {Window} win
   */
  constructor(win) {
    this.#window = win;
  }

  get #root() {
    return this.#window.document.documentElement;
  }

  /**
   * Writes a custom property on `:root`.
   *
   * @param {string} cssVar - Including the leading `--`.
   * @param {string} value
   */
  set(cssVar, value) {
    this.#root.style.setProperty(cssVar, value);
  }

  /**
   * @param {string} cssVar
   */
  clear(cssVar) {
    this.#root.style.removeProperty(cssVar);
  }

  /**
   * @param {string} cssVar
   * @returns {string} The computed value, trimmed.
   */
  get(cssVar) {
    return this.#window
      .getComputedStyle(this.#root)
      .getPropertyValue(cssVar)
      .trim();
  }

  /**
   * Keeps `cssVar` in sync with `pref` for as long as the binding is held.
   *
   * @param {object} descriptor
   * @param {string} descriptor.pref
   * @param {string} descriptor.cssVar
   * @param {TrancePrefType} descriptor.type
   * @param {any} descriptor.fallback - Used when the pref is missing.
   * @param {(value: any) => string} [descriptor.format] - Value to CSS text,
   *   e.g. `v => `${v}px``. Defaults to `String`.
   * @returns {number} A handle for `release()`.
   */
  bind({ pref, cssVar, type, fallback, format = String }) {
    const handle = this.#nextHandle++;
    const apply = () => {
      try {
        this.set(cssVar, format(this.#read(pref, type, fallback)));
      } catch (error) {
        TranceLog.error(NS, `failed to apply ${pref} to ${cssVar}`, error);
      }
    };
    const observer = { observe: apply };

    Services.prefs.addObserver(pref, observer);
    this.#bindings.set(handle, {
      pref,
      cssVar,
      type,
      fallback,
      format,
      observer,
    });
    apply();
    return handle;
  }

  /**
   * @param {object[]} descriptors
   * @returns {number[]} Handles, in the order given.
   */
  bindAll(descriptors) {
    return descriptors.map(descriptor => this.bind(descriptor));
  }

  /**
   * Drops the binding and removes the custom property, so the value falls back
   * to whatever `trance-tokens.css` declares.
   *
   * @param {number} handle
   */
  release(handle) {
    const binding = this.#bindings.get(handle);
    if (!binding) {
      return;
    }
    Services.prefs.removeObserver(binding.pref, binding.observer);
    this.clear(binding.cssVar);
    this.#bindings.delete(handle);
  }

  /**
   * @param {number[]} handles
   */
  releaseAll(handles) {
    for (const handle of handles) {
      this.release(handle);
    }
  }

  destroy() {
    this.releaseAll([...this.#bindings.keys()]);
  }

  #read(pref, type, fallback) {
    switch (type) {
      case "bool":
        return Services.prefs.getBoolPref(pref, fallback);
      case "int":
        return Services.prefs.getIntPref(pref, fallback);
      case "string":
        return Services.prefs.getStringPref(pref, fallback);
      default:
        throw new Error(`TranceTokens: unknown pref type "${type}"`);
    }
  }
}
