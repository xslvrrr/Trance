// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: one structural cache for the tab strip.
//
// ── Why the tab strip needs a cache and not another query ─────────────────────
//
// The mods Trance replaces each answered "which folders exist" with their own
// `querySelectorAll` over the whole chrome document, re-run on every mutation of
// the tab strip — and a tab opening, a favicon arriving and a tab going busy are
// all mutations of the tab strip. N observers times one document-wide query each
// is what made the sidebar the most expensive element in the browser
// (TRANCE.md §3.2).
//
// Trance collapsed the observers into one hub. This collapses the *queries*: the
// answer is held, and each mutation batch edits it rather than recomputing it.
// Adding a folder costs one `Set.add`; opening a tab costs a scan of that tab's
// own added nodes and nothing else. The document is walked exactly once, when the
// cache is built.
//
// It is deliberately narrow. This is not a model of the tab strip — Firefox and
// Zen already own that, and a second model of tabs would be the two-owners
// problem this project exists to remove. It holds the one structural fact no
// platform API exposes cheaply: the set of live `zen-folder` elements, in
// document order, across every space in this window.
//
// Refs: TRANCE.md §3.2, §6.4; AUDIT.md Phase 3; ADR-062

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "TabCache";

/**
 * The scroll box every `zen-workspace` is appended to
 * (`ZenSpaceManager.mjs`: `document.getElementById("tabbrowser-arrowscrollbox")`).
 * It is the narrowest stable ancestor that contains every folder in every space,
 * which is what makes it the right observer root: mutations anywhere else in the
 * chrome never reach this subscription at all.
 */
const STRIP_ROOT_ID = "tabbrowser-arrowscrollbox";

const FOLDER_TAG = "zen-folder";

export class TranceTabCache {
  #window;
  #observers;
  #handle = 0;
  #nextSub = 1;
  #destroyed = false;
  #readyListener = null;

  /**
   * Live folders, in insertion order rather than document order.
   *
   * Document order is not maintained, and no caller has ever needed it: the one
   * consumer stamps an attribute on each folder, which is order-independent. A
   * cache that promised document order would have to re-sort on every move, and
   * moving a folder is the one tab-strip gesture that produces no useful record
   * for it.
   *
   * @type {Set<Element>}
   */
  #folders = new Set();

  /** @type {Map<number, () => void>} */
  #subs = new Map();

  /**
   * @param {Window} win
   * @param {import("./TranceObserverHub.mjs").TranceObserverHub} observers
   */
  constructor(win, observers) {
    this.#window = win;
    this.#observers = observers;
  }

  /** The observer root, or null before the tab strip is built. */
  get root() {
    return this.#window.document.getElementById(STRIP_ROOT_ID);
  }

  /**
   * Every live folder in this window.
   *
   * An array rather than the Set itself, so a caller cannot edit the cache by
   * iterating it. Building it is one allocation per read, against a
   * `querySelectorAll` over the whole document per read.
   *
   * @returns {Element[]}
   */
  get folders() {
    return [...this.#folders];
  }

  get folderCount() {
    return this.#folders.size;
  }

  /**
   * Called after the cache has been updated, once per mutation batch.
   *
   * The hub already coalesces its records to one callback per frame, so this
   * inherits that: N structural changes in one task are one notification.
   *
   * @param {() => void} cb
   * @returns {number} A handle for `unsubscribe`.
   */
  subscribe(cb) {
    if (this.#destroyed) {
      throw new Error("Cannot subscribe to a destroyed tab cache");
    }
    const handle = this.#nextSub++;
    this.#subs.set(handle, cb);
    if (this.#subs.size === 1) {
      try {
        this.#whenReady(() => this.#attach());
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

  /**
   * Rebuilds from the document.
   *
   * The one place a full query still happens. It is called when the cache is
   * built, and when the hub reports that it lost records — which it does after a
   * window has been hidden, because the observer is disconnected while nothing
   * can be seen and reconnecting cannot replay what it missed.
   */
  invalidate() {
    const root = this.root;
    this.#folders.clear();
    if (!root) {
      return;
    }
    for (const folder of root.getElementsByTagName(FOLDER_TAG)) {
      this.#folders.add(folder);
    }
    TranceLog.log(NS, "rebuilt", this.#folders.size);
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
    if (this.#handle) {
      this.#observers.unobserve(this.#handle);
      this.#handle = 0;
    }
    this.#folders.clear();
  }

  // --- Internals -------------------------------------------------------------

  /**
   * The strip does not exist at `MozBeforeInitialXULLayout`, which is where
   * Trance enters (TRANCE.md §3.7).
   *
   * @param {() => void} callback
   */
  #whenReady(callback) {
    if (this.root) {
      callback();
      return;
    }
    this.#readyListener = () => {
      this.#readyListener = null;
      callback();
    };
    this.#window.addEventListener("load", this.#readyListener, { once: true });
  }

  #attach() {
    if (this.#destroyed || !this.#subs.size || this.#handle) {
      return;
    }
    const root = this.root;
    if (!root) {
      TranceLog.warn(NS, `#${STRIP_ROOT_ID} is missing; cache is inert`);
      return;
    }
    this.invalidate();
    this.#handle = this.#observers.observeMutations(
      "*",
      records => this.#onMutated(records),
      { root, childList: true, subtree: true }
    );
  }

  /**
   * @param {MutationRecord[]} records - One batch from the hub.
   */
  #onMutated(records) {
    if (this.#destroyed) {
      return;
    }
    if (!records.length) {
      // The hub's invalidation signal: it was disconnected while the window was
      // hidden and cannot say what changed, only that something did.
      this.invalidate();
      this.#notify();
      return;
    }

    let changed = false;
    for (const record of records) {
      for (const node of record.removedNodes) {
        changed = this.#forget(node) || changed;
      }
      for (const node of record.addedNodes) {
        changed = this.#remember(node) || changed;
      }
    }
    if (changed) {
      this.#notify();
    }
  }

  /**
   * Adds `node` and every folder inside it.
   *
   * The descendants matter: Zen builds a folder's subtree before inserting it,
   * and a space arriving inserts one node containing every folder it holds. A
   * cache that only looked at the inserted node itself would miss all of them —
   * which is the same mistake the hub's own record matching used to make.
   *
   * @param {Node} node
   * @returns {boolean} Whether anything was added.
   */
  #remember(node) {
    if (node.nodeType !== node.ELEMENT_NODE) {
      return false;
    }
    let changed = false;
    if (node.localName === FOLDER_TAG) {
      changed = !this.#folders.has(node);
      this.#folders.add(node);
    }
    for (const folder of node.getElementsByTagName?.(FOLDER_TAG) ?? []) {
      if (!this.#folders.has(folder)) {
        this.#folders.add(folder);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * @param {Node} node
   * @returns {boolean} Whether anything was removed.
   */
  #forget(node) {
    if (node.nodeType !== node.ELEMENT_NODE) {
      return false;
    }
    let changed = this.#folders.delete(node);
    // The removed node's descendants are still reachable from it, so they can be
    // named exactly rather than found by sweeping the whole cache for
    // disconnected entries.
    for (const folder of node.getElementsByTagName?.(FOLDER_TAG) ?? []) {
      changed = this.#folders.delete(folder) || changed;
    }
    return changed;
  }

  #notify() {
    for (const cb of [...this.#subs.values()]) {
      try {
        cb();
      } catch (error) {
        TranceLog.error(NS, "subscriber threw", error);
      }
    }
  }
}
