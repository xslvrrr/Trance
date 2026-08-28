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
// real progress, the bar's *scale* is that progress, and a token-timed
// `transition` interpolates between events. No loop, no reflow, and nothing
// running while nothing is loading. The bar's length is a static share of the
// edge it runs along — one declaration, changed when a slider moves and at no
// other time.
//
// This module also owns the animation pack: two gestures, both Web Animations
// through TranceMotion, so both are nothing at motion level 0 without either of
// them knowing that motion levels exist.
//
// Refs: TRANCE.md §3.4, §3.5, §3.6, §6.3, §8.1, §13 Phase 6;
// docs/trance/mods/{deta-loading-bar,tab-closing-bubble,floating-status-bar,
// render-js}.md

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Feedback";

const ATTR_ROOT = "trance-feedback";
const ATTR_LOADING = "trance-feedback-loading";
const ATTR_LOADING_PAGE = "trance-feedback-loading-page";
const ATTR_BUBBLES = "trance-feedback-bubbles";

const PREF_LOADING = "trance.feedback.loading.enabled";
const PREF_LOADING_POSITION = "trance.feedback.loading.position";
const PREF_LOADING_FLOURISH = "trance.feedback.loading.flourish";
const PREF_LOADING_ZOOM = "trance.feedback.loading.zoom";
const PREF_BUBBLES = "trance.feedback.bubbles.enabled";
const PREF_BUBBLE_COUNT = "trance.feedback.bubbles.count";
const PREF_BUBBLE_SHAPE = "trance.feedback.bubbles.shape";
const PREF_ANIM_TAB_SWITCH = "trance.feedback.animations.tab-switch";
const PREF_ANIM_SEARCH = "trance.feedback.animations.search";

/**
 * Zen's own loading indicator, which this feature replaces.
 *
 * `#zen-loading-progress-bar` (ZenProgressBar.sys.mjs) does the same job from
 * the same signal, and `zen.view.enable-loading-indicator` defaults to true
 * (prefs/zen/view.yaml). Left alone, a page load animates two bars — the exact
 * two-owners problem TRANCE.md §3.1 exists to remove, arrived at from inside
 * the project rather than from a mod.
 *
 * This is not fixed by shipping the pref off in `prefs/trance/`. ffprefs sorts
 * every YAML entry by pref *name* with a stable sort and emits duplicates
 * adjacently, so a second definition of the same name resolves in
 * `fs::read_dir` order — filesystem-dependent, and therefore a different
 * browser on a different machine. Nor is it fixed by shipping it off in
 * `prefs/zen/view.yaml`: that is a permanent upstream touchpoint for a value
 * that is only correct while Trance's own bar is switched on.
 *
 * So it is a default-branch write, held for as long as this feature owns the
 * bar and released the moment it does not. Writing the *default* branch means
 * nothing lands in prefs.js: a user who has deliberately set the pref still
 * wins, and a profile that later runs stock Zen is untouched.
 */
const PREF_ZEN_INDICATOR = "zen.view.enable-loading-indicator";

/**
 * Prefs are global; this feature is per-window. Without a count, the second
 * window to close would hand Zen's bar back while the first still owns it.
 */
let zenIndicatorSuppressors = 0;
/** What the default branch said before Trance touched it. */
let zenIndicatorWasEnabled = null;

const BAR_ID = "trance-loading-bar";
/** The part of the bar that moves. See the track/fill note in the stylesheet. */
const FILL_ID = "trance-loading-fill";
const BURST_ID = "trance-burst-layer";

/**
 * Which edge of the content pane the bar belongs to.
 *
 * `left` and `right` are not a rotation of `top` and `bottom`: a vertical bar
 * takes its length from the pane's height and grows downwards, so the axis is
 * part of this answer rather than a second setting. trance-feedback.css states
 * the geometry per axis for the same reason.
 */
const POSITIONS = Object.freeze(["top", "bottom", "left", "right"]);
const DEFAULT_POSITION = "top";

/**
 * The animation pack.
 *
 * Numbers rather than tokens, because they are the *shape* of one gesture
 * rather than values anything else consumes: no other Trance rule scales a pane
 * or blurs one, and a token exists to stop two owners disagreeing about a value
 * they share. The duration and the easing are tokens, because every gesture in
 * the browser shares those (TRANCE.md §6.2 rule 3).
 */
const ARRIVAL_SCALE = 0.9;
const ARRIVAL_BLUR = 15;
/** The address bar comes *down* to its size, so the pack reads as two opposites. */
const SEARCH_SCALE = 1.1;

/** Clamped so a number typed into about:config cannot schedule arbitrary work. */
const MIN_BUBBLES = 3;
const MAX_BUBBLES = 16;

const SHAPES = Object.freeze(["circle", "line"]);
const DEFAULT_SHAPE = "circle";

const TAU = Math.PI * 2;

/* ── Why the burst is sampled rather than stepped ────────────────────────────
 *
 * The first version placed bubble `i` at exactly `i / count` of a circle and
 * sent all of them exactly `travel` pixels. That is a ring expanding at a
 * constant rate: every burst is identical, the bubbles stay in formation for
 * the whole animation, and what a tab bursting into bubbles actually looks
 * like — a scatter that is dense near the origin and thins out — never happens.
 * "Uniform" was visible as a rotating dial rather than as a burst.
 *
 * Each of the three quantities below is a normal deviate scaled by one
 * constant, which is the whole change. The bubble count, the duration and the
 * cleanup are untouched: the same N elements run for the same time and are
 * removed on `finished`, so this costs nothing it did not already cost.
 */

/** Distance, as a fraction of the mean, that one standard deviation moves. */
const SPREAD_DISTANCE = 0.4;
/** Angular jitter, as a fraction of the gap between two evenly-spaced bubbles. */
const SPREAD_ANGLE = 0.55;
/** End-scale jitter, so the scatter has depth rather than one bubble size. */
const SPREAD_SCALE = 0.22;
/** `line`: how much further the burst reaches along its axis than a circle. */
const LINE_REACH = 1.9;
/** `line`: the spread across the axis, as a fraction of the mean distance. */
const LINE_THICKNESS = 0.16;
/** Deviates are clamped here, so one tail sample cannot throw a bubble off. */
const SIGMA_LIMIT = 2;

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

  /**
   * @type {Element | null} The bar: the track, and the fill's parent.
   *
   * There is deliberately no `#fill` field beside it. The fill is a child of
   * the bar, so removing the bar removes it, and the two things that touch it
   * — the progress transition and the finish flourish — are on the bar: the
   * transition reads a custom property written there, and the flourish scales
   * the track so that the fill it clips comes with it.
   */
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
  /** Whether the animation pack's subscriptions are attached. */
  #packListening = false;
  /** Whether this window currently holds Zen's loading indicator suppressed. */
  #ownsIndicator = false;

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
      this.#applyAnimations();
    });
  }

  onDisable() {
    const root = this.context.document.documentElement;
    root.removeAttribute(ATTR_ROOT);
    root.removeAttribute(ATTR_LOADING);
    root.removeAttribute(ATTR_LOADING_PAGE);
    root.removeAttribute(ATTR_BUBBLES);
    this.#teardownLoading();
    this.#teardownBubbles();
    this.#ownLoadingIndicator(false);
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
        fallback: 5,
        format: value => `${Math.max(1, Math.min(12, value))}px`,
      },
      // The page-arrival gesture. Stored the way a person thinks about it —
      // "three percent bigger" — and written as the scale factor CSS takes.
      // Clamped rather than validated: a scale typed into about:config with an
      // extra digit is a content pane larger than the window it is inside.
      {
        pref: "trance.feedback.loading.zoom.scale",
        cssVar: "--trance-loading-zoom",
        type: "int",
        fallback: 3,
        format: value => `${1 + Math.max(0, Math.min(20, value)) / 100}`,
      },
      // A filter function, not a length, for the same reason the surface
      // saturation is one: an identity `blur(0px)` over the content pane still
      // costs a full-pane render pass and `none` does not — and this is the
      // largest element in the window.
      {
        pref: "trance.feedback.loading.zoom.blur",
        cssVar: "--trance-loading-zoom-blur-fn",
        type: "int",
        fallback: 4,
        format: value =>
          Math.max(0, Math.min(24, value)) === 0
            ? "none"
            : `blur(${Math.max(0, Math.min(24, value))}px)`,
      },
      {
        // How much of its edge the bar spans at 100%. A percentage, because the
        // pane's size is not something this module knows or should ask for —
        // the containing block is what a percentage resolves against, and the
        // containing block is already the content pane.
        pref: "trance.feedback.loading.width",
        cssVar: "--trance-loading-span",
        type: "int",
        fallback: 25,
        format: value => `${Math.max(10, Math.min(100, value))}%`,
      },
      {
        pref: "trance.feedback.loading.offset",
        cssVar: "--trance-loading-offset",
        type: "int",
        fallback: 10,
        format: value => `${Math.max(0, Math.min(120, value))}px`,
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

    // Switching the page gesture off mid-load has to clear the attribute, or
    // the pane stays blurred until the next load starts and stops.
    const zoomObserver = { observe: () => this.#setPageEffect(this.#loading) };
    Services.prefs.addObserver(PREF_LOADING_ZOOM, zoomObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_LOADING_ZOOM, zoomObserver)
    );

    const bubbleObserver = { observe: () => this.#applyBubbles() };
    Services.prefs.addObserver(PREF_BUBBLES, bubbleObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_BUBBLES, bubbleObserver)
    );

    for (const pref of [PREF_ANIM_TAB_SWITCH, PREF_ANIM_SEARCH]) {
      const observer = { observe: () => this.#applyAnimations() };
      Services.prefs.addObserver(pref, observer);
      this.addDisposer(() => Services.prefs.removeObserver(pref, observer));
    }
  }

  // --- Loading bar -----------------------------------------------------------

  /**
   * Takes or releases ownership of the loading indicator, refcounted across
   * windows. See `PREF_ZEN_INDICATOR`.
   *
   * @param {boolean} owned - Whether this window's Trance bar is on.
   */
  #ownLoadingIndicator(owned) {
    if (owned === this.#ownsIndicator) {
      return;
    }
    this.#ownsIndicator = owned;

    const defaults = Services.prefs.getDefaultBranch("");
    if (owned) {
      if (zenIndicatorSuppressors++ === 0) {
        zenIndicatorWasEnabled = defaults.getBoolPref(PREF_ZEN_INDICATOR, true);
        defaults.setBoolPref(PREF_ZEN_INDICATOR, false);
        TranceLog.log(NS, "took the loading indicator from Zen");
      }
      return;
    }
    if (--zenIndicatorSuppressors === 0 && zenIndicatorWasEnabled !== null) {
      defaults.setBoolPref(PREF_ZEN_INDICATOR, zenIndicatorWasEnabled);
      zenIndicatorWasEnabled = null;
      TranceLog.log(NS, "gave the loading indicator back to Zen");
    }
  }

  #applyLoading() {
    const root = this.context.document.documentElement;

    if (!Services.prefs.getBoolPref(PREF_LOADING, true)) {
      root.removeAttribute(ATTR_LOADING);
      this.#teardownLoading();
      this.#ownLoadingIndicator(false);
      return;
    }
    this.#ownLoadingIndicator(true);

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
    // Two elements, because a progress bar is two things: the distance and how
    // much of it is covered. The track is the one that is always there while a
    // load is in flight; the fill is the only one that moves. See the
    // track/fill note in trance-feedback.css.
    const fill = doc.createElement("div");
    fill.id = FILL_ID;
    bar.appendChild(fill);
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
    this.#setPageEffect(true);
    this.#startCreep();
  }

  /**
   * The page's own arrival gesture: the selected pane pushed towards the viewer
   * and softened while a load is in flight, settling back when it finishes.
   *
   * One attribute, read by two transitions in trance-feedback.css. It is set
   * only while the switch is on, so a window with the effect off never matches
   * the rule and never carries the filter — and it is *cleared* unconditionally,
   * because turning the switch off mid-load must not leave the pane blurred
   * with nothing left to clear it (TRANCE.md §6.6).
   *
   * @param {boolean} loading
   */
  #setPageEffect(loading) {
    const root = this.context.document.documentElement;
    if (loading && Services.prefs.getBoolPref(PREF_LOADING_ZOOM, true)) {
      root.setAttribute(ATTR_LOADING_PAGE, "true");
    } else {
      root.removeAttribute(ATTR_LOADING_PAGE);
    }
  }

  #finishLoading() {
    if (!this.#loading) {
      return;
    }
    this.#loading = false;
    this.#stopCreep();
    this.#setPageEffect(false);
    // Land on 100% first, so the bar is seen to complete rather than to
    // vanish; the stylesheet fades it out from there with a token duration.
    this.#writeProgress(1);

    const fade = () => this.#bar?.removeAttribute("active");
    const flourish = this.#flourish();
    if (flourish) {
      flourish.finished.then(fade, fade);
      return;
    }
    fade();
  }

  /**
   * The last frame of a load: the bar goes slightly past its own length and
   * settles back before it fades.
   *
   * A Web Animation rather than a class and a `transitionend`, for the reason
   * every other piece of Trance motion is one: `TranceMotion` returns null when
   * motion is off — so at level 0 this method answers "no animation" and the
   * caller fades immediately, without this module knowing that motion levels
   * exist — and it scopes `will-change` to the animation instead of leaving a
   * compositor layer behind (TRANCE.md §3.5).
   *
   * It animates the *track*, not the fill. The fill is clipped by the track
   * (`overflow: clip`, so its square corners do not show through the track's
   * arcs), so a fill scaled past 1 would overshoot into a box that crops it and
   * nothing would move. Scaling the track takes the fill with it, which is the
   * gesture — the whole object reaching further — and it also means this no
   * longer shares a property with the transition the stylesheet drives from
   * `--trance-loading-progress`: that one is on the fill now.
   *
   * The scale is on the axis the bar runs along, about the centre, which is
   * also where the fill grows from — so the bar reaches further at both ends
   * rather than drifting sideways.
   *
   * @returns {Animation | null}
   */
  #flourish() {
    if (
      !this.#bar ||
      !Services.prefs.getBoolPref(PREF_LOADING_FLOURISH, true)
    ) {
      return null;
    }
    const overshoot = parseFloat(this.#token("--trance-loading-overshoot"));
    if (!Number.isFinite(overshoot) || overshoot <= 1) {
      return null;
    }
    const vertical = this.#isVertical;
    const scale = value => (vertical ? `scaleY(${value})` : `scaleX(${value})`);

    return this.context.motion.animate(
      this.#bar,
      [
        { transform: scale(1) },
        { transform: scale(overshoot), offset: 0.45 },
        { transform: scale(1) },
      ],
      {
        duration: this.#durationOf("--trance-dur-base"),
        easing: this.#token("--trance-ease-emphasis"),
        willChange: "transform",
      }
    );
  }

  /** @returns {boolean} Whether the bar runs down an edge rather than across one. */
  get #isVertical() {
    const position =
      this.context.document.documentElement.getAttribute(ATTR_LOADING);
    return position === "left" || position === "right";
  }

  #resetForTabSwitch() {
    const tab = this.context.window.gBrowser?.selectedTab;
    if (tab?.hasAttribute("busy")) {
      return;
    }
    this.#loading = false;
    this.#stopCreep();
    this.#setPageEffect(false);
    this.#bar?.removeAttribute("active");
    this.#writeProgress(0);
  }

  #writeProgress(value) {
    this.#progress = value;
    // On the bar rather than on the fill: the fill's rule reads the property
    // through the cascade, and keeping it on the parent means the two
    // horizontal/vertical rule pairs in the stylesheet do not each need their
    // own copy of it.
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
    this.#setPageEffect(false);
    const browser = this.context.window.gBrowser;
    if (this.#progressListener && browser?.removeProgressListener) {
      browser.removeProgressListener(this.#progressListener);
    }
    this.#progressListener = null;
    // The fill is a child of the bar, so removing the bar removes both.
    this.#bar?.remove();
    this.#bar = null;
  }

  // --- The animation pack ----------------------------------------------------

  /**
   * Two gestures, one idea: the thing you asked for arrives rather than
   * appearing.
   *
   * Both are Web Animations through `TranceMotion`, so both are nothing at
   * motion level 0 and shortened at level 1 — including when the level comes
   * from the system's reduced-motion setting rather than from the pref. Neither
   * has a switch for that, and neither should: a second owner for "is motion
   * allowed" is how a browser ends up honouring the system setting in three
   * places out of four (TRANCE.md §6.2).
   *
   * The subscriptions are attached once and never detached on a pref flip,
   * which is the same arrangement the tab-close burst has and for the same
   * reason: `addListener`'s disposers run on teardown, so re-attaching on a flip
   * would stack a second listener per flip. Each handler reads its own pref, so
   * a switched-off animation costs one `getBoolPref` on an event the browser
   * was dispatching anyway.
   */
  #applyAnimations() {
    if (this.#packListening) {
      return;
    }
    if (
      !Services.prefs.getBoolPref(PREF_ANIM_TAB_SWITCH, true) &&
      !Services.prefs.getBoolPref(PREF_ANIM_SEARCH, true)
    ) {
      return;
    }
    const container = this.context.window.gBrowser?.tabContainer;
    if (!container) {
      // Expected once, at startup. `#whenBrowserReady` calls back.
      return;
    }
    this.#packListening = true;

    this.addListener(container, "TabSelect", () => this.#animateTabSwitch());

    // The address bar's own state, read from the attribute Zen and Firefox
    // already maintain for it rather than from a `focus` event: `focus` fires
    // for the text field, and the panel that has to be animated is what
    // `[breakout-extend]` marks. One subscription through the hub, which
    // coalesces to one callback per frame (TRANCE.md §6.4).
    //
    // `subtree: true` is not optional here even though the target is one
    // element: the hub observes `document.documentElement` with the *union* of
    // its subscribers' options, so a subscription without it would only ever
    // see the root element's own attributes and this would silently never fire.
    this.observeMutations("#urlbar", () => this.#animateSearch(), {
      attributes: true,
      attributeFilter: ["breakout-extend"],
      subtree: true,
    });
  }

  /**
   * The selected tab's pane, arriving.
   *
   * The *pane*, not `#zen-tabbox-wrapper`: the wrapper holds every tab's panel
   * and the sidebar's own gutter, so scaling it would move the whole layout and
   * animate the tab that just left as well as the one that arrived.
   *
   * Running animations are cancelled first. Without that, switching quickly
   * through four tabs leaves four animations on the same element, each with its
   * own `will-change`, and the last one to finish is the one that removes it.
   */
  #animateTabSwitch() {
    if (!Services.prefs.getBoolPref(PREF_ANIM_TAB_SWITCH, true)) {
      return;
    }
    const pane = this.context.window.gBrowser?.selectedBrowser?.closest(
      ".browserSidebarContainer"
    );
    if (!pane) {
      return;
    }
    for (const animation of pane.getAnimations()) {
      animation.cancel();
    }
    this.context.motion.animate(
      pane,
      [
        {
          transform: `scale(${ARRIVAL_SCALE})`,
          filter: `blur(${ARRIVAL_BLUR}px)`,
          opacity: 0,
        },
        { transform: "none", filter: "blur(0px)", opacity: 1 },
      ],
      {
        duration: this.#durationOf("--trance-dur-arrival"),
        easing: this.#token("--trance-ease-standard"),
        willChange: "transform, filter, opacity",
      }
    );
  }

  /**
   * The address bar, settling — the same gesture with the scale the other side
   * of 1, so opening search reads as the opposite of changing tab rather than
   * as the same effect twice.
   *
   * ── Why there is no exit animation ───────────────────────────────────────
   *
   * There used to be: removing `[breakout-extend]` played the entry backwards,
   * so the bar scaled up, blurred and faded to nothing. It looked wrong because
   * it was wrong. `#urlbar` is one element in both states — the floating search
   * panel *is* the toolbar's address bar, wearing a different attribute — so
   * "animate the search panel out" fades a control that is not leaving. What
   * the user sees is the address bar in the sidebar blurring away to 20% opacity
   * every time they press Escape, and then snapping back when the animation
   * ends.
   *
   * The entry keeps its animation because there the gesture is real: the panel
   * arrives, and the thing being animated is the thing that appeared. On the way
   * out the panel does not disappear, it *becomes* the toolbar bar, and Zen
   * already animates that geometry itself. Trance's job there is to add nothing.
   */
  #animateSearch() {
    if (!Services.prefs.getBoolPref(PREF_ANIM_SEARCH, true)) {
      return;
    }
    const urlbar = this.context.document.getElementById("urlbar");
    if (!urlbar) {
      return;
    }
    // Cancel unconditionally, including on the way out: an entry that is still
    // running when the bar is dismissed would otherwise finish against an
    // element that has gone back to being a toolbar control, and leave its
    // `will-change` behind on it.
    for (const animation of urlbar.getAnimations()) {
      animation.cancel();
    }
    if (!urlbar.hasAttribute("breakout-extend")) {
      return;
    }
    this.context.motion.animate(
      urlbar,
      [
        {
          transform: `scale(${SEARCH_SCALE})`,
          filter: `blur(${ARRIVAL_BLUR}px)`,
          opacity: 0,
        },
        { transform: "none", filter: "blur(0px)", opacity: 1 },
      ],
      {
        duration: this.#durationOf("--trance-dur-arrival"),
        easing: this.#token("--trance-ease-standard"),
        willChange: "transform, filter, opacity",
      }
    );
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
    const shape = this.#bubbleShape();
    const duration = this.#burstDuration();
    const easing = this.#token("--trance-ease-standard");

    for (let index = 0; index < count; index++) {
      const { x, y, scale } = this.#bubbleVector(shape, index, count, travel);
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
              `translate(calc(-50% + ${x.toFixed(2)}px), ` +
              `calc(-50% + ${y.toFixed(2)}px)) scale(${scale.toFixed(3)})`,
            opacity: 0,
          },
        ],
        {
          duration,
          easing,
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
   * A standard normal deviate, clamped to ±`SIGMA_LIMIT`.
   *
   * Box–Muller, which is two `Math.random()` calls and one `log`/`cos` pair per
   * sample — cheaper than the polar method's rejection loop at these counts, and
   * bounded, which the rejection loop is not. `1 - Math.random()` because
   * `Math.log(0)` is `-Infinity` and `Math.random()` can return exactly 0.
   *
   * @returns {number} Roughly N(0, 1), never outside ±2.
   */
  #gaussian() {
    const magnitude = Math.sqrt(-2 * Math.log(1 - Math.random()));
    const deviate = magnitude * Math.cos(TAU * Math.random());
    return Math.max(-SIGMA_LIMIT, Math.min(SIGMA_LIMIT, deviate));
  }

  /**
   * Where one bubble ends up, and how big it is when it gets there.
   *
   * The even spacing is kept as the *mean* in both shapes rather than replaced
   * by a uniform random angle: N independent uniform angles clump, and a burst
   * of eight bubbles with three of them overlapping reads as a bug rather than
   * as randomness. Stratifying and then jittering is the standard fix and it is
   * one addition here.
   *
   * @param {string} shape - `circle` or `line`.
   * @param {number} index - 0-based bubble index.
   * @param {number} count - How many bubbles this burst has.
   * @param {number} travel - The mean distance, in pixels.
   * @returns {{x: number, y: number, scale: number}}
   */
  #bubbleVector(shape, index, count, travel) {
    const distance = travel * (1 + this.#gaussian() * SPREAD_DISTANCE);
    const scale = 1 + this.#gaussian() * SPREAD_SCALE;

    if (shape === "line") {
      // The tab strip is vertical, so the axis that reads as "the row the tab
      // was in" is the horizontal one. Bubbles alternate sides so the two arms
      // stay balanced at any count, odd ones included.
      const side = index % 2 ? 1 : -1;
      // Stratified along the arm rather than piled at its end: bubble 0 and 1
      // are the near pair, the last two are the far pair.
      const alongArm = (Math.floor(index / 2) + 1) / Math.ceil(count / 2);
      return {
        x: side * distance * LINE_REACH * alongArm,
        y: this.#gaussian() * travel * LINE_THICKNESS,
        scale,
      };
    }

    const step = TAU / count;
    const angle = index * step + this.#gaussian() * step * SPREAD_ANGLE;
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      scale,
    };
  }

  /**
   * @returns {string} A member of `SHAPES`.
   */
  #bubbleShape() {
    const value = Services.prefs.getStringPref(
      PREF_BUBBLE_SHAPE,
      DEFAULT_SHAPE
    );
    return SHAPES.includes(value) ? value : DEFAULT_SHAPE;
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

  /**
   * A duration token, in milliseconds.
   *
   * @param {string} property - A `--trance-dur-*` custom property name.
   * @returns {number}
   */
  #durationOf(property) {
    const raw = this.#token(property);
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return raw.endsWith("ms") ? parsed : parsed * 1000;
  }

  #burstDuration() {
    return this.#durationOf("--trance-dur-slow");
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
