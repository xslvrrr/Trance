// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the icon set registry.
//
// Four of the mods Trance replaces shipped their own SVG set, mostly inlined
// into CSS as data URIs — the same glyph parsed four times, cached zero times,
// and impossible to restyle (TRANCE.md §3.8). Trance ships one set as real
// files under `chrome://browser/skin/trance/icons/`, so the network/chrome
// cache holds one copy and `fill: currentColor` works.
//
// The set itself lands in Phase 5 with the icon cluster. This module exists
// from Phase 2 so that nothing written before then invents a second convention.
//
// Refs: TRANCE.md §3.8, §6.1, §13 Phase 5

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Icons";

export const TRANCE_ICON_ROOT = "chrome://browser/skin/trance/icons/";

/** Every icon name any Trance feature has asked for, for duplicate detection. */
const requested = new Set();

export const TranceIcons = {
  /**
   * @param {string} iconName - Icon file name without the extension, kebab-case.
   * @returns {string} The chrome URL of the icon.
   */
  url(iconName) {
    requested.add(iconName);
    return `${TRANCE_ICON_ROOT}${iconName}.svg`;
  },

  /**
   * @param {string} iconName
   * @returns {string} A CSS `url()` value, for `list-style-image` and friends.
   */
  cssUrl(iconName) {
    return `url("${this.url(iconName)}")`;
  },

  /** Names requested so far. The Phase 5 acceptance check reads this. */
  get requested() {
    return [...requested];
  },

  /**
   * @param {Element} element - Anything that takes a `src`, e.g. `html:img`.
   * @param {string} iconName
   */
  apply(element, iconName) {
    element.setAttribute("src", this.url(iconName));
    TranceLog.log(NS, "applied", iconName);
  },
};
