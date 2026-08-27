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
// This module replaces all four with **one** surface — a single layer over the
// whole browser — and blur that switches off when the window cannot be seen.
//
// One, not three. The per-region switches are gone (ADR-041): "frost the
// sidebar but not the toolbar" is two adjacent panes of glass with a seam
// between them, which is the look this project exists to remove, and the
// presets only ever moved two tokens the sliders already owned. There is no
// `content` region either (ADR-042). What is left is a master switch for the
// frost, a master switch for transparency, three sliders, the browser's own
// pages, and two pictures: the chrome's background texture and the mark on an
// empty tab.
//
// The budget is a ceiling, not a target. On any platform whose window is
// translucent in its own right — macOS vibrancy, Windows Mica, a transparent
// GTK window — Trance spends none of it: there the frost is produced behind
// Gecko by the compositor, and a `backdrop-filter` over it replaces it with
// flat black instead of softening it. See the Blur section of
// trance-surfaces.css; that one fact was behind three separate bug reports.
//
// Refs: TRANCE.md §3.3, §6, §8.1, §13 Phase 3; docs/trance/mods/nebula.md

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Surfaces";

const PREF_TRANSPARENCY = "trance.surface.transparency";
const PREF_SUSPEND = "trance.surface.suspend-when-unfocused";
const PREF_KEEP_UNFOCUSED = "trance.surface.keep-transparent-unfocused";
const PREF_EDGELESS = "trance.surface.edgeless";
const PREF_IMAGE = "trance.surface.image";
const PREF_NEWTAB_LOGO = "trance.surface.newtab.logo";
const PREF_NEWTAB_HOLOGRAPHIC = "trance.surface.newtab.logo.holographic";
const PREF_NEWTAB_HOVER = "trance.surface.newtab.logo.hover";
const PREF_NEWTAB_TILT = "trance.surface.newtab.logo.tilt";
const PREF_INTERNAL = "trance.surface.internal-pages";
const PREF_INTERNAL_OPACITY = "trance.surface.internal.opacity";
const PREF_INTERNAL_BLUR = "trance.surface.internal.blur";

/** Zen's own acrylic switch. See ADR-011 for why this module owns it. */
const PREF_ZEN_ACRYLIC = "zen.theme.acrylic-elements";

/**
 * Zen's "the window material follows the window's active state" switch. With it
 * on — its default — macOS drops the `NSVisualEffectView` to an opaque grey the
 * moment the window loses focus, which is why an unfocused Trance window went
 * black no matter what the Trance prefs said. Claimed, not mirrored (ADR-011).
 */
const PREF_ZEN_GREY_INACTIVE = "zen.view.grey-out-inactive-windows";

/**
 * Firefox's own switch for building content browsers with a transparent canvas.
 * It is what makes the internal-pages switch a real page-transparency feature
 * rather than a colour behind an opaque canvas. Claimed, not mirrored
 * (ADR-011), and re-stamped onto live browsers when it is claimed again — see
 * `#markTransparentBrowsers`.
 */
const PREF_ALLOW_TRANSPARENT_BROWSER = "browser.tabs.allow_transparent_browser";

/**
 * The platform's own "make this window translucent" switches, one per platform.
 *
 * These are what the master transparency switch actually turns on. Every one of
 * them is a platform decision Trance has no business reimplementing and no way
 * to reach from CSS, and until now none of them was reachable from the settings
 * page either — "make the browser transparent" meant editing about:config and
 * knowing which of the four lines applied to you.
 *
 * Claimed while the switch is on and given back when it is off, exactly like
 * `zen.theme.acrylic-elements` (ADR-011). `media` is the condition under which
 * the pref means anything at all, so a macOS build does not claim Mica.
 */
const PLATFORM_TRANSPARENCY = Object.freeze([
  {
    pref: "zen.widget.macos.window-vibrancy",
    media: "(-moz-platform: macos)",
  },
  {
    pref: "widget.windows.mica",
    media: "(-moz-platform: windows)",
  },
  {
    pref: "zen.widget.linux.transparency",
    media: "(-moz-platform: linux)",
  },
]);

/*
 * There are no regions left.
 *
 * There were four. Three were switches for parts of one decision — "frost the
 * sidebar but not the toolbar" is two adjacent panes of glass with a seam
 * between them, which is the look this project exists to remove — and they went
 * with ADR-041; the frost is one layer on `#zen-main-app-wrapper` now, with no
 * switch of its own beyond the feature's.
 *
 * The fourth, `content`, was translucency for *web pages*, and it went with
 * ADR-042. It could only ever reach the pixels a page leaves unpainted, and
 * those are already transparent in an edgeless window; on the pages where it
 * would have mattered, Zen Internet — which Trance preinstalls — restyles the
 * site's own background and covers it either way. What is left of the idea is
 * the internal-pages switch below, which is the half that was doing the work.
 */

const ATTR_VISIBLE = "trance-surface-visible";
const ATTR_TRANSPARENT = "trance-surface-transparent";
const ATTR_EDGELESS = "trance-surface-edgeless";
const ATTR_IMAGE = "trance-surface-image";
const ATTR_INTERNAL = "trance-surface-internal";
const ATTR_INTERNAL_BLUR = "trance-surface-internal-blur";
const ATTR_INTERNAL_PAGE = "trance-internal-page";
const ATTR_NEWTAB = "trance-surface-newtab";
const ATTR_NEWTAB_HOLOGRAPHIC = "trance-surface-newtab-holographic";
const ATTR_NEWTAB_TILT = "trance-surface-newtab-tilt";

/** The chrome element the empty-tab mark is painted into. */
const NEWTAB_LOGO_ID = "trance-newtab-logo";

/**
 * Where the pointer is inside the mark's box, as two numbers in −1..1.
 *
 * Written on the element rather than on the root: this is per-element state,
 * like the loading bar's progress, and putting it on the root would make every
 * rule in every Trance sheet re-resolve when the pointer moves.
 */
const NEWTAB_POINTER_X = "--trance-newtab-logo-px";
const NEWTAB_POINTER_Y = "--trance-newtab-logo-py";

/**
 * Whether the pointer is inside the mark's own box.
 *
 * The mark is `pointer-events: none` and has to stay that way — it is a 250px
 * square over the new-tab page's search field — so `:hover` never matches it and
 * CSS cannot ask this question. The pointer listener already knows the answer:
 * it computes the position relative to the mark's rect in order to produce the
 * two numbers, and "inside" falls out of the same arithmetic before it is
 * clamped.
 *
 * It exists because the tilt should answer to being touched rather than to
 * being near. Without it the mark leans towards the pointer wherever the
 * pointer is, which is a mark in the middle of the page tilting because
 * somebody moved the mouse across the address bar.
 *
 * On the element rather than on the root, for the same reason the two numbers
 * are: it changes as the pointer moves, and on the root every rule in every
 * Trance sheet would re-resolve with it.
 */
const ATTR_NEWTAB_POINTER_INSIDE = "trance-newtab-logo-hover";

/**
 * What counts as an empty tab.
 *
 * The three pages a browser shows when it is showing nothing: the new-tab page,
 * a genuinely blank document, and the home page when it is the new-tab page.
 * `about:privatebrowsing` is deliberately not here — it is a page with its own
 * artwork and its own message, and a second mark over it would be two things
 * saying "this window is empty" in the same rectangle.
 */
const EMPTY_PAGES = Object.freeze([
  "about:newtab",
  "about:blank",
  "about:home",
]);

/**
 * Zen's own attribute for a content browser built with an alpha-composited
 * canvas. Removed from live browsers when the platform switch is given back —
 * see `#releaseTransparentBrowser`.
 */
const ATTR_ZEN_TRANSPARENT = "transparent";

/**
 * The `about:` sheet, and the generated one-liner that carries the one value it
 * cannot read from the token layer.
 *
 * Both are registered with `nsIStyleSheetService` as USER sheets, which is
 * application-wide rather than per-window — hence the static refcount below. A
 * content document has no chrome stylesheet in scope, so this is the only way
 * to reach `about:preferences` at all; see the header of trance-internal.css.
 */
const INTERNAL_SHEET_URL =
  "chrome://browser/content/trance-styles/trance-internal.css";

/**
 * `nsIStyleSheetService`.
 *
 * Not on `Services`: the lazy getters in Services.sys.mjs cover the services
 * chrome code reaches for constantly, and this is not one of them — everything
 * else in the tree that wants it asks for the contract by name (see
 * ExtensionCommon.sys.mjs). Fetched on first use rather than at module scope so
 * that a Trance with the region switched off never instantiates it.
 */
const styleSheetService = () =>
  Cc["@mozilla.org/content/style-sheet-service;1"].getService(
    Ci.nsIStyleSheetService
  );

/**
 * A user-chosen image URL as a CSS `url()`, or `none`.
 *
 * The value came from a file picker, so it can contain anything a filename can
 * — including a quote or a backslash, either of which would end the string
 * early and turn the rest of the path into a parse error that silently takes
 * the whole declaration with it.
 *
 * @param {string} value
 * @returns {string}
 */
const cssImage = value => {
  const url = (value ?? "").trim();
  if (!url) {
    return "none";
  }
  return `url("${url.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
};

/**
 * How long the page-opacity sheet swap may wait for an idle moment.
 *
 * Long enough that a drag produces one write rather than a queue of them,
 * short enough that letting go of the slider and looking at the page feels like
 * one action. See `#queueInternalAlpha`.
 */
const INTERNAL_ALPHA_TIMEOUT = 200;

/**
 * Clamps a signed fraction to −1..1.
 *
 * The mark's pointer numbers are "how far across its own box", and a pointer
 * outside the box is a real case — the listener is on the window, not on the
 * element — so the values have to be bounded or a mark near the window edge
 * would lean further the further away the pointer got.
 *
 * @param {number} value
 * @returns {number}
 */
const clampUnit = value => Math.max(-1, Math.min(1, value));

const internalAlphaSheetURL = percent =>
  "data:text/css;charset=utf-8," +
  encodeURIComponent(
    `@-moz-document url-prefix("about:"){:root{--trance-internal-alpha:${percent}%}}`
  );

export class TranceSurfaces extends TranceFeature {
  static prefName = "trance.surface.enabled";
  static featureName = "Surfaces";
  static styles = [
    "chrome://browser/content/trance-styles/trance-surfaces.css",
  ];

  /** The user's `zen.theme.acrylic-elements` value, restored on disable. */
  #previousZenAcrylic = null;
  /** The user's `zen.view.grey-out-inactive-windows`, restored on disable. */
  #previousGreyInactive = null;
  /** The user's `browser.tabs.allow_transparent_browser`, restored on disable. */
  #previousTransparentBrowser = null;

  /**
   * The user's value for each platform transparency pref this window claimed.
   *
   * @type {Map<string, boolean>}
   */
  #previousPlatformTransparency = new Map();

  /**
   * How many windows currently want the `about:` user sheets.
   *
   * `nsIStyleSheetService` is application-wide, so these sheets are registered
   * once and unregistered when the last window that wanted them goes away —
   * unlike every other Trance stylesheet, which `TranceStyles` refcounts per
   * window because `loadSheetUsingURIString` is itself per window.
   */
  static #internalSheetUsers = 0;
  /** The alpha sheet currently registered, so it can be swapped on pref change. */
  static #internalAlphaURL = null;

  /** Whether this window holds a reference to the sheets above. */
  #holdsInternalSheets = false;
  /** The tabs progress listener that marks `about:` browsers, if registered. */
  #internalPageListener = null;
  /** @type {Element | null} The empty-tab mark, while there is one. */
  #newtabLogo = null;
  /** Whether the empty-tab mark's tab listeners are attached. */
  #newtabListening = false;
  /** Whether the mark's pointer listener is attached. */
  #pointerListening = false;
  /** The coalescing frame subscription for the mark's pointer, or 0. */
  #pointerFrame = 0;
  /**
   * The last pointer position seen, in the mark's own -1..1 space, plus whether
   * it was inside the box at all.
   *
   * @type {{ x: number, y: number, inside: boolean }}
   */
  #pointer = { x: 0, y: 0, inside: false };
  /** The pending idle callback for the page-opacity sheet swap, or 0. */
  #alphaHandle = 0;

  onEnable() {
    this.#bindTokens();
    this.#observePrefs();
    this.#observeVisibility();
    this.#claimZenAcrylic();

    this.#applyShape();
    this.#applyRegions();
    this.#applyVisibility();

    // And once more when there is a `gBrowser` to ask. TranceCore enters at
    // `MozBeforeInitialXULLayout`, before the tab browser is built, and the
    // empty-tab mark needs a selected tab to have an opinion about.
    const win = this.context.window;
    if (win.gBrowser?.tabContainer) {
      this.#applyNewtabLogo();
    } else {
      this.addListener(win, "load", () => this.#applyNewtabLogo(), {
        once: true,
      });
    }
  }

  onDisable() {
    const root = this.context.document.documentElement;
    for (const attribute of [
      ATTR_VISIBLE,
      ATTR_TRANSPARENT,
      ATTR_EDGELESS,
      ATTR_IMAGE,
      ATTR_INTERNAL,
      ATTR_INTERNAL_BLUR,
      ATTR_NEWTAB,
      ATTR_NEWTAB_HOLOGRAPHIC,
      ATTR_NEWTAB_TILT,
    ]) {
      root.removeAttribute(attribute);
    }
    if (this.#alphaHandle) {
      this.context.scheduler.cancel(this.#alphaHandle);
      this.#alphaHandle = 0;
    }
    this.#teardownNewtabLogo();
    this.#releaseInternalPages();
    this.#releaseZenAcrylic();
    this.#releaseGreyInactive();
    this.#releaseTransparentBrowser();
    this.#releasePlatformTransparency();
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
    // `trance.surface.internal.opacity` is deliberately not here: it is
    // consumed by a stylesheet in a *content* document, where an inline custom
    // property on the chrome window's root element is not in scope. See
    // `#syncInternalAlpha`.
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
        fallback: 35,
        format: value => `${Math.min(100, Math.max(0, value))}%`,
      },
      {
        pref: "trance.surface.saturation",
        cssVar: "--trance-surface-saturate",
        type: "int",
        fallback: 130,
        format: value => `${Math.max(0, value)}%`,
      },
      // The same number as a filter function, so that the identity value can
      // be `none` rather than `saturate(100%)`. See the token's own comment:
      // an identity filter still costs a full-window render pass, and `none`
      // does not.
      {
        pref: "trance.surface.saturation",
        cssVar: "--trance-surface-saturate-fn",
        type: "int",
        fallback: 130,
        format: value =>
          Math.max(0, value) === 100
            ? "none"
            : `saturate(${Math.max(0, value)}%)`,
      },
      // The background image, as the three things CSS needs to paint it: the
      // layer, how strongly it reads, and how soft it is.
      //
      // The URL is quoted and its quotes and backslashes escaped, because the
      // value is a file path the user chose and a path may contain either. It
      // resolves to `none` when there is no image, so the rule below it is inert
      // rather than being a `url("")` the style system tries to load.
      {
        pref: PREF_IMAGE,
        cssVar: "--trance-surface-image",
        type: "string",
        fallback: "",
        format: value => cssImage(value),
      },
      {
        pref: "trance.surface.image.opacity",
        cssVar: "--trance-surface-image-alpha",
        type: "int",
        fallback: 12,
        format: value => `${Math.min(100, Math.max(0, value)) / 100}`,
      },
      // Twice, as a length and as a filter function. The length is what the
      // rule grows the image's box by, so a blur does not fade out along the
      // window's own edges; the function is `none` at zero rather than
      // `blur(0px)`, because an identity filter still forces a render pass —
      // the same argument the saturation token makes.
      {
        pref: "trance.surface.image.blur",
        cssVar: "--trance-surface-image-blur",
        type: "int",
        fallback: 0,
        format: value => `${Math.max(0, value)}px`,
      },
      {
        pref: "trance.surface.image.blur",
        cssVar: "--trance-surface-image-blur-fn",
        type: "int",
        fallback: 0,
        format: value =>
          Math.max(0, value) === 0 ? "none" : `blur(${Math.max(0, value)}px)`,
      },

      // The empty-tab mark. Same three things, same escaping, and the same
      // reason the URL is a token rather than an attribute on the element: a
      // slider costs one `setProperty` and no rule is re-matched.
      {
        pref: PREF_NEWTAB_LOGO,
        cssVar: "--trance-newtab-logo",
        type: "string",
        fallback: "",
        format: value => cssImage(value),
      },
      {
        // Clamped rather than validated: the mark is painted over the page, and
        // a size typed into about:config with an extra digit is a picture over
        // the whole window that the settings page cannot obviously undo.
        pref: "trance.surface.newtab.logo.size",
        cssVar: "--trance-newtab-logo-size",
        type: "int",
        fallback: 250,
        format: value => `${Math.max(16, Math.min(1200, value))}px`,
      },
      {
        pref: "trance.surface.newtab.logo.opacity",
        cssVar: "--trance-newtab-logo-alpha",
        type: "int",
        fallback: 35,
        format: value => `${Math.min(100, Math.max(0, value)) / 100}`,
      },
    ]);
  }

  // --- Prefs ----------------------------------------------------------------

  #observePrefs() {
    const transparencyObserver = { observe: () => this.#applyRegions() };
    Services.prefs.addObserver(PREF_TRANSPARENCY, transparencyObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_TRANSPARENCY, transparencyObserver)
    );

    for (const pref of [
      PREF_NEWTAB_LOGO,
      PREF_NEWTAB_HOLOGRAPHIC,
      PREF_NEWTAB_HOVER,
      PREF_NEWTAB_TILT,
    ]) {
      const observer = { observe: () => this.#applyNewtabLogo() };
      Services.prefs.addObserver(pref, observer);
      this.addDisposer(() => Services.prefs.removeObserver(pref, observer));
    }

    for (const pref of [PREF_SUSPEND, PREF_KEEP_UNFOCUSED]) {
      const observer = { observe: () => this.#applyVisibility() };
      Services.prefs.addObserver(pref, observer);
      this.addDisposer(() => Services.prefs.removeObserver(pref, observer));
    }

    for (const pref of [
      PREF_EDGELESS,
      PREF_IMAGE,
      PREF_INTERNAL,
      PREF_INTERNAL_BLUR,
    ]) {
      const observer = { observe: () => this.#applyShape() };
      Services.prefs.addObserver(pref, observer);
      this.addDisposer(() => Services.prefs.removeObserver(pref, observer));
    }

    // The page-opacity slider is deliberately *not* in that list.
    //
    // It was, and dragging it locked the browser up. `#applyShape` re-reads
    // five prefs, claims and releases platform state, walks every browser in
    // the window and — the expensive part — swaps a registered
    // `nsIStyleSheetService` user sheet, which invalidates the style data of
    // every document in the application. A `range` input notifies on every
    // pixel of a drag, so a slow sweep across the slider was a hundred
    // application-wide invalidations with a full `#applyShape` on top of each.
    //
    // Its own observer, doing only the one thing that value changes, and
    // coalesced (ADR-046).
    const alphaObserver = { observe: () => this.#queueInternalAlpha() };
    Services.prefs.addObserver(PREF_INTERNAL_OPACITY, alphaObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_INTERNAL_OPACITY, alphaObserver)
    );
  }

  /**
   * The master transparency switch.
   *
   * It is still its own method rather than being folded into `#applyShape`,
   * because it is the one that claims and releases the *platform's* prefs, and
   * a claim and a release that can get out of step is worth keeping in one
   * place with the thing that decides it.
   */
  #applyRegions() {
    const root = this.context.document.documentElement;

    if (Services.prefs.getBoolPref(PREF_TRANSPARENCY, true)) {
      root.setAttribute(ATTR_TRANSPARENT, "true");
      this.#claimPlatformTransparency();
    } else {
      root.removeAttribute(ATTR_TRANSPARENT);
      this.#releasePlatformTransparency();
    }

    this.#syncTransparentBrowser();
  }

  // --- Shape and internal pages ---------------------------------------------

  /**
   * The two switches that change what the browser *is* rather than how strongly
   * it is tinted: edgeless geometry, and the browser's own pages.
   *
   * They share a method because they share a consequence — both are reasons the
   * content canvas has to be alpha-composited — and keeping the decision in one
   * place is what stops the platform pref being claimed twice and released once.
   */
  #applyShape() {
    const root = this.context.document.documentElement;

    if (Services.prefs.getBoolPref(PREF_EDGELESS, true)) {
      root.setAttribute(ATTR_EDGELESS, "true");
    } else {
      root.removeAttribute(ATTR_EDGELESS);
    }

    // An attribute rather than "is the token `none`", because a pseudo-element
    // with `content: ""` costs a box whether or not its background resolves to
    // an image. No image, no box.
    if (Services.prefs.getStringPref(PREF_IMAGE, "").trim()) {
      root.setAttribute(ATTR_IMAGE, "true");
    } else {
      root.removeAttribute(ATTR_IMAGE);
    }

    const internal = Services.prefs.getBoolPref(PREF_INTERNAL, true);
    if (internal) {
      root.setAttribute(ATTR_INTERNAL, "true");
      this.#claimInternalPages();
    } else {
      root.removeAttribute(ATTR_INTERNAL);
      this.#releaseInternalPages();
    }

    // The frost behind those pages. Gated on the switch above rather than
    // standing beside it: blurring what is behind an opaque page is a pass
    // spent on something nobody can see.
    if (internal && Services.prefs.getBoolPref(PREF_INTERNAL_BLUR, true)) {
      root.setAttribute(ATTR_INTERNAL_BLUR, "true");
    } else {
      root.removeAttribute(ATTR_INTERNAL_BLUR);
    }

    this.#syncTransparentBrowser();
  }

  /**
   * Registers the `about:` user sheets and starts marking the browsers that
   * hold an `about:` page.
   *
   * The sheets are application-wide, so only the first window to ask actually
   * registers them; the marker is per window, because the browsers are.
   */
  #claimInternalPages() {
    this.#syncInternalAlpha();

    if (!this.#holdsInternalSheets) {
      this.#holdsInternalSheets = true;
      if (TranceSurfaces.#internalSheetUsers === 0) {
        this.#registerSheet(INTERNAL_SHEET_URL);
      }
      TranceSurfaces.#internalSheetUsers += 1;
    }

    if (!this.#internalPageListener) {
      this.#observeInternalPages();
    }
    this.#markAllBrowsers();
  }

  #releaseInternalPages() {
    if (this.#holdsInternalSheets) {
      this.#holdsInternalSheets = false;
      TranceSurfaces.#internalSheetUsers -= 1;
      if (TranceSurfaces.#internalSheetUsers === 0) {
        this.#unregisterSheet(INTERNAL_SHEET_URL);
        if (TranceSurfaces.#internalAlphaURL) {
          this.#unregisterSheet(TranceSurfaces.#internalAlphaURL);
          TranceSurfaces.#internalAlphaURL = null;
        }
      }
    }

    if (this.#internalPageListener) {
      this.context.window.gBrowser?.removeTabsProgressListener(
        this.#internalPageListener
      );
      this.#internalPageListener = null;
    }

    for (const browser of this.#contentBrowsers()) {
      browser.removeAttribute(ATTR_INTERNAL_PAGE);
    }
  }

  /**
   * Asks for the alpha sheet to be rewritten, at most once per idle period.
   *
   * This is the whole fix for "dragging the page-opacity slider locks the
   * browser up". The write itself cannot be made cheap — see
   * `#syncInternalAlpha` — so it is made *rare*: a drag produces one sheet swap
   * when the main thread next has a moment, rather than one per pixel. The
   * timeout is what keeps the slider feeling connected to the page behind it if
   * the thread never goes idle (ADR-046).
   *
   * The pending handle is cancelled rather than allowed to stack, so a
   * two-second sweep is one swap and not a queue of two hundred.
   */
  #queueInternalAlpha() {
    if (!Services.prefs.getBoolPref(PREF_INTERNAL, true)) {
      return;
    }
    if (this.#alphaHandle) {
      this.context.scheduler.cancel(this.#alphaHandle);
    }
    this.#alphaHandle = this.context.scheduler.onIdle(
      () => {
        this.#alphaHandle = 0;
        this.#syncInternalAlpha();
      },
      { timeout: INTERNAL_ALPHA_TIMEOUT }
    );
  }

  /**
   * The alpha, as its own one-line sheet.
   *
   * `trance-internal.css` runs in a content document, where none of the token
   * layer exists, so this one value cannot be an inline custom property the way
   * every other slider's is. It travels as a generated sheet instead: two
   * `nsIStyleSheetService` calls, which is not the cheap operation the first
   * version of this comment implied. Registering a user sheet is a synchronous
   * parse plus a style-data invalidation of every document in the application —
   * fine once, ruinous sixty times a second. Callers reach it through
   * `#queueInternalAlpha`.
   */
  #syncInternalAlpha() {
    const percent = Math.min(
      100,
      Math.max(0, Services.prefs.getIntPref(PREF_INTERNAL_OPACITY, 55))
    );
    const url = internalAlphaSheetURL(percent);
    if (TranceSurfaces.#internalAlphaURL === url) {
      return;
    }
    if (TranceSurfaces.#internalAlphaURL) {
      this.#unregisterSheet(TranceSurfaces.#internalAlphaURL);
    }
    this.#registerSheet(url);
    TranceSurfaces.#internalAlphaURL = url;
  }

  /**
   * @param {string} url
   */
  #registerSheet(url) {
    try {
      const uri = Services.io.newURI(url);
      const service = styleSheetService();
      if (!service.sheetRegistered(uri, service.USER_SHEET)) {
        service.loadAndRegisterSheet(uri, service.USER_SHEET);
      }
    } catch (error) {
      TranceLog.error(NS, `could not register ${url.slice(0, 64)}`, error);
    }
  }

  /**
   * @param {string} url
   */
  #unregisterSheet(url) {
    try {
      const uri = Services.io.newURI(url);
      const service = styleSheetService();
      if (service.sheetRegistered(uri, service.USER_SHEET)) {
        service.unregisterSheet(uri, service.USER_SHEET);
      }
    } catch (error) {
      TranceLog.error(NS, `could not unregister ${url.slice(0, 64)}`, error);
    }
  }

  /**
   * Marks the browsers holding an `about:` page.
   *
   * CSS cannot ask what a `<browser>` is showing, and the alternative — making
   * every content browser transparent — is what the edgeless rule in
   * trance-surfaces.css exists to undo, because it would make arbitrary
   * websites translucent too.
   *
   * One tabs progress listener covers every tab in the window, present and
   * future, which is the same subscription `TranceFeedback` already uses for the
   * loading bar rather than one listener per tab (TRANCE.md §3.2).
   */
  #observeInternalPages() {
    // Named rather than destructured to `gBrowser`: that identifier is already
    // a global in a browser window, and shadowing it here would make this the
    // one place in the file where `gBrowser` means something local.
    const tabbrowser = this.context.window.gBrowser;
    if (!tabbrowser?.addTabsProgressListener) {
      return;
    }
    this.#internalPageListener = {
      onLocationChange: browser => this.#markBrowser(browser),
    };
    tabbrowser.addTabsProgressListener(this.#internalPageListener);
    this.addDisposer(() => {
      if (this.#internalPageListener) {
        tabbrowser.removeTabsProgressListener(this.#internalPageListener);
        this.#internalPageListener = null;
      }
    });
  }

  #contentBrowsers() {
    return this.context.window.gBrowser?.browsers ?? [];
  }

  #markAllBrowsers() {
    for (const browser of this.#contentBrowsers()) {
      this.#markBrowser(browser);
    }
  }

  /**
   * @param {object} browser
   */
  #markBrowser(browser) {
    const scheme = browser?.currentURI?.scheme;
    if (scheme === "about") {
      browser.setAttribute(ATTR_INTERNAL_PAGE, "true");
    } else {
      browser?.removeAttribute(ATTR_INTERNAL_PAGE);
    }
  }

  // --- Visibility -----------------------------------------------------------

  /**
   * Blur is dropped whenever the window cannot actually be seen. This is the
   * rule the mod stack had no way to express: a stylesheet cannot know the
   * window is occluded, so its blur passes ran forever.
   *
   * `activate`/`deactivate` are here alongside `focus`/`blur` because the two
   * pairs answer different questions. `focus` is about the focused *element*
   * and does not fire on a chrome window that is already frontmost when this
   * runs — which is every startup, since `TranceCore` enters at
   * `MozBeforeInitialXULLayout`. That is why `trance-surface-visible` was never
   * set and every blur rule in trance-surfaces.css was dead for the whole
   * session: nothing ever fired the event that would have set it.
   */
  #observeVisibility() {
    const win = this.context.window;
    const update = () => this.#applyVisibility();
    this.addListener(win, "focus", update);
    this.addListener(win, "blur", update);
    this.addListener(win, "activate", update);
    this.addListener(win, "deactivate", update);
    this.addListener(win, "occlusionstatechange", update);
    this.addListener(win, "sizemodechange", update);

    // And once more when the window is built, for the startup case above: at
    // `MozBeforeInitialXULLayout` the document is not focusable yet, so the
    // first `#applyVisibility` can only answer "not visible" however it asks.
    if (win.document.readyState !== "complete") {
      this.addListener(win, "load", update, { once: true });
    }
  }

  #applyVisibility() {
    const win = this.context.window;
    const root = this.context.document.documentElement;

    // The opt-in overrides the suspend switch rather than sitting beside it:
    // "keep the window translucent when it is not focused" and "drop blur when
    // it is not focused" are the same question asked twice, and answering it
    // differently in two places is how a browser ends up with two owners for
    // one behaviour (TRANCE.md §6.2).
    const keepWhenUnfocused = Services.prefs.getBoolPref(
      PREF_KEEP_UNFOCUSED,
      false
    );
    this.#syncGreyInactive(keepWhenUnfocused);

    const suspendWhenUnfocused =
      !keepWhenUnfocused && Services.prefs.getBoolPref(PREF_SUSPEND, true);
    const occluded =
      win.isFullyOccluded || win.windowState === win.STATE_MINIMIZED;
    const focused =
      win.document.hasFocus() || Services.focus.activeWindow === win;
    const visible = !occluded && (!suspendWhenUnfocused || focused);

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

  // --- Transparency while unfocused ------------------------------------------

  /**
   * `zen.view.grey-out-inactive-windows` decides whether the macOS window
   * material is `NSVisualEffectStateFollowsWindowActiveState` or
   * `NSVisualEffectStateActive` (see `ZenWindowMaterialView` in
   * nsCocoaWindow.mm). On its default the whole frost collapses to an opaque
   * grey the moment the window is not frontmost — which no Trance pref could
   * undo, because Trance never owned it.
   *
   * It is claimed rather than mirrored, and only while the opt-in is on, so a
   * user who has never touched the Trance switch keeps Zen's behaviour exactly.
   * The pref is `mirror: always`, and nsCocoaWindow registers its own callback
   * on it, so this takes effect without a restart.
   *
   * @param {boolean} keepWhenUnfocused
   */
  #syncGreyInactive(keepWhenUnfocused) {
    if (!keepWhenUnfocused) {
      this.#releaseGreyInactive();
      return;
    }
    if (this.#previousGreyInactive !== null) {
      return;
    }
    const current = Services.prefs.getBoolPref(PREF_ZEN_GREY_INACTIVE, true);
    if (!current) {
      return;
    }
    this.#previousGreyInactive = current;
    Services.prefs.setBoolPref(PREF_ZEN_GREY_INACTIVE, false);
    TranceLog.log(NS, `disabled ${PREF_ZEN_GREY_INACTIVE} to keep the frost`);
  }

  #releaseGreyInactive() {
    if (this.#previousGreyInactive === null) {
      return;
    }
    Services.prefs.setBoolPref(
      PREF_ZEN_GREY_INACTIVE,
      this.#previousGreyInactive
    );
    this.#previousGreyInactive = null;
  }

  // --- Page transparency -----------------------------------------------------

  /**
   * The `content` region's other half. A CSS background on the `<browser>` sits
   * *behind* the content process's canvas, and the canvas is opaque, so on its
   * own the region could only ever tint the rounded corners.
   *
   * `browser.tabs.allow_transparent_browser` is Firefox's own switch for
   * building content browsers with `transparent="true"`, which reaches
   * `BrowserParent::IsTransparent` and makes the canvas composite with alpha.
   * `tabbrowser.js` reads it when it *creates* a browser, so this changes tabs
   * opened from now on rather than the ones already open — the settings page
   * says so rather than pretending otherwise.
   *
   * ── Why edgeless wants it too ─────────────────────────────────────────────
   *
   * Edgeless declares `background: transparent` on the content browser, on the
   * argument that the pane should show the identical stack the chrome around it
   * shows rather than a near miss. That argument only holds if there is
   * something to show *through*: with an opaque canvas underneath, "paint
   * nothing" means the content process's own white or `rgb(32,32,32)` is what
   * is left, which is a rectangle in a slightly different colour from the rest
   * of the window — the exact seam edgeless exists to remove, reintroduced
   * behind the rule that removes it.
   *
   * With the internal-pages switch on — the default — the pref was already
   * being claimed and edgeless was correct by coincidence. Turning that switch
   * off gave the canvas back and edgeless silently stopped working. So the
   * claim is now the union of the two switches that need it, which is also the
   * honest description of what the pref is for.
   */
  #syncTransparentBrowser() {
    const wanted =
      Services.prefs.getBoolPref(PREF_INTERNAL, true) ||
      Services.prefs.getBoolPref(PREF_EDGELESS, true);
    if (!wanted) {
      this.#releaseTransparentBrowser();
      return;
    }

    if (this.#previousTransparentBrowser === null) {
      const current = Services.prefs.getBoolPref(
        PREF_ALLOW_TRANSPARENT_BROWSER,
        false
      );
      if (!current) {
        this.#previousTransparentBrowser = current;
        Services.prefs.setBoolPref(PREF_ALLOW_TRANSPARENT_BROWSER, true);
        TranceLog.log(NS, `enabled ${PREF_ALLOW_TRANSPARENT_BROWSER}`);
      }
    }
    this.#markTransparentBrowsers();
  }

  /**
   * Puts `transparent="true"` back on the browsers that lost it.
   *
   * This is the other half of `#releaseTransparentBrowser`, and without it that
   * method is a one-way door — which is the whole of "the settings page keeps
   * the wrong background until a restart when you toggle anything to do with
   * transparency".
   *
   * The sequence is: something turns a transparency switch off, the release
   * strips the attribute from every live browser (it has to — see that method),
   * the switch goes back on, and the *pref* is restored but the browsers are
   * not. `tabbrowser` reads that pref when it **creates** a browser, so nothing
   * ever puts the attribute back on a tab that already exists, and the rules in
   * trance-surfaces.css and in Zen's own zen-browser-container.css that key on
   * it stay unmatched for the rest of that tab's life. Closing and reopening
   * about:preferences fixed it, which is why it read as "until restart".
   *
   * Re-stamping is safe in the direction that matters. The canvas underneath is
   * decided at construction and cannot be changed either way, so this only
   * restores what CSS matches: a browser that was built alpha-composited is
   * correctly transparent again, and one that was not shows the same thing it
   * showed before the attribute was ever removed.
   */
  #markTransparentBrowsers() {
    if (!Services.prefs.getBoolPref(PREF_ALLOW_TRANSPARENT_BROWSER, false)) {
      return;
    }
    for (const browser of this.#contentBrowsers()) {
      browser?.setAttribute(ATTR_ZEN_TRANSPARENT, "true");
    }
  }

  // --- The empty-tab mark ----------------------------------------------------

  /**
   * A mark on a tab with nothing in it.
   *
   * ── Why the chrome draws it and not the page ──────────────────────────────
   *
   * The obvious place is the new-tab page itself, and it is not reachable: an
   * `about:` document is content, no chrome stylesheet is in scope there, and
   * the one sheet Trance does register against `about:` (trance-internal.css)
   * is a USER sheet shared by every internal page in every window — so a mark
   * added there would appear on about:config and about:addons too, and could not
   * follow a per-window pref without regenerating the sheet on every change.
   *
   * So it is one absolutely-positioned box in the chrome, over the content pane,
   * shown only while the selected tab is empty. It costs an attribute and an
   * element, both of which go away the moment a real page is selected — which is
   * also why the mark cannot be a background on the `<browser>`: that would put
   * it behind the page's own canvas, where it would be visible on exactly the
   * pages that are transparent and invisible on the rest.
   */
  #applyNewtabLogo() {
    const hasLogo = !!Services.prefs.getStringPref(PREF_NEWTAB_LOGO, "").trim();
    if (!hasLogo) {
      this.#teardownNewtabLogo();
      return;
    }
    this.#ensureNewtabLogo();
    this.#applyNewtabEffects();
    this.#observeNewtab();
    this.#syncNewtab();
  }

  /**
   * The mark's two opt-out effects, as two attributes.
   *
   * Attributes rather than tokens resolving to an identity, for the reason
   * TRANCE.md §6.6 gives: the holographic sheen is a second background layer
   * and a `mask-image`, and the tilt is a `transform` with a `perspective` in
   * it. A switched-off effect should cost neither, and the only way to be sure
   * of that is for no rule to match.
   */
  #applyNewtabEffects() {
    const root = this.context.document.documentElement;
    for (const [pref, attribute] of [
      [PREF_NEWTAB_HOLOGRAPHIC, ATTR_NEWTAB_HOLOGRAPHIC],
      [PREF_NEWTAB_TILT, ATTR_NEWTAB_TILT],
    ]) {
      if (Services.prefs.getBoolPref(pref, true)) {
        root.setAttribute(attribute, "true");
      } else {
        root.removeAttribute(attribute);
      }
    }
    this.#syncPointerTracking();
  }

  #ensureNewtabLogo() {
    if (this.#newtabLogo?.isConnected) {
      return;
    }
    const doc = this.context.document;
    // The same host the loading bar uses, and for the same reason: Zen already
    // makes `#zen-tabbox-wrapper` `position: relative`, so this adds no
    // positioning context and changes nobody's layout.
    const host = doc.getElementById("zen-tabbox-wrapper");
    if (!host) {
      TranceLog.warn(NS, "#zen-tabbox-wrapper is missing; no empty-tab mark");
      return;
    }
    const logo = doc.createElement("div");
    logo.id = NEWTAB_LOGO_ID;
    logo.setAttribute("aria-hidden", "true");
    host.appendChild(logo);
    this.#newtabLogo = logo;
  }

  /**
   * The two events that change whether the selected tab is empty: selecting a
   * different one, and the one you are on going somewhere.
   *
   * Attached once and left attached, like every other listener in this project
   * that outlives a pref flip — `#syncNewtab` reads the pref, so a switched-off
   * mark costs one string read on an event the browser already dispatches.
   */
  #observeNewtab() {
    if (this.#newtabListening) {
      return;
    }
    const win = this.context.window;
    const tabbrowser = win.gBrowser;
    if (!tabbrowser?.tabContainer) {
      // Expected once, at startup; `onEnable`'s `load` listener comes back.
      return;
    }
    this.#newtabListening = true;
    this.addListener(tabbrowser.tabContainer, "TabSelect", () =>
      this.#syncNewtab()
    );
    // A newly created tab is selected before its browser publishes its final
    // initial URI. Re-check on the next frame so the mark appears with the new
    // tab instead of waiting for a later navigation event.
    this.addListener(tabbrowser.tabContainer, "TabOpen", () => {
      this.context.scheduler.onFrame(() => this.#syncNewtab(), {
        once: true,
      });
    });

    const listener = {
      onLocationChange: browser => {
        if (browser === win.gBrowser?.selectedBrowser) {
          this.#syncNewtab();
        }
      },
    };
    tabbrowser.addTabsProgressListener(listener);
    this.addDisposer(() => tabbrowser.removeTabsProgressListener(listener));
  }

  #syncNewtab() {
    const root = this.context.document.documentElement;
    const spec =
      this.context.window.gBrowser?.selectedBrowser?.currentURI?.spec;
    const empty =
      !!this.#newtabLogo &&
      !!spec &&
      EMPTY_PAGES.includes(spec.replace(/[?#].*$/, ""));
    if (empty) {
      root.setAttribute(ATTR_NEWTAB, "true");
    } else {
      root.removeAttribute(ATTR_NEWTAB);
    }
    this.#syncPointerTracking();
  }

  // --- The mark's pointer ----------------------------------------------------

  /**
   * Attaches or detaches the one `mousemove` listener the mark's effects need.
   *
   * ── Why the chrome window can see a pointer over a web page at all ────────
   *
   * The mark is `pointer-events: none` and has to stay that way: it is a 250px
   * square in the middle of the new-tab page, and a hit-testable one would eat
   * clicks on the search field underneath it. So the position cannot come from
   * the element.
   *
   * It comes from the window. In e10s a mouse event over remote content is
   * dispatched in the *parent* process first — targeted at the `<browser>` and
   * then forwarded to the child — so a listener on the chrome window sees it.
   * This is the same mechanism `MousePosTracker` (browser.js) uses to reveal
   * the toolbar in fullscreen while the pointer is over a page, and the
   * coordinate correction below is the same one it makes and for the same
   * reason: `screenX` is in the *event target's* CSS pixels, and a content
   * document may be zoomed independently of the chrome.
   *
   * ── What it costs ─────────────────────────────────────────────────────────
   *
   * The listener exists only while an empty marked tab is selected and either
   * pointer-reactive effect is on. The sheen and tilt share its two numbers,
   * but either can be used alone. Outside those, a
   * `mousemove` handler that runs during every drag, every text selection and
   * every scroll of every page is exactly the kind of thing TRANCE.md §3.2 is
   * about. Inside them, the handler stores two numbers and asks the scheduler
   * for one frame; the write happens there, so a 1000 Hz mouse produces one
   * style change per frame rather than sixteen.
   */
  #syncPointerTracking() {
    const wanted =
      !!this.#newtabLogo &&
      this.context.document.documentElement.hasAttribute(ATTR_NEWTAB) &&
      Services.prefs.getBoolPref(PREF_NEWTAB_HOVER, true) &&
      (Services.prefs.getBoolPref(PREF_NEWTAB_TILT, true) ||
        Services.prefs.getBoolPref(PREF_NEWTAB_HOLOGRAPHIC, true));

    if (wanted === this.#pointerListening) {
      return;
    }
    const win = this.context.window;
    if (wanted) {
      this.#pointerListening = true;
      win.addEventListener("mousemove", this.#onPointerMove);
      return;
    }
    this.#pointerListening = false;
    win.removeEventListener("mousemove", this.#onPointerMove);
    this.#cancelPointerFrame();
    this.#restPointer();
  }

  /**
   * Bound once, as a field, so that `addEventListener` and
   * `removeEventListener` are given the same function object — a method
   * reference would be a new bound function on each call and the remove would
   * silently do nothing.
   *
   * @param {MouseEvent} event
   */
  #onPointerMove = event => {
    const logo = this.#newtabLogo;
    if (!logo) {
      return;
    }
    const win = this.context.window;

    // `screenX` is in the CSS pixels of whatever document the event came from,
    // which for a pointer over a page is the content document and may be zoomed
    // independently of the chrome. Rescaling is what makes the comparison with
    // a chrome-side rect valid; see `MousePosTracker.handleEvent`.
    const source = event.target?.documentGlobal;
    const scale =
      source && source !== win
        ? source.devicePixelRatio / win.devicePixelRatio
        : 1;
    const x = event.screenX * scale - win.mozInnerScreenX;
    const y = event.screenY * scale - win.mozInnerScreenY;

    // `getBoundsWithoutFlushing`, not `getBoundingClientRect`: this runs on a
    // mouse event, and a synchronous layout flush per mouse move is the forced
    // reflow TRANCE.md §6.4 exists to prevent. The mark's box only changes when
    // the window resizes or the size pref moves, so a frame-stale rect is not a
    // wrong answer here.
    const rect = win.windowUtils.getBoundsWithoutFlushing(logo);
    if (!rect.width || !rect.height) {
      return;
    }
    // Unclamped first, because "inside the box" is a question the clamp
    // destroys: a pointer twice the mark's width away and a pointer on its edge
    // both read as exactly 1 afterwards.
    const px = ((x - rect.left) / rect.width) * 2 - 1;
    const py = ((y - rect.top) / rect.height) * 2 - 1;
    this.#pointer = {
      x: clampUnit(px),
      y: clampUnit(py),
      inside: Math.abs(px) <= 1 && Math.abs(py) <= 1,
    };
    this.#queuePointerWrite();
  };

  /**
   * One style write per frame, however many events arrived in it.
   *
   * `once` rather than a standing subscription: the frame loop should be awake
   * while the pointer is moving and asleep the moment it stops, and a
   * subscription that has to be cancelled on a timer is a timer.
   */
  #queuePointerWrite() {
    if (this.#pointerFrame) {
      return;
    }
    this.#pointerFrame = this.context.scheduler.onFrame(
      () => {
        this.#pointerFrame = 0;
        this.#writePointer(
          this.#pointer.x,
          this.#pointer.y,
          this.#pointer.inside
        );
      },
      { once: true }
    );
  }

  #cancelPointerFrame() {
    if (!this.#pointerFrame) {
      return;
    }
    this.context.scheduler.cancel(this.#pointerFrame);
    this.#pointerFrame = 0;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean} inside - Whether the pointer is over the mark itself.
   */
  #writePointer(x, y, inside) {
    const logo = this.#newtabLogo;
    if (!logo) {
      return;
    }
    logo.style.setProperty(NEWTAB_POINTER_X, `${x.toFixed(3)}`);
    logo.style.setProperty(NEWTAB_POINTER_Y, `${y.toFixed(3)}`);
    // Written in the same frame as the two numbers, so the lean and the reason
    // for it can never be a frame apart. The style system ignores a
    // `setAttribute` that changes nothing, so this is free while the pointer is
    // simply moving around inside — or outside — the mark.
    if (inside) {
      logo.setAttribute(ATTR_NEWTAB_POINTER_INSIDE, "true");
    } else {
      logo.removeAttribute(ATTR_NEWTAB_POINTER_INSIDE);
    }
  }

  /**
   * Puts the mark back to level.
   *
   * The properties are removed rather than set to zero, so what the mark falls
   * back to is the token — one place that decides what "at rest" means, rather
   * than two that have to agree.
   */
  #restPointer() {
    this.#pointer = { x: 0, y: 0, inside: false };
    this.#newtabLogo?.style.removeProperty(NEWTAB_POINTER_X);
    this.#newtabLogo?.style.removeProperty(NEWTAB_POINTER_Y);
    this.#newtabLogo?.removeAttribute(ATTR_NEWTAB_POINTER_INSIDE);
  }

  #teardownNewtabLogo() {
    const root = this.context.document.documentElement;
    root.removeAttribute(ATTR_NEWTAB);
    root.removeAttribute(ATTR_NEWTAB_HOLOGRAPHIC);
    root.removeAttribute(ATTR_NEWTAB_TILT);
    this.#cancelPointerFrame();
    if (this.#pointerListening) {
      this.#pointerListening = false;
      this.context.window.removeEventListener("mousemove", this.#onPointerMove);
    }
    this.#newtabLogo?.remove();
    this.#newtabLogo = null;
    // `#newtabListening` is deliberately not cleared: the listeners belong to
    // `addListener`/`addDisposer` and only go on a full teardown, so clearing it
    // on a pref flip would attach a second pair next time the pref came back.
  }

  /**
   * Gives the platform switch back — and takes the attribute off the browsers
   * that were built while it was on.
   *
   * That second half is the whole of "turning Trance off leaves the page
   * permanently tinted". `browser.tabs.allow_transparent_browser` is read when
   * `tabbrowser` *creates* a browser, so every tab opened while it was on
   * carries `transparent="true"` for the rest of its life. Zen has its own rule
   * for that attribute — a flat
   * `light-dark(rgba(255,255,255,0.6), rgba(255,255,255,0.1))` in
   * zen-browser-container.css — which Trance's rules were replacing. With
   * Trance's stylesheets gone and the attribute still there, Zen's rule is what
   * is left, so the web view keeps a white veil over it until the tab is
   * closed and reopened.
   *
   * Restoring the pref cannot fix that on its own: the pref decides what the
   * *next* browser is built with. The attribute is what CSS matches, so the
   * attribute is what has to go. The canvas stays alpha-composited underneath —
   * it cannot be changed after construction either way — and what shows through
   * it is the window, which is what shows through it in stock Zen too.
   */
  #releaseTransparentBrowser() {
    if (this.#previousTransparentBrowser === null) {
      return;
    }
    Services.prefs.setBoolPref(
      PREF_ALLOW_TRANSPARENT_BROWSER,
      this.#previousTransparentBrowser
    );
    this.#previousTransparentBrowser = null;

    if (Services.prefs.getBoolPref(PREF_ALLOW_TRANSPARENT_BROWSER, false)) {
      return;
    }
    for (const browser of this.#contentBrowsers()) {
      browser?.removeAttribute(ATTR_ZEN_TRANSPARENT);
    }
  }

  // --- The platform's own transparency ---------------------------------------

  /**
   * Turns on whichever "make the window translucent" pref this platform has.
   *
   * One of the four is claimed at most — the media query is what decides which,
   * so a macOS build never touches Mica — and the user's value is kept so that
   * switching the master off puts the browser back exactly as it was rather
   * than leaving a platform pref on that Trance turned on and nothing turns off.
   */
  #claimPlatformTransparency() {
    for (const { pref, media } of PLATFORM_TRANSPARENCY) {
      if (this.#previousPlatformTransparency.has(pref)) {
        continue;
      }
      if (!this.context.window.matchMedia(media).matches) {
        continue;
      }
      const current = Services.prefs.getBoolPref(pref, false);
      this.#previousPlatformTransparency.set(pref, current);
      if (!current) {
        Services.prefs.setBoolPref(pref, true);
        TranceLog.log(NS, `enabled ${pref}`);
      }
    }
  }

  #releasePlatformTransparency() {
    for (const [pref, previous] of this.#previousPlatformTransparency) {
      Services.prefs.setBoolPref(pref, previous);
    }
    this.#previousPlatformTransparency.clear();
  }
}
