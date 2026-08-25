// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the surface layer.
//
// Behaviour inspired by "Nebula" by JustADumbPrsn
// (https://github.com/JustADumbPrsn/Zen-Nebula), "Transparent Zen" by sameerasw
// (https://github.com/sameerasw/zen-themes), "Zen Compact Transparent Mode" by
// rasyidrafi (https://github.com/rasyidrafi/zen-compact-transparent-mode) and
// "Nova UI" by qumeqa (https://github.com/qumeqa/nova).
// Implemented independently for Trance; no code copied. Nebula is GPL-3.0 and
// two of the others are unlicensed, so this is a clean-room reimplementation by
// requirement, not by preference (TRANCE.md §7.2, §7.3).
//
// Those four mods run four independent `backdrop-filter` stacks over
// overlapping regions. Each blurred surface forces its own compositor layer,
// forces whatever is behind it to stay readback-able (defeating occlusion
// culling), and costs a full separable Gaussian pass per frame per layer. On a
// 120 Hz ProMotion display that is four full-region blur passes at display rate
// for a completely static UI, and on macOS it stops the window server skipping
// an occluded window entirely (TRANCE.md §3.3).
//
// This module replaces all four with one region registry, a hard budget of
// three surfaces, and blur that switches off when the window cannot be seen.
//
// Refs: TRANCE.md §3.3, §6, §8.1, §13 Phase 3; docs/trance/mods/nebula.md

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Surfaces";

const PREF_PRESET = "trance.surface.preset";
const PREF_SUSPEND = "trance.surface.suspend-when-unfocused";

/** Zen's own acrylic switch. See ADR-011 for why this module owns it. */
const PREF_ZEN_ACRYLIC = "zen.theme.acrylic-elements";

const PRESETS = Object.freeze(["nebula", "compact", "flat", "custom"]);
const DEFAULT_PRESET = "nebula";

/**
 * The regions, enumerated.
 *
 * The first three are the blur budget: one `backdrop-filter` surface each,
 * never nested. `content` is translucency only — a blurred content pane is the
 * most expensive surface a browser can have and the window's own translucency
 * already supplies the frost behind it — so the blur budget is still three
 * (ADR-019). Adding a fourth *blurred* region requires removing one or a
 * DECISIONS.md entry (TRANCE.md §12.3 rule 1).
 */
const REGIONS = Object.freeze([
  {
    id: "sidebar",
    pref: "trance.surface.region.sidebar",
    blurred: true,
    fallback: true,
  },
  {
    id: "toolbar",
    pref: "trance.surface.region.toolbar",
    blurred: true,
    fallback: true,
  },
  {
    id: "overlay",
    pref: "trance.surface.region.overlay",
    blurred: true,
    fallback: true,
  },
  // Off unless asked for: this is the one region that can put a workspace
  // gradient behind body text.
  {
    id: "content",
    pref: "trance.surface.region.content",
    blurred: false,
    fallback: false,
  },
]);

/** Regions that carry a `backdrop-filter`. Read by the mochitest. */
export const TRANCE_BLURRED_REGIONS = REGIONS.filter(r => r.blurred).map(
  r => r.id
);

const ATTR_PRESET = "trance-surface";
const ATTR_VISIBLE = "trance-surface-visible";
const regionAttribute = id => `trance-surface-${id}`;

export class TranceSurfaces extends TranceFeature {
  static prefName = "trance.surface.enabled";
  static featureName = "Surfaces";
  static styles = [
    "chrome://browser/content/trance-styles/trance-surfaces.css",
  ];

  /** The user's `zen.theme.acrylic-elements` value, restored on disable. */
  #previousZenAcrylic = null;

  onEnable() {
    this.#bindTokens();
    this.#observePrefs();
    this.#observeVisibility();
    this.#claimZenAcrylic();

    this.#applyPreset();
    this.#applyRegions();
    this.#applyVisibility();
  }

  onDisable() {
    const root = this.context.document.documentElement;
    root.removeAttribute(ATTR_PRESET);
    root.removeAttribute(ATTR_VISIBLE);
    for (const region of REGIONS) {
      root.removeAttribute(regionAttribute(region.id));
    }
    this.#releaseZenAcrylic();
  }

  // --- Tokens ---------------------------------------------------------------

  /**
   * The tunable surface values follow their prefs directly. Writing one custom
   * property is all a slider costs — no stylesheet is rebuilt and no rule is
   * re-matched, which is the difference between this and Zen's mods system
   * regenerating `zen-themes.css` wholesale (TRANCE.md §3.1).
   *
   * `--trance-surface-alpha` is consumed as an `opacity` on Zen's own
   * background elements rather than as an alpha channel on a tint Trance
   * paints. See the header of trance-surfaces.css for why that distinction is
   * the whole feature.
   */
  #bindTokens() {
    this.bindTokens([
      {
        pref: "trance.surface.blur.radius",
        cssVar: "--trance-surface-blur",
        type: "int",
        fallback: 24,
        format: value => `${Math.max(0, value)}px`,
      },
      {
        pref: "trance.surface.opacity",
        cssVar: "--trance-surface-alpha",
        type: "int",
        fallback: 62,
        format: value => `${Math.min(100, Math.max(0, value))}%`,
      },
      {
        pref: "trance.surface.saturation",
        cssVar: "--trance-surface-saturate",
        type: "int",
        fallback: 130,
        format: value => `${Math.max(0, value)}%`,
      },
      {
        pref: "trance.surface.content.opacity",
        cssVar: "--trance-content-alpha",
        type: "int",
        fallback: 85,
        format: value => `${Math.min(100, Math.max(0, value))}%`,
      },
    ]);
  }

  // --- Prefs ----------------------------------------------------------------

  #observePrefs() {
    const presetObserver = { observe: () => this.#applyPreset() };
    Services.prefs.addObserver(PREF_PRESET, presetObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_PRESET, presetObserver)
    );

    for (const region of REGIONS) {
      const observer = { observe: () => this.#applyRegions() };
      Services.prefs.addObserver(region.pref, observer);
      this.addDisposer(() =>
        Services.prefs.removeObserver(region.pref, observer)
      );
    }

    const suspendObserver = { observe: () => this.#applyVisibility() };
    Services.prefs.addObserver(PREF_SUSPEND, suspendObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_SUSPEND, suspendObserver)
    );
  }

  #applyPreset() {
    let preset = Services.prefs.getStringPref(PREF_PRESET, DEFAULT_PRESET);
    if (!PRESETS.includes(preset)) {
      TranceLog.warn(NS, `unknown preset "${preset}", falling back`);
      preset = DEFAULT_PRESET;
    }
    this.context.document.documentElement.setAttribute(ATTR_PRESET, preset);
  }

  #applyRegions() {
    const root = this.context.document.documentElement;
    for (const region of REGIONS) {
      const enabled = Services.prefs.getBoolPref(region.pref, region.fallback);
      if (enabled) {
        root.setAttribute(regionAttribute(region.id), "true");
      } else {
        root.removeAttribute(regionAttribute(region.id));
      }
    }
  }

  // --- Visibility -----------------------------------------------------------

  /**
   * Blur is dropped whenever the window cannot actually be seen. This is the
   * rule the mod stack had no way to express: a stylesheet cannot know the
   * window is occluded, so its blur passes ran forever.
   */
  #observeVisibility() {
    const win = this.context.window;
    const update = () => this.#applyVisibility();
    this.addListener(win, "focus", update);
    this.addListener(win, "blur", update);
    this.addListener(win, "occlusionstatechange", update);
    this.addListener(win, "sizemodechange", update);
  }

  #applyVisibility() {
    const win = this.context.window;
    const root = this.context.document.documentElement;

    const suspendWhenUnfocused = Services.prefs.getBoolPref(PREF_SUSPEND, true);
    const occluded =
      win.isFullyOccluded || win.windowState === win.STATE_MINIMIZED;
    const visible =
      !occluded && (!suspendWhenUnfocused || win.document.hasFocus());

    if (visible) {
      root.setAttribute(ATTR_VISIBLE, "true");
    } else {
      root.removeAttribute(ATTR_VISIBLE);
    }
    TranceLog.log(NS, "visible", visible);
  }

  // --- Zen's acrylic switch --------------------------------------------------

  /**
   * Zen's compact-mode sheet carries
   * `backdrop-filter: blur(42px) … !important` on `.zen-toolbar-background`,
   * gated on `zen.theme.acrylic-elements`. An author-level Trance rule cannot
   * beat `!important`, and adding `!important` to fight it is forbidden
   * (§6.2 rule 1). Owning the pref is the honest way to keep one owner per
   * region — and unlike a CSS arms race it is exactly reversible.
   *
   * The pref defaults to false in a Trance build (it is `@IS_TWILIGHT@` and
   * Trance has a single non-twilight brand), so for most users this is a no-op.
   *
   * See ADR-011.
   */
  #claimZenAcrylic() {
    if (!Services.prefs.getBoolPref(PREF_ZEN_ACRYLIC, false)) {
      return;
    }
    this.#previousZenAcrylic = true;
    Services.prefs.setBoolPref(PREF_ZEN_ACRYLIC, false);
    TranceLog.log(NS, `disabled ${PREF_ZEN_ACRYLIC} to keep the blur budget`);
  }

  #releaseZenAcrylic() {
    if (this.#previousZenAcrylic === null) {
      return;
    }
    Services.prefs.setBoolPref(PREF_ZEN_ACRYLIC, this.#previousZenAcrylic);
    this.#previousZenAcrylic = null;
  }
}
