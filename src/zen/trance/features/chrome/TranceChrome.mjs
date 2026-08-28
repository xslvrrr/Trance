// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the chrome furniture — icons, menus, panels, the new-tab button and
// the address bar.
//
// Behaviour inspired by "Context Menu Icons" by Starry
// (https://github.com/Starry-AXQG/Context-Menu-Icons, MIT), "Zen Context Menu"
// by KiKaraage (https://github.com/KiKaraage/ZenMods, MIT), "Hide Extension
// Name" by ch4og (https://github.com/ch4og/zenbrowser-themes, MIT), "Zen Custom
// URL Bar" by rasyidrafi (https://github.com/rasyidrafi/zen-custom-urlbar,
// Apache-2.0), "Better New Tab Button" by themaster5209
// (https://github.com/themaster5209/zen-better-new-tab-button), "New Icons" and
// "Nova UI" by qumeqa (https://github.com/qumeqa/zen-icons,
// https://github.com/qumeqa/nova).
//
// Everything here is written for Trance: three of those seven mods carry no
// licence at all and nothing may be taken from them (TRANCE.md §7.3).
//
// Seven mods, four icon sets, and roughly fifty preferences between them, all
// arguing over `.subviewbutton`, `menuitem` and `#urlbar`. New Icons and Nova UI
// both restyle the toolbar; Context Menu Icons adds icons to menus while Zen
// Context Menu removes them, on the same selectors, with the winner decided by
// Sine's load order (TRANCE.md §3.1, §3.8).
//
// Trance ships no icon pack of its own. It preinstalls the "New Icons" mod
// instead, so the glyphs are the ones that mod's author draws, and the only
// icon *preference* left here is how big they are (ADR-039). One owner per
// element, and one place to look for it.
//
// Refs: TRANCE.md §3.1, §3.8, §8.1, §13 Phase 5;
// docs/trance/mods/{context-menu-icons,zen-context-menu,new-icons,nova-ui,
// better-new-tab-button,hide-extension-name,zen-custom-urlbar}.md

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";

const ATTR_ROOT = "trance-chrome";

const PREF_ICON_SCALE = "trance.chrome.icons.scale";

const PREF_TOPBUTTONS = "trance.chrome.topbuttons.reveal-on-hover";

/**
 * Set while the pointer is in the band at the top of the sidebar, which is when
 * the window buttons and the compact-mode toggle are shown and the sidebar's
 * content settles back down to make room for them (see trance-chrome.css).
 */
const ATTR_TOPBUTTONS_NEAR = "trance-chrome-topbuttons-near";

/** The sidebar, and the strip the platform's window buttons sit over. */
const TOOLBOX_ID = "navigator-toolbox";
const TOPBUTTONS_ID = "zen-sidebar-top-buttons";

/**
 * How far outside the strip a leaving pointer still counts as being on it.
 *
 * The coordinates on a synthesised mouse exit are the last ones the widget saw,
 * which is a pixel or so inside the boundary it left through — and the native
 * buttons are drawn a hair proud of the box that reserves space for them. Two
 * pixels covers both without reaching anything else.
 */
const TOPBUTTONS_SLOP = 2;

/**
 * How far below the strip the pointer still counts as reaching for it.
 *
 * The strip alone is a band about as tall as one toolbar row, and aiming at a
 * row that is currently empty is harder than aiming at one with buttons in it.
 * One gap of grace is enough to make it feel like a region rather than a line,
 * and small enough that it does not reach the first tab.
 */
const TOPBUTTONS_BAND = 8;

/**
 * How much of that band actually *opens* the strip.
 *
 * The band was one region doing two jobs, and they want different sizes. To
 * keep the buttons up it should be generous — a pointer travelling towards a
 * window control should not lose them on the way. To open them in the first
 * place it should be small, because the whole strip plus a gap of grace spans
 * the top of the sidebar, and crossing it on the way to anything else revealed
 * three buttons and shifted the tab list down.
 *
 * So the open threshold is 30% of the keep threshold, centred on the strip, and
 * the keep threshold is unchanged. Standard hysteresis: hard to trip, easy to
 * hold.
 */
const TOPBUTTONS_ENTER_FRACTION = 0.3;

/**
 * The icon scale: a quarter smaller to a quarter larger, one percent at a time.
 *
 * 50–200% in steps of 25 was the previous range and it was the wrong shape for
 * what this does. The scale multiplies the browser's own 16px (17 on macOS)
 * icon box, so a step of 25% is a step of four pixels — there is no setting
 * between "noticeably bigger" and "twice the size" — and the ends of the range
 * are not sizes anyone wants: at 50% a toolbar glyph is 8px, at 200% it no
 * longer fits the button drawn around it. ±25% is the range where the answer is
 * still a browser toolbar, and 1% is the step that lets a person actually land
 * on the size they meant.
 *
 * Clamped rather than validated: a value out of range in about:config is a
 * browser whose toolbar buttons are a pixel tall or overlap the address bar,
 * and neither is worth honouring literally.
 *
 * @param {number} value - The stored percentage.
 * @returns {number} The same percentage, rounded and clamped.
 */
const clampScale = value => Math.max(75, Math.min(125, Math.round(value)));

/**
 * Sub-features. Each is one pref, one root attribute, and nothing at runtime
 * when off: the attribute is absent and the rules stop matching.
 *
 * There is deliberately no new-tab button flag any more. Trance preinstalls
 * "Better New Tab button" instead of reimplementing a third of it, so the
 * button has one owner again and it is the mod's author
 * (scripts/trance-cosine.py, ADR-049).
 */
const FLAGS = Object.freeze([
  { pref: "trance.chrome.panels.enabled", attribute: "trance-chrome-panels" },
  { pref: "trance.chrome.menus.tint", attribute: "trance-chrome-menus" },
  {
    // Opt-out: the Trance mark in place of the three-dot app-menu glyph.
    pref: "trance.chrome.logo-menu-button",
    attribute: "trance-chrome-logo",
  },
  {
    // The window buttons and the compact-mode toggle, revealed while the
    // pointer is in the band at the top of the sidebar. This attribute gates
    // the rules; `#syncTopButtons` below owns the band itself, because neither
    // "a band rather than an element" nor "the platform's own window buttons"
    // is a thing `:hover` can answer (see trance-chrome.css).
    pref: "trance.chrome.topbuttons.reveal-on-hover",
    attribute: "trance-chrome-topbuttons",
  },
  {
    pref: "trance.chrome.urlbar.hide-extension-name",
    attribute: "trance-chrome-urlbar-noextname",
  },
  {
    pref: "trance.chrome.urlbar.focus-dim",
    attribute: "trance-chrome-urlbar-dim",
  },
  {
    pref: "trance.chrome.urlbar.focus-blur",
    attribute: "trance-chrome-urlbar-blur",
  },
]);

export class TranceChrome extends TranceFeature {
  static prefName = "trance.chrome.enabled";
  static featureName = "Chrome";
  static styles = ["chrome://browser/content/trance-styles/trance-chrome.css"];

  /** Whether the sidebar's enter/leave pair is attached. */
  #topbuttonsListening = false;

  /** Whether a leave into the platform's window buttons is still unresolved. */
  #resolvingLeave = false;

  /** Whether the in-sidebar `mousemove` that watches the band is attached. */
  #bandListening = false;

  onEnable() {
    this.context.document.documentElement.setAttribute(ATTR_ROOT, "true");

    this.#bindTokens();
    this.#observePrefs();
    this.#applyFlags();
  }

  onDisable() {
    const root = this.context.document.documentElement;
    root.removeAttribute(ATTR_ROOT);
    for (const { attribute } of FLAGS) {
      root.removeAttribute(attribute);
    }
    this.#teardownTopButtons();
  }

  // --- Tokens ----------------------------------------------------------------

  #bindTokens() {
    this.bindTokens([
      {
        // The scale itself, unitless, so that `--zen-toolbar-button-size` can
        // multiply the browser's own base size rather than replace it — 16px
        // everywhere, 17px on macOS, and Trance does not have to know which.
        pref: PREF_ICON_SCALE,
        cssVar: "--trance-icon-scale",
        type: "int",
        fallback: 100,
        format: value => `${clampScale(value) / 100}`,
      },
      {
        // The same number as a length, for the two places that size an icon
        // box directly instead of going through Zen's variable: menu rows and
        // subview rows.
        pref: PREF_ICON_SCALE,
        cssVar: "--trance-menu-icon-size",
        type: "int",
        fallback: 100,
        format: value => `${Math.round((16 * clampScale(value)) / 100)}px`,
      },
      {
        // Stored as a percentage of dimming; the stylesheet consumes it as a
        // `brightness()` multiplier, so 30% dim is brightness(0.7).
        pref: "trance.chrome.urlbar.focus-dim.strength",
        cssVar: "--trance-urlbar-dim",
        type: "int",
        fallback: 30,
        format: value => `${(100 - Math.min(90, Math.max(0, value))) / 100}`,
      },
      {
        // The address bar's own blur radius. Deliberately not
        // `--trance-surface-blur`: that one is a `backdrop-filter` radius for
        // frosted chrome, and reusing it meant widening a surface smeared the
        // page. Capped well below the surface range for the same reason — past
        // about 24px the page stops reading as a page.
        pref: "trance.chrome.urlbar.focus-blur.radius",
        cssVar: "--trance-urlbar-blur",
        type: "int",
        fallback: 6,
        format: value => `${Math.max(0, Math.min(24, value))}px`,
      },
    ]);
  }

  // --- Prefs -----------------------------------------------------------------

  #observePrefs() {
    for (const flag of FLAGS) {
      const observer = { observe: () => this.#applyFlags() };
      Services.prefs.addObserver(flag.pref, observer);
      this.addDisposer(() =>
        Services.prefs.removeObserver(flag.pref, observer)
      );
    }
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
    this.#syncTopButtons();
  }

  // --- The top of the sidebar ------------------------------------------------

  /**
   * Attaches or detaches the sidebar's enter/leave pair.
   *
   * The reveal used to be `:hover` on the strip itself, and on macOS that could
   * not work: the traffic lights are the platform's own `NSWindow` buttons,
   * positioned over the box Gecko reserves for them, so the pointer arriving on
   * one is a mouse *exit* as far as the Gecko view is concerned. `:hover`
   * cleared on the strip and on every ancestor at once, and the buttons slid
   * away underneath the cursor that had just reached them.
   *
   * ── Why it is not the whole sidebar ──────────────────────────────────────
   *
   * The reveal is about the top of the sidebar, so being anywhere in the sidebar
   * is the wrong question: reaching for a tab two thirds of the way down opened
   * the window buttons and shuffled the entire list down to make room for them,
   * which is a large piece of motion in answer to nothing. The band is the strip
   * itself plus one gap, and `mousemove` is how a band gets asked about — an
   * enter and a leave can only say which *element* the pointer is in.
   *
   * That listener is attached on entering the sidebar and removed on leaving it,
   * so it does not exist while the pointer is anywhere else in the window, and
   * while it does exist it does one rect comparison and one `setAttribute` the
   * style system discards when nothing changed.
   *
   * Two listeners on one element, and only while the sub-feature is on — a
   * switched-off effect costs no subscription (TRANCE.md §6.6).
   */
  #syncTopButtons() {
    const wanted = Services.prefs.getBoolPref(PREF_TOPBUTTONS, true);
    if (wanted === this.#topbuttonsListening) {
      return;
    }
    const toolbox = this.context.document.getElementById(TOOLBOX_ID);
    if (!toolbox) {
      // Expected once, at startup, before the sidebar exists; `#applyFlags`
      // runs again on the next pref change and on the window's `load`.
      return;
    }
    if (wanted) {
      this.#topbuttonsListening = true;
      toolbox.addEventListener("mouseenter", this.#onSidebarEnter);
      toolbox.addEventListener("mouseleave", this.#onSidebarLeave);
      return;
    }
    this.#topbuttonsListening = false;
    toolbox.removeEventListener("mouseenter", this.#onSidebarEnter);
    toolbox.removeEventListener("mouseleave", this.#onSidebarLeave);
    this.#detachBandTracking();
    this.#closeTopButtons();
  }

  #onSidebarEnter = event => {
    this.#disarmPointerResolve();
    if (!this.#bandListening) {
      this.#bandListening = true;
      this.context.document
        .getElementById(TOOLBOX_ID)
        ?.addEventListener("mousemove", this.#onSidebarMove);
    }
    this.#applyBand(this.#windowPoint(event));
  };

  #onSidebarMove = event => {
    this.#applyBand(this.#windowPoint(event));
  };

  /**
   * Sets or clears the reveal from one position.
   *
   * The band is measured from the strip rather than from a constant, because the
   * strip's height is Zen's and differs by platform and by layout — and the
   * strip keeps that height whether the buttons are shown or not, since what
   * collapses while they are away is its margin, not its box.
   *
   * @param {{x: number, y: number}} point
   */
  #applyBand(point) {
    const strip = this.context.document.getElementById(TOPBUTTONS_ID);
    if (!strip) {
      return;
    }
    const rect =
      this.context.window.windowUtils.getBoundsWithoutFlushing(strip);
    const root = this.context.document.documentElement;
    if (!rect.height) {
      root.removeAttribute(ATTR_TOPBUTTONS_NEAR);
      return;
    }

    // Two thresholds, and which one applies depends on where the strip already
    // is. Reading the attribute back rather than keeping a field: it is the
    // same state, and one owner for it means the CSS and this can never
    // disagree about whether the buttons are up.
    let upper = rect.top - TOPBUTTONS_BAND;
    let lower = rect.bottom + TOPBUTTONS_BAND;
    if (!root.hasAttribute(ATTR_TOPBUTTONS_NEAR)) {
      const centre = (rect.top + rect.bottom) / 2;
      const half = ((lower - upper) * TOPBUTTONS_ENTER_FRACTION) / 2;
      upper = centre - half;
      lower = centre + half;
    }

    if (point.y >= upper && point.y <= lower) {
      root.setAttribute(ATTR_TOPBUTTONS_NEAR, "true");
    } else {
      root.removeAttribute(ATTR_TOPBUTTONS_NEAR);
    }
  }

  #detachBandTracking() {
    if (!this.#bandListening) {
      return;
    }
    this.#bandListening = false;
    this.context.document
      .getElementById(TOOLBOX_ID)
      ?.removeEventListener("mousemove", this.#onSidebarMove);
  }

  /**
   * A leave that is not a leave, told apart by where the pointer was.
   *
   * If the last coordinates are inside the strip the window buttons sit over,
   * the pointer has not gone anywhere: it has moved onto a native widget the
   * Gecko view cannot see, and the reveal has to hold. The view will see the
   * pointer again the moment it comes back off the buttons, and that is when
   * the question gets answered rather than guessed.
   *
   * @param {MouseEvent} event
   */
  #onSidebarLeave = event => {
    const strip = this.context.document.getElementById(TOPBUTTONS_ID);
    const point = this.#windowPoint(event);
    if (strip && this.#within(strip, point)) {
      this.#armPointerResolve();
      return;
    }
    this.#detachBandTracking();
    this.#closeTopButtons();
  };

  /**
   * One `mousemove`, attached only while a leave is unresolved, removed by the
   * first event it receives. It is not a poll and it is not a timer: it is the
   * one question "is the pointer still in the sidebar?" asked at the first
   * moment the answer is knowable again.
   */
  #armPointerResolve() {
    if (this.#resolvingLeave) {
      return;
    }
    this.#resolvingLeave = true;
    this.context.window.addEventListener("mousemove", this.#onResolveMove);
  }

  #disarmPointerResolve() {
    if (!this.#resolvingLeave) {
      return;
    }
    this.#resolvingLeave = false;
    this.context.window.removeEventListener("mousemove", this.#onResolveMove);
  }

  #onResolveMove = event => {
    this.#disarmPointerResolve();
    const toolbox = this.context.document.getElementById(TOOLBOX_ID);
    if (!toolbox || !this.#within(toolbox, this.#windowPoint(event))) {
      this.#detachBandTracking();
      this.#closeTopButtons();
    }
  };

  #closeTopButtons() {
    this.#disarmPointerResolve();
    this.context.document.documentElement.removeAttribute(ATTR_TOPBUTTONS_NEAR);
  }

  #teardownTopButtons() {
    this.#detachBandTracking();
    if (this.#topbuttonsListening) {
      this.#topbuttonsListening = false;
      const toolbox = this.context.document.getElementById(TOOLBOX_ID);
      toolbox?.removeEventListener("mouseenter", this.#onSidebarEnter);
      toolbox?.removeEventListener("mouseleave", this.#onSidebarLeave);
    }
    this.#closeTopButtons();
  }

  /**
   * An event's position in the chrome window's own CSS pixels.
   *
   * `screenX` is in the CSS pixels of whatever document the event came from,
   * and a pointer over a page is in the content document, which may be zoomed
   * independently of the chrome. This is the correction `MousePosTracker`
   * (browser.js) makes, for the same reason: without it a coordinate from a
   * zoomed page is compared against a chrome-side rect and the comparison is
   * simply wrong.
   *
   * @param {MouseEvent} event
   * @returns {{x: number, y: number}}
   */
  #windowPoint(event) {
    const win = this.context.window;
    const source = event.target?.documentGlobal;
    const scale =
      source && source !== win
        ? source.devicePixelRatio / win.devicePixelRatio
        : 1;
    return {
      x: event.screenX * scale - win.mozInnerScreenX,
      y: event.screenY * scale - win.mozInnerScreenY,
    };
  }

  /**
   * `getBoundsWithoutFlushing`, not `getBoundingClientRect`: this runs on mouse
   * events, and a synchronous layout flush per event is the forced reflow
   * TRANCE.md §6.4 exists to prevent. A frame-stale rect for a toolbar that only
   * moves when the window resizes is not a wrong answer.
   *
   * @param {Element} element
   * @param {{x: number, y: number}} point
   * @returns {boolean}
   */
  #within(element, point) {
    const rect =
      this.context.window.windowUtils.getBoundsWithoutFlushing(element);
    if (!rect.width || !rect.height) {
      return false;
    }
    return (
      point.x >= rect.left - TOPBUTTONS_SLOP &&
      point.x <= rect.right + TOPBUTTONS_SLOP &&
      point.y >= rect.top - TOPBUTTONS_SLOP &&
      point.y <= rect.bottom + TOPBUTTONS_SLOP
    );
  }
}
