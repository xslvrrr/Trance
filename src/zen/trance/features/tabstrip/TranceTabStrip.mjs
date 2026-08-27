// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the tab strip — one owner for the sidebar's pinned tabs, folders,
// collapsed rail and unloaded-tab state.
//
// Behaviour inspired by "SuperPins" by CosmoCreeper
// (https://github.com/CosmoCreeper/Zen-Themes), "Advanced Tab Groups" by
// Vertex-Mods (https://github.com/Vertex-Mods/Advanced-Tab-Groups),
// "Customize Collapsed Sidebar" by Ciuriya (https://github.com/Ciuriya/zen-themes)
// and "Unloaded Tabs" by qumeqa (https://github.com/qumeqa/unloaded-tabs).
// Implemented independently for Trance; no code copied. Three of them are
// unlicensed, so this is a clean-room reimplementation by requirement, not by
// preference (TRANCE.md §7.2, §7.3). Zen Folder Tree Connectors used to be in
// that list; it is preinstalled now rather than reimplemented (ADR-027).
//
// Those mods install five stylesheets and three scripts over
// `#tabbrowser-tabs`, and between them they hold at least three
// `MutationObserver`s on the same subtree — every chrome mutation fans out to
// all of them, each doing its own `querySelectorAll` and its own style write, so
// one tab opening costs several forced reflows (TRANCE.md §3.2).
//
// This module holds **one** subscription for the whole tab strip, and it is used
// for exactly one thing: keeping the `trance-folder-color` attribute in step
// with folders appearing and disappearing. The unloaded state, the collapsed
// rail and sticky pins are attribute- and CSS-driven and add nothing.
//
// Refs: TRANCE.md §3.1, §3.2, §8.1, §13 Phase 4;
// docs/trance/mods/{superpins,advanced-tab-groups,zen-folder-tree-connectors,
// customize-collapsed-sidebar,unloaded-tabs}.md

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "TabStrip";

const ATTR_ROOT = "trance-tabstrip";
const ATTR_FOLDER_COLOR = "trance-folder-color";

const COLOR_MENU_ID = "trance-folder-color-menu";
const FOLDER_ACTIONS_ID = "zenFolderActions";
const FOLDER_ICON_ITEM_ID = "context_zenFolderChangeIcon";

/**
 * Firefox's own tab-group palette, in the platform's order
 * (`MozTabbrowserTabGroupMenu.COLORS`). Trance does not define a second one:
 * the codes resolve against `--tab-group-*` in
 * `browser/themes/shared/tabbrowser/tab.tokens.css` and are persisted by
 * `TabGroupState.sys.mjs`, so a folder's colour survives a restart without
 * Trance owning any storage at all
 * (docs/trance/mods/advanced-tab-groups.md §6).
 */
const FOLDER_COLORS = Object.freeze([
  { code: "blue", label: "Blue" },
  { code: "purple", label: "Purple" },
  { code: "cyan", label: "Cyan" },
  { code: "orange", label: "Orange" },
  { code: "yellow", label: "Yellow" },
  { code: "pink", label: "Pink" },
  { code: "green", label: "Green" },
  { code: "gray", label: "Grey" },
  { code: "red", label: "Red" },
]);

/**
 * What `ZenFolders.createFolder` assigns on creation
 * (`src/zen/folders/ZenFolders.mjs:700`). There is no `--tab-group-zen-workspace-color`
 * anywhere in the tree, so this is "no colour" in practice — which is exactly
 * what Trance uses it as when the user clears one.
 */
const ZEN_DEFAULT_COLOR = "zen-workspace-color";

/**
 * Sub-features. Each is one pref, one root attribute, and no runtime cost when
 * off — the attribute is simply absent and the rules stop matching.
 */
const FLAGS = Object.freeze([
  // There is no connectors flag. Folder tree connectors are the preinstalled
  // Zen Folder Tree Connectors mod now, not a Trance drawing (ADR-027).
  {
    pref: "trance.tabstrip.folders.arc-style",
    attribute: "trance-tabstrip-folders-arc",
  },
  {
    pref: "trance.tabstrip.pins.sticky",
    attribute: "trance-tabstrip-pins-sticky",
  },
  {
    pref: "trance.tabstrip.unloaded.enabled",
    attribute: "trance-tabstrip-unloaded",
  },
  { pref: "trance.tabstrip.rail.enabled", attribute: "trance-tabstrip-rail" },
  {
    pref: "trance.tabstrip.rail.stack-top-buttons",
    attribute: "trance-tabstrip-rail-stack",
  },
]);

const PREF_FOLDER_COLORS = "trance.tabstrip.folders.colors";

const PREF_GLOW_MODE = "trance.tabstrip.glow.mode";
const ATTR_GLOW = "trance-tabstrip-glow";

/** The custom property the glow's `icon` mode paints from. */
const GLOW_COLOR_PROPERTY = "--trance-tab-glow-color";

/**
 * How the favicon is sampled, and why each number is what it is.
 *
 * The icon is drawn into a square this small on purpose: the browser's
 * downscale is a box filter, so 16×16 is already an average of every pixel in
 * the source at a sixteenth of the cost of reading the source, and a favicon
 * has no detail worth keeping at this stage anyway — the answer wanted is one
 * colour.
 *
 * `SAMPLE_BUCKET_BITS` quantises each channel before counting, so "the same
 * blue with two pixels of anti-aliasing" is one bucket rather than three. Four
 * bits is 16 levels per channel: coarse enough to merge a gradient, fine enough
 * to keep two genuinely different brand colours apart.
 */
const SAMPLE_SIZE = 16;
const SAMPLE_BUCKET_BITS = 4;
/** Below this alpha a pixel is the space around the icon, not the icon. */
const SAMPLE_MIN_ALPHA = 128;
/** Chroma below this is grey — counted, but only used if nothing else is. */
const SAMPLE_MIN_CHROMA = 16;
/**
 * How much a bucket's saturation counts against how many pixels it has.
 *
 * A favicon is usually a coloured mark on a white or transparent field, so the
 * most *frequent* colour is very often the field. Weighting by saturation is
 * what makes "the colour of that site" the mark rather than the paper it is
 * printed on, and the constant is a floor rather than a multiplier so a
 * genuinely monochrome icon still resolves to its own grey.
 */
const SAMPLE_CHROMA_WEIGHT = 3;

/**
 * The band the sampled colour is pushed into before it is used.
 *
 * A glow has to be visible against the chrome, and a favicon is under no
 * obligation to be: GitHub's is near-black, and painted literally it is a glow
 * you cannot see on a dark browser — the same failure `--trance-accent-vivid`
 * exists to fix for the space accent, arrived at from the other direction.
 */
const GLOW_MIN_SATURATION = 0.45;
const GLOW_MIN_LIGHTNESS = 0.45;
const GLOW_MAX_LIGHTNESS = 0.7;

/**
 * How many favicons' colours are kept.
 *
 * Bounded because this is a cache on a long-lived window and an unbounded one
 * is a leak with a slow fuse. Sixty-four is comfortably more than the number of
 * distinct sites a person switches between in a session, and each entry is a
 * string.
 */
const GLOW_CACHE_LIMIT = 64;

/**
 * Glow modes, in the words the pref uses.
 *
 * `none` is not a mode that draws nothing — it is the absence of the attribute,
 * so no rule in trance-tabstrip.css matches and no pseudo-element is generated
 * (TRANCE.md §6.6).
 */
const GLOW_MODES = Object.freeze(["none", "theme", "icon"]);
const GLOW_ICON = "icon";

export class TranceTabStrip extends TranceFeature {
  static prefName = "trance.tabstrip.enabled";
  static featureName = "TabStrip";
  static styles = [
    "chrome://browser/content/trance-styles/trance-tabstrip.css",
  ];

  /** The submenu appended to Zen's folder context menu, while enabled. */
  #colorMenu = null;
  /** The folder the context menu was last opened on. */
  #contextFolder = null;
  /** Whether the two tab-selection listeners the glow needs are attached. */
  #glowListening = false;
  /** The tab currently carrying an inline glow colour, so it can be cleared. */
  #glowTab = null;
  /**
   * Favicon URL → the colour sampled from it, bounded to `GLOW_CACHE_LIMIT`.
   *
   * @type {Map<string, string>}
   */
  #glowColors = new Map();
  /**
   * The favicon a sample is in flight for.
   *
   * Reading an image is asynchronous, and a person switching tabs quickly can
   * start three samples before the first finishes. Without this, the *last* one
   * to decode wins rather than the last one asked for, and the glow settles on
   * whichever site happened to be slowest.
   */
  #glowPending = null;

  onEnable() {
    this.context.document.documentElement.setAttribute(ATTR_ROOT, "true");

    this.#bindTokens();
    this.#observeFlags();
    this.#applyFlags();
    this.#setUpFolderColors();

    // Attributes first, so the stylesheet is right immediately; then again once
    // `gBrowser` exists, because the glow's `icon` mode needs a selected tab to
    // read a favicon from and TranceCore enters at `MozBeforeInitialXULLayout`,
    // before there is one.
    this.#applyGlow();
    const win = this.context.window;
    if (!win.gBrowser?.tabContainer) {
      this.addListener(win, "load", () => this.#applyGlow(), { once: true });
    }
  }

  onDisable() {
    const root = this.context.document.documentElement;
    root.removeAttribute(ATTR_ROOT);
    root.removeAttribute(ATTR_GLOW);
    for (const { attribute } of FLAGS) {
      root.removeAttribute(attribute);
    }
    this.#clearGlowColor();
    this.#glowColors.clear();
    this.#tearDownFolderColors();
  }

  // --- Tokens ----------------------------------------------------------------

  /**
   * The rail's geometry and the unloaded-tab treatment follow their prefs
   * directly. A slider costs one `setProperty`; no rule is re-matched and no
   * stylesheet is rebuilt, which is the difference between this and five mods
   * regenerating `zen-themes.css` between them (TRANCE.md §3.1).
   */
  #bindTokens() {
    const px = value => `${Math.max(0, value)}px`;
    const percent = value => `${Math.min(100, Math.max(0, value))}%`;

    this.bindTokens([
      {
        pref: "trance.tabstrip.rail.width",
        cssVar: "--trance-rail-width",
        type: "int",
        fallback: 48,
        format: px,
      },
      {
        pref: "trance.tabstrip.rail.tab-size",
        cssVar: "--trance-rail-tab-size",
        type: "int",
        fallback: 36,
        format: px,
      },
      {
        pref: "trance.tabstrip.rail.icon-size",
        cssVar: "--trance-rail-icon-size",
        type: "int",
        fallback: 16,
        format: px,
      },
      {
        pref: "trance.tabstrip.rail.margin-top",
        cssVar: "--trance-rail-margin-top",
        type: "int",
        fallback: 0,
        format: px,
      },
      {
        pref: "trance.tabstrip.rail.margin-bottom",
        cssVar: "--trance-rail-margin-bottom",
        type: "int",
        fallback: 0,
        format: px,
      },
      {
        pref: "trance.tabstrip.unloaded.opacity",
        cssVar: "--trance-tab-unloaded-opacity",
        type: "int",
        fallback: 55,
        format: percent,
      },
      {
        pref: "trance.tabstrip.unloaded.saturation",
        cssVar: "--trance-tab-unloaded-saturation",
        type: "int",
        fallback: 0,
        format: percent,
      },
      {
        // How far past the tab the glow reaches. Capped rather than validated:
        // the stylesheet opens the tab's `overflow-clip-margin` to this reach,
        // and an unbounded value from about:config would let one tab's glow
        // paint over the whole sidebar.
        pref: "trance.tabstrip.glow.spread",
        cssVar: "--trance-tab-glow-spread",
        type: "int",
        fallback: 6,
        format: value => `${Math.max(0, Math.min(48, value))}px`,
      },
      {
        pref: "trance.tabstrip.glow.opacity",
        cssVar: "--trance-tab-glow-alpha",
        type: "int",
        fallback: 80,
        format: value => `${Math.min(100, Math.max(0, value)) / 100}`,
      },
    ]);
  }

  // --- Sub-feature flags -----------------------------------------------------

  #observeFlags() {
    for (const flag of FLAGS) {
      const observer = { observe: () => this.#applyFlags() };
      Services.prefs.addObserver(flag.pref, observer);
      this.addDisposer(() =>
        Services.prefs.removeObserver(flag.pref, observer)
      );
    }

    const colorsObserver = { observe: () => this.#syncFolderColorFeature() };
    Services.prefs.addObserver(PREF_FOLDER_COLORS, colorsObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_FOLDER_COLORS, colorsObserver)
    );

    const glowObserver = { observe: () => this.#applyGlow() };
    Services.prefs.addObserver(PREF_GLOW_MODE, glowObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_GLOW_MODE, glowObserver)
    );
  }

  #applyFlags() {
    const root = this.context.document.documentElement;
    for (const { pref, attribute } of FLAGS) {
      if (Services.prefs.getBoolPref(pref, true)) {
        root.setAttribute(attribute, "true");
      } else {
        root.removeAttribute(attribute);
      }
    }
  }

  // --- Active tab glow -------------------------------------------------------

  /**
   * @returns {string} A member of `GLOW_MODES`.
   */
  get #glowMode() {
    const value = Services.prefs.getStringPref(PREF_GLOW_MODE, "none");
    return GLOW_MODES.includes(value) ? value : "none";
  }

  /**
   * Publishes the mode and, in `icon` mode, keeps the selected tab's favicon on
   * the tab.
   *
   * `none` removes the attribute rather than setting it to "none". The
   * difference is not cosmetic: with the attribute absent no rule in
   * trance-tabstrip.css matches, so the pseudo-element is never generated and
   * the tab's `overflow-clip-margin` is Firefox's own again — which is
   * TRANCE.md §6.6's "a switched-off feature costs nothing", applied to a
   * three-valued setting rather than to a checkbox.
   */
  #applyGlow() {
    const root = this.context.document.documentElement;
    const mode = this.#glowMode;

    if (mode === "none") {
      root.removeAttribute(ATTR_GLOW);
      this.#clearGlowColor();
      return;
    }
    root.setAttribute(ATTR_GLOW, mode);

    if (mode === GLOW_ICON) {
      this.#observeGlow();
      this.#syncGlowColor();
    } else {
      // The listeners stay: see `#observeGlow`. Only the inline property goes,
      // so that `theme` mode resolves the token — the space accent — rather
      // than whatever site the last `icon` session left on the tab.
      this.#clearGlowColor();
    }
  }

  /**
   * The two events that change which favicon the glow should be showing.
   *
   * Attached once, for the life of the feature, and never removed on a mere
   * mode change — they belong to `addListener`, whose disposers only run on a
   * full teardown, so re-attaching on every flip would stack a second pair per
   * flip. Both handlers read the mode and return immediately when it is not
   * `icon`, which is the same shape `TranceFeedback` uses for its `TabClose`
   * listener and for the same reason.
   */
  #observeGlow() {
    if (this.#glowListening) {
      return;
    }
    const container = this.context.window.gBrowser?.tabContainer;
    if (!container) {
      // Expected once, at startup: TranceCore runs before gBrowser is built,
      // and `onEnable` comes back through the window's `load`.
      return;
    }
    this.#glowListening = true;

    this.addListener(container, "TabSelect", () => this.#syncGlowColor());
    // A favicon arrives after the tab does — a fresh tab has none until the
    // page has been fetched — so the glow would otherwise be empty for exactly
    // the load everyone is looking at. `TabAttrModified` is the event Firefox
    // already fires for it; a MutationObserver here would be inferring what
    // this states (TRANCE.md §3.2).
    this.addListener(container, "TabAttrModified", event => {
      if (event.detail?.changed?.includes("image")) {
        this.#syncGlowColor();
      }
    });
  }

  /**
   * Writes the selected tab's own colour onto the selected tab.
   *
   * One tab carries the property at a time, which is why the previous one is
   * cleared first: the rules only draw for `[visuallyselected]`, so a stale
   * value on another tab is invisible until that tab is selected again — at
   * which point it would show the wrong colour for a frame.
   *
   * A cached favicon resolves synchronously and nothing is scheduled. A new one
   * costs one image decode and one 16×16 canvas read, once, and the answer is
   * kept — see `#sampleFavicon`.
   */
  #syncGlowColor() {
    if (this.#glowMode !== GLOW_ICON) {
      return;
    }
    const tab = this.context.window.gBrowser?.selectedTab ?? null;
    if (tab !== this.#glowTab) {
      this.#clearGlowColor();
    }
    // `tab.image` is the resolved favicon URL Firefox already keeps on the tab.
    const image = tab?.image ?? "";
    if (!tab || !image) {
      return;
    }

    const cached = this.#glowColors.get(image);
    if (cached) {
      this.#writeGlowColor(tab, cached);
      return;
    }

    this.#glowPending = image;
    this.#sampleFavicon(image).then(color => {
      if (!color) {
        return;
      }
      this.#remember(image, color);
      // Everything may have moved while the image decoded: a different tab may
      // be selected, that tab's favicon may have been replaced, and the mode
      // may have been switched off. All three are checked rather than assumed.
      if (this.#glowPending !== image || this.#glowMode !== GLOW_ICON) {
        return;
      }
      const current = this.context.window.gBrowser?.selectedTab ?? null;
      if (current && current.image === image) {
        this.#writeGlowColor(current, color);
      }
    });
  }

  /**
   * @param {Element} tab
   * @param {string} color
   */
  #writeGlowColor(tab, color) {
    tab.style.setProperty(GLOW_COLOR_PROPERTY, color);
    this.#glowTab = tab;
  }

  /**
   * @param {string} image - The favicon URL the colour was sampled from.
   * @param {string} color
   */
  #remember(image, color) {
    // Insertion-ordered, so the first key is the oldest. One eviction per
    // insertion past the limit is all a cache this size needs; an LRU would be
    // more bookkeeping than the thing it is keeping.
    if (this.#glowColors.size >= GLOW_CACHE_LIMIT) {
      const oldest = this.#glowColors.keys().next().value;
      this.#glowColors.delete(oldest);
    }
    this.#glowColors.set(image, color);
  }

  #clearGlowColor() {
    this.#glowTab?.style.removeProperty(GLOW_COLOR_PROPERTY);
    this.#glowTab = null;
    this.#glowPending = null;
  }

  // --- Reading a favicon's colour --------------------------------------------

  /**
   * The dominant colour of one favicon, as a CSS colour, or null.
   *
   * ── Why the browser has to draw it to find out ────────────────────────────
   *
   * There is no API that answers "what colour is this image". `mozIColorAnalyzer`
   * was that API and it is gone from the tree. So the icon is decoded, drawn
   * into a 16×16 canvas, and the pixels are counted — which is exactly the work
   * the previous implementation refused to do (see the comment this replaces in
   * prefs/trance/tabstrip.yaml) and is affordable for the same reason that
   * refusal was reasonable: it happens **once per favicon**, not once per tab
   * switch and certainly not once per frame. The blur it replaces ran on every
   * repaint of the busiest element in the sidebar.
   *
   * The canvas is tainted by a cross-origin favicon and read anyway: this is
   * chrome, and `HTMLCanvasElement::CallerCanRead` grants the system principal
   * `all_urls` (nsContentUtils::PrincipalHasPermission). Nothing sampled here
   * leaves the parent process or is persisted — it is one colour, held in a
   * bounded in-memory map for the life of the window.
   *
   * @param {string} url - A favicon URL from `tab.image`.
   * @returns {Promise<string | null>}
   */
  #sampleFavicon(url) {
    const win = this.context.window;
    const doc = this.context.document;

    return new Promise(resolve => {
      const image = new win.Image();
      image.onload = () => {
        try {
          resolve(this.#dominantColor(doc, win, image));
        } catch (error) {
          // A decode that produced no drawable image, or a canvas read that
          // was refused. Neither is worth a console error on every tab switch
          // to a site with a broken icon: the glow falls back to the accent,
          // which is a correct answer rather than an absent one.
          TranceLog.log(NS, `could not read ${url.slice(0, 64)}`, error);
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  /**
   * Counts the pixels and picks the bucket that best answers "what colour is
   * this".
   *
   * Most frequent is the wrong answer on its own: a favicon is usually a
   * coloured mark on a white or transparent field, so the field wins on count
   * every time. Frequency weighted by chroma is what picks the mark — and the
   * weight is a floor rather than a multiplier, so a genuinely grey icon still
   * resolves to its own grey instead of to whatever stray anti-aliased pixel
   * happened to be the most colourful thing in it.
   *
   * @param {Document} doc
   * @param {Window} win
   * @param {HTMLImageElement} image
   * @returns {string | null}
   */
  #dominantColor(doc, win, image) {
    const canvas = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas"
    );
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: false });
    if (!context) {
      return null;
    }
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    /** @type {Map<number, {count: number, chroma: number, r: number, g: number, b: number}>} */
    const buckets = new Map();
    const shift = 8 - SAMPLE_BUCKET_BITS;

    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < SAMPLE_MIN_ALPHA) {
        continue;
      }
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const key =
        ((r >> shift) << (2 * SAMPLE_BUCKET_BITS)) |
        ((g >> shift) << SAMPLE_BUCKET_BITS) |
        (b >> shift);

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { count: 0, chroma: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      bucket.chroma = Math.max(bucket.chroma, chroma);
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    }

    let best = null;
    let bestScore = -1;
    for (const bucket of buckets.values()) {
      const coloured = bucket.chroma >= SAMPLE_MIN_CHROMA;
      const score = bucket.count * (1 + (coloured ? SAMPLE_CHROMA_WEIGHT : 0));
      if (score > bestScore) {
        bestScore = score;
        best = bucket;
      }
    }
    if (!best) {
      return null;
    }

    return this.#liftForGlow(
      Math.round(best.r / best.count),
      Math.round(best.g / best.count),
      Math.round(best.b / best.count)
    );
  }

  /**
   * The sampled colour, pushed into a band where it is actually visible as a
   * glow.
   *
   * A favicon is under no obligation to contrast with a browser chrome —
   * GitHub's is near-black, Medium's is black-on-white — so painted literally
   * the glow for those sites is invisible on a dark window and washed out on a
   * light one. This is the same correction `--trance-accent-vivid` makes for the
   * space accent, done here rather than in CSS because the token's own default
   * *is* that accent and mixing it a second time in the rule would mute the one
   * value that is already correct.
   *
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @returns {string} An `hsl()` colour.
   */
  #liftForGlow(r, g, b) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;

    let hue = 0;
    if (delta !== 0) {
      if (max === red) {
        hue = ((green - blue) / delta) % 6;
      } else if (max === green) {
        hue = (blue - red) / delta + 2;
      } else {
        hue = (red - green) / delta + 4;
      }
      hue *= 60;
      if (hue < 0) {
        hue += 360;
      }
    }

    let lightness = (max + min) / 2;
    let saturation =
      delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

    // A grey icon stays grey — lifting its saturation would invent a hue the
    // site does not have — but it still has to be light enough to read.
    if (delta !== 0) {
      saturation = Math.max(GLOW_MIN_SATURATION, saturation);
    }
    lightness = Math.min(
      GLOW_MAX_LIGHTNESS,
      Math.max(GLOW_MIN_LIGHTNESS, lightness)
    );

    return (
      `hsl(${Math.round(hue)} ${Math.round(saturation * 100)}% ` +
      `${Math.round(lightness * 100)}%)`
    );
  }

  // --- Folder colour ---------------------------------------------------------

  #setUpFolderColors() {
    // One subscription, for the whole tab strip. `zen-workspace` rather than
    // `zen-folder` because a folder added at the top level of a space has no
    // `zen-folder` ancestor for the hub to match on.
    this.observeMutations(
      "zen-workspace",
      records => this.#onStripMutated(records),
      { childList: true, subtree: true }
    );

    const popup = this.context.document.getElementById(FOLDER_ACTIONS_ID);
    if (popup) {
      const onPopupShowing = event => this.#onFolderMenuShowing(event);
      this.addListener(popup, "popupshowing", onPopupShowing);
    }

    this.#syncFolderColorFeature();
  }

  #tearDownFolderColors() {
    this.#removeColorMenu();
    this.#contextFolder = null;
    for (const folder of this.#folders()) {
      folder.removeAttribute(ATTR_FOLDER_COLOR);
    }
  }

  /**
   * The colour sub-feature can be turned off without turning the tab strip off.
   * Doing so removes the menu and every attribute, but deliberately leaves
   * `folder.color` alone: that is Firefox's state, not Trance's, and discarding
   * the user's choices on a pref flip would be the opposite of reversible.
   */
  #syncFolderColorFeature() {
    if (Services.prefs.getBoolPref(PREF_FOLDER_COLORS, true)) {
      this.#ensureColorMenu();
      this.#stampFolders();
      return;
    }
    this.#removeColorMenu();
    for (const folder of this.#folders()) {
      folder.removeAttribute(ATTR_FOLDER_COLOR);
    }
  }

  #folders() {
    return this.context.document.querySelectorAll("zen-folder");
  }

  /**
   * Rescans only when the mutation actually involved a folder. A tab opening
   * mutates this subtree too, and rescanning the folder tree for every tab is
   * the kind of work the mods this replaces did unconditionally.
   *
   * @param {MutationRecord[]} records - The batch the hub flushed.
   */
  #onStripMutated(records) {
    const touchedAFolder = records.some(record =>
      [...record.addedNodes, ...record.removedNodes].some(
        node =>
          node.nodeType === node.ELEMENT_NODE &&
          (node.localName === "zen-folder" ||
            node.querySelector?.("zen-folder"))
      )
    );
    if (!touchedAFolder) {
      return;
    }
    this.#stampFolders();
  }

  /**
   * Marks folders that carry a real platform colour. Without the attribute the
   * stylesheet cannot tell one from a folder still holding Zen's
   * `zen-workspace-color` sentinel, whose token does not exist — tinting those
   * would resolve every folder variable to nothing.
   */
  #stampFolders() {
    if (!Services.prefs.getBoolPref(PREF_FOLDER_COLORS, true)) {
      return;
    }
    for (const folder of this.#folders()) {
      const code = folder.color;
      if (FOLDER_COLORS.some(color => color.code === code)) {
        folder.setAttribute(ATTR_FOLDER_COLOR, code);
      } else {
        folder.removeAttribute(ATTR_FOLDER_COLOR);
      }
    }
  }

  // --- The context-menu submenu ----------------------------------------------

  /**
   * Appended to Zen's own `#zenFolderActions` at runtime rather than added to
   * `popups.inc`. Two reasons: it costs no upstream touchpoint, and a disabled
   * feature leaves no dead menu item behind (TRANCE.md §6.5).
   */
  #ensureColorMenu() {
    if (this.#colorMenu?.isConnected) {
      return;
    }
    const doc = this.context.document;
    const popup = doc.getElementById(FOLDER_ACTIONS_ID);
    if (!popup) {
      TranceLog.warn(NS, `#${FOLDER_ACTIONS_ID} is missing; no colour menu`);
      return;
    }

    const menu = doc.createXULElement("menu");
    menu.id = COLOR_MENU_ID;
    menu.setAttribute("label", "Folder colour");

    const menupopup = doc.createXULElement("menupopup");
    for (const { code, label } of FOLDER_COLORS) {
      menupopup.appendChild(this.#createColorItem(code, label));
    }
    menupopup.appendChild(doc.createXULElement("menuseparator"));
    menupopup.appendChild(this.#createColorItem(ZEN_DEFAULT_COLOR, "Default"));

    menu.appendChild(menupopup);

    const iconItem = doc.getElementById(FOLDER_ICON_ITEM_ID);
    if (iconItem?.parentElement === popup) {
      iconItem.after(menu);
    } else {
      popup.appendChild(menu);
    }
    this.#colorMenu = menu;
  }

  #createColorItem(code, label) {
    const item = this.context.document.createXULElement("menuitem");
    item.setAttribute("type", "radio");
    item.setAttribute("name", COLOR_MENU_ID);
    item.setAttribute("value", code);
    item.setAttribute("label", label);
    item.addEventListener("command", () => this.#applyColor(code));
    return item;
  }

  #removeColorMenu() {
    this.#colorMenu?.remove();
    this.#colorMenu = null;
  }

  /**
   * Zen keeps its own private handle on the folder the menu was opened for, so
   * this repeats the derivation rather than reaching into it. Same three cases
   * Zen handles in `ZenFolders`: the label, a child of the label, and the label
   * container itself.
   *
   * @param {Event} event - Zen's `#zenFolderActions` popupshowing.
   */
  #onFolderMenuShowing(event) {
    const target = event.explicitOriginalTarget;
    let folder = null;
    if (target?.parentElement?.isZenFolder) {
      folder = target.parentElement;
    } else if (target?.closest) {
      folder = target.closest("zen-folder");
    }
    this.#contextFolder = folder?.isZenFolder ? folder : null;

    if (this.#colorMenu) {
      this.#colorMenu.hidden = !this.#contextFolder;
      const current = this.#contextFolder?.color ?? ZEN_DEFAULT_COLOR;
      for (const item of this.#colorMenu.querySelectorAll("menuitem")) {
        item.setAttribute(
          "checked",
          String(item.getAttribute("value") === current)
        );
      }
    }
  }

  #applyColor(code) {
    const folder = this.#contextFolder;
    if (!folder?.isZenFolder) {
      return;
    }
    // The platform setter writes the inline custom properties and
    // `TabGroupState` persists the code. Trance's attribute only says "this one
    // has a real colour".
    folder.color = code;
    if (code === ZEN_DEFAULT_COLOR) {
      folder.removeAttribute(ATTR_FOLDER_COLOR);
    } else {
      folder.setAttribute(ATTR_FOLDER_COLOR, code);
    }
    TranceLog.log(NS, `folder colour set to ${code}`);
  }
}
