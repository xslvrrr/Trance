// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: motion and feedback — the loading bar and the tab-close burst.
//
// Behaviour inspired by "Zen Deta Loading Bar" by rasyidrafi
// (https://github.com/rasyidrafi/zen-deta-loading-bar, MIT) and "Tab Closing
// Bubble Animation" by Zylaah (https://github.com/Zylaah/bubble-pop-deleting).
// The bubble mod carries no licence, so that half is a clean-room
// reimplementation by requirement (TRANCE.md §7.3); the loading bar's licence
// permits adapting, and none of it needed adapting — see below.
//
// Two more of the cluster's four mods are not here, and that is the result of
// their investigations rather than an omission:
//
//   - Floating Status Bar (7) → verdict changed to ZEN. Zen's own
//     `zen.theme.styled-status-panel` already floats the status panel, and it
//     is on by default on macOS. Building a second owner for `#statuspanel`
//     buys nothing (docs/trance/mods/floating-status-bar.md).
//   - Render.js (14) → verdict changed to DEFER. Each of its five behaviours
//     duplicates an owner Trance has already assigned, and the sixth
//     ("ambient motion") cannot be specified, built or accepted
//     (docs/trance/mods/render-js.md). TRANCE.md §16 Q8 is answered.
//
// ── Why the loading bar is written rather than ported ─────────────────────
//
// The MIT original is ninety lines of CSS and exhibits four of TRANCE.md §3's
// eight failure modes at once: an `infinite` animation, animating `width` —
// a layout property, so every one of ~120 frames per second is a reflow of the
// content pane — with a `filter: blur()` re-evaluated on each of them, over a
// `.browserStack` permanently promoted to its own compositor layer by
// `translateZ(0)`. And it does all of that to *pulse*, because a stylesheet
// has no way to ask how far a page has loaded.
//
// None of that is careless. It is what "CSS-only" costs from outside the
// browser. Trance is inside it, so it asks: `nsIWebProgressListener` reports
// real progress, the bar's width is that progress, and a token-timed
// `transition` on `transform: scaleX()` interpolates between events. No loop,
// no reflow, and nothing running while nothing is loading.
//
// Refs: TRANCE.md §3.4, §3.5, §3.6, §6.3, §8.1, §13 Phase 6;
// docs/trance/mods/{deta-loading-bar,tab-closing-bubble,floating-status-bar,
// render-js}.md

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Feedback";

const ATTR_ROOT = "trance-feedback";
const ATTR_LOADING = "trance-feedback-loading";
const ATTR_BUBBLES = "trance-feedback-bubbles";

const PREF_LOADING = "trance.feedback.loading.enabled";
const PREF_LOADING_POSITION = "trance.feedback.loading.position";
const PREF_BUBBLES = "trance.feedback.bubbles.enabled";
const PREF_BUBBLE_COUNT = "trance.feedback.bubbles.count";

const BAR_ID = "trance-loading-bar";
const BURST_ID = "trance-burst-layer";

const POSITIONS = Object.freeze(["top", "bottom"]);
const DEFAULT_POSITION = "top";

/** Clamped so a number typed into about:config cannot schedule arbitrary work. */
const MIN_BUBBLES = 3;
const MAX_BUBBLES = 16;

/**
 * How far the indeterminate creep is allowed to travel. A server that reports no
 * content length gives no progress to show, so the bar eases toward this and
 * waits — arriving at 100% before the page has arrived would be a lie, and
 * stopping short is the honest version of the original's pulse.
 */
const CREEP_CEILING = 0.9;
/** Fraction of the remaining distance covered per frame. */
const CREEP_RATE = 0.012;

export class TranceFeedback extends TranceFeature {
  static prefName = "trance.feedback.enabled";
  static featureName = "Feedback";
  static styles = [
    "chrome://browser/content/trance-styles/trance-feedback.css",
  ];

  /** @type {Element | null} */
  #bar = null;
  /** @type {Element | null} */
  #burstLayer = null;

  /** The tabbrowser progress listener, while the loading bar is on. */
  #progressListener = null;
  /** The `TranceScheduler` handle for the indeterminate creep, or 0. */
  #creepHandle = 0;
  /** Last value written to the bar, 0..1. */
  #progress = 0;
  /** True between STATE_START and STATE_STOP on the top-level document. */
  #loading = false;
  /** Whether the `TabClose` listener is attached. */
  #burstListening = false;
  /** Whether the `TabSelect` listener is attached. */
  #tabSelectListening = false;

  onEnable() {
    this.context.document.documentElement.setAttribute(ATTR_ROOT, "true");

    this.#bindTokens();
    this.#observePrefs();

    // Attributes first, so the stylesheet is correct immediately.
    this.#applyLoading();
    this.#applyBubbles();

    // Then again once the browser exists. TranceCore enters through
    // `nsZenPreloadedFeature`, which fires at `MozBeforeInitialXULLayout` —
    // deliberately, so that Trance is never in a load-order race with Zen
    // (TRANCE.md §3.7). The cost is that `gBrowser` and its tab container are
    // not built yet, and this is the first Trance feature that needs them:
    // Phases 3 to 5 style elements the markup already contains, and this one
    // attaches to a progress listener and a tab-close event.
    //
    // Without this both halves of the feature silently did nothing — the run
    // log said "gBrowser is not ready; no loading bar" and never retried.
    this.#whenBrowserReady(() => {
      this.#applyLoading();
      this.#applyBubbles();
    });
  }

  onDisable() {
    const root = this.context.document.documentElement;
    root.removeAttribute(ATTR_ROOT);
    root.removeAttribute(ATTR_LOADING);
    root.removeAttribute(ATTR_BUBBLES);
    this.#teardownLoading();
    this.#teardownBubbles();
  }

  /**
   * Runs `callback` once `gBrowser` and its tab container exist.
   *
   * Immediately if they already do — which is the case whenever the feature is
   * enabled by a pref flip mid-session, rather than at startup.
   *
   * @param {() => void} callback
   */
  #whenBrowserReady(callback) {
    const win = this.context.window;
    if (win.gBrowser?.tabContainer) {
      callback();
      return;
    }
    this.addListener(win, "load", callback, { once: true });
  }

  // --- Tokens ----------------------------------------------------------------

  #bindTokens() {
    this.bindTokens([
      {
        pref: "trance.feedback.loading.thickness",
        cssVar: "--trance-loading-thickness",
        type: "int",
        fallback: 3,
        format: value => `${Math.max(1, Math.min(12, value))}px`,
      },
      {
        pref: PREF_BUBBLE_COUNT,
        cssVar: "--trance-bubble-count",
        type: "int",
        fallback: 8,
        format: value =>
          `${Math.max(MIN_BUBBLES, Math.min(MAX_BUBBLES, value))}`,
      },
    ]);
  }

  // --- Prefs -----------------------------------------------------------------

  #observePrefs() {
    for (const pref of [PREF_LOADING, PREF_LOADING_POSITION]) {
      const observer = { observe: () => this.#applyLoading() };
      Services.prefs.addObserver(pref, observer);
      this.addDisposer(() => Services.prefs.removeObserver(pref, observer));
    }

    const bubbleObserver = { observe: () => this.#applyBubbles() };
    Services.prefs.addObserver(PREF_BUBBLES, bubbleObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_BUBBLES, bubbleObserver)
    );
  }

  // --- Loading bar -----------------------------------------------------------

  #applyLoading() {
    const root = this.context.document.documentElement;

    if (!Services.prefs.getBoolPref(PREF_LOADING, true)) {
      root.removeAttribute(ATTR_LOADING);
      this.#teardownLoading();
      return;
    }

    let position = Services.prefs.getStringPref(
      PREF_LOADING_POSITION,
      DEFAULT_POSITION
    );
    if (!POSITIONS.includes(position)) {
      TranceLog.warn(NS, `unknown position "${position}", falling back`);
      position = DEFAULT_POSITION;
    }
    root.setAttribute(ATTR_LOADING, position);

    this.#ensureBar();
    this.#ensureProgressListener();
  }

  #ensureBar() {
    if (this.#bar?.isConnected) {
      return;
    }
    const doc = this.context.document;
    // `#zen-tabbox-wrapper` is `position: relative` already (zen-tabs.css), so
    // the bar can be absolutely positioned against the content pane without
    // Trance changing anyone's layout. It is out of flow, so the XUL box it
    // sits in does not measure it.
    const host = doc.getElementById("zen-tabbox-wrapper");
    if (!host) {
      TranceLog.warn(NS, "#zen-tabbox-wrapper is missing; no loading bar");
      return;
    }
    const bar = doc.createElement("div");
    bar.id = BAR_ID;
    bar.setAttribute("aria-hidden", "true");
    host.appendChild(bar);
    this.#bar = bar;
    this.#writeProgress(0);
  }

  /**
   * One listener on the tabbrowser, which already filters to the selected tab.
   * A `MutationObserver` watching for `[busy]` — which is how this is done from
   * outside the browser — would be inferring what this states (TRANCE.md §3.2).
   */
  #ensureProgressListener() {
    if (this.#progressListener) {
      return;
    }
    const win = this.context.window;
    const browser = win.gBrowser;
    if (!browser?.addProgressListener) {
      // Expected once, at startup: TranceCore runs before gBrowser is built.
      // `#whenBrowserReady` calls back and this runs again.
      return;
    }

    const WPL = Ci.nsIWebProgressListener;
    const feature = this;

    this.#progressListener = {
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),

      onStateChange(webProgress, request, stateFlags) {
        if (!webProgress.isTopLevel) {
          return;
        }
        if (stateFlags & WPL.STATE_START && stateFlags & WPL.STATE_IS_NETWORK) {
          feature.#startLoading();
        } else if (
          stateFlags & WPL.STATE_STOP &&
          stateFlags & WPL.STATE_IS_NETWORK
        ) {
          feature.#finishLoading();
        }
      },

      onProgressChange(
        webProgress,
        request,
        currentSelf,
        maxSelf,
        currentTotal,
        maxTotal
      ) {
        if (!feature.#loading || maxTotal <= 0) {
          return;
        }
        // Real progress supersedes the creep, and cancels it — there is no
        // reason to hold a frame subscription once the server has told us how
        // big the thing is.
        feature.#stopCreep();
        feature.#writeProgress(
          Math.max(feature.#progress, Math.min(1, currentTotal / maxTotal))
        );
      },

      onLocationChange() {},
      onStatusChange() {},
      onSecurityChange() {},
      onContentBlockingEvent() {},
    };

    browser.addProgressListener(this.#progressListener);

    // Switching tabs mid-load would otherwise leave the previous tab's progress
    // on screen until the next event.
    //
    // Attached once for the life of the feature, not once per enable: the
    // progress listener is torn down and rebuilt when the loading-bar pref is
    // flipped, and `addListener`'s disposer only runs on full teardown, so
    // re-registering here would stack a second listener per flip. The handler
    // is already a no-op when there is no bar.
    if (!this.#tabSelectListening) {
      this.#tabSelectListening = true;
      this.addListener(win, "TabSelect", () => this.#resetForTabSwitch());
    }
  }

  #startLoading() {
    this.#loading = true;
    this.#writeProgress(0);
    this.#bar?.setAttribute("active", "true");
    this.#startCreep();
  }

  #finishLoading() {
    if (!this.#loading) {
      return;
    }
    this.#loading = false;
    this.#stopCreep();
    // Land on 100% first, so the bar is seen to complete rather than to
    // vanish; the stylesheet fades it out from there with a token duration.
    this.#writeProgress(1);
    this.#bar?.removeAttribute("active");
  }

  #resetForTabSwitch() {
    const tab = this.context.window.gBrowser?.selectedTab;
    if (tab?.hasAttribute("busy")) {
      return;
    }
    this.#loading = false;
    this.#stopCreep();
    this.#bar?.removeAttribute("active");
    this.#writeProgress(0);
  }

  #writeProgress(value) {
    this.#progress = value;
    this.#bar?.style.setProperty("--trance-loading-progress", `${value}`);
  }

  /**
   * The indeterminate case, and the only part of this feature that holds a
   * frame subscription. It exists for exactly as long as a load with no
   * reported length is in flight, and `TranceScheduler` suspends it on blur,
   * minimise and occlusion — which is the one thing the CSS-only original could
   * not express (TRANCE.md §3.4).
   */
  #startCreep() {
    if (this.#creepHandle) {
      return;
    }
    this.#creepHandle = this.onFrame(() => {
      const next =
        this.#progress + (CREEP_CEILING - this.#progress) * CREEP_RATE;
      this.#writeProgress(Math.min(CREEP_CEILING, next));
    });
  }

  #stopCreep() {
    if (!this.#creepHandle) {
      return;
    }
    this.context.scheduler.cancel(this.#creepHandle);
    this.#creepHandle = 0;
  }

  #teardownLoading() {
    this.#stopCreep();
    this.#loading = false;
    const browser = this.context.window.gBrowser;
    if (this.#progressListener && browser?.removeProgressListener) {
      browser.removeProgressListener(this.#progressListener);
    }
    this.#progressListener = null;
    this.#bar?.remove();
    this.#bar = null;
  }

  // --- Tab-close burst -------------------------------------------------------

  #applyBubbles() {
    const root = this.context.document.documentElement;

    if (!Services.prefs.getBoolPref(PREF_BUBBLES, true)) {
      root.removeAttribute(ATTR_BUBBLES);
      this.#teardownBubbles();
      return;
    }
    root.setAttribute(ATTR_BUBBLES, "true");

    if (this.#burstListening) {
      return;
    }
    const container = this.context.window.gBrowser?.tabContainer;
    if (!container) {
      // Expected once, at startup. `#whenBrowserReady` calls back.
      return;
    }
    this.#burstListening = true;
    // `TabClose` is the event Firefox already fires. The original mod watches
    // `#tabbrowser-tabs` for removals because from outside the browser there is
    // nothing else to watch (TRANCE.md §3.2).
    this.addListener(container, "TabClose", event => this.#burst(event.target));
  }

  /**
   * One `getBoundingClientRect` per burst, in the read phase, before anything is
   * written. The obvious implementation measures once per bubble, which is a
   * forced reflow per bubble (TRANCE.md §6.4).
   *
   * @param {Element} tab - The tab that is closing.
   */
  #burst(tab) {
    // The attribute, not the pref, and not a private flag: it is the same
    // thing the stylesheet gates on, so the burst cannot be on visually and off
    // behaviourally. See `#teardownBubbles` for why the listener outlives it.
    const root = this.context.document.documentElement;
    if (!root.hasAttribute(ATTR_BUBBLES) || !this.context.motion.isEnabled) {
      return;
    }
    const layer = this.#ensureBurstLayer();
    if (!layer || !tab) {
      return;
    }

    const rect = tab.getBoundingClientRect();
    const host = layer.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const originX = rect.left - host.left + rect.width / 2;
    const originY = rect.top - host.top + rect.height / 2;

    const count = Math.max(
      MIN_BUBBLES,
      Math.min(MAX_BUBBLES, Services.prefs.getIntPref(PREF_BUBBLE_COUNT, 8))
    );
    const doc = this.context.document;
    const travel = Math.max(rect.width, rect.height) / 2;

    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2;
      const bubble = doc.createElement("div");
      bubble.className = "trance-burst-bubble";
      bubble.style.left = `${originX}px`;
      bubble.style.top = `${originY}px`;
      layer.appendChild(bubble);

      // Web Animations rather than a class, so `will-change` is scoped to the
      // animation's lifetime by TranceMotion and cleanup is `finished` rather
      // than a timer (TRANCE.md §3.5, §3.6).
      const animation = this.context.motion.animate(
        bubble,
        [
          { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0.9 },
          {
            transform:
              `translate(calc(-50% + ${Math.cos(angle) * travel}px), ` +
              `calc(-50% + ${Math.sin(angle) * travel}px)) scale(1)`,
            opacity: 0,
          },
        ],
        {
          duration: this.#burstDuration(),
          easing: this.#token("--trance-ease-standard"),
          willChange: "transform, opacity",
        }
      );

      if (!animation) {
        bubble.remove();
        continue;
      }
      const remove = () => bubble.remove();
      animation.finished.then(remove, remove);
    }
  }

  /**
   * The tokens file is the only place a duration or an easing is written, and
   * that holds for JavaScript too — a literal `cubic-bezier(…)` here would be
   * a second owner for the browser's motion feel, which is what
   * TRANCE.md §6.2 rule 3 is about. The stylelint rule cannot see this file, so
   * the discipline has to be the code's.
   *
   * Reading the token also means the burst shortens at motion level 1 and goes
   * to zero at level 0 without this module knowing the level exists.
   *
   * @param {string} property - A `--trance-*` custom property name.
   * @returns {string} Its computed value on the root element.
   */
  #token(property) {
    return this.context.window
      .getComputedStyle(this.context.document.documentElement)
      .getPropertyValue(property)
      .trim();
  }

  #burstDuration() {
    const raw = this.#token("--trance-dur-slow");
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return raw.endsWith("ms") ? parsed : parsed * 1000;
  }

  #ensureBurstLayer() {
    if (this.#burstLayer?.isConnected) {
      return this.#burstLayer;
    }
    const doc = this.context.document;
    const host = doc.getElementById("navigator-toolbox");
    if (!host) {
      return null;
    }
    const layer = doc.createElement("div");
    layer.id = BURST_ID;
    layer.setAttribute("aria-hidden", "true");
    host.appendChild(layer);
    this.#burstLayer = layer;
    return layer;
  }

  #teardownBubbles() {
    this.#burstLayer?.remove();
    this.#burstLayer = null;
    // `#burstListening` is deliberately not cleared here. The `TabClose`
    // listener belongs to `addListener`, so it is removed only when the whole
    // feature tears down — clearing the flag on a mere pref flip would attach
    // a second listener the next time the pref came back. `#burst` checks the
    // attribute instead, so the still-attached listener does nothing.
  }
}
