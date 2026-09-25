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
// This module replaces all four with a bounded set of regions. In the
// sidebar-and-toolbar layout the sidebar and toolbar blur separately, with the
// narrow splitter between them covering their measured seam; when the address
// bar is extended, it takes the toolbar's place. The background sheen remains
// a separate layer and is not a backdrop-filter surface.
//
// Per-region controls stay gone (ADR-041): "frost the sidebar but not the
// toolbar" is not a useful product choice, and presets only move tokens the
// sliders already own. There is no `content` region either (ADR-042). The
// budget remains three regions at most (ADR-019), and blur is gated on
// transparency as well as visibility.
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
 * Whether the primary button is held while the pointer is inside the mark.
 *
 * Holding the mark leans it further — the stylesheet swaps the tilt token for
 * `--trance-newtab-logo-tilt-pressed` while this is set. It is only ever set
 * alongside `ATTR_NEWTAB_POINTER_INSIDE`, in the same frame-coalesced write,
 * so "pressed" always means "pressed on the mark", never "pressed anywhere".
 */
const ATTR_NEWTAB_POINTER_PRESSED = "trance-newtab-logo-pressed";

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
 * The `about:` sheet, and the generated one-liner that carries the one value it
 * cannot read from the token layer.
 *
 * Both are application-wide USER sheets. `TranceGlobalSheetOwner` keeps the
 * fixed sheet refcounted across windows and gives the generated value one
 * coalesced slot, so changing opacity does not invalidate every document once
 * per window.
 */
const INTERNAL_SHEET_URL =
  "chrome://browser/content/trance-styles/trance-internal.css";

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

  /** Whether this window holds the fixed `about:` sheet. */
  #holdsInternalSheets = false;
  /** Subscription that marks top-level navigations as internal pages. */
  #internalNavigationHandle = null;
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
  /** Whether the mark's press listeners are attached. */
  #pressListening = false;
  /** Whether the primary button is down, as the window last saw it. */
  #pressed = false;
  /** The pending idle callback for the page-opacity sheet swap, or 0. */
  #alphaHandle = 0;

  onEnable() {
    this.#bindTokens();
    this.#observePrefs();

    this.#applyShape();
    this.#applyRegions();

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
    this.context.material.reset();
    // The latches guard against attaching a second copy while the feature is
    // enabled and a sub-pref flips. A full teardown is the other case: the base
    // class has just run every disposer, so the listeners are gone and the
    // latches have to say so, or re-enabling the feature would leave the empty
    // tab mark and the pointer parallax permanently dead.
    this.#newtabListening = false;
    this.#pointerListening = false;
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

    for (const pref of [
      PREF_SUSPEND,
      PREF_KEEP_UNFOCUSED,
      "trance.surface.blur.radius",
    ]) {
      const observer = { observe: () => this.#applyMaterial() };
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
    // Its own observer does only the one thing that value changes, and
    // coalesces a drag into one generated-sheet slot update (ADR-046).
    const alphaObserver = { observe: () => this.#queueInternalAlpha() };
    Services.prefs.addObserver(PREF_INTERNAL_OPACITY, alphaObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_INTERNAL_OPACITY, alphaObserver)
    );
  }

  /**
   * The master transparency switch is one material intent alongside the
   * unfocused-window policy and content-canvas requirement. The material owner
   * translates that intent into platform prefs, browser attributes, and the
   * root attributes consumed by the surface stylesheet.
   */
  #applyRegions() {
    this.#applyMaterial();
  }

  #applyMaterial() {
    this.context.material.apply({
      transparent: Services.prefs.getBoolPref(PREF_TRANSPARENCY, true),
      blurRadius: Math.max(
        0,
        Services.prefs.getIntPref("trance.surface.blur.radius", 24)
      ),
      keepUnfocused: Services.prefs.getBoolPref(PREF_KEEP_UNFOCUSED, false),
      suspendWhenUnfocused: Services.prefs.getBoolPref(PREF_SUSPEND, true),
      contentTransparency:
        Services.prefs.getBoolPref(PREF_INTERNAL, true) ||
        Services.prefs.getBoolPref(PREF_EDGELESS, true),
    });
  }

  // --- Shape and internal pages ---------------------------------------------

  /**
   * The switches that change surface shape and browser-page treatment:
   * edgeless geometry, the background image, and internal pages.
   *
   * Internal pages and edgeless mode both request content transparency through
   * the material intent below; keeping that union in one place prevents a
   * platform claim from being made twice and released once.
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

    this.#applyMaterial();
  }

  /**
   * Registers the fixed `about:` USER sheet and the generated alpha slot, then
   * starts marking the browsers that hold an `about:` page.
   *
   * The sheets are application-wide, so the owner and its slot registry carry
   * the cross-window lifetime; the marker remains per window because browsers
   * are.
   */
  #claimInternalPages() {
    if (!this.#holdsInternalSheets) {
      this.#holdsInternalSheets = true;
      this.globalSheets.hold(INTERNAL_SHEET_URL);
    }
    this.#syncInternalAlpha();

    if (this.#internalNavigationHandle === null) {
      this.#observeInternalPages();
    }
    this.#markAllBrowsers();
  }

  #releaseInternalPages() {
    if (this.#alphaHandle) {
      this.context.scheduler.cancel(this.#alphaHandle);
      this.#alphaHandle = 0;
    }
    if (this.#holdsInternalSheets) {
      this.#holdsInternalSheets = false;
      this.globalSheets.release(INTERNAL_SHEET_URL);
      this.globalSheets.releaseSlot("internal-alpha");
    }

    if (this.#internalNavigationHandle !== null) {
      this.context.navigation.unsubscribe(this.#internalNavigationHandle);
      this.#internalNavigationHandle = null;
    }

    for (const browser of this.#contentBrowsers()) {
      browser.removeAttribute(ATTR_INTERNAL_PAGE);
    }
  }

  /**
   * Asks for the alpha slot to be updated, at most once per idle period.
   *
   * The generated value cannot be an inline token because `trance-internal.css`
   * runs in a content document. The global-sheet owner swaps one named slot,
   * coalescing this window's opacity changes with the process-wide sheet state.
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

  #syncInternalAlpha() {
    const percent = Math.min(
      100,
      Math.max(0, Services.prefs.getIntPref(PREF_INTERNAL_OPACITY, 55))
    );
    this.globalSheets.setSlot("internal-alpha", internalAlphaSheetURL(percent));
  }

  /**
   * Marks the browsers holding an `about:` page.
   *
   * CSS cannot ask what a `<browser>` is showing, and the alternative — making
   * every content browser transparent — is what the edgeless rule in
   * trance-surfaces.css exists to undo, because it would make arbitrary
   * websites translucent too.
   *
   * The shared navigation router filters to top-level location changes and
   * coalesces delivery, so this feature only marks the browser it is given.
   */
  #observeInternalPages() {
    this.#internalNavigationHandle = this.observeNavigation({
      onNavigate: browser => this.#markBrowser(browser),
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
    //
    // Through the feature's own `onFrame`, not the scheduler's: a handle taken
    // straight from `context.scheduler` is not in this feature's disposer list,
    // so a tab opened in the same frame as the feature being switched off ran
    // its callback afterwards, against a feature that had already given its
    // attributes back (AUDIT.md Phase 3).
    this.addListener(tabbrowser.tabContainer, "TabOpen", () => {
      this.onFrame(() => this.#syncNewtab(), { once: true });
    });

    // `onProgress` as well as `onNavigate`, and that pair is the whole of the
    // "mark over a loading page" report.
    //
    // A browser's `currentURI` is the document it is *showing*, not the one it
    // is fetching. Clicking a link on the new-tab page therefore leaves the
    // spec at `about:newtab` — and a tab opened for `about:preferences` leaves
    // it at `about:blank` — for the whole network wait, because
    // `onLocationChange` does not fire until the new document commits. The
    // mark was hiding at the right moment; it was showing for the entire load
    // before it. `onNavigate` alone cannot see that interval, since the only
    // event inside it is the load starting.
    this.observeNavigation(
      {
        onNavigate: () => this.#syncNewtab(),
        onProgress: () => this.#syncNewtab(),
      },
      { selectedOnly: true }
    );
  }

  /**
   * Whether the selected browser is between a load starting and that load
   * finishing.
   *
   * The router's own state first, because it is the same fact the loading bar
   * is drawn from and it is already maintained per browser. `webProgress` is
   * the fallback for the one case the router has no answer for: a browser it
   * has not seen a state change for yet, at startup.
   *
   * @param {object} browser
   * @returns {boolean}
   */
  #isLoading(browser) {
    if (!browser) {
      return false;
    }
    const state = this.context.navigation?.stateFor(browser);
    if (state && typeof state.loading === "boolean") {
      return state.loading;
    }
    return Boolean(browser.webProgress?.isLoadingDocument);
  }

  #syncNewtab() {
    const root = this.context.document.documentElement;
    const browser = this.context.window.gBrowser?.selectedBrowser;
    const spec = browser?.currentURI?.spec;
    const empty =
      !!this.#newtabLogo &&
      !!spec &&
      EMPTY_PAGES.includes(spec.replace(/[?#].*$/, "")) &&
      !this.#isLoading(browser);
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

    // The press only strengthens the lean, so it listens only while the tilt
    // is on: with the sheen alone there is nothing for a press to change.
    this.#syncPressTracking(
      wanted && Services.prefs.getBoolPref(PREF_NEWTAB_TILT, true)
    );

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
   * Attaches or detaches the window `mousedown`/`mouseup` pair that drives the
   * held-press lean. From the window, for the same reason the move listener
   * is: the mark is `pointer-events: none` and never receives its own events.
   *
   * @param {boolean} wanted
   */
  #syncPressTracking(wanted) {
    if (wanted === this.#pressListening) {
      return;
    }
    const win = this.context.window;
    this.#pressListening = wanted;
    if (wanted) {
      win.addEventListener("mousedown", this.#onPointerDown);
      win.addEventListener("mouseup", this.#onPointerUp);
      return;
    }
    win.removeEventListener("mousedown", this.#onPointerDown);
    win.removeEventListener("mouseup", this.#onPointerUp);
    this.#pressed = false;
    this.#newtabLogo?.removeAttribute(ATTR_NEWTAB_POINTER_PRESSED);
  }

  /**
   * A press is written straight away, without waiting for a move, so holding
   * the button still leans the mark further.
   *
   * @param {MouseEvent} event
   */
  #onPointerDown = event => {
    if (event.button !== 0) {
      return;
    }
    this.#pressed = true;
    this.#queuePointerWrite();
  };

  /** @param {MouseEvent} event */
  #onPointerUp = event => {
    if (event.button !== 0) {
      return;
    }
    this.#pressed = false;
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
    if (inside && this.#pressed) {
      logo.setAttribute(ATTR_NEWTAB_POINTER_PRESSED, "true");
    } else {
      logo.removeAttribute(ATTR_NEWTAB_POINTER_PRESSED);
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
    this.#newtabLogo?.removeAttribute(ATTR_NEWTAB_POINTER_PRESSED);
  }

  #teardownNewtabLogo() {
    const root = this.context.document.documentElement;
    root.removeAttribute(ATTR_NEWTAB);
    root.removeAttribute(ATTR_NEWTAB_HOLOGRAPHIC);
    root.removeAttribute(ATTR_NEWTAB_TILT);
    this.#cancelPointerFrame();
    this.#syncPressTracking(false);
    if (this.#pointerListening) {
      this.#pointerListening = false;
      this.context.window.removeEventListener("mousemove", this.#onPointerMove);
    }
    this.#newtabLogo?.remove();
    this.#newtabLogo = null;
    // `#newtabListening` is deliberately not cleared here: the listeners belong
    // to `addListener`/`addDisposer` and only go on a full teardown, so
    // clearing it on a sub-pref flip would attach a second pair next time the
    // pref came back. `onDisable` is where it is cleared, because that is the
    // point at which the disposers have actually run.
  }
}
