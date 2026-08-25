// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: motion level, reduced-motion handling, and the animation registry.
//
// Two rules live here, both from TRANCE.md §3:
//
//   - No `infinite` CSS animation exists in Trance (§3.4). Gecko does not
//     throttle chrome animations the way it throttles content ones, so one
//     forgotten `animation: … infinite` holds the refresh driver at display
//     rate forever, even offscreen, even in an unfocused window. Anything that
//     loops is driven from TranceScheduler, which stops.
//
//   - `will-change` is never written in CSS (§3.5). Several mods applied it
//     statically as a cargo-culted perf fix; each one promoted a permanent
//     compositor layer. Here it is added when an animation starts and removed
//     when it ends.
//
// Refs: TRANCE.md §3.4, §3.5, §6.1, §12.3

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Motion";

const PREF_LEVEL = "trance.motion.level";
const ATTRIBUTE = "trance-motion";

export const TranceMotionLevel = Object.freeze({
  NONE: 0,
  REDUCED: 1,
  FULL: 2,
});

export class TranceMotion {
  #window;
  #reducedMotionQuery;
  #prefObserver;
  #boundOnChange;
  /** @type {Set<Animation>} */
  #running = new Set();

  /**
   * @param {Window} win
   */
  constructor(win) {
    this.#window = win;
    this.#reducedMotionQuery = win.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );
    this.#boundOnChange = () => this.#apply();
    this.#prefObserver = { observe: this.#boundOnChange };

    Services.prefs.addObserver(PREF_LEVEL, this.#prefObserver);
    this.#reducedMotionQuery.addEventListener("change", this.#boundOnChange);
    this.#apply();
  }

  /**
   * The level after clamping to what the platform asks for. Trance never raises
   * motion above `prefers-reduced-motion`; the pref can only lower it.
   *
   * @returns {number} One of `TranceMotionLevel`.
   */
  get level() {
    const requested = Services.prefs.getIntPref(
      PREF_LEVEL,
      TranceMotionLevel.FULL
    );
    const clamped = Math.min(
      Math.max(requested, TranceMotionLevel.NONE),
      TranceMotionLevel.FULL
    );
    if (this.#reducedMotionQuery.matches) {
      return Math.min(clamped, TranceMotionLevel.REDUCED);
    }
    return clamped;
  }

  get isEnabled() {
    return this.level > TranceMotionLevel.NONE;
  }

  /**
   * Runs a Web Animation with `will-change` scoped to its lifetime.
   *
   * Returns null when motion is off, so callers can branch on it and jump
   * straight to the end state instead of animating to it.
   *
   * @param {Element} element
   * @param {Keyframe[]} keyframes
   * @param {object} [options] - `Element.animate()` options, plus `willChange`.
   * @param {string} [options.willChange] - e.g. "transform, opacity".
   * @returns {Animation | null}
   */
  animate(element, keyframes, options = {}) {
    if (!this.isEnabled) {
      return null;
    }
    const { willChange, ...animationOptions } = options;
    if (willChange) {
      element.style.willChange = willChange;
    }

    const animation = element.animate(keyframes, animationOptions);
    this.#running.add(animation);

    const cleanup = () => {
      this.#running.delete(animation);
      if (willChange) {
        element.style.removeProperty("will-change");
      }
    };
    animation.finished.then(cleanup, cleanup);
    return animation;
  }

  /** Live animation count. Used by the §12.1 idle checks. */
  get runningCount() {
    return this.#running.size;
  }

  destroy() {
    Services.prefs.removeObserver(PREF_LEVEL, this.#prefObserver);
    this.#reducedMotionQuery.removeEventListener("change", this.#boundOnChange);
    for (const animation of this.#running) {
      animation.cancel();
    }
    this.#running.clear();
    this.#window.document.documentElement.removeAttribute(ATTRIBUTE);
  }

  /**
   * The level is published as an attribute rather than a custom property so
   * stylesheets can gate whole rule blocks on it — a rule that never matches
   * costs nothing, a custom property that resolves to `0s` still matches.
   */
  #apply() {
    const level = this.level;
    this.#window.document.documentElement.setAttribute(
      ATTRIBUTE,
      String(level)
    );
    TranceLog.log(NS, "level", level);
  }
}
