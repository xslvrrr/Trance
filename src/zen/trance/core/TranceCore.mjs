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
// Refs: TRANCE.md §3.7, §6, §13 Phase 2, §13 Phase 5

import { nsZenPreloadedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Core";
const PREF_ENABLED = "trance.enabled";
const STYLE_ENTRY_POINT = "chrome://browser/content/trance-styles/trance.css";

class nsTranceCore extends nsZenPreloadedFeature {
  #active = false;
  #prefObserver;
  #boundUnload;

  /** @type {import("./TranceFeature.mjs").TranceContext | null} */
  #context = null;
  /** @type {import("./TranceFeatureRegistry.mjs").TranceFeatureRegistry | null} */
  #registry = null;

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
    return this.#registry?.features ?? [];
  }

  /** Metadata for lazy-loading diagnostics and the startup smoke script. */
  get registrations() {
    return this.#registry?.registrations ?? [];
  }

  /**
   * Explicit demand from a settings or onboarding entry point.
   *
   * @param {string} featureName - The registration's `name`.
   * @returns {import("./TranceFeature.mjs").TranceFeature | null}
   */
  ensureFeature(featureName) {
    return this.#registry?.ensure(featureName) ?? null;
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
    const { TranceNavigation } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceNavigation.mjs",
      { global: "current" }
    );
    const { TranceTabCache } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceTabCache.mjs",
      { global: "current" }
    );
    const { TranceMaterial } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceMaterial.mjs",
      { global: "current" }
    );
    const { TranceFeatureRegistry } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceFeatureRegistry.mjs",
      { global: "current" }
    );

    const tranceScheduler = new TranceScheduler(window);
    const observers = new TranceObserverHub(window, tranceScheduler);
    const activity = window.gZenWindowActivity;
    const material = new TranceMaterial(window, activity);
    const context = {
      window,
      document,
      scheduler: tranceScheduler,
      observers,
      styles: new TranceStyles(window),
      tokens: new TranceTokens(window),
      motion: new TranceMotion(window),
      navigation: new TranceNavigation(window, tranceScheduler),
      tabCache: new TranceTabCache(window, observers),
      // ZenWindowActivity is installed by Zen's common startup. Automation
      // windows can omit it; TranceMaterial treats that as no activity signal.
      activity,
      material,
    };
    this.#context = context;

    // Tokens, reset and motion keyframes. Feature stylesheets are loaded by the
    // features themselves so that a disabled feature loads nothing.
    context.styles.load(STYLE_ENTRY_POINT);
    document.documentElement.setAttribute("trance", "true");

    // These are metadata gates, not imports. Keep the order: state and surface
    // foundations precede consumers, and onboarding must extend the picker only
    // after its persistent settings registration is present.
    this.#registry = new TranceFeatureRegistry(context, [
      {
        name: "Surfaces",
        url: "chrome://browser/content/trance-components/TranceSurfaces.mjs",
        exportName: "TranceSurfaces",
        prefName: "trance.surface.enabled", // TranceSurfaces.prefName
      },
      {
        name: "TabStrip",
        url: "chrome://browser/content/trance-components/TranceTabStrip.mjs",
        exportName: "TranceTabStrip",
        prefName: "trance.tabstrip.enabled", // TranceTabStrip.prefName
      },
      {
        name: "Chrome",
        url: "chrome://browser/content/trance-components/TranceChrome.mjs",
        exportName: "TranceChrome",
        prefName: "trance.chrome.enabled", // TranceChrome.prefName
      },
      {
        name: "Feedback",
        url: "chrome://browser/content/trance-components/TranceFeedback.mjs",
        exportName: "TranceFeedback",
        prefName: "trance.feedback.enabled", // TranceFeedback.prefName
      },
      {
        // ThemeState is the always-eligible, cheap state bridge. The picker UI
        // itself remains popup-gated below so its stylesheet and controls are
        // not parsed before the first picker opening.
        name: "ThemeState",
        url: "chrome://browser/content/trance-components/TranceThemeState.mjs",
        exportName: "TranceThemeState",
        prefName: "trance.theme.enabled", // TranceThemeState.prefName
      },
      {
        // Theme extends `gZenThemePicker`; loading it on the first popup keeps
        // Zen's picker construction order intact while preserving zero cost for
        // sessions that never open the picker.
        name: "Theme",
        url: "chrome://browser/content/trance-components/TranceTheme.mjs",
        exportName: "TranceTheme",
        prefName: "trance.theme.enabled", // TranceTheme.prefName
        popup: "PanelUI-zen-gradient-generator",
      },
      {
        name: "OnboardingSettings",
        url: "chrome://browser/content/trance-components/TranceOnboardingSettings.mjs",
        exportName: "TranceOnboardingSettings",
        prefName: "trance.onboarding.enabled", // TranceOnboardingSettings.prefName
      },
      {
        // The flow is parsed only when completion is clear. Clearing completion
        // while it is running deliberately invokes its restart entry point.
        name: "Onboarding",
        url: "chrome://browser/content/trance-components/TranceOnboarding.mjs",
        exportName: "TranceOnboarding",
        prefName: "trance.onboarding.enabled", // TranceOnboarding.prefName
        completedPref: "trance.onboarding.completed",
        restart: "start",
      },
      {
        // FirstRun waits for Zen's welcome signals and is also complete-gated;
        // registering its metadata does not parse the implementation at startup.
        name: "FirstRun",
        url: "chrome://browser/content/trance-components/TranceFirstRun.mjs",
        exportName: "TranceFirstRun",
        prefName: "trance.firstrun.enabled", // TranceFirstRun.prefName
        completedPref: "trance.firstrun.completed",
      },
    ]);
    this.#registry.init();

    this.#active = true;
    TranceLog.log(
      NS,
      `activated in ${(window.performance.now() - started).toFixed(1)}ms`
    );
  }

  /**
   * The `TranceLog` counters for the §12.1 budget checks.
   *
   * `scripts/trance-perf.py` reads the counters over Marionette, and it cannot
   * get at them by importing TranceLog itself: `ZenPreloadedScripts` imports
   * TranceCore with `{ global: "current" }`, so the module — and the Map it
   * keeps the counts in — lives in this window's global, while an import from a
   * Marionette sandbox resolves to a different instance of the same module
   * whose Map has never been written to. The symptom is not an error; it is a
   * plausible-looking `{}`, which reads as "nothing ever happened".
   *
   * Exposing it here costs nothing when `trance.debug` is off, because nothing
   * increments a counter in that case either.
   *
   * Refs: TRANCE.md §12.1, §13 Phase 11
   *
   * @returns {object} A snapshot of every counter.
   */
  get counters() {
    return TranceLog.snapshot();
  }

  /** Clears the counters, so a measurement can be scoped to one interaction. */
  resetCounters() {
    TranceLog.resetCounters();
  }

  #deactivate() {
    const context = this.#context;
    try {
      this.#registry?.destroy();
    } catch (error) {
      TranceLog.error(NS, "failed to destroy feature registry", error);
    }
    this.#registry = null;

    if (context) {
      // Consumers first, then the shared routers/material, then the foundation
      // they depend on. This order also makes a failed feature teardown unable
      // to leave a listener attached to a destroyed scheduler or observer hub.
      try {
        context.navigation.destroy();
      } catch (error) {
        TranceLog.error(NS, "failed to destroy navigation", error);
      }
      try {
        context.tabCache.destroy();
      } catch (error) {
        TranceLog.error(NS, "failed to destroy tab cache", error);
      }
      try {
        context.material.destroy();
      } catch (error) {
        TranceLog.error(NS, "failed to destroy material", error);
      }
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
