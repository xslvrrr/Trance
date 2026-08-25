// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: one MutationObserver, one ResizeObserver, one IntersectionObserver
// per window, multiplexed to every subscriber.
//
// Seven of the mods Trance replaces each installed their own MutationObserver
// on `#tabbrowser-tabs` or `document.documentElement` with
// `{ subtree: true, attributes: true }`. Every chrome DOM mutation then fanned
// out to N callbacks, each doing its own `querySelectorAll` plus a style write,
// so a page flipping its `busy` attribute cost N forced reflows (TRANCE.md
// §3.2). Collapsing that to one observer whose records are filtered once and
// flushed once per frame is the single largest main-thread win available.
//
// Refs: TRANCE.md §3.2, §6.4, §12.1, §12.3

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "ObserverHub";

export class TranceObserverHub {
  #window;
  #scheduler;
  #nextHandle = 1;

  /**
   * @type {Map<number, {
   *   selector: string,
   *   cb: Function,
   *   attributes: boolean,
   *   childList: boolean,
   *   characterData: boolean,
   *   subtree: boolean,
   *   attributeFilter: string[] | null,
   * }>}
   */
  #mutationSubs = new Map();
  /** @type {Map<number, {element: Element, cb: Function}>} */
  #resizeSubs = new Map();
  /** @type {Map<number, {element: Element, cb: Function}>} */
  #intersectionSubs = new Map();

  /** @type {MutationObserver | null} */
  #mutationObserver = null;
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  /** @type {Map<string, IntersectionObserver>} */
  #intersectionObservers = new Map();

  /** Subscriber handle -> the records queued for it this frame. */
  #pending = new Map();
  #flushHandle = 0;
  #destroyed = false;

  /**
   * @param {Window} win
   * @param {import("./TranceScheduler.mjs").TranceScheduler} schedulerInstance
   */
  constructor(win, schedulerInstance) {
    this.#window = win;
    this.#scheduler = schedulerInstance;
  }

  // --- Mutations -------------------------------------------------------------

  /**
   * Calls `cb(records)` when a node matching `selector` — or, for `childList`,
   * a node inside one — mutates. Records are batched: N mutations in one task
   * produce one callback, not N.
   *
   * @param {string} selector - CSS selector the mutation target must match.
   * @param {(records: MutationRecord[]) => void} cb
   * @param {object} [options]
   * @param {boolean} [options.attributes]
   * @param {boolean} [options.childList]
   * @param {boolean} [options.characterData]
   * @param {boolean} [options.subtree]
   * @param {string[]} [options.attributeFilter] - Narrows this subscriber only;
   *   the shared observer watches the union of every subscriber's filters.
   * @returns {number}
   */
  observeMutations(selector, cb, options = {}) {
    const handle = this.#nextHandle++;
    this.#mutationSubs.set(handle, {
      selector,
      cb,
      attributes: options.attributes ?? false,
      childList: options.childList ?? false,
      characterData: options.characterData ?? false,
      subtree: options.subtree ?? true,
      attributeFilter: options.attributeFilter ?? null,
    });
    this.#syncMutationObserver();
    return handle;
  }

  // --- Resize ----------------------------------------------------------------

  /**
   * @param {Element} element
   * @param {(entry: ResizeObserverEntry) => void} cb
   * @returns {number}
   */
  observeResize(element, cb) {
    const handle = this.#nextHandle++;
    this.#resizeSubs.set(handle, { element, cb });
    if (!this.#resizeObserver) {
      this.#resizeObserver = new this.#window.ResizeObserver(entries =>
        this.#onResize(entries)
      );
    }
    this.#resizeObserver.observe(element);
    return handle;
  }

  // --- Intersection ----------------------------------------------------------

  /**
   * IntersectionObserver options change what the observer *is*, so unlike the
   * other two this keeps one observer per distinct option set. In practice that
   * is one or two for the whole browser.
   *
   * @param {Element} element
   * @param {(entry: IntersectionObserverEntry) => void} cb
   * @param {object} [options] - Standard IntersectionObserver options.
   * @returns {number}
   */
  observeIntersection(element, cb, options = {}) {
    const handle = this.#nextHandle++;
    this.#intersectionSubs.set(handle, { element, cb });

    const key = JSON.stringify({
      rootMargin: options.rootMargin ?? "0px",
      threshold: options.threshold ?? 0,
    });
    let observer = this.#intersectionObservers.get(key);
    if (!observer) {
      observer = new this.#window.IntersectionObserver(
        entries => this.#onIntersection(entries),
        options
      );
      this.#intersectionObservers.set(key, observer);
    }
    observer.observe(element);
    return handle;
  }

  // --- Teardown --------------------------------------------------------------

  /**
   * @param {number} handle - A handle from any of the `observe*` methods.
   */
  unobserve(handle) {
    if (this.#mutationSubs.delete(handle)) {
      this.#pending.delete(handle);
      this.#syncMutationObserver();
      return;
    }
    const resize = this.#resizeSubs.get(handle);
    if (resize) {
      this.#resizeSubs.delete(handle);
      if (!this.#hasOtherSubscriber(this.#resizeSubs, resize.element)) {
        this.#resizeObserver?.unobserve(resize.element);
      }
      if (!this.#resizeSubs.size) {
        this.#resizeObserver?.disconnect();
        this.#resizeObserver = null;
      }
      return;
    }
    const intersection = this.#intersectionSubs.get(handle);
    if (intersection) {
      this.#intersectionSubs.delete(handle);
      if (
        !this.#hasOtherSubscriber(this.#intersectionSubs, intersection.element)
      ) {
        for (const observer of this.#intersectionObservers.values()) {
          observer.unobserve(intersection.element);
        }
      }
      if (!this.#intersectionSubs.size) {
        for (const observer of this.#intersectionObservers.values()) {
          observer.disconnect();
        }
        this.#intersectionObservers.clear();
      }
    }
  }

  destroy() {
    this.#destroyed = true;
    this.#mutationObserver?.disconnect();
    this.#mutationObserver = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    for (const observer of this.#intersectionObservers.values()) {
      observer.disconnect();
    }
    this.#intersectionObservers.clear();
    this.#mutationSubs.clear();
    this.#resizeSubs.clear();
    this.#intersectionSubs.clear();
    this.#pending.clear();
    if (this.#flushHandle) {
      this.#scheduler.cancel(this.#flushHandle);
      this.#flushHandle = 0;
    }
  }

  /** Live observer count. The §12.1 budget is one of each, per window. */
  get observerCount() {
    return (
      (this.#mutationObserver ? 1 : 0) +
      (this.#resizeObserver ? 1 : 0) +
      this.#intersectionObservers.size
    );
  }

  // --- Internals -------------------------------------------------------------

  #hasOtherSubscriber(subs, element) {
    for (const sub of subs.values()) {
      if (sub.element === element) {
        return true;
      }
    }
    return false;
  }

  /**
   * Rebuilds the one shared MutationObserver from the union of what every
   * subscriber asked for. Called whenever the subscriber set changes, which is
   * on pref flips and window teardown — not on the hot path.
   */
  #syncMutationObserver() {
    if (this.#destroyed) {
      return;
    }
    if (!this.#mutationSubs.size) {
      this.#mutationObserver?.disconnect();
      this.#mutationObserver = null;
      return;
    }

    const union = {
      attributes: false,
      childList: false,
      characterData: false,
      subtree: false,
    };
    /** @type {Set<string> | null} */
    let attributeFilter = new Set();
    for (const sub of this.#mutationSubs.values()) {
      union.attributes ||= sub.attributes;
      union.childList ||= sub.childList;
      union.characterData ||= sub.characterData;
      union.subtree ||= sub.subtree;
      if (sub.attributes) {
        if (!sub.attributeFilter) {
          // One unfiltered attribute subscriber means the observer cannot be
          // narrowed for anyone.
          attributeFilter = null;
        } else if (attributeFilter) {
          for (const attributeName of sub.attributeFilter) {
            attributeFilter.add(attributeName);
          }
        }
      }
    }

    const options = { ...union };
    if (!options.attributes && !options.childList && !options.characterData) {
      // MutationObserver.observe() throws if none of the three is requested.
      // A subscriber that asked for nothing gets attributes, which is what
      // every caller so far has actually meant.
      options.attributes = true;
    }
    if (options.attributes && attributeFilter?.size) {
      options.attributeFilter = [...attributeFilter];
    }

    if (!this.#mutationObserver) {
      this.#mutationObserver = new this.#window.MutationObserver(records =>
        this.#onMutations(records)
      );
    }
    this.#mutationObserver.disconnect();
    this.#mutationObserver.observe(
      this.#window.document.documentElement,
      options
    );
    TranceLog.log(NS, "mutation observer rebuilt", options);
  }

  #onMutations(records) {
    TranceLog.count("observer.mutation.batches");
    for (const record of records) {
      for (const [handle, sub] of this.#mutationSubs) {
        if (!this.#recordMatches(record, sub)) {
          continue;
        }
        let queue = this.#pending.get(handle);
        if (!queue) {
          queue = [];
          this.#pending.set(handle, queue);
        }
        queue.push(record);
      }
    }
    this.#scheduleFlush();
  }

  #recordMatches(record, sub) {
    if (record.type === "attributes" && !sub.attributes) {
      return false;
    }
    if (record.type === "childList" && !sub.childList) {
      return false;
    }
    if (record.type === "characterData" && !sub.characterData) {
      return false;
    }
    if (
      record.type === "attributes" &&
      sub.attributeFilter &&
      !sub.attributeFilter.includes(record.attributeName)
    ) {
      return false;
    }

    const target =
      record.target.nodeType === record.target.ELEMENT_NODE
        ? record.target
        : record.target.parentElement;
    if (!target) {
      return false;
    }
    if (target.matches(sub.selector)) {
      return true;
    }
    return sub.subtree && !!target.closest(sub.selector);
  }

  /**
   * Records are delivered once per frame. Reads happen in the subscriber,
   * writes happen after every subscriber has read, so a batch costs one style
   * flush rather than one per subscriber (TRANCE.md §6.4).
   */
  #scheduleFlush() {
    if (this.#flushHandle || !this.#pending.size) {
      return;
    }
    this.#flushHandle = this.#scheduler.onFrame(() => this.#flush(), {
      once: true,
    });
  }

  #flush() {
    this.#flushHandle = 0;
    const pending = this.#pending;
    this.#pending = new Map();
    for (const [handle, records] of pending) {
      const sub = this.#mutationSubs.get(handle);
      if (!sub) {
        continue;
      }
      TranceLog.count("observer.mutation.callbacks");
      try {
        sub.cb(records);
      } catch (error) {
        TranceLog.error(NS, `subscriber for "${sub.selector}" threw`, error);
      }
    }
  }

  #onResize(entries) {
    TranceLog.count("observer.resize.callbacks");
    for (const entry of entries) {
      for (const sub of this.#resizeSubs.values()) {
        if (sub.element === entry.target) {
          this.#safe(sub.cb, entry);
        }
      }
    }
  }

  #onIntersection(entries) {
    TranceLog.count("observer.intersection.callbacks");
    for (const entry of entries) {
      for (const sub of this.#intersectionSubs.values()) {
        if (sub.element === entry.target) {
          this.#safe(sub.cb, entry);
        }
      }
    }
  }

  #safe(cb, arg) {
    try {
      cb(arg);
    } catch (error) {
      TranceLog.error(NS, "subscriber threw", error);
    }
  }
}
