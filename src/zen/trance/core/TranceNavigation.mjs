// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: one router for "what is this browser doing", for the whole window.
//
// ── Why there is a router at all ──────────────────────────────────────────────
//
// Trance had three independent subscriptions to the same events: a
// `nsIWebProgressListener` on the tabbrowser for the loading bar, and two
// `addTabsProgressListener` registrations in the surface layer — one to mark
// `about:` browsers, one to decide whether the selected tab is empty. Each
// re-derived "which browser is this" and "does it matter", and between them they
// got two answers wrong (AUDIT.md Phase 3):
//
//   - `gBrowser.addProgressListener` reports the *selected* tab's progress, but
//     it keeps reporting through a tab switch, so a background tab finishing a
//     load could drive the selected pane's loading gesture.
//   - `onProgressChange` was filtered on `feature.#loading` rather than on
//     `webProgress.isTopLevel`, so a subresource's byte counts could move a bar
//     that is supposed to represent the document.
//
// So: one `addTabsProgressListener` per window, keyed by browser, filtered to
// top-level progress once, and flushed to subscribers at most once per frame.
// A subscriber says whether it cares about every browser or only the selected
// one; nobody re-derives it, and nobody writes style on the event itself.
//
// The per-frame flush is not a nicety. `onProgressChange` fires per network
// event — hundreds of times on an ordinary page — and every subscriber that
// writes a custom property on it is a style flush at network rate. Coalescing
// makes the cost of N subscribers and M events one write per frame
// (TRANCE.md §6.4).
//
// Refs: TRANCE.md §3.2, §6.4; AUDIT.md Phase 3; ADR-060

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Navigation";

/** What a subscriber is told about one browser. */
const emptyState = () =>
  Object.freeze({
    loading: false,
    /** 0..1, or null while the load reports no total. */
    progress: null,
    uri: null,
  });

export class TranceNavigation {
  #window;
  #scheduler;
  #listener = null;
  #tabbrowser = null;
  #nextHandle = 1;
  #flushHandle = 0;
  #destroyed = false;
  #readyListener = null;
  #onSelect = () => this.#onTabSelect();
  #onClose = event => {
    const browser = event.target?.linkedBrowser;
    if (browser) {
      this.#states.delete(browser);
      this.#dirty.delete(browser);
    }
  };

  /**
   * @type {Map<number, {
   *   selectedOnly: boolean,
   *   onProgress: Function | null,
   *   onNavigate: Function | null,
   *   onSelect: Function | null,
   * }>}
   */
  #subs = new Map();

  /**
   * Browser -> its current state. A `Map` rather than a `WeakMap` because the
   * flush iterates the browsers that changed, and a WeakMap cannot be iterated;
   * entries are dropped on `TabClose`, which is the event that makes a browser
   * unreachable in the first place.
   *
   * @type {Map<object, {loading: boolean, progress: number|null, uri: nsIURI|null}>}
   */
  #states = new Map();

  /** Browsers whose state changed since the last flush, and how. */
  #dirty = new Map();

  /** The browser `TabSelect` last reported, so a re-select is not an event. */
  #selected = null;

  /**
   * @param {Window} win
   * @param {import("./TranceScheduler.mjs").TranceScheduler} tranceScheduler
   */
  constructor(win, tranceScheduler) {
    this.#window = win;
    this.#scheduler = tranceScheduler;
  }

  // --- Subscription ----------------------------------------------------------

  /**
   * Subscribes to navigation and progress for this window.
   *
   * @param {object} handlers
   * @param {(browser: object, state: object) => void} [handlers.onProgress]
   *   The browser's loading state or progress changed.
   * @param {(browser: object, state: object, sameDocument: boolean) => void} [handlers.onNavigate]
   *   The browser's top-level location changed.
   * @param {(browser: object, state: object) => void} [handlers.onSelect]
   *   A different tab became the selected one.
   * @param {object} [options]
   * @param {boolean} [options.selectedOnly] - Only hear about the selected
   *   browser. This is the fix for background loads driving selected-tab UI;
   *   a subscriber that wants it must not have to remember to check.
   * @returns {number} A handle for `unsubscribe`.
   */
  subscribe(
    { onProgress = null, onNavigate = null, onSelect = null } = {},
    { selectedOnly = false } = {}
  ) {
    if (this.#destroyed) {
      throw new Error("Cannot subscribe to a destroyed navigation router");
    }
    const handle = this.#nextHandle++;
    this.#subs.set(handle, { selectedOnly, onProgress, onNavigate, onSelect });
    if (this.#subs.size === 1) {
      try {
        this.#whenBrowserReady(() => this.#attach());
      } catch (error) {
        this.#subs.delete(handle);
        this.#detach();
        throw error;
      }
    }
    return handle;
  }

  /**
   * @param {number} handle
   */
  unsubscribe(handle) {
    this.#subs.delete(handle);
    if (!this.#subs.size) {
      this.#detach();
    }
  }

  // --- State -----------------------------------------------------------------

  /** The selected browser, or null before `gBrowser` exists. */
  get selectedBrowser() {
    return this.#window.gBrowser?.selectedBrowser ?? null;
  }

  /**
   * @param {object} browser
   * @returns {{loading: boolean, progress: number|null, uri: nsIURI|null}}
   */
  stateFor(browser) {
    const state = this.#states.get(browser);
    return state ? { ...state } : emptyState();
  }

  /** How many browsers this router is tracking. Used by the §12.1 checks. */
  get trackedCount() {
    return this.#states.size;
  }

  destroy() {
    this.#destroyed = true;
    this.#detach();
    this.#subs.clear();
  }

  #detach() {
    if (this.#readyListener) {
      this.#window.removeEventListener("load", this.#readyListener);
      this.#readyListener = null;
    }
    const container = this.#tabbrowser?.tabContainer;
    container?.removeEventListener("TabSelect", this.#onSelect);
    container?.removeEventListener("TabClose", this.#onClose);
    if (this.#listener && this.#tabbrowser?.removeTabsProgressListener) {
      this.#tabbrowser.removeTabsProgressListener(this.#listener);
    }
    this.#listener = null;
    this.#tabbrowser = null;
    if (this.#flushHandle) {
      this.#scheduler.cancel(this.#flushHandle);
      this.#flushHandle = 0;
    }
    this.#selected = null;
    this.#states.clear();
    this.#dirty.clear();
  }

  // --- Internals -------------------------------------------------------------

  /**
   * `TranceCore` enters at `MozBeforeInitialXULLayout`, deliberately, so that
   * Trance is never in a load-order race with Zen (TRANCE.md §3.7). `gBrowser`
   * does not exist yet at that point, so everything that needs it waits here.
   *
   * @param {() => void} callback
   */
  #whenBrowserReady(callback) {
    const win = this.#window;
    if (win.gBrowser?.tabContainer) {
      callback();
      return;
    }
    this.#readyListener = () => {
      this.#readyListener = null;
      callback();
    };
    win.addEventListener("load", this.#readyListener, { once: true });
  }

  #attach() {
    if (this.#destroyed || !this.#subs.size || this.#listener) {
      return;
    }
    const tabbrowser = this.#window.gBrowser;
    if (!tabbrowser?.addTabsProgressListener) {
      TranceLog.warn(NS, "no tabbrowser; navigation router is inert");
      return;
    }
    this.#tabbrowser = tabbrowser;

    const WPL = Ci.nsIWebProgressListener;
    const router = this;

    // A tabs progress listener, not a browser one. The browser-level listener
    // reports whichever tab is selected *at the time of the event*, which is
    // precisely the ambiguity this router exists to remove: here the browser is
    // an argument, so "whose load is this" is never inferred.
    this.#listener = {
      onStateChange(browser, webProgress, request, stateFlags) {
        if (!webProgress?.isTopLevel) {
          return;
        }
        if (!(stateFlags & WPL.STATE_IS_NETWORK)) {
          // Per-request start/stop. The document's own start and stop are the
          // network ones; everything else is a subresource.
          return;
        }
        if (stateFlags & WPL.STATE_START) {
          router.#update(
            browser,
            { loading: true, progress: null },
            "progress"
          );
        } else if (stateFlags & WPL.STATE_STOP) {
          router.#update(browser, { loading: false, progress: 1 }, "progress");
        }
      },

      onProgressChange(
        browser,
        webProgress,
        request,
        currentSelf,
        maxSelf,
        currentTotal,
        maxTotal
      ) {
        if (!webProgress?.isTopLevel || maxTotal <= 0) {
          return;
        }
        const state = router.#states.get(browser);
        if (!state?.loading) {
          return;
        }
        // Monotonic within a load: byte counts can go backwards when a
        // redirect resets the totals, and a bar that retreats reads as a bug.
        const next = Math.max(
          state.progress ?? 0,
          Math.min(1, currentTotal / maxTotal)
        );
        router.#update(browser, { progress: next }, "progress");
      },

      onLocationChange(browser, webProgress, request, uri, flags) {
        if (!webProgress?.isTopLevel) {
          return;
        }
        const sameDocument = Boolean(flags & WPL.LOCATION_CHANGE_SAME_DOCUMENT);
        router.#update(browser, { uri: uri ?? null }, "navigate", {
          sameDocument,
        });
      },
    };
    tabbrowser.addTabsProgressListener(this.#listener);

    const container = tabbrowser.tabContainer;
    container.addEventListener("TabSelect", this.#onSelect);
    container.addEventListener("TabClose", this.#onClose);

    // Whatever is already selected is the current answer, and a subscriber that
    // attaches after startup must not have to wait for the next navigation to
    // learn it.
    this.#selected = this.selectedBrowser;
    for (const browser of tabbrowser.browsers ?? []) {
      this.#states.set(browser, {
        loading: false,
        progress: null,
        uri: browser.currentURI ?? null,
      });
    }
  }

  /**
   * Records a change and asks for one flush.
   *
   * The write happens in the flush, never here: this runs on a network event,
   * and a style write per network event is the per-event reflow TRANCE.md §6.4
   * exists to prevent.
   *
   * @param {object} browser
   * @param {object} patch
   * @param {"progress"|"navigate"} kind
   * @param {object} [detail]
   */
  #update(browser, patch, kind, detail = {}) {
    if (this.#destroyed || !browser) {
      return;
    }
    const state = this.#states.get(browser) ?? {
      loading: false,
      progress: null,
      uri: null,
    };
    const next = { ...state, ...patch };
    this.#states.set(browser, next);

    const pending = this.#dirty.get(browser) ?? {
      progress: false,
      navigate: false,
      sameDocument: true,
    };
    pending[kind] = true;
    if (kind === "navigate") {
      // One flush may cover a same-document hop followed by a real load. The
      // stronger claim wins: a subscriber that skips same-document changes must
      // not skip the load that came with them.
      pending.sameDocument = pending.sameDocument && detail.sameDocument;
    }
    this.#dirty.set(browser, pending);
    this.#scheduleFlush();
  }

  #onTabSelect() {
    const browser = this.selectedBrowser;
    if (browser === this.#selected) {
      return;
    }
    this.#selected = browser;
    if (!this.#states.has(browser) && browser) {
      this.#states.set(browser, {
        loading: false,
        progress: null,
        uri: browser.currentURI ?? null,
      });
    }
    // Selection is not coalesced with progress: it is the answer to "which
    // browser do I represent", and a subscriber that renders the wrong browser
    // for a frame is the defect, not the optimisation.
    const state = this.stateFor(browser);
    for (const sub of [...this.#subs.values()]) {
      this.#safe(sub.onSelect, browser, state);
    }
  }

  #scheduleFlush() {
    if (this.#flushHandle || !this.#dirty.size) {
      return;
    }
    this.#flushHandle = this.#scheduler.onFrame(() => this.#flush(), {
      once: true,
    });
  }

  #flush() {
    this.#flushHandle = 0;
    const dirty = this.#dirty;
    this.#dirty = new Map();
    const selected = this.selectedBrowser;

    for (const [browser, pending] of dirty) {
      const isSelected = browser === selected;
      const state = this.stateFor(browser);
      for (const sub of [...this.#subs.values()]) {
        if (sub.selectedOnly && !isSelected) {
          continue;
        }
        if (pending.progress) {
          this.#safe(sub.onProgress, browser, state);
        }
        if (pending.navigate) {
          this.#safe(sub.onNavigate, browser, state, pending.sameDocument);
        }
      }
    }
  }

  /**
   * @param {Function|null} cb
   * @param {...any} args
   */
  #safe(cb, ...args) {
    if (!cb) {
      return;
    }
    try {
      cb(...args);
    } catch (error) {
      TranceLog.error(NS, "subscriber threw", error);
    }
  }
}
