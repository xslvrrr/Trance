// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: metadata gates implementation parsing, not just feature setup.
// Refs: AUDIT.md Phase 5; TRANCE.md §6.5.

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

export class TranceFeatureRegistry {
  #context;
  #entries;
  #disposers = [];
  #destroyed = false;
  #load;

  constructor(
    context,
    descriptors,
    load = url => ChromeUtils.importESModule(url, { global: "current" })
  ) {
    this.#context = context;
    this.#load = load;
    this.#entries = descriptors.map(descriptor => ({
      descriptor,
      feature: null,
      loading: false,
    }));
  }

  init() {
    const byPref = new Map();
    for (const entry of this.#entries) {
      for (const pref of [
        entry.descriptor.prefName,
        entry.descriptor.completedPref,
      ].filter(Boolean)) {
        if (!byPref.has(pref)) {
          byPref.set(pref, []);
        }
        byPref.get(pref).push(entry);
      }
    }
    for (const [pref, entries] of byPref) {
      // Services.prefs does not promise observer ordering. One observer per
      // pref preserves dependency order even when two registrations share it.
      const observer = { observe: () => this.#prefChanged(pref, entries) };
      Services.prefs.addObserver(pref, observer);
      this.#disposers.push(() => Services.prefs.removeObserver(pref, observer));
    }
    for (const entry of this.#entries) {
      const { descriptor } = entry;
      if (descriptor.popup) {
        // Capture at the window so the implementation and its controls exist
        // before the target's first popupshowing listeners run. No polling and
        // no dependency on when Zen constructs the picker object.
        const onPopupShowing = event => {
          if (event.target.id === descriptor.popup) {
            this.#sync(entry, true);
          }
        };
        this.#context.window.addEventListener(
          "popupshowing",
          onPopupShowing,
          true
        );
        this.#disposers.push(() =>
          this.#context.window.removeEventListener(
            "popupshowing",
            onPopupShowing,
            true
          )
        );
      }
      this.#sync(entry);
    }
  }

  #prefChanged(pref, entries) {
    const enabling = Services.prefs.getBoolPref(pref, false);
    for (const entry of enabling ? entries : [...entries].reverse()) {
      const { descriptor } = entry;
      const existing = entry.feature;
      this.#sync(entry);
      // Completion is claimed on ENTRY. True must never dismantle a running
      // takeover; clearing it explicitly requests the flow again.
      if (
        existing?.enabled &&
        descriptor.restart &&
        pref === descriptor.completedPref &&
        !enabling &&
        !Cu.isInAutomation
      ) {
        existing[descriptor.restart]();
      }
    }
  }

  get features() {
    return this.#entries.flatMap(entry =>
      entry.feature ? [entry.feature] : []
    );
  }

  get registrations() {
    return this.#entries.map(({ descriptor, feature }) => ({
      name: descriptor.name,
      loaded: !!feature,
      enabled: feature?.enabled ?? false,
    }));
  }

  /**
   * Explicit UI entry point; never overrides a disabled preference.
   *
   * @param {string} featureName
   */
  ensure(featureName) {
    const entry = this.#entries.find(
      item => item.descriptor.name === featureName
    );
    return entry ? this.#sync(entry, true) : null;
  }

  #sync(entry, requested = false) {
    if (this.#destroyed || entry.loading) {
      return null;
    }
    const { descriptor } = entry;
    const enabled = Services.prefs.getBoolPref(descriptor.prefName, false);
    if (entry.feature) {
      entry.feature.init({ observePref: false });
      return enabled ? entry.feature : null;
    }
    if (!enabled) {
      return null;
    }
    if (!requested) {
      if (
        descriptor.completedPref &&
        Services.prefs.getBoolPref(descriptor.completedPref, false)
      ) {
        return null;
      }
      if (descriptor.popup) {
        const state = this.#context.document.getElementById(
          descriptor.popup
        )?.state;
        if (state !== "open" && state !== "showing") {
          return null;
        }
      }
    }
    entry.loading = true;
    let feature;
    try {
      const module = this.#load(descriptor.url);
      feature = new module[descriptor.exportName](this.#context);
      feature.init({ observePref: false });
      if (this.#destroyed) {
        feature.destroy();
        return null;
      }
      entry.feature = feature;
      return feature;
    } catch (error) {
      feature?.destroy();
      TranceLog.error("Features", `failed to load ${descriptor.name}`, error);
      return null;
    } finally {
      entry.loading = false;
    }
  }

  destroy() {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    for (const dispose of this.#disposers.splice(0).reverse()) {
      dispose();
    }
    for (const entry of [...this.#entries].reverse()) {
      try {
        entry.feature?.destroy();
      } catch (error) {
        TranceLog.error(
          "Features",
          `failed to destroy ${entry.descriptor.name}`,
          error
        );
      }
      entry.feature = null;
    }
  }
}
