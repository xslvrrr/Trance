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
// ── Why this extends Zen's picker instead of replacing it ─────────────────
//
// Zen already ships a gradient picker: a colour wheel with draggable dots, six
// harmony algorithms, five preset pages, a translucency slider and a grain
// knob, all writing into a per-space theme that the session store persists and
// that every other part of the chrome reads through `--zen-primary-color`.
//
// Replacing that means owning the gradient engine, the theme format and the
// migration path for everyone's existing spaces — an enormous amount of surface
// to buy four controls. So Trance does not replace it. `TranceTheme` appends its
// own controls to the existing panel and wraps four methods on
// `gZenThemePicker`:
//
//   getGradient            → rotates the CSS Zen produced by the chosen angle
//   getColorFromPosition   → applies the lightness slider and the palette
//   getGradientForWorkspace→ renders another space at *that* space's angle
//   onWorkspaceChange      → notices a space change and reloads Trance's state
//   static getTheme        → stamps Trance's three extra fields into the theme
//
// Zen keeps owning the dots, the harmonies, the saving and the repaint. Trance
// owns exactly what it adds, which is the one-owner-per-thing rule this project
// is built on (TRANCE.md §3.1) applied to itself. With the pref off, every wrap
// is restored, every node is removed, and the panel is stock Zen's again — node
// for node, which is what the mochitest checks.
//
// ── Why the extra state lives in the theme, not in a pref ─────────────────
//
// Lightness, angle and palette are per-space, exactly like the colours are. A
// pref would be one global value for all of them, and a pref *per space* would
// be an unbounded set of prefs that TRANCE.md §6.6 could not surface. They are
// therefore three extra fields on the theme object Zen already saves, written
// by the one seam every theme passes through — the static `getTheme`. A theme
// that has never seen Trance simply has none of them, and reads as "auto".
//
// Refs: TRANCE.md §3.1, §6.2, §6.5, §6.6, §8.1, §13 Phase 8; ADR-031;
// docs/trance/mods/better-zen-gradient-picker.md

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Theme";

const ATTR_ROOT = "trance-theme";

const PREF_LIGHTNESS = "trance.theme.controls.lightness";
const PREF_ANGLE = "trance.theme.controls.angle";
const PREF_HEX = "trance.theme.controls.hex";
const PREF_PALETTES = "trance.theme.palettes.enabled";
const PREF_SAVED = "trance.theme.saved.enabled";
const PREF_SAVED_THEMES = "trance.theme.saved.themes";
const PREF_NOTIFICATIONS = "trance.theme.notifications";

/** Zen's own switch for the custom-colour list. Claimed and released. */
const PREF_ZEN_CUSTOM_COLORS = "zen.theme.gradient.show-custom-colors";

/** Zen's dot type for the greyscale preset page. Left entirely alone. */
const EXPLICIT_BLACKWHITE_TYPE = "explicit-black-white";

/** Degrees per press of an arrow key on the angle knob. */
const ANGLE_STEP = 15;

/**
 * How many slots the saved page draws.
 *
 * Zen's own preset pages hold eight or nine swatches, so eight is the width of
 * one row in this panel. Every slot that has no saved theme in it is drawn as a
 * dashed outline: an empty page then says *where saved themes go* rather than
 * saying nothing, and the page does not change height when the first one lands.
 */
const SAVED_SLOTS = 8;

/** How many saved themes the extra page holds before the oldest is dropped. */
const MAX_SAVED = 24;

/**
 * The palettes.
 *
 * A palette is not a set of colours — it is a *slider configuration*, which is
 * the only definition that survives contact with a picker whose colours come
 * from where you click. `saturation` and `lightness` are absolute targets in
 * percent, or null to leave Zen's own value alone; `opacity` is Zen's
 * translucency slider, or null to leave it where the user put it.
 *
 * "Full" is the identity palette: it is what a space that has never met Trance
 * already has, so switching to it is how you get stock Zen's behaviour back
 * without turning the feature off.
 */
const PALETTES = Object.freeze([
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

/**
 * Zen's harmony ids, in the words the panel should use for them.
 *
 * The algorithm button cycles these silently upstream: three dots move and
 * nothing says why. Naming the harmony is requirement 7.
 */
const HARMONY_LABELS = Object.freeze({
  complementary: "Complementary — opposite hues",
  singleAnalogous: "Analogous — one neighbouring hue",
  splitComplementary: "Split complementary",
  analogous: "Analogous — two neighbouring hues",
  triadic: "Triadic — three evenly spaced hues",
  floating: "Floating — no harmony, place them yourself",
});

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Tooltips for the picker's buttons — Zen's as well as Trance's.
 *
 * Zen's row of icon buttons carries no label and no tooltip of any kind: three
 * unlabelled glyphs that add a dot, remove a dot and cycle the harmony, plus
 * three more for the window scheme. Naming them is not a Trance feature, it is
 * the minimum a button owes the person looking at it, so Trance fills in the
 * ones that are empty and puts back exactly what it found on disable.
 */
const ZEN_TOOLTIPS = Object.freeze({
  "PanelUI-zen-gradient-generator-scheme-auto":
    "Follow the system's light or dark setting",
  "PanelUI-zen-gradient-generator-scheme-light": "Always light",
  "PanelUI-zen-gradient-generator-scheme-dark": "Always dark",
  "PanelUI-zen-gradient-generator-color-add": "Add a colour",
  "PanelUI-zen-gradient-generator-color-remove": "Remove the last colour",
  "PanelUI-zen-gradient-generator-color-toggle-algo": "Change the harmony",
  "PanelUI-zen-gradient-generator-color-page-left": "Previous presets",
  "PanelUI-zen-gradient-generator-color-page-right": "More presets",
  "PanelUI-zen-gradient-generator-texture-wrapper": "Grain",
  "PanelUI-zen-gradient-generator-opacity": "Tint strength",
  "PanelUI-zen-gradient-generator-custom-opacity": "Opacity of the colour",
});

export class TranceTheme extends TranceFeature {
  static prefName = "trance.theme.enabled";
  static featureName = "Theme";
  static styles = ["chrome://browser/content/trance-styles/trance-theme.css"];

  /** @type {object|null} Zen's picker for this window. */
  #picker = null;

  /** Created nodes, by role. Everything here is removed on disable. */
  #nodes = {};

  /** `() => void` undo steps for the method wraps and the moved nodes. */
  #undo = [];

  /**
   * Trance's three extra values for the *current* space.
   *
   * `lightness: null` means auto — Zen derives it from how far the dot is from
   * the centre of the wheel, which is what a space with no Trance state does.
   */
  #state = { lightness: null, angle: 0, palette: "full" };

  /** The space `#state` was loaded from, so a space change is noticeable. */
  #uuid = null;

  /**
   * The angle to render with, while rendering a space that is not the current
   * one. See `#wrapGradientForWorkspace`.
   */
  #renderAngle = null;

  /** Zen's value for the pref below, held while Trance has it claimed. */
  #previousCustomColors = null;

  /** The saved-themes pref as last read, so `#sync()` can skip the work. */
  #savedSignature = null;

  /**
   * The identity of every saved theme, rebuilt only when the pref changes.
   *
   * `#syncLive` runs on every repaint and has to answer "is *this* theme
   * saved?". Answering it from the pref meant a string read, a `JSON.parse` and
   * a `JSON.stringify` per saved theme — up to `MAX_SAVED` of them — on a path
   * that runs while the mouse is moving. The answer only changes when the pref
   * does, and the pref has an observer already.
   */
  #savedKeys = new Set();

  /** Scheduler handle for the coalesced repaint, or 0 when none is armed. */
  #repaintHandle = 0;

  /**
   * Whether this window's translucency range has ever been widened.
   *
   * Survives a disable, because what it really records is what Zen cached: once
   * the ends have been read as 0 and 1, they stay 0 and 1 for the life of the
   * window, and widening again on re-enable is right rather than risky.
   */
  #widenedRange = false;

  // --- Lifecycle -------------------------------------------------------------

  /**
   * Subscribes, then attaches as soon as there is something to attach to.
   *
   * `gZenThemePicker` does not exist yet. Zen constructs it in
   * `restoreWorkspacesFromSessionStore`, which runs off session restore — long
   * after `MozBeforeInitialXULLayout`, where TranceCore builds its features. So
   * this feature cannot assume the picker on enable, and polling for it would
   * be a timer, which is the thing this project deletes.
   *
   * It does not have to. Zen's own construction ends with
   * `gZenThemePicker.onWorkspaceChange(activeWorkspace)`, which finishes by
   * notifying `zen-space-gradient-update` — the same notification this feature
   * needs anyway to keep its controls in step with the theme. One subscription
   * covers both: while there is no picker it is the arrival signal, and
   * afterwards it is the sync signal.
   *
   * A private window, or a profile with spaces disabled, never fires it and
   * never constructs a picker, and this feature correctly stays at one
   * observer and nothing else for the whole session.
   */
  onEnable() {
    const observer = { observe: () => this.#onGradientUpdate() };
    Services.obs.addObserver(observer, "zen-space-gradient-update");
    this.addDisposer(() =>
      Services.obs.removeObserver(observer, "zen-space-gradient-update")
    );

    // Before `#attach`, and deliberately: see `#widenOpacitySlider`.
    this.#widenOpacitySlider();
    this.#attach();
  }

  /**
   * A theme changed somewhere.
   *
   * While the panel is shut this is only ever the arrival signal: the controls
   * it would sync are not on screen, the answer is recomputed on
   * `popupshowing`, and Zen fires this notification for space switches and
   * session restores as well as for anything this feature did.
   */
  #onGradientUpdate() {
    if (!this.#picker) {
      this.#attach();
      return;
    }
    if (this.#isPanelOpen) {
      this.#sync();
    }
  }

  #attach() {
    const picker = this.context.window.gZenThemePicker;
    if (this.#picker || !picker?.panel) {
      return;
    }
    this.#picker = picker;
    picker.panel.setAttribute(ATTR_ROOT, "true");

    this.#claimCustomColorsPref();
    this.#loadState();
    this.#build();
    this.#addTooltips();
    this.#wrap();
    this.#observe();
    this.#sync();

    // Zen has already painted this space once, before any of the wraps above
    // existed, so a saved angle or lightness would not show until something
    // else asked for a repaint. One is asked for here instead — `skipSave`
    // defaults to true, so this writes nothing and notifies nothing.
    this.#repaint();
    TranceLog.log(NS, "attached to the gradient picker");
  }

  onDisable() {
    // First: a repaint armed for the next frame holds Zen's *unwrapped* method
    // in its closure, and running it after the undo steps below would repaint
    // through a picker that is half restored.
    this.#cancelRepaint();

    for (const undo of this.#undo.splice(0).reverse()) {
      try {
        undo();
      } catch (error) {
        TranceLog.error(NS, "undo step threw", error);
      }
    }
    for (const node of Object.values(this.#nodes)) {
      node?.remove();
    }
    this.#nodes = {};
    this.#savedSignature = null;
    this.#savedKeys = new Set();
    this.#picker?.panel.removeAttribute(ATTR_ROOT);
    this.#releaseCustomColorsPref();

    // Zen's own render is still correct without Trance; asking for one puts the
    // unrotated, unlightened gradient back without waiting for a click.
    try {
      this.#picker?.updateCurrentWorkspace();
    } catch (error) {
      TranceLog.error(NS, "could not repaint after disable", error);
    }
    this.#picker = null;
  }

  // --- Zen's pref for the custom-colour list ---------------------------------

  /**
   * Zen hides its custom-colour list behind a pref that is off by default, and
   * the list is the only way to *remove* an exact colour once it is added. Hex
   * entry without it would be one-way, so Trance claims the pref while it is
   * enabled and gives the user's value back on disable — the same arrangement
   * `TranceChrome` has with the macOS context-menu pref (ADR-011, ADR-020).
   */
  #claimCustomColorsPref() {
    if (this.#previousCustomColors !== null) {
      return;
    }
    const current = Services.prefs.getBoolPref(PREF_ZEN_CUSTOM_COLORS, false);
    this.#previousCustomColors = current;
    if (!current) {
      Services.prefs.setBoolPref(PREF_ZEN_CUSTOM_COLORS, true);
    }
  }

  #releaseCustomColorsPref() {
    if (this.#previousCustomColors === null) {
      return;
    }
    Services.prefs.setBoolPref(
      PREF_ZEN_CUSTOM_COLORS,
      this.#previousCustomColors
    );
    this.#previousCustomColors = null;
  }

  // --- Zen's translucency slider ---------------------------------------------

  /**
   * Gives the translucency slider its whole range back.
   *
   * Zen pins the ends at 0.25 and 0.9 (0.30 on macOS), so the slider can never
   * say "no tint" and can never say "solid" — the two answers people most often
   * want from it. The numbers are only the slider's ends: `currentOpacity` is
   * the alpha of the background colour and every consumer of it already handles
   * 0 and 1, which is what the default theme (no tint at all) and an opaque
   * custom colour already produce by other routes.
   *
   * ── Why this runs from `onEnable`, before there is a picker to attach to ──
   *
   * Zen does not read the ends off the element when it needs them. It reads
   * them *once*, through two `ChromeUtils.defineLazyGetter`s on a module-local
   * object that no one outside `ZenGradientGenerator.mjs` can reach, and every
   * later use — the wave that fills behind the thumb, the thumb's own size, the
   * blend on macOS and Mica — is computed against that first reading.
   *
   * Widening the element after the first read therefore moves the thumb without
   * moving anything that was scaled to the old ends: at 0.5 the thumb sits at
   * the middle of the track and the wave fills to 38% of it. That is the
   * "the fill moves differently to the knob" bug, and it is a *timing* bug, not
   * a drawing one.
   *
   * The read happens inside `gZenThemePicker`'s own first repaint, so widening
   * before that object exists makes the cached ends 0 and 1 and every one of
   * Zen's own calculations correct again. `onEnable` runs at
   * `MozBeforeInitialXULLayout`, which is after the whole panel is parsed and
   * long before session restore constructs the picker, so the element is there
   * and the getters are not yet resolved.
   *
   * If the picker already exists, this is a mid-session pref flip and the ends
   * are already cached: widening now would produce exactly the mismatch above,
   * so it is skipped and the next window Trance opens gets the wide slider.
   *
   * The attributes are restored on disable, like every other borrowed thing
   * here, so a Trance-less panel is stock Zen's again.
   */
  #widenOpacitySlider() {
    const slider = this.context.document.getElementById(
      "PanelUI-zen-gradient-generator-opacity"
    );
    if (!slider) {
      return;
    }
    if (this.context.window.gZenThemePicker && !this.#widenedRange) {
      TranceLog.log(
        NS,
        "the picker already cached the translucency range; leaving it alone"
      );
      return;
    }
    const min = slider.getAttribute("min");
    const max = slider.getAttribute("max");
    slider.setAttribute("min", "0");
    slider.setAttribute("max", "1");
    this.#widenedRange = true;
    this.#undo.push(() => {
      slider.setAttribute("min", min);
      slider.setAttribute("max", max);
    });
  }

  // --- Zen's unlabelled buttons ----------------------------------------------

  /**
   * Names the buttons that have no name.
   *
   * Only the empty ones: a `tooltiptext` Zen already set, or one a locale
   * supplied through Fluent, is left exactly as it is — this fills gaps, it
   * does not overrule anyone. Everything it sets is removed on disable, and
   * nothing it sets is read by anything but the tooltip.
   */
  #addTooltips() {
    const doc = this.context.document;
    for (const [id, text] of Object.entries(ZEN_TOOLTIPS)) {
      const node = doc.getElementById(id);
      if (!node || node.getAttribute("tooltiptext") || node.title) {
        continue;
      }
      // XUL reads `tooltiptext`, HTML reads `title`, and this panel has both
      // kinds of element in the same row.
      const attribute = node.namespaceURI?.includes("xhtml")
        ? "title"
        : "tooltiptext";
      node.setAttribute(attribute, text);
      this.#undo.push(() => node.removeAttribute(attribute));
    }
  }

  // --- Method wraps ----------------------------------------------------------

  #wrap() {
    this.#wrapColorFromPosition();
    this.#wrapGradient();
    this.#wrapGradientForWorkspace();
    this.#wrapWorkspaceChange();
    this.#wrapUpdateCurrentWorkspace();
    this.#wrapGetTheme();
  }

  /**
   * Swaps one own-property method on the picker and registers its restoration.
   *
   * Own properties, not the prototype: another window's picker is a different
   * instance of the same class, and patching the prototype would reach into
   * windows where Trance may be disabled.
   *
   * @param {string} methodName
   * @param {(original: Function) => Function} make
   */
  #patch(methodName, make) {
    const picker = this.#picker;
    const original = picker[methodName].bind(picker);
    picker[methodName] = make(original);
    this.#undo.push(() => delete picker[methodName]);
  }

  /**
   * Lightness and palette.
   *
   * Zen derives both hue and lightness from where the dot is: the angle around
   * the wheel is the hue, and the distance from the centre is the lightness.
   * That is a defensible design and it is exactly why the mod this replaces
   * exists — it means there is no way to say "this hue, but darker" without
   * moving the dot somewhere it no longer means the hue you wanted.
   *
   * So while a lightness is set, Trance owns lightness and the wheel is hue and
   * saturation only. That is a real behaviour change, it is the point of the
   * control, and "Full colour" hands it straight back.
   *
   * The greyscale preset page is left alone: its dots encode lightness as
   * position deliberately, and forcing a lightness onto them would collapse the
   * whole page to one colour.
   */
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
    const palette = this.#palette;
    const lightness = this.#state.lightness ?? palette.lightness;
    if (palette.saturation === null && lightness === null) {
      return rgb;
    }
    const picker = this.#picker;
    /* eslint-disable no-unused-vars */
    const [hue, saturation, currentLightness] = picker.rgbToHsl(...rgb);
    const nextSaturation =
      palette.saturation === null ? saturation : palette.saturation / 100;
    const nextLightness =
      lightness === null ? currentLightness : lightness / 100;
    const next = picker.hslToRgb(hue / 360, nextSaturation, nextLightness);
    return next.map(channel => Math.min(255, Math.max(0, channel)));
  }

  /**
   * The gradient angle.
   *
   * Zen hard-codes `const rotation = -45` and builds every gradient string
   * around it, with a `TODO: Detect rotation based on the accent color` next to
   * it. Rather than reimplement `getGradient` — which would mean owning three
   * layout cases and every future one — Trance rotates the CSS it produced:
   * each `linear-gradient()` angle moves by the same delta, and each
   * `radial-gradient(circle at x% y%)` centre rotates about the middle of the
   * box by the same delta. Both use clockwise-positive degrees (CSS angles
   * increase clockwise; screen coordinates have y pointing down, which makes
   * the standard rotation matrix clockwise too), so one delta drives both.
   *
   * A single flat colour has no angle, which is why the knob is inert until the
   * theme is actually a gradient.
   */
  #wrapGradient() {
    this.#patch(
      "getGradient",
      original =>
        (colors, forToolbar = false) =>
          this.#rotate(original(colors, forToolbar))
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

  /**
   * Reloads Trance's state when a theme arrives that Trance did not write.
   *
   * A space change is the obvious case, but not the only one: a saved theme
   * applied to the current space, a session restore, or another window changing
   * this space's theme all hand this method a theme whose Trance fields are not
   * the ones in `#state`, with the same uuid as before. Keying only on the uuid
   * meant the controls kept the previous space's angle and the gradient was
   * drawn with it.
   *
   * This cannot loop. Every theme Trance itself causes has been through
   * `getTheme`, which stamps `#state` into it, so its fields match by
   * construction and nothing is reloaded.
   */
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

  /**
   * One repaint per frame, and the two live controls with it.
   *
   * `updateCurrentWorkspace` is the picker's whole repaint: it reads every dot,
   * builds a theme, rebuilds the custom-colour list, recomputes two gradient
   * strings and writes them, the accent, the text colour and the scheme into
   * every window showing this space. Zen calls it straight out of the
   * `mousemove` handler on a dot drag — once per event, not once per frame.
   *
   * A mouse reporting at 125Hz therefore asks for twice the work a 60Hz display
   * can show, and the gaming mice people actually own report at 500Hz or
   * 1000Hz: sixteen full repaints per frame, fifteen of which are overwritten
   * before anything is painted. That is the lag — it is not that any one step
   * is slow, it is that all of them run an order of magnitude more often than
   * the screen can use.
   *
   * So a repaint that is not saving anything is coalesced onto the next
   * animation frame through `TranceScheduler` — the one rAF loop this project
   * allows, already suspended when the window is not visible (TRANCE.md §3.6).
   * The result on screen is identical, because every dropped call was going to
   * be overwritten by the next one anyway.
   *
   * A *saving* repaint is never deferred: it is the end of a gesture, its
   * result is what gets written to the session store, and it supersedes
   * anything queued. `updated` is still set the moment the deferred call is
   * queued rather than when it runs, so a panel closed mid-gesture still saves.
   */
  #wrapUpdateCurrentWorkspace() {
    this.#patch("updateCurrentWorkspace", original => (skipSave = true) => {
      if (!skipSave) {
        this.#cancelRepaint();
        const result = original(false);
        this.#syncLive();
        return result;
      }

      this.#picker.updated = true;
      if (this.#repaintHandle) {
        return undefined;
      }
      this.#repaintHandle = this.context.scheduler.onFrame(
        () => {
          this.#repaintHandle = 0;
          original(true);
          this.#syncLive();
        },
        { once: true }
      );
      return undefined;
    });
  }

  #cancelRepaint() {
    if (this.#repaintHandle) {
      this.context.scheduler.cancel(this.#repaintHandle);
      this.#repaintHandle = 0;
    }
  }

  /**
   * The one seam every theme passes through.
   *
   * `updateCurrentWorkspace` builds the object that gets saved by calling this,
   * so stamping here is the only place that catches every write — including the
   * ones Trance did not initiate, like a drag of one of Zen's own dots.
   *
   * The class object is per-window: `ZenSpaceManager.mjs` is imported with
   * `global: "current"`, so its import of `ZenGradientGenerator.mjs` resolves
   * into this window's global and no other window sees this patch.
   */
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

  // --- State -----------------------------------------------------------------

  get #palette() {
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

    const lightness = Number(source?.tranceLightness);
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

  /** The active theme's colours, or an empty array. */
  get #colors() {
    return this.#activeWorkspace()?.theme?.gradientColors ?? [];
  }

  /** Whether the current theme is a gradient rather than one flat colour. */
  get #isGradient() {
    return this.#colors.length > 1;
  }

  /** Writes `#state` through Zen's own save path. */
  #commit() {
    this.#picker.updateCurrentWorkspace(false);
  }

  // --- DOM -------------------------------------------------------------------

  #build() {
    const doc = this.context.document;
    const panel = this.#picker.panel;

    this.#buildToast(doc, panel);
    this.#buildActions(doc, panel);
    this.#buildSavedPage(doc, panel);
    this.#buildControls(doc, panel);
    this.#buildHexRow(doc, panel);
  }

  /**
   * The in-panel notification.
   *
   * Not `gZenUIManager.showToast`: that takes a Fluent id, and Trance has no
   * .ftl of its own yet (see the head of `tranceSettings.inc.xhtml`). It also
   * puts the message at the bottom of the window, three hundred pixels from
   * the button that caused it.
   *
   * It carries no timer. The whole life of the message is one Web Animation
   * through `TranceMotion`, which means it is also automatically nothing at
   * motion level 0 — where `animate()` returns null and the message simply
   * stays until the next one replaces it or the panel closes.
   *
   * A `span`, and that is load-bearing. Zen's colour dots are `div`s appended to
   * this same container, and the only rule that makes the primary one clickable
   * is `.zen-theme-picker-dot:first-of-type { pointer-events: all }`. Every
   * theme change removes all the dots and appends them again, so a Trance `div`
   * sitting in the container would become the first `div` and quietly take that
   * rule with it — the dot then stops receiving `mousedown`, dragging does
   * nothing, and the click handler alone moves the dot when the button comes
   * back up. `:first-of-type` matches by tag, so a `span` is invisible to it.
   *
   * @param {Document} doc
   * @param {Element} panel
   */
  #buildToast(doc, panel) {
    const toast = doc.createElement("span");
    toast.className = "trance-theme-toast";
    panel.querySelector(".zen-theme-picker-gradient").appendChild(toast);
    this.#nodes.toast = toast;
  }

  /**
   * How long a notification lives, from `--trance-toast-life`.
   *
   * Read from the token rather than declared here so the token layer stays the
   * one owner of every Trance duration — including the ones spent by a Web
   * Animation instead of by a CSS transition (TRANCE.md §6.2 rule 3).
   *
   * @returns {number} Milliseconds.
   */
  get #toastLife() {
    const raw = this.context.window
      .getComputedStyle(this.context.document.documentElement)
      .getPropertyValue("--trance-toast-life");
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2200;
  }

  /**
   * @param {string} message
   */
  #notify(message) {
    const toast = this.#nodes.toast;
    if (!toast || !Services.prefs.getBoolPref(PREF_NOTIFICATIONS, true)) {
      return;
    }
    toast.textContent = message;
    toast.setAttribute("visible", "true");
    for (const animation of toast.getAnimations()) {
      animation.cancel();
    }
    const animation = this.context.motion.animate(
      toast,
      [
        { opacity: 0, transform: "translateY(-6px)" },
        { opacity: 1, transform: "none", offset: 0.12 },
        { opacity: 1, transform: "none", offset: 0.78 },
        { opacity: 0, transform: "translateY(-6px)" },
      ],
      {
        duration: this.#toastLife,
        easing: "ease",
        willChange: "opacity, transform",
      }
    );
    animation?.finished.then(
      () => toast.removeAttribute("visible"),
      () => {}
    );
  }

  /**
   * The palette and heart buttons.
   *
   * They join Zen's own row of picker actions so the four read as one control
   * group, and they are `toolbarbutton`s rather than `button`s for a reason
   * that is not cosmetic: `onWorkspaceChange` disables every
   * `#…-color-actions button` whenever the space has no colours, and a heart
   * that cannot be clicked on a default theme is right for saving but wrong for
   * the palette switch, which is how you *stop* having a default theme.
   *
   * @param {Document} doc
   * @param {Element} panel
   */
  #buildActions(doc, panel) {
    const actions = panel.querySelector(
      "#PanelUI-zen-gradient-generator-color-actions"
    );
    if (!actions) {
      return;
    }

    if (Services.prefs.getBoolPref(PREF_PALETTES, true)) {
      const palette = doc.createXULElement("toolbarbutton");
      palette.className = "trance-theme-action trance-theme-palette";
      palette.setAttribute("tooltiptext", "Switch palette");
      this.addListener(palette, "click", event => {
        event.preventDefault();
        event.stopPropagation();
        this.#cyclePalette();
      });
      actions.appendChild(palette);
      this.#nodes.palette = palette;
    }

    if (Services.prefs.getBoolPref(PREF_SAVED, true)) {
      const heart = doc.createXULElement("toolbarbutton");
      heart.className = "trance-theme-action trance-theme-heart";
      heart.setAttribute("tooltiptext", "Save this theme");
      this.addListener(heart, "click", event => {
        event.preventDefault();
        event.stopPropagation();
        this.#toggleSaved();
      });
      actions.appendChild(heart);
      this.#nodes.heart = heart;
    }
  }

  /**
   * The lightness slider and the angle knob.
   *
   * One row under Zen's own, so the two sliders stack on the left and the two
   * knobs stack on the right: translucency and grain are Zen's, lightness and
   * angle are Trance's, and nothing was moved to achieve it.
   *
   * @param {Document} doc
   * @param {Element} panel
   */
  #buildControls(doc, panel) {
    const wantLightness = Services.prefs.getBoolPref(PREF_LIGHTNESS, true);
    const wantAngle = Services.prefs.getBoolPref(PREF_ANGLE, true);
    if (!wantLightness && !wantAngle) {
      return;
    }

    const row = doc.createElement("div");
    row.className = "trance-theme-row";

    if (wantLightness) {
      const wrapper = doc.createElement("div");
      wrapper.className = "trance-theme-slider-wrapper";
      this.#nodes.sliderWrapper = wrapper;
      const slider = doc.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.step = "1";
      slider.className = "trance-theme-slider";
      slider.setAttribute("aria-label", "Lightness");
      slider.title = "Lightness — how dark or pale the colours are";
      this.addListener(slider, "input", () => {
        this.#state.lightness = Number(slider.value);
        slider.removeAttribute("auto");
        this.#recolourDots();
        this.#repaint();
      });
      this.addListener(slider, "change", () => this.#commit());
      wrapper.appendChild(slider);
      row.appendChild(wrapper);
      this.#nodes.slider = slider;
    }

    if (wantAngle) {
      row.appendChild(this.#buildKnob(doc));
    }

    const controls = panel.querySelector(
      "#PanelUI-zen-gradient-generator-controls"
    );
    if (!controls) {
      return;
    }
    controls.after(row);
    this.#nodes.row = row;
  }

  /**
   * The angle knob: a continuous ring, a handle that follows the pointer, and
   * the angle itself in the middle.
   *
   * An angle is a number, and the knob says the number. The alternative — a
   * swatch of the gradient inside the ring — was a second, smaller, rotated
   * copy of the thing the panel is already showing full-size behind it, which
   * is decoration where a readout belongs. Detent dots went with it: they
   * quantised the value to twenty-four positions for no reason other than that
   * Zen's grain knob has sixteen, and a gradient angle has no detents.
   *
   * It is keyboard-reachable, which Zen's is not — a knob that can only be
   * dragged is a control some people cannot use at all. Arrow keys still move
   * in `ANGLE_STEP` degrees, because a key press has to be worth something.
   *
   * @param {Document} doc
   * @returns {Element}
   */
  #buildKnob(doc) {
    const knob = doc.createElement("div");
    knob.className = "trance-theme-knob";
    knob.tabIndex = 0;
    knob.setAttribute("role", "slider");
    knob.setAttribute("aria-label", "Gradient angle");
    knob.title = "Gradient angle — drag to turn, or use the arrow keys";

    const value = doc.createElement("span");
    value.className = "trance-theme-knob-value";
    knob.appendChild(value);

    const handle = doc.createElement("div");
    handle.className = "trance-theme-knob-handle";
    knob.appendChild(handle);

    this.addListener(knob, "mousedown", event => this.#onKnobDown(event));
    this.addListener(knob, "keydown", event => this.#onKnobKey(event));

    this.#nodes.knob = knob;
    this.#nodes.knobHandle = handle;
    this.#nodes.knobValue = value;
    return knob;
  }

  /**
   * Exact colours.
   *
   * Zen already has an add-a-colour row, and it already does the right thing
   * with what it is given — it is the only path in the picker that uses a
   * colour *verbatim* rather than deriving one from a position, which is
   * precisely what "import this hex code" means. What it does not have is
   * anywhere to type a hex code: it has an `<input type="color">`, which opens
   * the platform picker.
   *
   * So Trance adds the text field and reuses everything else. Neither of Zen's
   * two inputs is moved and neither is shown; both stay in the row this feature
   * hides, holding the values `addCustomColor` reads:
   *
   *   - the swatch is an `<input type="color">`, so clicking it opens the
   *     *operating system's* colour picker — a second, differently-shaped,
   *     modal colour picker launched from inside a colour picker;
   *   - the opacity spinner is an `<input type="number">`, which draws as a
   *     native stepper that belongs to no part of this panel's visual language,
   *     and it is a second owner for a number the hex field already carries.
   *     `#RRGGBBAA` is eight characters in the field that is already there.
   *
   * What each is genuinely good at is holding a value, and a hidden input holds
   * one just as well as a visible one.
   *
   * @param {Document} doc
   * @param {Element} panel
   */
  #buildHexRow(doc, panel) {
    if (!Services.prefs.getBoolPref(PREF_HEX, true)) {
      return;
    }
    const zenRow = panel.querySelector("#zen-theme-picker-color");
    const swatch = panel.querySelector(
      "#PanelUI-zen-gradient-generator-custom-input"
    );
    if (!zenRow || !swatch) {
      return;
    }

    const row = doc.createElement("div");
    row.className = "trance-theme-hex-row";

    const input = doc.createElement("input");
    input.type = "text";
    input.className = "trance-theme-hex-input";
    input.placeholder = "#RRGGBB or #RRGGBBAA";
    input.setAttribute("aria-label", "Exact colour");
    input.setAttribute("spellcheck", "false");
    input.title =
      "A hex colour, used exactly as typed — eight digits sets its opacity. Press Enter to add it";
    this.addListener(input, "keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.#addHex(input);
      }
    });
    this.addListener(input, "input", () => input.removeAttribute("invalid"));
    row.appendChild(input);

    const add = doc.createXULElement("toolbarbutton");
    add.className = "trance-theme-action trance-theme-hex-add";
    add.setAttribute("tooltiptext", "Add this colour");
    this.addListener(add, "click", event => {
      event.preventDefault();
      event.stopPropagation();
      this.#addHex(input);
    });

    row.appendChild(add);

    zenRow.after(row);
    this.#nodes.hexRow = row;
    this.#nodes.hexInput = input;
  }

  /**
   * The saved-themes page.
   *
   * Zen's pager is a scroll container whose pages are its children and whose
   * current index is private, so Trance cannot prepend a page and then tell Zen
   * that the index moved. It does not have to: after prepending, one synthetic
   * command on the right arrow walks Zen's own handler forward by exactly one
   * page, which lands on the page that used to be first, enables the left arrow
   * and leaves the index and the scroll position agreeing with each other.
   *
   * That is the requirement — saved themes at the start, opening on the
   * original first page, with the arrows working in both directions — expressed
   * as one click rather than as a reimplementation of the pager.
   *
   * @param {Document} doc
   * @param {Element} panel
   */
  #buildSavedPage(doc, panel) {
    if (!Services.prefs.getBoolPref(PREF_SAVED, true)) {
      return;
    }
    const pages = panel.querySelector(
      "#PanelUI-zen-gradient-generator-color-pages"
    );
    const right = panel.querySelector(
      "#PanelUI-zen-gradient-generator-color-page-right"
    );
    if (!pages || !right) {
      return;
    }

    const page = doc.createXULElement("hbox");
    page.className = "trance-theme-saved-page";

    pages.prepend(page);
    this.#nodes.savedPage = page;

    // `getAttribute`, not `dataset`: these are XUL boxes, matching the ones Zen
    // fills the other five pages with, and `dataset` is an HTML interface.
    this.addListener(page, "click", event => {
      const swatch = event.target.closest(".trance-theme-saved-swatch");
      if (!swatch) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.#applySaved(Number(swatch.getAttribute("data-index")));
    });
    this.addListener(page, "contextmenu", event => {
      const swatch = event.target.closest(".trance-theme-saved-swatch");
      if (!swatch) {
        return;
      }
      event.preventDefault();
      this.#forget(Number(swatch.getAttribute("data-index")));
    });

    right.dispatchEvent(new this.context.window.Event("command"));
    this.#undo.push(() => {
      // Walking back is the same trick in reverse, so Zen's private index and
      // the page it is showing agree again once the extra page is gone.
      const left = panel.querySelector(
        "#PanelUI-zen-gradient-generator-color-page-left"
      );
      left?.dispatchEvent(new this.context.window.Event("command"));
    });
  }

  // --- The angle knob --------------------------------------------------------

  #onKnobDown(event) {
    if (event.button !== 0 || !this.#isGradient) {
      return;
    }
    event.preventDefault();
    const doc = this.context.document;
    const move = moveEvent => this.#onKnobMove(moveEvent);
    const up = () => {
      doc.removeEventListener("mousemove", move);
      doc.removeEventListener("mouseup", up);
      this.#commit();
    };
    doc.addEventListener("mousemove", move);
    doc.addEventListener("mouseup", up);
    this.#onKnobMove(event);
  }

  #onKnobMove(event) {
    const knob = this.#nodes.knob;
    const rect = this.context.window.windowUtils.getBoundsWithoutFlushing(knob);
    const radians = Math.atan2(
      event.clientY - rect.top - rect.height / 2,
      event.clientX - rect.left - rect.width / 2
    );
    // atan2 measures from the +x axis; a gradient angle measures from "up".
    const degrees = (radians * 180) / Math.PI + 90;
    this.#setAngle(degrees);
  }

  #onKnobKey(event) {
    const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[
      event.key
    ];
    if (!delta || !this.#isGradient) {
      return;
    }
    event.preventDefault();
    this.#setAngle(this.#state.angle + delta * ANGLE_STEP);
    this.#commit();
  }

  #setAngle(degrees) {
    const next = ((Math.round(degrees) % 360) + 360) % 360;
    const previous = this.#state.angle;
    if (next === previous) {
      return;
    }
    this.#state.angle = next;
    // The knob turns freely, so haptics are on the multiples of ANGLE_STEP
    // rather than on every degree — a tick per pixel is not feedback, it is a
    // buzz. Zen's grain knob does the same on its own sixteen positions.
    /* eslint-disable mozilla/valid-services */
    if (Math.round(next / ANGLE_STEP) !== Math.round(previous / ANGLE_STEP)) {
      Services.zen.playHapticFeedback();
    }
    this.#repaint();
  }

  // --- The palette and the heart ---------------------------------------------

  #cyclePalette() {
    const index = PALETTES.findIndex(entry => entry.id === this.#state.palette);
    const next = PALETTES[(index + 1) % PALETTES.length];
    this.#state.palette = next.id;
    // A palette *is* a slider configuration, so selecting one moves the
    // sliders. Its own lightness takes over from whatever the slider held, and
    // "Full colour" hands lightness back to Zen's distance-from-centre rule.
    this.#state.lightness = next.lightness;
    if (next.opacity !== null) {
      this.#picker.currentOpacity = next.opacity;
    }
    this.#recolourDots();
    this.#notify(`${next.label} — ${next.hint}`);
    this.#commit();
  }

  /**
   * The saved list, or an empty one.
   *
   * The pref's default is the empty string rather than `"[]"` — ffprefs emits
   * an unquoted `[]`, which is not JavaScript — so "no saved themes" arrives
   * here as `""` and is not a parse failure worth warning about.
   *
   * @returns {object[]}
   */
  #savedThemes() {
    const raw = Services.prefs.getStringPref(PREF_SAVED_THEMES, "");
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      TranceLog.warn(NS, "saved themes are not valid JSON; starting over");
      return [];
    }
  }

  #writeSavedThemes(themes) {
    Services.prefs.setStringPref(
      PREF_SAVED_THEMES,
      JSON.stringify(themes.slice(-MAX_SAVED))
    );
  }

  /**
   * Identity for a theme, so the heart can know whether *this* one is saved.
   *
   * Colours, translucency, grain and Trance's three fields — everything that
   * makes a theme look the way it looks, and nothing that does not.
   *
   * @param {object} theme
   * @returns {string}
   */
  #key(theme) {
    return JSON.stringify([
      (theme?.gradientColors ?? []).map(color => [color.c, color.isCustom]),
      theme?.opacity ?? null,
      theme?.texture ?? null,
      theme?.tranceLightness ?? null,
      theme?.tranceAngle ?? 0,
      theme?.trancePalette ?? "full",
    ]);
  }

  #toggleSaved() {
    const theme = this.#activeWorkspace()?.theme;
    if (!theme?.gradientColors?.length) {
      this.#notify("Nothing to save yet — pick a colour first");
      return;
    }
    const themes = this.#savedThemes();
    const key = this.#key(theme);
    const index = themes.findIndex(entry => this.#key(entry) === key);
    if (index === -1) {
      themes.push(JSON.parse(JSON.stringify(theme)));
      this.#writeSavedThemes(themes);
      this.#notify("Saved to the first page");
    } else {
      themes.splice(index, 1);
      this.#writeSavedThemes(themes);
      this.#notify("Removed from saved themes");
    }
    this.#sync();
  }

  /**
   * Forgets one saved theme, after asking.
   *
   * ── Why this one asks and the heart does not ──────────────────────────────
   *
   * The heart also removes a saved theme, and it deliberately has no
   * confirmation: it only ever un-saves the theme the space is *currently*
   * wearing, so undoing it is pressing the heart again. This is the other case
   * — a right-click on some other swatch, removing a set of colours that exists
   * nowhere else in the profile, from a control whose whole gesture is one
   * click on a target the size of a thumbnail. It is the only unrecoverable
   * action either half of the theme feature offers, and a right-click is
   * exactly the gesture people make by accident on a small target.
   *
   * `Services.prompt.confirmEx`, not a panel of Trance's own: this is a chrome
   * window, the question is modal by nature, and reimplementing a modal inside
   * a XUL `<panel>` that Zen may close underneath it is a way to lose the
   * answer. The settings page's own dialog is an in-page `<html:dialog>` for
   * the opposite reason — see `gTranceSettings.confirm`.
   *
   * @param {number} index
   */
  #forget(index) {
    const themes = this.#savedThemes();
    if (index < 0 || index >= themes.length) {
      return;
    }
    if (!this.#confirmForget()) {
      return;
    }
    themes.splice(index, 1);
    this.#writeSavedThemes(themes);
    this.#notify("Removed from saved themes");
    this.#sync();
  }

  /**
   * @returns {boolean} Whether the user said yes.
   */
  #confirmForget() {
    const prompts = Services.prompt;
    const flags =
      prompts.BUTTON_TITLE_IS_STRING * prompts.BUTTON_POS_0 +
      prompts.BUTTON_TITLE_CANCEL * prompts.BUTTON_POS_1;
    const chosen = prompts.confirmEx(
      this.context.window,
      "Forget this saved theme?",
      "Its colours are not stored anywhere else, so this cannot be undone.",
      flags,
      "Forget",
      null,
      null,
      null,
      {}
    );
    return chosen === 0;
  }

  /**
   * Applies a saved theme by handing it to Zen's own load path.
   *
   * Not by recreating the dots: `recalculateDots` drops exact colours on the
   * floor (its custom branch builds a node and never appends it), and
   * `onWorkspaceChange` is the path that rebuilds *everything* — dots, the
   * custom list, the sliders and the paint — from a theme object. Writing the
   * theme and asking for that is both shorter and the same code a space switch
   * runs.
   *
   * @param {number} index
   */
  #applySaved(index) {
    const themes = this.#savedThemes();
    const saved = themes[index];
    const workspace = this.#activeWorkspace();
    if (!saved || !workspace) {
      return;
    }
    this.#loadState(saved, workspace.uuid);
    workspace.theme = JSON.parse(JSON.stringify(saved));
    this.context.window.gZenWorkspaces.saveWorkspace(workspace);
    this.#picker.onWorkspaceChange(workspace);
    this.#notify("Saved theme applied");
    this.#sync();
  }

  // --- Exact colours ---------------------------------------------------------

  /**
   * @param {HTMLInputElement} input
   */
  #addHex(input) {
    const raw = input.value.trim();
    if (!HEX_PATTERN.test(raw)) {
      input.setAttribute("invalid", "true");
      this.#notify(`Not a colour: ${raw || "(empty)"}`);
      return;
    }
    let hex = raw.startsWith("#") ? raw.slice(1) : raw;
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map(character => character + character)
        .join("");
    }
    const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
    const color = `#${hex.slice(0, 6).toUpperCase()}`;

    // Zen's own inputs, which Zen's own `addCustomColor` reads. Alpha goes
    // through its opacity field rather than being folded into the string here,
    // because that field is what the number is *for*.
    const swatch = this.context.document.getElementById(
      "PanelUI-zen-gradient-generator-custom-input"
    );
    const opacity = this.context.document.getElementById(
      "PanelUI-zen-gradient-generator-custom-opacity"
    );
    swatch.value = color;
    if (opacity) {
      opacity.value = String(Math.round(alpha * 100) / 100);
    }
    this.#picker.addCustomColor();
    input.value = "";
    this.#notify(`Added ${color}`);
  }

  // --- Syncing ---------------------------------------------------------------

  #observe() {
    // The panel is the only reason any of the controls need to be right, so
    // opening it is when they are made right. See `#sync`.
    this.addListener(this.#picker.panel, "popupshowing", () => this.#sync());

    // Zen cycles the harmony silently: three dots move and nothing says which
    // harmony they moved into. The listener runs before Zen's, which is on an
    // ancestor, so the name is read in a microtask — after the whole dispatch,
    // and therefore after `useAlgo` has changed.
    const algo = this.context.document.getElementById(
      "PanelUI-zen-gradient-generator-color-toggle-algo"
    );
    if (algo) {
      this.addListener(algo, "click", () => {
        Promise.resolve().then(() => {
          const label = HARMONY_LABELS[this.#picker.useAlgo];
          if (label) {
            this.#notify(label);
          }
        });
      });
    }

    // Zen's grain knob only starts a drag when the press lands on the handle,
    // which is six pixels wide inside a five-rem control — you have to hit the
    // needle to turn the dial. The wrapper gets what the angle knob next to it
    // already has: press anywhere in the circle and the knob is yours.
    //
    // A press that *does* land on the handle is left to Zen's own listener.
    // Running both would register the document-level move listener twice while
    // only one of them can ever be removed.
    const texture = this.context.document.getElementById(
      "PanelUI-zen-gradient-generator-texture-wrapper"
    );
    if (texture) {
      this.addListener(texture, "mousedown", event => {
        if (
          event.button !== 0 ||
          event.target === this.#picker._textureHandler
        ) {
          return;
        }
        this.#picker.onTextureHandlerMouseDown(event);
        this.#picker.onTextureMouseMove(event);
      });
    }

    for (const pref of [PREF_SAVED_THEMES, PREF_NOTIFICATIONS]) {
      const prefObserver = { observe: () => this.#sync() };
      Services.prefs.addObserver(pref, prefObserver);
      this.addDisposer(() => Services.prefs.removeObserver(pref, prefObserver));
    }
  }

  /** Repaints without saving, which is what a drag wants. */
  #repaint() {
    this.#picker.updateCurrentWorkspace();
  }

  /**
   * Asks every dot for its colour again, without moving it.
   *
   * `updateCurrentWorkspace` does not derive colours: it *reads* the colour
   * each dot is already painted with and builds a theme out of those. Zen only
   * ever writes those colours from `getColorFromPosition`, and only when a dot
   * moves — which is fine upstream, because upstream nothing but a move can
   * change what that function returns.
   *
   * Lightness and palette are exactly that: they change the answer for a
   * position that has not moved. Without this, they reached the gradient only
   * on the next click on the wheel, so both controls looked broken until you
   * touched something else. This asks the same question again for the positions
   * the dots already hold, which is the smallest thing that can be true.
   *
   * Custom colours are verbatim by definition and are not in `dots` at all.
   */
  #recolourDots() {
    for (const dot of this.#picker.dots ?? []) {
      const position = dot.position;
      if (!dot.element || !position) {
        continue;
      }
      const [red, green, blue] = this.#picker.getColorFromPosition(
        position.x,
        position.y,
        dot.type
      );
      dot.element.style.setProperty(
        "--zen-theme-picker-dot-color",
        `rgb(${red}, ${green}, ${blue})`
      );
    }
  }

  /** Whether the picker panel is actually on screen. */
  get #isPanelOpen() {
    const state = this.#picker?.panel?.state;
    return state === "open" || state === "showing";
  }

  /** Pulls every Trance control back into agreement with the current theme. */
  #sync() {
    if (!this.#picker) {
      return;
    }
    const isGradient = this.#isGradient;
    const savedChanged = this.#refreshSavedKeys();

    if (this.#nodes.slider) {
      // Auto shows the lightness Zen last derived, so the control starts where
      // the theme already is rather than snapping it somewhere on first touch.
      const shown =
        this.#state.lightness ??
        this.#palette.lightness ??
        Number(this.#colors[0]?.lightness ?? 50);
      this.#nodes.slider.value = String(Math.round(shown));
      this.#nodes.slider.toggleAttribute(
        "auto",
        this.#state.lightness === null
      );
      this.#syncLightnessTrack();
    }

    if (this.#nodes.palette) {
      const palette = this.#palette;
      this.#nodes.palette.setAttribute(
        "tooltiptext",
        `Palette: ${palette.label}`
      );
      this.#nodes.palette.setAttribute("data-palette", palette.id);
    }

    this.#syncLive(isGradient, true);
    if (savedChanged) {
      this.#renderSavedPage();
    }
  }

  /**
   * The lightness slider's track, held still.
   *
   * The track used to be a token derived from `--trance-accent`, which is
   * `--zen-primary-color`, which is the colour this slider changes. So dragging
   * toward dark darkened the accent, which darkened the ramp, which moved the
   * ramp out from under the thumb — the gradient was a picture of the answer
   * rather than of the question, and it slid away as you asked.
   *
   * Here it is built once from the theme's *hue and saturation*, at three fixed
   * lightnesses, so it says "dark on the left, pale on the right, in this
   * colour" and goes on saying it for the whole gesture. It is written from
   * `#sync` only — the panel opening, a committed change, a space switch — and
   * never from `#syncLive`, which is the path that runs on every frame of a
   * drag.
   *
   * Zen's own `rgbToHsl`/`hslToRgb` do the conversion, because a second colour
   * space implementation in this file would be a second owner for the numbers
   * the picker already agrees on.
   */
  #syncLightnessTrack() {
    const wrapper = this.#nodes.sliderWrapper;
    const base = this.#colors.find(color => !color.isCustom)?.c;
    if (!wrapper) {
      return;
    }
    if (!Array.isArray(base) || base.length < 3) {
      // No wheel colour to take a hue from — a default theme, or a theme built
      // entirely from exact colours. The token layer's fallback is the honest
      // answer there, and clearing is how this hands it back.
      wrapper.style.removeProperty("--trance-picker-lightness-track");
      return;
    }
    const picker = this.#picker;
    const [hue, saturation] = picker.rgbToHsl(base[0], base[1], base[2]);
    const at = lightness => {
      const [red, green, blue] = picker.hslToRgb(
        hue / 360,
        saturation,
        lightness
      );
      return `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;
    };
    wrapper.style.setProperty(
      "--trance-picker-lightness-track",
      `linear-gradient(to right, ${at(0.12)}, ${at(0.5)} 50%, ${at(0.94)})`
    );
  }

  /**
   * Re-reads the saved themes, but only when the pref actually changed.
   *
   * @returns {boolean} Whether the list is different from the last reading.
   */
  #refreshSavedKeys() {
    const raw = Services.prefs.getStringPref(PREF_SAVED_THEMES, "");
    if (raw === this.#savedSignature) {
      return false;
    }
    this.#savedSignature = raw;
    this.#savedKeys = new Set(
      this.#savedThemes().map(theme => this.#key(theme))
    );
    return true;
  }

  /**
   * The two controls that have to keep up with a drag.
   *
   * Zen only fires `zen-space-gradient-update` on a *saving* update, because
   * notifying on every frame of a dot drag was measurably slow (its own comment
   * says so). `#sync()` therefore does not run while anything is being dragged
   * — which left the angle knob frozen until the mouse came up, and the heart
   * still filled in after the theme had been dragged away from the saved one.
   *
   * So the two controls that answer "what is the theme *right now*" are split
   * out and driven from the wrap on `updateCurrentWorkspace` instead, which
   * does run every frame. Both are a handful of property writes on nodes that
   * already exist; neither creates or destroys anything.
   *
   * Skipped entirely while the panel is shut. This runs on every repaint, and
   * a repaint happens for reasons that have nothing to do with this panel — a
   * space switch, another window, a session restore — none of which is worth
   * measuring a knob nobody is looking at. `#sync` passes `force`, because the
   * paths that call it are the ones where the answer has to be right now: the
   * panel opening, and a button in it being pressed.
   *
   * @param {boolean} [isGradient]
   * @param {boolean} [force]
   */
  #syncLive(isGradient = this.#isGradient, force = false) {
    if (!force && !this.#isPanelOpen) {
      return;
    }
    const knob = this.#nodes.knob;
    if (knob) {
      const angle = this.#state.angle;
      knob.toggleAttribute("disabled", !isGradient);
      knob.setAttribute("aria-valuenow", String(angle));
      knob.setAttribute("aria-valuetext", `${angle} degrees`);
      this.#nodes.knobValue.textContent = `${angle}°`;
      const handle = this.#nodes.knobHandle;
      const size =
        this.context.window.windowUtils.getBoundsWithoutFlushing(knob).width;
      if (size) {
        const radians = ((angle - 90) * Math.PI) / 180;
        handle.style.transform = `rotate(${angle}deg)`;
        handle.style.left = `${size / 2 + Math.cos(radians) * (size / 2) - 3}px`;
        handle.style.top = `${size / 2 + Math.sin(radians) * (size / 2) - 6}px`;
      }
    }

    const heart = this.#nodes.heart;
    if (heart) {
      const theme = this.#activeWorkspace()?.theme;
      const key = theme && this.#key(theme);
      const saved = !!key && this.#savedKeys.has(key);
      heart.toggleAttribute("saved", saved);
      heart.setAttribute(
        "tooltiptext",
        saved ? "Saved — press to forget" : "Save this theme"
      );
      // Zen disables its own action buttons on a default theme; Trance's two
      // are toolbarbuttons precisely so that loop cannot reach them, and this
      // is the only rule about when they are dead.
      heart.disabled = false;
    }
  }

  /**
   * Rebuilds the saved page. Called only when the saved list actually changed,
   * which `#refreshSavedKeys` is the judge of.
   *
   * `#sync()` runs on every gradient update, which includes every frame of a
   * dot drag. Rebuilding two dozen nodes on each of those would be the kind of
   * per-frame DOM work this project exists to delete.
   */
  #renderSavedPage() {
    const page = this.#nodes.savedPage;
    if (!page) {
      return;
    }

    const doc = this.context.document;
    const themes = this.#savedThemes();
    page.replaceChildren();

    themes.forEach((theme, index) => {
      const colors = (theme.gradientColors ?? [])
        .map(color =>
          color.isCustom
            ? color.c
            : `rgb(${color.c[0]}, ${color.c[1]}, ${color.c[2]})`
        )
        .slice(0, 3);
      if (!colors.length) {
        return;
      }
      const swatch = doc.createXULElement("box");
      swatch.className = "trance-theme-saved-swatch";
      swatch.setAttribute("data-index", String(index));
      swatch.style.setProperty("--trance-saved-1", colors[0]);
      swatch.style.setProperty("--trance-saved-2", colors[1] ?? colors[0]);
      swatch.style.setProperty("--trance-saved-3", colors[2] ?? colors[0]);
      swatch.setAttribute(
        "tooltiptext",
        "Click to apply · right-click to forget"
      );
      page.appendChild(swatch);
    });

    // A dashed outline for every slot that is still free. An empty page then
    // shows where saved themes will go, which a sentence saying the page is
    // empty did not, and the row is the same height either way — the page does
    // not resize under the pager the first time something is saved.
    for (let slot = page.childElementCount; slot < SAVED_SLOTS; slot++) {
      const outline = doc.createXULElement("box");
      outline.className = "trance-theme-saved-slot";
      outline.setAttribute("tooltiptext", "An empty slot for a saved theme");
      page.appendChild(outline);
    }
  }
}
