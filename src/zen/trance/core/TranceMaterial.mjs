// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the one owner of what this window is made of.
//
// ── The problem this replaces ─────────────────────────────────────────────────
//
// "Is this window translucent" was answered in six places at once: the platform
// switch (`zen.widget.macos.window-vibrancy` and its Windows and Linux
// equivalents), Zen's acrylic switch, Zen's grey-out-inactive switch, Firefox's
// `browser.tabs.allow_transparent_browser`, the `transparent` attribute on each
// live `<browser>`, and a CSS attribute on the root that decides whether the
// frost is painted at all. Each was read and written by a different method of
// the surface feature, each claimed and released its own prefs, and the claims
// could get out of step with each other and with the second window
// (AUDIT.md §2, "Dual compositor ownership on macOS").
//
// This module is that decision, once. A feature states an *intent* — what the
// window should look like — and this decides everything that follows from it:
// which platform pref to hold, whether the native material may grey out, whether
// content canvases may carry alpha, and whether the frost is painted right now
// given that the window may be blurred, minimised or fully occluded.
//
// ── Why intent rather than switches ───────────────────────────────────────────
//
// The switches are not independent. Native vibrancy and a WebRender backdrop
// filter are two owners of the same material: on a platform whose window is
// already translucent, a `backdrop-filter` over it replaces the frost with flat
// black rather than softening it, and both cost a full-window pass. A caller
// that sets six switches can express that contradiction; a caller that states
// "translucent, frosted by this much, and keep it when unfocused" cannot, and
// this module resolves it in one place.
//
// Every global pref it holds goes through `TranceGlobalPrefs`, so the holds are
// refcounted across the whole process rather than per window.
//
// Refs: TRANCE.md §3.3, §6.2, §6.6; AUDIT.md Phase 1 and Phase 3; ADR-011,
// ADR-061

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

// Deliberately `ChromeUtils.importESModule` with no `global` option rather than
// a static `import`: this module is itself loaded into the window's global, and
// a static import would clone the pref registry into it. See the header of
// TranceGlobalPrefs.mjs.
const { TranceGlobalPrefOwner } = ChromeUtils.importESModule(
  "chrome://browser/content/trance-components/TranceGlobalPrefs.mjs"
);

const NS = "Material";

/** The frost is painted. Consumed by trance-surfaces.css. */
const ATTR_VISIBLE = "trance-surface-visible";
/** The window is translucent. Consumed by trance-surfaces.css. */
const ATTR_TRANSPARENT = "trance-surface-transparent";

/** Zen's own acrylic switch. Held off for as long as Trance owns the blur. */
const PREF_ZEN_ACRYLIC = "zen.theme.acrylic-elements";

/**
 * Zen's "the window material follows the window's active state" switch. With it
 * on — its default — macOS drops the `NSVisualEffectView` to an opaque grey the
 * moment the window loses focus, which is why an unfocused Trance window went
 * black no matter what the Trance prefs said.
 */
const PREF_ZEN_GREY_INACTIVE = "zen.view.grey-out-inactive-windows";

/**
 * Firefox's own switch for building content browsers with an alpha-composited
 * canvas. It is what makes internal-page translucency a real page-transparency
 * feature rather than a colour behind an opaque canvas — and it is also the
 * single most expensive default in the browser, because it removes Gecko's
 * opaque fast path from *every* ordinary web tab, not only the internal page
 * currently selected (AUDIT.md §1). It is therefore held only while a caller
 * explicitly asks for content transparency.
 */
const PREF_ALLOW_TRANSPARENT_BROWSER = "browser.tabs.allow_transparent_browser";

/** Zen's attribute for a browser built with an alpha-composited canvas. */
const ATTR_ZEN_TRANSPARENT = "transparent";

/**
 * The platform's own "make this window translucent" switches, one per platform.
 *
 * Each is a platform decision Trance has no business reimplementing and no way
 * to reach from CSS. `media` is the condition under which the pref means
 * anything at all, so a macOS build never claims Mica.
 */
const PLATFORM_TRANSPARENCY = Object.freeze([
  { pref: "zen.widget.macos.window-vibrancy", media: "(-moz-platform: macos)" },
  { pref: "widget.windows.mica", media: "(-moz-platform: windows)" },
  { pref: "zen.widget.linux.transparency", media: "(-moz-platform: linux)" },
]);

/**
 * What a caller may ask for. Anything absent takes the opaque answer, which is
 * the maximum-performance baseline AUDIT.md Phase 1 wants as the default.
 *
 * @typedef {object} TranceMaterialIntent
 * @property {boolean} [transparent] The window itself is translucent.
 * @property {number} [blurRadius] Frost radius in px. 0 paints no frost.
 * @property {boolean} [keepUnfocused] Keep the material when not frontmost.
 * @property {boolean} [suspendWhenUnfocused] Drop the frost when not focused.
 * @property {boolean} [contentTransparency] Ordinary content canvases may carry
 *   alpha. Expensive; see `PREF_ALLOW_TRANSPARENT_BROWSER`.
 */

const OPAQUE = Object.freeze({
  transparent: false,
  blurRadius: 0,
  keepUnfocused: false,
  suspendWhenUnfocused: true,
  contentTransparency: false,
});

export class TranceMaterial {
  #window;
  #activity;
  #prefs;
  #unsubscribeActivity = null;
  #destroyed = false;

  /** @type {TranceMaterialIntent} */
  #intent = OPAQUE;
  /** Platform prefs that apply on this platform, resolved once. */
  #platformPrefs;
  /** Whether the content-transparency claim is currently held. */
  #ownsContentTransparency = false;

  /**
   * @param {Window} win
   * @param {import("../../common/modules/ZenWindowActivity.mjs").ZenWindowActivityController} activity
   */
  constructor(win, activity) {
    this.#window = win;
    this.#activity = activity;
    this.#prefs = new TranceGlobalPrefOwner(
      `Material@${win.docShell?.name ?? "window"}`
    );
    this.#platformPrefs = PLATFORM_TRANSPARENCY.filter(
      ({ media }) => win.matchMedia(media).matches
    ).map(({ pref }) => pref);

    // The frost is dropped whenever the window cannot actually be seen. This is
    // the rule a stylesheet cannot express: CSS cannot know the window is
    // occluded, so a mod's blur passes ran forever (TRANCE.md §3.3).
  }

  /**
   * States what this window should be made of. Idempotent, and the only way in.
   *
   * @param {TranceMaterialIntent} intent
   */
  apply(intent = {}) {
    if (this.#destroyed) {
      return;
    }
    this.#unsubscribeActivity ??= this.#activity?.subscribe(() =>
      this.#render()
    );
    this.#intent = Object.freeze({ ...OPAQUE, ...intent });
    this.#syncClaims();
    this.#render();
  }

  /** Returns the window to the opaque baseline and gives every pref back. */
  reset() {
    this.#unsubscribeActivity?.();
    this.#unsubscribeActivity = null;
    this.#intent = OPAQUE;
    this.#prefs.releaseAll();
    this.#ownsContentTransparency = false;
    this.#unmarkContentBrowsers();
    const root = this.#window.document.documentElement;
    root.removeAttribute(ATTR_VISIBLE);
    root.removeAttribute(ATTR_TRANSPARENT);
  }

  /** True while the frost is actually being painted. For the §12.1 checks. */
  get frosted() {
    return this.#window.document.documentElement.hasAttribute(ATTR_VISIBLE);
  }

  /** True while the window itself is translucent. */
  get translucent() {
    return Boolean(this.#intent.transparent);
  }

  /** The global prefs this window's material currently holds. */
  get heldPrefs() {
    return this.#prefs.held;
  }

  destroy() {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#unsubscribeActivity?.();
    this.#unsubscribeActivity = null;
    this.reset();
    this.#prefs.destroy();
  }

  // --- Internals -------------------------------------------------------------

  /**
   * The pref half of the decision: everything that has to be true outside this
   * window's DOM for the intent to be honoured.
   */
  #syncClaims() {
    const intent = this.#intent;

    // The platform's translucency, held in *both* directions. Holding it off is
    // as much a decision as holding it on — an opaque Trance has to turn Zen's
    // native material defaults off, or the window is translucent underneath a
    // browser that has been told it is not.
    for (const pref of this.#platformPrefs) {
      this.#prefs.claim(pref, Boolean(intent.transparent));
    }

    // Zen's compact-mode sheet carries `backdrop-filter: blur(42px) …
    // !important` on `.zen-toolbar-background`, gated on this pref. An
    // author-level Trance rule cannot beat `!important` and adding `!important`
    // to fight it is forbidden (§6.2 rule 1), so ownership is the honest way to
    // keep one owner per region — and unlike a CSS arms race it is exactly
    // reversible (ADR-011).
    this.#prefs.claim(PREF_ZEN_ACRYLIC, false);

    // `zen.view.grey-out-inactive-windows` decides whether the macOS material is
    // `NSVisualEffectStateFollowsWindowActiveState` or
    // `NSVisualEffectStateActive` (ZenWindowMaterialView, nsCocoaWindow.mm). It
    // is held only when the caller has asked to keep the material while
    // unfocused; otherwise Zen's own behaviour is the correct one, and a user
    // who has never touched that switch keeps it exactly.
    if (intent.keepUnfocused) {
      this.#prefs.claim(PREF_ZEN_GREY_INACTIVE, false);
    } else {
      this.#prefs.release(PREF_ZEN_GREY_INACTIVE);
    }

    this.#syncContentTransparency(Boolean(intent.contentTransparency));
  }

  /**
   * Alpha-composited content canvases, and the attribute that makes CSS match
   * them.
   *
   * `tabbrowser.js` reads the pref when it *creates* a browser, so the pref
   * alone changes tabs opened from now on rather than the ones already open. The
   * attribute is what CSS matches, so the attribute is what has to be stamped
   * and unstamped — without that, releasing the pref is a one-way door and every
   * tab built while it was on keeps a veil over it until it is closed
   * (ADR-046).
   *
   * @param {boolean} wanted
   */
  #syncContentTransparency(wanted) {
    if (wanted === this.#ownsContentTransparency) {
      if (wanted) {
        this.#markContentBrowsers();
      }
      return;
    }
    this.#ownsContentTransparency = wanted;

    if (wanted) {
      this.#prefs.claim(PREF_ALLOW_TRANSPARENT_BROWSER, true);
      this.#markContentBrowsers();
      TranceLog.log(NS, "content canvases may carry alpha");
      return;
    }
    this.#prefs.release(PREF_ALLOW_TRANSPARENT_BROWSER);
    this.#unmarkContentBrowsers();
    TranceLog.log(NS, "content canvases are opaque again");
  }

  #contentBrowsers() {
    return this.#window.gBrowser?.browsers ?? [];
  }

  #markContentBrowsers() {
    if (!Services.prefs.getBoolPref(PREF_ALLOW_TRANSPARENT_BROWSER, false)) {
      return;
    }
    for (const browser of this.#contentBrowsers()) {
      browser?.setAttribute(ATTR_ZEN_TRANSPARENT, "true");
    }
  }

  #unmarkContentBrowsers() {
    // No guard on the global preference here, and that asymmetry with
    // `#markContentBrowsers` is the point. The *preference* is process-wide —
    // it decides whether the next browser is constructed with an alpha canvas,
    // so another window may legitimately still hold it. The *attribute* is not:
    // it is what this window's CSS matches, and these are this window's
    // browsers. Declining to strip it because a second window still wanted
    // alpha left the first window's tabs wearing Zen's translucent container
    // rule with no Trance stylesheet behind it — a white veil over every page,
    // until that window was closed (AUDIT.md Phase 1, ADR-046).
    for (const browser of this.#contentBrowsers()) {
      browser?.removeAttribute(ATTR_ZEN_TRANSPARENT);
    }
  }

  /**
   * The DOM half: two attributes, both derived, neither settable from outside.
   *
   * Re-run on every activity change as well as on every intent change, because
   * "can this window be seen" is half of "should the frost be painted".
   */
  #render() {
    if (this.#destroyed) {
      return;
    }
    const root = this.#window.document.documentElement;
    const intent = this.#intent;

    // `setAttribute(name, "true")`, not `toggleAttribute`. Every selector in
    // trance-surfaces.css matches on the *value* — `[trance-surface-visible=
    // "true"]`, `[trance-surface-transparent="true"]` — so a valueless
    // attribute is present in the DOM and matches nothing, which is the most
    // expensive kind of wrong: the window is marked translucent and painted
    // opaque.
    this.#mark(root, ATTR_TRANSPARENT, Boolean(intent.transparent));

    // The opt-in overrides the suspend switch rather than sitting beside it:
    // "keep the window translucent when it is not focused" and "drop the frost
    // when it is not focused" are the same question asked twice, and answering
    // it differently in two places is how a browser ends up with two owners for
    // one behaviour (TRANCE.md §6.2).
    const suspend = !intent.keepUnfocused && intent.suspendWhenUnfocused;
    const { focused, visible } = this.#activity ?? {
      focused: true,
      visible: true,
    };
    const frosted = intent.blurRadius > 0 && visible && (!suspend || focused);

    this.#mark(root, ATTR_VISIBLE, frosted);
  }

  /**
   * @param {Element} root
   * @param {string} attribute
   * @param {boolean} on
   */
  #mark(root, attribute, on) {
    if (on) {
      root.setAttribute(attribute, "true");
    } else {
      root.removeAttribute(attribute);
    }
  }
}
