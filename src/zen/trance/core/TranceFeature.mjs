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
// through the context it is handed, and teardown returns all of it.
//
// Features do not extend `nsZenPreloadedFeature` directly. That class binds
// `init()` to `MozBeforeInitialXULLayout` in its constructor, which is exactly
// wrong for something that may first be constructed when a pref is flipped
// twenty minutes into a session. `TranceCore` is the `nsZenPreloadedFeature`
// (so Trance still enters through Zen's own startup lifecycle, TRANCE.md §3.7)
// and it drives feature construction from there.
//
// Refs: TRANCE.md §3.7, §6.5, §14.4; ADR-070

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
 * @property {import("./TranceNavigation.mjs").TranceNavigation} navigation
 *   Shared navigation and progress state.
 * @property {import("./TranceTabCache.mjs").TranceTabCache} tabCache Shared
 *   live-folder cache.
 * @property {import("./TranceMaterial.mjs").TranceMaterial} material Shared
 *   window-material decision.
 */

export class TranceFeature {
  /** @type {string} */
  static prefName = "";

  /** @type {string[]} */
  static styles = [];

  /** @type {string} */
  static featureName = "";

  /** @type {TranceContext} */
  context;

  #enabled = false;
  #prefObserver = null;
  #prefObserved = false;
  #destroyed = false;
  #settingUp = false;
  #setupAborted = false;
  #setupEntered = false;
  #setupRolledBack = false;
  #tearingDown = false;

  /** Handles this feature owns, returned wholesale on disable. */
  #observerHandles = new Set();
  #schedulerHandles = new Set();
  #tokenHandles = new Set();
  #navigationHandles = new Set();
  /** @type {string[]} */
  #styleHandles = [];
  /** @type {Array<() => void>} */
  #disposers = [];
  #globalPrefOwner = null;
  #globalSheetOwner = null;

  /** @param {TranceContext} context */
  constructor(context) {
    // Construction deliberately has no side effects. In particular, the
    // registry may construct a feature while its gate is being inspected, and
    // a subclass constructor may still throw before init() is called.
    this.context = context;
  }

  /**
   * Installs the feature-owned preference observer (when requested) and then
   * synchronises with the current value. Registry-managed features use
   * `observePref: false`: the registry owns one ordered observer per gate.
   *
   * @param {object} [options]
   * @param {boolean} [options.observePref] - Install this feature's own
   *   preference observer. False when a registry owns the gate.
   */
  init({ observePref = true } = {}) {
    if (this.#destroyed) {
      return;
    }
    if (observePref && !this.#prefObserved) {
      this.#prefObserver = { observe: () => this.#sync() };
      Services.prefs.addObserver(this.constructor.prefName, this.#prefObserver);
      this.#prefObserved = true;
    }
    this.#sync();
  }

  get enabled() {
    return this.#enabled;
  }

  get name() {
    return this.constructor.featureName || this.constructor.name;
  }

  // --- Overridden by subclasses ---------------------------------------------

  onEnable() {}

  onDisable() {}

  // --- Resource helpers ------------------------------------------------------

  #canAllocate() {
    return !this.#destroyed && !this.#tearingDown && !this.#setupAborted;
  }

  observeMutations(selector, cb, options) {
    if (!this.#canAllocate()) {
      return null;
    }
    const handle = this.context.observers.observeMutations(
      selector,
      cb,
      options
    );
    this.#observerHandles.add(handle);
    return handle;
  }

  observeResize(element, cb) {
    if (!this.#canAllocate()) {
      return null;
    }
    const handle = this.context.observers.observeResize(element, cb);
    this.#observerHandles.add(handle);
    return handle;
  }

  observeIntersection(element, cb, options) {
    if (!this.#canAllocate()) {
      return null;
    }
    const handle = this.context.observers.observeIntersection(
      element,
      cb,
      options
    );
    this.#observerHandles.add(handle);
    return handle;
  }

  onFrame(cb, options) {
    if (!this.#canAllocate()) {
      return null;
    }
    const handle = this.context.scheduler.onFrame(cb, options);
    this.#schedulerHandles.add(handle);
    return handle;
  }

  onIdle(cb, options) {
    if (!this.#canAllocate()) {
      return null;
    }
    const handle = this.context.scheduler.onIdle(cb, options);
    this.#schedulerHandles.add(handle);
    return handle;
  }

  onWallClock(cb, unit) {
    if (!this.#canAllocate()) {
      return null;
    }
    const handle = this.context.scheduler.onWallClock(cb, unit);
    this.#schedulerHandles.add(handle);
    return handle;
  }

  /** @param {object[]} descriptors */
  bindTokens(descriptors) {
    if (!this.#canAllocate()) {
      return [];
    }
    const handles = [];
    for (const descriptor of descriptors) {
      const handle = this.context.tokens.bind(descriptor);
      this.#tokenHandles.add(handle);
      handles.push(handle);
    }
    return handles;
  }

  /**
   * Subscribes to the window's navigation router. See `TranceNavigation`.
   *
   * @param {object} subscription - `{ onProgress, onNavigate, onSelect }`.
   * @param {object} [options] - `{ selectedOnly }`.
   * @returns {number | null} A tracked handle, or null while tearing down.
   */
  observeNavigation(subscription, options) {
    if (!this.#canAllocate()) {
      return null;
    }
    const handle = this.context.navigation.subscribe(subscription, options);
    this.#navigationHandles.add(handle);
    return handle;
  }

  /**
   * Takes a process-wide preference claim for this feature. The owner is lazy
   * so an enabled feature that never reaches a material branch pays nothing.
   *
   * @param {string} prefName
   * @param {any} value
   * @param {object} [options] Owner claim options, such as `{branch: "default"}`.
   */
  claimGlobalPref(prefName, value, options) {
    if (!this.#canAllocate()) {
      return null;
    }
    if (!this.#globalPrefOwner) {
      const { TranceGlobalPrefOwner } = ChromeUtils.importESModule(
        "chrome://browser/content/trance-components/TranceGlobalPrefs.mjs"
      );
      this.#globalPrefOwner = new TranceGlobalPrefOwner(this.name);
    }
    this.#globalPrefOwner.claim(prefName, value, options);
    return this.#globalPrefOwner;
  }

  get globalSheets() {
    // Existing ownership is readable during onDisable so subclasses can give
    // individual sheets back; only creating a new owner is forbidden while
    // teardown or destruction is in progress.
    if (this.#destroyed && !this.#tearingDown) {
      return null;
    }
    if (!this.#globalSheetOwner && !this.#canAllocate()) {
      return null;
    }
    if (!this.#globalSheetOwner) {
      const { TranceGlobalSheetOwner } = ChromeUtils.importESModule(
        "chrome://browser/content/trance-components/TranceGlobalSheets.mjs"
      );
      this.#globalSheetOwner = new TranceGlobalSheetOwner(this.name);
    }
    return this.#globalSheetOwner;
  }

  addListener(target, type, listener, options) {
    if (!this.#canAllocate()) {
      return null;
    }
    target.addEventListener(type, listener, options);
    this.#disposers.push(() =>
      target.removeEventListener(type, listener, options)
    );
    return listener;
  }

  addDisposer(disposer) {
    if (!this.#canAllocate()) {
      return null;
    }
    this.#disposers.push(disposer);
    return disposer;
  }

  // --- Lifecycle -------------------------------------------------------------

  destroy() {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    if (this.#prefObserved) {
      Services.prefs.removeObserver(
        this.constructor.prefName,
        this.#prefObserver
      );
      this.#prefObserved = false;
    }
    if (this.#enabled || this.#settingUp) {
      this.#teardown();
      return;
    }
    // A subclass should not normally allocate while disabled, but cleanup is
    // still defensive if it did: destruction must never strand a claim or
    // handle merely because the feature was not in its committed state.
    if (
      this.#disposers.length ||
      this.#observerHandles.size ||
      this.#schedulerHandles.size ||
      this.#tokenHandles.size ||
      this.#navigationHandles.size ||
      this.#styleHandles.length ||
      this.#globalPrefOwner ||
      this.#globalSheetOwner
    ) {
      this.#tearingDown = true;
      this.#releaseResources();
      this.#tearingDown = false;
    }
  }

  #sync() {
    if (this.#destroyed || this.#tearingDown) {
      return;
    }
    const shouldBeEnabled = Services.prefs.getBoolPref(
      this.constructor.prefName,
      false
    );
    if (this.#settingUp) {
      if (!shouldBeEnabled) {
        this.#setupAborted = true;
        this.#teardown();
      }
      return;
    }
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
    if (this.#destroyed || this.#settingUp || this.#enabled) {
      return;
    }
    this.#settingUp = true;
    this.#setupAborted = false;
    this.#setupEntered = false;
    this.#setupRolledBack = false;
    try {
      // Load and account for each sheet independently. TranceStyles swallows a
      // Gecko load failure, so the loaded-set check turns that into a failed
      // transaction without unloading a sheet owned by another feature.
      for (const url of this.constructor.styles) {
        if (!this.#canAllocate()) {
          throw new Error("feature setup was cancelled");
        }
        this.context.styles.load(url);
        const loaded = this.context.styles.loadedSheets;
        if (Array.isArray(loaded) && !loaded.includes(url)) {
          throw new Error(`failed to load stylesheet ${url}`);
        }
        this.#styleHandles.push(url);
      }
      if (!this.#canAllocate()) {
        throw new Error("feature setup was cancelled");
      }
      this.#setupEntered = true;
      this.onEnable();
      if (!this.#canAllocate()) {
        throw new Error("feature setup was cancelled");
      }
      // Commit only after every allocation and onEnable() have completed.
      this.#enabled = true;
      TranceLog.log(this.name, "enabled");
    } catch (error) {
      if (!this.#setupRolledBack) {
        this.#rollback(this.#setupEntered);
      }
      TranceLog.error(this.name, "setup failed", error);
    } finally {
      this.#settingUp = false;
      this.#setupEntered = false;
      this.#setupAborted = false;
      this.#setupRolledBack = false;
    }
  }

  #rollback(callOnDisable) {
    this.#tearingDown = true;
    this.#enabled = false;
    if (callOnDisable) {
      try {
        this.onDisable();
      } catch (error) {
        TranceLog.error(this.name, "onDisable threw", error);
      }
    }
    this.#releaseResources();
    this.#tearingDown = false;
    this.#setupRolledBack = true;
  }

  #teardown() {
    if (this.#tearingDown) {
      return;
    }
    const duringSetup = this.#settingUp;
    if (duringSetup) {
      this.#setupAborted = true;
    }
    this.#tearingDown = true;
    this.#enabled = false;
    if (!duringSetup) {
      try {
        this.onDisable();
      } catch (error) {
        TranceLog.error(this.name, "onDisable threw", error);
      }
    }
    this.#releaseResources();
    this.#tearingDown = false;
    if (duringSetup) {
      this.#setupRolledBack = true;
    }
    TranceLog.log(this.name, "disabled");
  }

  #releaseResources() {
    for (const disposer of this.#disposers.splice(0).reverse()) {
      try {
        disposer();
      } catch (error) {
        TranceLog.error(this.name, "disposer threw", error);
      }
    }
    for (const handle of this.#observerHandles) {
      try {
        this.context.observers.unobserve(handle);
      } catch (error) {
        TranceLog.error(this.name, "observer release threw", error);
      }
    }
    this.#observerHandles.clear();
    for (const handle of this.#schedulerHandles) {
      try {
        this.context.scheduler.cancel(handle);
      } catch (error) {
        TranceLog.error(this.name, "scheduler release threw", error);
      }
    }
    this.#schedulerHandles.clear();
    for (const handle of this.#tokenHandles) {
      try {
        this.context.tokens.release(handle);
      } catch (error) {
        TranceLog.error(this.name, "token release threw", error);
      }
    }
    this.#tokenHandles.clear();
    for (const handle of this.#navigationHandles) {
      try {
        this.context.navigation.unsubscribe(handle);
      } catch (error) {
        TranceLog.error(this.name, "navigation release threw", error);
      }
    }
    this.#navigationHandles.clear();
    try {
      this.#globalPrefOwner?.releaseAll();
    } catch (error) {
      TranceLog.error(this.name, "global preference release threw", error);
    }
    try {
      this.#globalSheetOwner?.releaseAll();
    } catch (error) {
      TranceLog.error(this.name, "global sheet release threw", error);
    }
    for (const url of this.#styleHandles.splice(0).reverse()) {
      try {
        this.context.styles.unload(url);
      } catch (error) {
        TranceLog.error(this.name, "stylesheet release threw", error);
      }
    }
  }
}
