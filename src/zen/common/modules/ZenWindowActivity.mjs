/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const LOW_POWER_MODE_PREF = "zen.performance.low-power-mode";

/** One activity state owner for a chrome window. */
export class ZenWindowActivityController extends EventTarget {
  #window;
  #state;
  #subscribers = new Set();
  #boundUpdate;
  #destroyed = false;
  #isChromeWindow;

  constructor(win) {
    super();
    this.#window = win;
    this.#isChromeWindow = win.STATE_MINIMIZED !== undefined;
    this.#boundUpdate = this.#update.bind(this);

    for (const type of [
      "focus",
      "blur",
      "activate",
      "deactivate",
      "occlusionstatechange",
      "sizemodechange",
      "move",
      "load",
    ]) {
      win.addEventListener(type, this.#boundUpdate);
    }
    win.document.addEventListener("visibilitychange", this.#boundUpdate);
    Services.prefs.addObserver(LOW_POWER_MODE_PREF, this.#boundUpdate);
    win.addEventListener("unload", () => this.destroy(), { once: true });

    this.#state = this.#readState();
    this.#applyAttributes();
  }

  get state() {
    return { ...this.#state };
  }

  get focused() {
    return this.#state.focused;
  }

  get visible() {
    return this.#state.visible;
  }

  get occluded() {
    return this.#state.occluded;
  }

  get minimized() {
    return this.#state.minimized;
  }

  get lowPowerMode() {
    return this.#state.lowPowerMode;
  }

  get refreshRate() {
    return this.#state.refreshRate;
  }

  get suspended() {
    return this.#state.suspended;
  }

  /**
   * @param {(state: object, previousState: object, changed: string[]) => void} callback
   * @param {object} [options]
   * @param {boolean} [options.immediate]
   * @returns {() => void}
   */
  subscribe(callback, { immediate = false } = {}) {
    if (this.#destroyed) {
      return () => {};
    }
    this.#subscribers.add(callback);
    if (immediate) {
      const state = this.state;
      callback(state, state, []);
    }
    return () => this.#subscribers.delete(callback);
  }

  destroy() {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    const win = this.#window;
    for (const type of [
      "focus",
      "blur",
      "activate",
      "deactivate",
      "occlusionstatechange",
      "sizemodechange",
      "move",
      "load",
    ]) {
      win.removeEventListener(type, this.#boundUpdate);
    }
    win.document.removeEventListener("visibilitychange", this.#boundUpdate);
    Services.prefs.removeObserver(LOW_POWER_MODE_PREF, this.#boundUpdate);
    this.#subscribers.clear();
  }

  #readState() {
    const win = this.#window;
    const minimized =
      this.#isChromeWindow && win.windowState === win.STATE_MINIMIZED;
    const occluded = this.#isChromeWindow && Boolean(win.isFullyOccluded);
    const documentVisible = win.document.visibilityState !== "hidden";
    const visible = documentVisible && !minimized && !occluded;
    const focused = this.#isChromeWindow
      ? win.document.hasFocus() || Services.focus.activeWindow === win
      : documentVisible;

    return Object.freeze({
      focused,
      visible,
      occluded,
      minimized,
      windowState: this.#isChromeWindow ? win.windowState : null,
      lowPowerMode: Services.prefs.getBoolPref(LOW_POWER_MODE_PREF, false),
      refreshRate: this.#readRefreshRate(),
      suspended: !focused || !visible,
    });
  }

  #readRefreshRate() {
    const win = this.#window;
    try {
      const manager = Cc["@mozilla.org/gfx/screenmanager;1"].getService(
        Ci.nsIScreenManager
      );
      return manager.screenForRect(
        win.screenX,
        win.screenY,
        Math.max(1, win.outerWidth),
        Math.max(1, win.outerHeight)
      ).refreshRate;
    } catch {
      return 0;
    }
  }

  #update() {
    if (this.#destroyed) {
      return;
    }
    const previous = this.#state;
    const current = this.#readState();
    const changed = Object.keys(current).filter(
      key => current[key] !== previous[key]
    );
    if (!changed.length) {
      return;
    }
    this.#state = current;
    this.#applyAttributes();

    for (const callback of [...this.#subscribers]) {
      try {
        callback(this.state, { ...previous }, changed);
      } catch (error) {
        console.error("ZenWindowActivity subscriber failed", error);
      }
    }
    this.dispatchEvent(
      new CustomEvent("statechange", {
        detail: { state: this.state, previous: { ...previous }, changed },
      })
    );
  }

  #applyAttributes() {
    const root = this.#window.document.documentElement;
    if (!root) {
      return;
    }
    const state = this.#state;
    root.toggleAttribute("zen-window-focused", state.focused);
    root.toggleAttribute("zen-window-visible", state.visible);
    root.toggleAttribute("zen-window-occluded", state.occluded);
    root.toggleAttribute("zen-window-minimized", state.minimized);
    root.toggleAttribute("zen-low-power-mode", state.lowPowerMode);
    root.setAttribute("zen-display-refresh-rate", state.refreshRate);
  }
}

if (typeof window !== "undefined") {
  window.gZenWindowActivity ??= new ZenWindowActivityController(window);
}
