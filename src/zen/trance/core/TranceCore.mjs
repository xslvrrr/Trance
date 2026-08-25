// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the foundation layer's entry point.
//
// This is the *only* Trance module listed in `ZenPreloadedScripts.js`. Trance
// enters through Zen's own startup lifecycle rather than injecting at some
// autoconfig-driven point of its own, which is what made mod load order
// nondeterministic in the first place (TRANCE.md §3.7).
//
// With `trance.enabled=false` this module holds one pref observer and nothing
// else: no other Trance module is even imported, no stylesheet is in the style
// set, no observer is connected, no timer is armed. Flipping the pref back
// builds the whole layer live, without a restart.
//
// Refs: TRANCE.md §3.7, §6, §13 Phase 2

import { nsZenPreloadedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Core";

const PREF_ENABLED = "trance.enabled";

const STYLE_ENTRY_POINT = "chrome://browser/content/trance-styles/trance.css";

/**
 * Feature modules, in construction order. Foundation first, features after.
 * Each is imported only when Trance is active, so a disabled browser never
 * parses them.
 */
const FEATURES = Object.freeze([
  {
    url: "chrome://browser/content/trance-components/TranceSurfaces.mjs",
    exportName: "TranceSurfaces",
  },
  {
    url: "chrome://browser/content/trance-components/TranceTabStrip.mjs",
    exportName: "TranceTabStrip",
  },
  {
    url: "chrome://browser/content/trance-components/TranceChrome.mjs",
    exportName: "TranceChrome",
  },
  {
    url: "chrome://browser/content/trance-components/TranceFeedback.mjs",
    exportName: "TranceFeedback",
  },
]);

class nsTranceCore extends nsZenPreloadedFeature {
  #active = false;
  #prefObserver;
  #boundUnload;

  /** @type {import("./TranceFeature.mjs").TranceContext | null} */
  #context = null;
  /** @type {import("./TranceFeature.mjs").TranceFeature[]} */
  #features = [];

  init() {
    this.#prefObserver = { observe: () => this.#sync() };
    Services.prefs.addObserver(PREF_ENABLED, this.#prefObserver);

    this.#boundUnload = () => this.#shutdown();
    window.addEventListener("unload", this.#boundUnload, { once: true });

    this.#sync();
  }

  get active() {
    return this.#active;
  }

  /** The shared context, or null while Trance is disabled. Debugging aid. */
  get context() {
    return this.#context;
  }

  get features() {
    return this.#features;
  }

  #sync() {
    const shouldBeActive = Services.prefs.getBoolPref(PREF_ENABLED, true);
    if (shouldBeActive === this.#active) {
      return;
    }
    if (shouldBeActive) {
      this.#activate();
    } else {
      this.#deactivate();
    }
  }

  #activate() {
    const started = window.performance.now();

    const { TranceScheduler } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceScheduler.mjs",
      { global: "current" }
    );
    const { TranceObserverHub } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceObserverHub.mjs",
      { global: "current" }
    );
    const { TranceStyles } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceStyles.mjs",
      { global: "current" }
    );
    const { TranceTokens } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceTokens.mjs",
      { global: "current" }
    );
    const { TranceMotion } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceMotion.mjs",
      { global: "current" }
    );

    const tranceScheduler = new TranceScheduler(window);
    const context = {
      window,
      document,
      scheduler: tranceScheduler,
      observers: new TranceObserverHub(window, tranceScheduler),
      styles: new TranceStyles(window),
      tokens: new TranceTokens(window),
      motion: new TranceMotion(window),
    };
    this.#context = context;

    // Tokens, reset and motion keyframes. Feature stylesheets are loaded by the
    // features themselves so that a disabled feature loads nothing.
    context.styles.load(STYLE_ENTRY_POINT);
    document.documentElement.setAttribute("trance", "true");

    for (const { url, exportName } of FEATURES) {
      try {
        const module = ChromeUtils.importESModule(url, { global: "current" });
        const feature = new module[exportName](context);
        this.#features.push(feature);
        feature.init();
      } catch (error) {
        TranceLog.error(NS, `failed to construct ${exportName}`, error);
      }
    }

    this.#active = true;
    TranceLog.log(
      NS,
      `activated in ${(window.performance.now() - started).toFixed(1)}ms`
    );
  }

  #deactivate() {
    for (const feature of this.#features.splice(0)) {
      try {
        feature.destroy();
      } catch (error) {
        TranceLog.error(NS, `failed to destroy ${feature.name}`, error);
      }
    }

    const context = this.#context;
    if (context) {
      context.styles.unload(STYLE_ENTRY_POINT);
      context.motion.destroy();
      context.tokens.destroy();
      context.observers.destroy();
      context.scheduler.destroy();
      // Anything a feature failed to unload is caught here rather than left in
      // the style set for the rest of the session.
      context.styles.destroy();
    }
    this.#context = null;
    document.documentElement.removeAttribute("trance");

    this.#active = false;
    TranceLog.log(NS, "deactivated");
  }

  #shutdown() {
    Services.prefs.removeObserver(PREF_ENABLED, this.#prefObserver);
    if (this.#active) {
      this.#deactivate();
    }
  }
}

window.gTrance = new nsTranceCore();
