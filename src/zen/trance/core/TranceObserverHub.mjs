// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: one MutationObserver per subscribed root, one ResizeObserver and
// one IntersectionObserver per option set, multiplexed to every subscriber.
//
// Seven of the mods Trance replaces each installed their own MutationObserver
// on `#tabbrowser-tabs` or `document.documentElement` with
// `{ subtree: true, attributes: true }`. Every chrome DOM mutation then fanned
// out to N callbacks, each doing its own `querySelectorAll` plus a style write,
// so a page flipping its `busy` attribute cost N forced reflows (TRANCE.md
// §3.2). Collapsing each root's records to one filtered flush per frame is
// the single largest main-thread win available.
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
   *   cb: Function | null,
   *   read: Function | null,
   *   write: Function | null,
   *   root: Element,
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
  /**
   * @type {Map<number, {
   *   element: Element,
   *   cb: Function,
   *   observer: IntersectionObserver,
   * }>}
   */
  #intersectionSubs = new Map();

  /**
   * Each root has its own observer because a shared document observer defeats
   * the point of a scoped subscription: unrelated chrome mutations would still
   * reach the subscriber and make it walk its own subtree. The observer entry
   * also owns the observe options, rebuilt when the union of subscriptions for
   * that root changes.
   *
   * @type {Map<Element, {observer: MutationObserver}>}
   */
  #mutationObservers = new Map();
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  /**
   * @type {Map<Element | null, Map<string, IntersectionObserver>>}
   */
  #intersectionObservers = new Map();

  /** Subscriber handle -> the records queued for it this frame. */
  #pending = new Map();
  #flushHandle = 0;
  #destroyed = false;

  /**
   * The dispatch index keeps records inside their observer root and avoids
   * offering an attribute record to subscribers that cannot have requested
   * that attribute. Selector matching is consequently limited to the
   * subscribers that can observe the record's type in that root, rather than
   * every mutation subscriber in the window.
   *
   * @type {Map<Element, {
   *   byType: Map<string, Set<number>>,
   *   attributesByName: Map<string, Set<number>>,
   *   unfilteredAttributes: Set<number>,
   * }>}
   */
  #mutationIndex = new Map();

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
   * A subscriber may instead provide `{ read, write }` as `cb`, or provide
   * those functions in `options`. Reads run for every subscriber before any
   * corresponding writes; a write receives its own read's return value.
   *
   * @param {string} selector - CSS selector the mutation target must match.
   * @param {(records: MutationRecord[]) => void | {read: Function, write: Function} | null} cb
   * @param {object} [options]
   * @param {Element} [options.root] - Root narrowed observer scope.
   * @param {boolean} [options.attributes]
   * @param {boolean} [options.childList]
   * @param {boolean} [options.characterData]
   * @param {boolean} [options.subtree]
   * @param {string[]} [options.attributeFilter] - Narrows this subscriber only;
   *   the shared observer watches the union of every subscriber's filters.
   * @param {(records: MutationRecord[]) => any} [options.read]
   * @param {(value: any) => void} [options.write]
   * @returns {number}
   */
  observeMutations(selector, cb, options = {}) {
    const handle = this.#nextHandle++;
    const phaseSource = cb && typeof cb === "object" ? cb : options;
    this.#mutationSubs.set(handle, {
      selector,
      cb: typeof cb === "function" ? cb : null,
      read: typeof phaseSource.read === "function" ? phaseSource.read : null,
      write: typeof phaseSource.write === "function" ? phaseSource.write : null,
      root: options.root ?? this.#window.document.documentElement,
      attributes: options.attributes ?? false,
      childList: options.childList ?? false,
      characterData: options.characterData ?? false,
      subtree: options.subtree ?? true,
      attributeFilter: options.attributeFilter ?? null,
    });
    this.#rebuildMutationIndex();
    this.#syncMutationObservers();
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
   * other two this keeps one observer per distinct option set. Root identity is
   * part of that set: the same threshold against two roots is two observers.
   *
   * @param {Element} element
   * @param {(entry: IntersectionObserverEntry) => void} cb
   * @param {object} [options] - Standard IntersectionObserver options.
   * @returns {number}
   */
  observeIntersection(element, cb, options = {}) {
    const handle = this.#nextHandle++;
    const root = options.root ?? null;
    const key = JSON.stringify({
      rootMargin: options.rootMargin ?? "0px",
      threshold: options.threshold ?? 0,
    });
    let observersForRoot = this.#intersectionObservers.get(root);
    if (!observersForRoot) {
      observersForRoot = new Map();
      this.#intersectionObservers.set(root, observersForRoot);
    }
    let observer = observersForRoot.get(key);
    if (!observer) {
      observer = new this.#window.IntersectionObserver(
        entries => this.#onIntersection(observer, entries),
        options
      );
      observersForRoot.set(key, observer);
    }
    this.#intersectionSubs.set(handle, { element, cb, observer });
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
      this.#rebuildMutationIndex();
      this.#syncMutationObservers();
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
    if (!intersection) {
      return;
    }
    this.#intersectionSubs.delete(handle);
    if (
      !this.#hasOtherIntersectionSubscriber(
        this.#intersectionSubs,
        intersection.observer,
        intersection.element
      )
    ) {
      intersection.observer.unobserve(intersection.element);
    }
    if (
      !this.#hasOtherIntersectionSubscriber(
        this.#intersectionSubs,
        intersection.observer
      )
    ) {
      for (const [root, observersForRoot] of this.#intersectionObservers) {
        for (const [key, observer] of observersForRoot) {
          if (observer === intersection.observer) {
            observer.disconnect();
            observersForRoot.delete(key);
          }
        }
        if (!observersForRoot.size) {
          this.#intersectionObservers.delete(root);
        }
      }
    }
  }

  destroy() {
    this.#destroyed = true;
    for (const { observer } of this.#mutationObservers.values()) {
      observer.disconnect();
    }
    this.#mutationObservers.clear();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    for (const observersForRoot of this.#intersectionObservers.values()) {
      for (const observer of observersForRoot.values()) {
        observer.disconnect();
      }
    }
    this.#intersectionObservers.clear();
    this.#mutationSubs.clear();
    this.#resizeSubs.clear();
    this.#intersectionSubs.clear();
    this.#mutationIndex.clear();
    this.#pending.clear();
    if (this.#flushHandle) {
      this.#scheduler.cancel(this.#flushHandle);
      this.#flushHandle = 0;
    }
  }

  /** Live observer count. The §12.1 budget is one of each, per window. */
  get observerCount() {
    return (
      this.#mutationObservers.size +
      (this.#resizeObserver ? 1 : 0) +
      [...this.#intersectionObservers.values()].reduce(
        (count, observersForRoot) => count + observersForRoot.size,
        0
      )
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

  #hasOtherIntersectionSubscriber(subs, observer, element = null) {
    for (const sub of subs.values()) {
      if (
        sub.observer === observer &&
        (element === null || sub.element === element)
      ) {
        return true;
      }
    }
    return false;
  }

  #rebuildMutationIndex() {
    this.#mutationIndex.clear();
    for (const [handle, sub] of this.#mutationSubs) {
      let index = this.#mutationIndex.get(sub.root);
      if (!index) {
        index = {
          byType: new Map([
            ["attributes", new Set()],
            ["childList", new Set()],
            ["characterData", new Set()],
          ]),
          attributesByName: new Map(),
          unfilteredAttributes: new Set(),
        };
        this.#mutationIndex.set(sub.root, index);
      }
      for (const [type, enabled] of [
        ["attributes", sub.attributes],
        ["childList", sub.childList],
        ["characterData", sub.characterData],
      ]) {
        if (enabled) {
          index.byType.get(type).add(handle);
        }
      }
      if (sub.attributes) {
        if (!sub.attributeFilter) {
          index.unfilteredAttributes.add(handle);
        } else {
          for (const attributeName of sub.attributeFilter) {
            let handles = index.attributesByName.get(attributeName);
            if (!handles) {
              handles = new Set();
              index.attributesByName.set(attributeName, handles);
            }
            handles.add(handle);
          }
        }
      }
    }
  }

  /**
   * Rebuilds each root's MutationObserver from the union of what subscribers
   * for that root asked for. Called when subscriptions change, never per record.
   */
  #syncMutationObservers() {
    if (this.#destroyed) {
      return;
    }
    for (const [root, entry] of this.#mutationObservers) {
      if (!this.#mutationIndex.has(root)) {
        entry.observer.disconnect();
        this.#mutationObservers.delete(root);
      }
    }
    for (const [root] of this.#mutationIndex) {
      const union = {
        attributes: false,
        childList: false,
        characterData: false,
        subtree: false,
      };
      /** @type {Set<string> | null} */
      let attributeFilter = new Set();
      for (const sub of this.#mutationSubs.values()) {
        if (sub.root !== root) {
          continue;
        }
        union.attributes ||= sub.attributes;
        union.childList ||= sub.childList;
        union.characterData ||= sub.characterData;
        union.subtree ||= sub.subtree;
        if (sub.attributes) {
          if (!sub.attributeFilter) {
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
        options.attributes = true;
      }
      if (options.attributes && attributeFilter?.size) {
        options.attributeFilter = [...attributeFilter];
      }

      let entry = this.#mutationObservers.get(root);
      if (!entry) {
        entry = {
          observer: new this.#window.MutationObserver(records =>
            this.#onMutations(root, records)
          ),
        };
        this.#mutationObservers.set(root, entry);
      }
      entry.observer.disconnect();
      entry.observer.observe(root, options);
      TranceLog.log(NS, "mutation observer rebuilt", { root, ...options });
    }
  }

  #onMutations(root, records) {
    TranceLog.count("observer.mutation.batches");
    const index = this.#mutationIndex.get(root);
    if (!index) {
      return;
    }
    for (const record of records) {
      const candidates = new Set();
      if (record.type === "attributes") {
        for (const handle of index.unfilteredAttributes) {
          candidates.add(handle);
        }
        for (const handle of index.attributesByName.get(record.attributeName) ??
          []) {
          candidates.add(handle);
        }
      } else {
        for (const handle of index.byType.get(record.type) ?? []) {
          candidates.add(handle);
        }
      }
      for (const handle of candidates) {
        const sub = this.#mutationSubs.get(handle);
        if (!sub || !this.#recordMatches(record, sub)) {
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
    if (sub.subtree && target.closest(sub.selector)) {
      return true;
    }
    if (record.type !== "childList" || !sub.subtree) {
      return false;
    }
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (node.nodeType !== node.ELEMENT_NODE) {
        continue;
      }
      if (node.matches(sub.selector) || node.querySelector(sub.selector)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Records are delivered once per frame. Reads happen for every structured
   * subscriber before any of those subscribers writes (TRANCE.md §6.4).
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
    const writes = [];
    for (const [handle, records] of pending) {
      const sub = this.#mutationSubs.get(handle);
      if (!sub) {
        continue;
      }
      TranceLog.count("observer.mutation.callbacks");
      if (sub.read) {
        try {
          const value = sub.read(records);
          if (sub.write) {
            writes.push({ sub, value });
          }
        } catch (error) {
          TranceLog.error(NS, `subscriber for "${sub.selector}" threw`, error);
        }
      } else if (sub.cb) {
        this.#safe(sub.cb, records, `subscriber for "${sub.selector}"`);
      }
    }
    for (const { sub, value } of writes) {
      this.#safe(sub.write, value, `subscriber for "${sub.selector}"`);
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

  #onIntersection(observer, entries) {
    TranceLog.count("observer.intersection.callbacks");
    for (const entry of entries) {
      for (const sub of this.#intersectionSubs.values()) {
        if (sub.observer === observer && sub.element === entry.target) {
          this.#safe(sub.cb, entry);
        }
      }
    }
  }

  #safe(cb, arg, context = "subscriber") {
    try {
      cb(arg);
    } catch (error) {
      TranceLog.error(NS, `${context} threw`, error);
    }
  }
}
