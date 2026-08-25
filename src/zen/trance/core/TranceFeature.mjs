// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the base class every Trance feature extends.
//
// The contract it enforces is the one thing that makes 23 mods' worth of
// behaviour affordable: **disabled means zero**. Not hidden, not `display:none`
// — no stylesheet in the style set, no observer subscription, no listener, no
// DOM node, no scheduler subscriber. Everything a feature allocates goes
// through the context it is handed, and `#teardown()` returns all of it.
//
// Features do not extend `nsZenPreloadedFeature` directly. That class binds
// `init()` to `MozBeforeInitialXULLayout` in its constructor, which is exactly
// wrong for something that may first be constructed when a pref is flipped
// twenty minutes into a session. `TranceCore` is the `nsZenPreloadedFeature`
// (so Trance still enters through Zen's own startup lifecycle, TRANCE.md §3.7)
// and it drives feature construction from there.
//
// Refs: TRANCE.md §3.7, §6.5, §14.4

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

/**
 * @typedef {object} TranceContext
 * @property {Window} window The browser window the feature lives in.
 * @property {Document} document That window's chrome document.
 * @property {import("./TranceScheduler.mjs").TranceScheduler} scheduler The
 *   window's one animation and periodic-work scheduler.
 * @property {import("./TranceObserverHub.mjs").TranceObserverHub} observers The
 *   window's one Mutation/Resize/Intersection observer set.
 * @property {import("./TranceStyles.mjs").TranceStyles} styles Ref-counted
 *   stylesheet loading for this window.
 * @property {import("./TranceTokens.mjs").TranceTokens} tokens Pref-to-custom-
 *   property binding for this window.
 * @property {import("./TranceMotion.mjs").TranceMotion} motion Motion level and
 *   the animation registry for this window.
 */

export class TranceFeature {
  /**
   * The pref that gates this feature. Required. A feature with no pref cannot
   * be turned off, and TRANCE.md §6.6 says every `trance.*` pref appears in
   * `about:preferences#trance`.
   *
   * @type {string}
   */
  static prefName = "";

  /**
   * Chrome stylesheet URLs, loaded on enable and unloaded on disable.
   *
   * @type {string[]}
   */
  static styles = [];

  /**
   * Human-readable name for the settings page and logs.
   *
   * @type {string}
   */
  static featureName = "";

  /** @type {TranceContext} */
  context;

  #enabled = false;
  #prefObserver;
  #destroyed = false;

  /** Handles this feature owns, returned wholesale on disable. */
  #observerHandles = new Set();
  #schedulerHandles = new Set();
  #tokenHandles = new Set();
  /** @type {Array<() => void>} */
  #disposers = [];

  /**
   * @param {TranceContext} context
   */
  constructor(context) {
    this.context = context;
    this.#prefObserver = { observe: () => this.#sync() };
    Services.prefs.addObserver(this.constructor.prefName, this.#prefObserver);
  }

  /**
   * Reads the pref and enables the feature if it is on.
   *
   * Deliberately not called from the constructor: a subclass's own private
   * methods are not installed on the instance until `super()` returns, so
   * calling `onEnable()` from the base constructor throws
   * "object is not the right class" the moment the subclass uses one. TranceCore
   * constructs, then calls this.
   */
  init() {
    this.#sync();
  }

  get enabled() {
    return this.#enabled;
  }

  get name() {
    return this.constructor.featureName || this.constructor.name;
  }

  // --- Overridden by subclasses ---------------------------------------------

  /** Called when the feature becomes enabled. Allocate here, not in the ctor. */
  onEnable() {}

  /** Called when the feature becomes disabled. Undo anything `onEnable` did. */
  onDisable() {}

  // --- Resource helpers ------------------------------------------------------
  //
  // Everything a feature allocates should go through one of these, so that
  // `onDisable` rarely needs to do anything and the zero-cost guarantee does
  // not depend on the subclass author remembering.

  /**
   * @param {string} selector
   * @param {(records: MutationRecord[]) => void} cb
   * @param {object} [options] - See `TranceObserverHub.observeMutations`.
   */
  observeMutations(selector, cb, options) {
    const handle = this.context.observers.observeMutations(
      selector,
      cb,
      options
    );
    this.#observerHandles.add(handle);
    return handle;
  }

  /**
   * @param {Element} element
   * @param {(entry: ResizeObserverEntry) => void} cb
   */
  observeResize(element, cb) {
    const handle = this.context.observers.observeResize(element, cb);
    this.#observerHandles.add(handle);
    return handle;
  }

  /**
   * @param {Element} element
   * @param {(entry: IntersectionObserverEntry) => void} cb
   * @param {object} [options]
   */
  observeIntersection(element, cb, options) {
    const handle = this.context.observers.observeIntersection(
      element,
      cb,
      options
    );
    this.#observerHandles.add(handle);
    return handle;
  }

  /**
   * @param {(timestamp: number) => void} cb
   * @param {object} [options] - See `TranceScheduler.onFrame`.
   */
  onFrame(cb, options) {
    const handle = this.context.scheduler.onFrame(cb, options);
    this.#schedulerHandles.add(handle);
    return handle;
  }

  /**
   * @param {(deadline: IdleDeadline) => void} cb
   * @param {object} [options]
   */
  onIdle(cb, options) {
    const handle = this.context.scheduler.onIdle(cb, options);
    this.#schedulerHandles.add(handle);
    return handle;
  }

  /**
   * @param {() => void} cb
   * @param {"second"|"minute"|"hour"} unit
   */
  onWallClock(cb, unit) {
    const handle = this.context.scheduler.onWallClock(cb, unit);
    this.#schedulerHandles.add(handle);
    return handle;
  }

  /**
   * @param {object[]} descriptors - See `TranceTokens.bind`.
   */
  bindTokens(descriptors) {
    const handles = this.context.tokens.bindAll(descriptors);
    for (const handle of handles) {
      this.#tokenHandles.add(handle);
    }
    return handles;
  }

  /**
   * Adds an event listener that is removed automatically on disable.
   *
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListener} listener
   * @param {object|boolean} [options]
   */
  addListener(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.#disposers.push(() =>
      target.removeEventListener(type, listener, options)
    );
  }

  /**
   * Registers arbitrary cleanup to run on disable.
   *
   * @param {() => void} disposer
   */
  addDisposer(disposer) {
    this.#disposers.push(disposer);
  }

  // --- Lifecycle -------------------------------------------------------------

  destroy() {
    this.#destroyed = true;
    Services.prefs.removeObserver(
      this.constructor.prefName,
      this.#prefObserver
    );
    if (this.#enabled) {
      this.#teardown();
    }
  }

  #sync() {
    if (this.#destroyed) {
      return;
    }
    const shouldBeEnabled = Services.prefs.getBoolPref(
      this.constructor.prefName,
      false
    );
    if (shouldBeEnabled === this.#enabled) {
      return;
    }
    if (shouldBeEnabled) {
      this.#setUp();
    } else {
      this.#teardown();
    }
  }

  #setUp() {
    this.#enabled = true;
    this.context.styles.loadAll(this.constructor.styles);
    try {
      this.onEnable();
    } catch (error) {
      TranceLog.error(this.name, "onEnable threw", error);
    }
    TranceLog.log(this.name, "enabled");
  }

  #teardown() {
    this.#enabled = false;
    try {
      this.onDisable();
    } catch (error) {
      TranceLog.error(this.name, "onDisable threw", error);
    }

    for (const disposer of this.#disposers.splice(0)) {
      try {
        disposer();
      } catch (error) {
        TranceLog.error(this.name, "disposer threw", error);
      }
    }
    for (const handle of this.#observerHandles) {
      this.context.observers.unobserve(handle);
    }
    this.#observerHandles.clear();
    for (const handle of this.#schedulerHandles) {
      this.context.scheduler.cancel(handle);
    }
    this.#schedulerHandles.clear();
    this.context.tokens.releaseAll([...this.#tokenHandles]);
    this.#tokenHandles.clear();
    this.context.styles.unloadAll(this.constructor.styles);

    TranceLog.log(this.name, "disabled");
  }
}
