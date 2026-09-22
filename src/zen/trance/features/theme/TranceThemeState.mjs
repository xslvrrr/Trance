// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the theme picker — lightness, translucency, gradient angle, palettes,
// saved themes and exact colours.
//
// Behaviour inspired by "BetterZenGradientPicker" by JustAdumbPrsn
// (https://github.com/JustAdumbPrsn/BetterZenGradientPicker). That mod carries
// no licence, so under TRANCE.md §7.3 nothing from it may be copied and none of
// its source was read. What is reimplemented here is a list of behaviours taken
// from its screenshots and from the user's own requirements, which is the
// clean-room boundary: what a product does is a fact about the product.
//
// Startup rendering for saved themes. The registry enables this small owner
// before Zen caches the opacity range; TranceTheme imports only when its panel
// opens. No controls, styles, preview scheduler or UI imports belong here.
// Refs: AUDIT.md Phase 5; TRANCE.md §6.5, §13 Phase 8; ADR-031.

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "ThemeState";
const EXPLICIT_BLACKWHITE_TYPE = "explicit-black-white";
const owners = new WeakMap();
// Zen's private cached bounds outlive an owner destroyed by a master-pref flip.
const widenedPickers = new WeakSet();

/** Slider configurations shared with the lazily loaded controls. */
export const PALETTES = Object.freeze([
  {
    id: "full",
    label: "Full colour",
    hint: "Zen's own behaviour — lightness follows the wheel",
    saturation: null,
    lightness: null,
    opacity: null,
  },
  {
    id: "vivid",
    label: "Vivid",
    hint: "Saturated, mid lightness",
    saturation: 100,
    lightness: 55,
    opacity: null,
  },
  {
    id: "pastel",
    label: "Pastel",
    hint: "Soft and light",
    saturation: 45,
    lightness: 82,
    opacity: 0.45,
  },
  {
    id: "muted",
    label: "Muted",
    hint: "Low saturation, mid lightness",
    saturation: 25,
    lightness: 58,
    opacity: null,
  },
  {
    id: "dark",
    label: "Dark",
    hint: "Deep colour, heavier tint",
    saturation: 60,
    lightness: 18,
    opacity: 0.75,
  },
  {
    id: "light",
    label: "Light",
    hint: "Pale colour, lighter tint",
    saturation: 55,
    lightness: 88,
    opacity: 0.4,
  },
  {
    id: "neon",
    label: "Neon",
    hint: "Maximum saturation, bright",
    saturation: 100,
    lightness: 66,
    opacity: 0.6,
  },
  {
    id: "monochrome",
    label: "Monochrome",
    hint: "No hue at all",
    saturation: 0,
    lightness: null,
    opacity: null,
  },
]);

export class TranceThemeState extends TranceFeature {
  static prefName = "trance.theme.enabled";
  static featureName = "ThemeState";

  #picker = null;
  #state = { lightness: null, angle: 0, palette: "full" };
  #uuid = null;
  #renderAngle = null;
  #undo = [];
  #rangeWidened = false;

  /**
   * Returns the startup owner; never constructs one or imports the UI.
   *
   * @param {Window} browserWindow
   * @returns {TranceThemeState|null}
   */
  static forWindow(browserWindow) {
    return owners.get(browserWindow) ?? null;
  }

  get picker() {
    return this.#picker;
  }

  /** The one mutable state object used by both rendering and the controls. */
  get state() {
    return this.#state;
  }

  onEnable() {
    const win = this.context.window;
    if (owners.has(win)) {
      throw new Error("A theme state owner already exists for this window");
    }
    owners.set(win, this);
    this.addDisposer(() => {
      if (owners.get(win) === this) {
        owners.delete(win);
      }
    });
    this.#widenOpacitySlider();
    if (this.#attach()) {
      return;
    }

    // Session restore constructs the picker after TranceCore. Its first
    // workspace notification is the arrival signal; stop observing once ready.
    let observing = true;
    const stopObserving = () => {
      if (observing) {
        Services.obs.removeObserver(observer, "zen-space-gradient-update");
        observing = false;
      }
    };
    const observer = {
      observe: () => {
        try {
          if (this.#attach()) {
            stopObserving();
          }
        } catch (error) {
          this.destroy();
          TranceLog.error(NS, "could not attach to the gradient picker", error);
        }
      },
    };
    Services.obs.addObserver(observer, "zen-space-gradient-update");
    this.addDisposer(stopObserving);
  }

  #attach() {
    if (this.#picker) {
      return true;
    }
    const picker = this.context.window.gZenThemePicker;
    if (!picker?.panel) {
      return false;
    }
    this.#picker = picker;
    if (this.#rangeWidened) {
      widenedPickers.add(picker);
    }
    this.#loadState();
    this.#wrapColorFromPosition();
    this.#wrapGradient();
    this.#wrapGradientForWorkspace();
    this.#wrapWorkspaceChange();
    this.#wrapGetTheme();
    this.#repaint();
    return true;
  }

  onDisable() {
    for (const undo of this.#undo.splice(0).reverse()) {
      try {
        undo();
      } catch (error) {
        TranceLog.error(NS, "undo step threw", error);
      }
    }
    // Read the stored theme directly. updateCurrentWorkspace would serialize
    // panel dots and overwrite the saved Trance fields after removing getTheme.
    try {
      this.#repaint();
    } catch (error) {
      TranceLog.error(NS, "could not repaint after disable", error);
    }
    this.#picker = null;
    this.#rangeWidened = false;
  }

  #repaint() {
    const workspace = this.#activeWorkspace();
    if (workspace) {
      this.#picker?.onWorkspaceChange(workspace);
    }
  }

  #widenOpacitySlider() {
    const slider = this.context.document.getElementById(
      "PanelUI-zen-gradient-generator-opacity"
    );
    const picker = this.context.window.gZenThemePicker;
    if (!slider || (picker && !widenedPickers.has(picker))) {
      return;
    }
    const min = slider.getAttribute("min");
    const max = slider.getAttribute("max");
    this.#undo.push(() => {
      for (const [attribute, value] of [
        ["min", min],
        ["max", max],
      ]) {
        if (value === null) {
          slider.removeAttribute(attribute);
        } else {
          slider.setAttribute(attribute, value);
        }
      }
    });
    slider.setAttribute("min", "0");
    slider.setAttribute("max", "1");
    this.#rangeWidened = true;
  }

  /**
   * Wrap only this picker, preserving any method already owned by the instance.
   *
   * @param {string} methodName
   * @param {(original: Function) => Function} make
   */
  #patch(methodName, make) {
    const picker = this.#picker;
    const descriptor = Object.getOwnPropertyDescriptor(picker, methodName);
    const wrapped = make(picker[methodName].bind(picker));
    picker[methodName] = wrapped;
    this.#undo.push(() => {
      if (picker[methodName] !== wrapped) {
        return;
      }
      if (descriptor) {
        Object.defineProperty(picker, methodName, descriptor);
      } else {
        delete picker[methodName];
      }
    });
  }

  #wrapColorFromPosition() {
    this.#patch(
      "getColorFromPosition",
      original =>
        (x, y, type = undefined) => {
          const rgb = original(x, y, type);
          if (type === EXPLICIT_BLACKWHITE_TYPE) {
            return rgb;
          }
          return this.#applyPalette(rgb);
        }
    );
  }

  /**
   * @param {number[]} rgb
   * @returns {number[]}
   */
  #applyPalette(rgb) {
    const palette = this.palette;
    const lightness = this.#state.lightness ?? palette.lightness;
    if (palette.saturation === null && lightness === null) {
      return rgb;
    }
    const picker = this.#picker;
    const [hue, saturation, currentLightness] = picker.rgbToHsl(...rgb);
    const nextSaturation =
      palette.saturation === null ? saturation : palette.saturation / 100;
    const nextLightness =
      lightness === null ? currentLightness : lightness / 100;
    const next = picker.hslToRgb(hue / 360, nextSaturation, nextLightness);
    return next.map(channel => Math.min(255, Math.max(0, channel)));
  }

  #wrapGradient() {
    this.#patch(
      "getGradient",
      original =>
        (colors, forToolbar = false) =>
          this.#rotate(this.#flattenTint(original(colors, forToolbar), colors))
    );
  }

  /**
   * Tint strength belongs to startup rendering, not the popup controls.
   *
   * Zen emits the wheel colours with the translucency slider's alpha. Compose
   * that alpha against the chrome base so the slider means tint strength while
   * surface transparency remains owned by the surface prefs. Exact colours
   * and transparent gradient stops are deliberately left untouched.
   *
   * @param {string|Array} css Whatever Zen's `getGradient` returned.
   * @param {Array} colors The colours it was given.
   * @returns {string|Array}
   */
  #flattenTint(css, colors) {
    if (typeof css !== "string" || !colors?.filter(Boolean).length) {
      return css;
    }
    const picker = this.#picker;
    const base = picker.getToolbarModifiedBaseRaw().slice(0, 3);
    return css.replace(
      /rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g,
      (match, red, green, blue, rawAlpha) => {
        const strength = parseFloat(rawAlpha);
        if (!(strength < 1)) {
          return match;
        }
        const [r, g, b] = picker.blendColors(
          [parseFloat(red), parseFloat(green), parseFloat(blue)],
          base,
          strength * 100
        );
        return `rgb(${r}, ${g}, ${b})`;
      }
    );
  }

  /**
   * @param {string|Array} css Whatever Zen's `getGradient` returned.
   * @returns {string|Array}
   */
  #rotate(css) {
    const degrees = this.#renderAngle ?? this.#state.angle;
    if (!degrees || typeof css !== "string") {
      return css;
    }
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const round = value => Math.round(value * 100) / 100;

    return css
      .replace(
        /linear-gradient\(\s*(-?[\d.]+)deg/g,
        (_match, angle) =>
          `linear-gradient(${round((parseFloat(angle) + degrees) % 360)}deg`
      )
      .replace(
        /radial-gradient\(\s*circle at\s+(-?[\d.]+)%\s+(-?[\d.]+)%/g,
        (_match, rawX, rawY) => {
          const x = parseFloat(rawX) - 50;
          const y = parseFloat(rawY) - 50;
          return `radial-gradient(circle at ${round(50 + x * cos - y * sin)}% ${round(50 + x * sin + y * cos)}%`;
        }
      );
  }

  /**
   * Other spaces render at their own angle.
   *
   * `getGradientForWorkspace` is how the space switcher draws a preview of a
   * space you are not in. Without this, every preview would be rotated by the
   * angle of the space you happen to be looking at.
   */
  #wrapGradientForWorkspace() {
    this.#patch("getGradientForWorkspace", original => (workspace, options) => {
      const previous = this.#renderAngle;
      this.#renderAngle = this.#angleOf(workspace?.theme);
      try {
        return original(workspace, options);
      } finally {
        this.#renderAngle = previous;
      }
    });
  }

  #wrapWorkspaceChange() {
    this.#patch(
      "onWorkspaceChange",
      original =>
        (workspace, skipUpdate = false, theme = null) => {
          const incoming = theme || workspace?.theme;
          if (workspace?.uuid && this.#isForeign(workspace.uuid, incoming)) {
            this.#loadState(incoming, workspace.uuid);
          }
          return original(workspace, skipUpdate, theme);
        }
    );
  }

  /**
   * @param {string} uuid
   * @param {object} [theme]
   * @returns {boolean} Whether this theme carries values Trance did not write.
   */
  #isForeign(uuid, theme) {
    if (uuid !== this.#uuid) {
      return true;
    }
    if (!theme) {
      return false;
    }
    return (
      (theme.tranceLightness ?? null) !== this.#state.lightness ||
      this.#angleOf(theme) !== this.#state.angle ||
      (theme.trancePalette ?? "full") !== this.#state.palette
    );
  }

  #wrapGetTheme() {
    const klass = this.#picker.constructor;
    const original = klass.getTheme;
    klass.getTheme = (colors = [], opacity = 0.5, texture = 0) => {
      const theme = original.call(klass, colors, opacity, texture);
      theme.tranceLightness = this.#state.lightness;
      theme.tranceAngle = this.#state.angle;
      theme.trancePalette = this.#state.palette;
      return theme;
    };
    this.#undo.push(() => {
      klass.getTheme = original;
    });
  }

  get palette() {
    return (
      PALETTES.find(entry => entry.id === this.#state.palette) ?? PALETTES[0]
    );
  }

  /**
   * @param {object} [theme]
   * @returns {number}
   */
  #angleOf(theme) {
    const angle = Number(theme?.tranceAngle);
    return Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 0;
  }

  /**
   * @param {object} [theme] Defaults to the active space's.
   * @param {string} [uuid]
   */
  #loadState(theme = undefined, uuid = undefined) {
    const workspace = this.#activeWorkspace();
    const source = theme ?? workspace?.theme;
    this.#uuid = uuid ?? workspace?.uuid ?? null;

    const lightness =
      source?.tranceLightness == null ? NaN : Number(source.tranceLightness);
    this.#state = {
      lightness: Number.isFinite(lightness)
        ? Math.min(100, Math.max(0, lightness))
        : null,
      angle: this.#angleOf(source),
      palette: PALETTES.some(entry => entry.id === source?.trancePalette)
        ? source.trancePalette
        : "full",
    };
  }

  #activeWorkspace() {
    try {
      return this.context.window.gZenWorkspaces?.getActiveWorkspace() ?? null;
    } catch {
      // Asked before the first space exists, which happens once per window.
      return null;
    }
  }
}
