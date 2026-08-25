// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the single source of animation and periodic work.
//
// Every mod in the stack Trance replaces held its own `setInterval` or its own
// `requestAnimationFrame` loop (TRANCE.md §3.6). Timer wakeups are what keep an
// Apple Silicon CPU out of its deep idle states, and a chrome-process rAF loop
// is never throttled by Gecko the way a content one is — one forgotten loop
// pins the browser at display refresh rate forever.
//
// So: one rAF loop per window, started only while something is subscribed,
// suspended the moment the window is blurred, minimised or fully occluded; and
// wall-clock work armed to the next boundary rather than polled.
//
// Refs: TRANCE.md §3.4, §3.6, §6.3, §12.1, §12.3

import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Scheduler";

/** Milliseconds in each wall-clock unit `onWallClock` understands. */
const WALL_CLOCK_UNITS = Object.freeze({
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
});

/** Lower runs first. Matches the order features want to read then write. */
export const TrancePriority = Object.freeze({
  HIGH: 0,
  NORMAL: 10,
  LOW: 20,
});

export class TranceScheduler {
  #window;
  #nextHandle = 1;

  /** @type {Map<number, {cb: Function, priority: number, once: boolean}>} */
  #frameSubs = new Map();
  /** @type {Map<number, {cb: Function, idleHandle: number}>} */
  #idleSubs = new Map();
  /** @type {Map<string, {timer: number, subs: Map<number, Function>}>} */
  #wallClocks = new Map();

  #rafId = 0;
  #suspended = false;
  #destroyed = false;
  #boundTick;
  #boundVisibility;

  /**
   * `STATE_MINIMIZED` only exists on a chrome window. Comparing `windowState`
   * against it anywhere else compares undefined with undefined and reports
   * every content document as permanently minimised, which silently kills the
   * frame loop for anything Trance runs outside browser.xhtml.
   */
  #isChromeWindow = false;

  /**
   * @param {Window} win - The browser window this scheduler belongs to.
   */
  constructor(win) {
    this.#window = win;
    this.#boundTick = this.#tick.bind(this);
    this.#boundVisibility = this.#onVisibilityChanged.bind(this);

    this.#isChromeWindow = win.STATE_MINIMIZED !== undefined;

    win.addEventListener("focus", this.#boundVisibility);
    win.addEventListener("blur", this.#boundVisibility);
    win.addEventListener("occlusionstatechange", this.#boundVisibility);
    win.addEventListener("sizemodechange", this.#boundVisibility);
    if (!this.#isChromeWindow) {
      win.document.addEventListener("visibilitychange", this.#boundVisibility);
    }

    this.#suspended = !this.#isVisible();
  }

  // --- Subscription API ------------------------------------------------------

  /**
   * Runs `cb` once per animation frame while the window is visible.
   *
   * @param {(timestamp: number) => void} cb
   * @param {object} [options]
   * @param {number} [options.priority] - One of `TrancePriority`.
   * @param {boolean} [options.once] - Unsubscribe after the next frame.
   * @returns {number} A handle for `cancel()`.
   */
  onFrame(cb, { priority = TrancePriority.NORMAL, once = false } = {}) {
    const handle = this.#nextHandle++;
    this.#frameSubs.set(handle, { cb, priority, once });
    this.#syncFrameLoop();
    return handle;
  }

  /**
   * Runs `cb` when the main thread is next idle.
   *
   * @param {(deadline: IdleDeadline) => void} cb
   * @param {object} [options]
   * @param {number} [options.timeout] - Force the callback after this long.
   * @returns {number}
   */
  onIdle(cb, { timeout = 1000 } = {}) {
    const handle = this.#nextHandle++;
    const idleHandle = this.#window.requestIdleCallback(
      deadline => {
        this.#idleSubs.delete(handle);
        this.#run(cb, deadline);
      },
      { timeout }
    );
    this.#idleSubs.set(handle, { cb, idleHandle });
    return handle;
  }

  /**
   * Runs `cb` on every wall-clock boundary of `unit`.
   *
   * This is the anti-polling primitive: a clock that shows minutes costs one
   * wakeup per minute, arriving on the boundary, rather than a 1 Hz interval
   * that is wrong 59 times out of 60 (TRANCE.md §3.6).
   *
   * @param {() => void} cb
   * @param {"second"|"minute"|"hour"} unit
   * @returns {number}
   */
  onWallClock(cb, unit) {
    if (!(unit in WALL_CLOCK_UNITS)) {
      throw new Error(`TranceScheduler: unknown wall-clock unit "${unit}"`);
    }
    const handle = this.#nextHandle++;
    let entry = this.#wallClocks.get(unit);
    if (!entry) {
      entry = { timer: 0, subs: new Map() };
      this.#wallClocks.set(unit, entry);
    }
    entry.subs.set(handle, cb);
    this.#armWallClock(unit);
    return handle;
  }

  /**
   * @param {number} handle - A handle from `onFrame`/`onIdle`/`onWallClock`.
   */
  cancel(handle) {
    if (this.#frameSubs.delete(handle)) {
      this.#syncFrameLoop();
      return;
    }
    const idle = this.#idleSubs.get(handle);
    if (idle) {
      this.#window.cancelIdleCallback(idle.idleHandle);
      this.#idleSubs.delete(handle);
      return;
    }
    for (const [unit, entry] of this.#wallClocks) {
      if (entry.subs.delete(handle) && !entry.subs.size) {
        this.#window.clearTimeout(entry.timer);
        this.#wallClocks.delete(unit);
      }
    }
  }

  // --- State -----------------------------------------------------------------

  /** True while the window is blurred, minimised or fully occluded. */
  get suspended() {
    return this.#suspended;
  }

  /** Number of live frame subscribers — used by the §12.1 budget checks. */
  get frameSubscriberCount() {
    return this.#frameSubs.size;
  }

  /** Number of armed timers owned by Trance. Must be 0 at idle. */
  get timerCount() {
    return this.#wallClocks.size;
  }

  destroy() {
    this.#destroyed = true;
    const win = this.#window;
    win.removeEventListener("focus", this.#boundVisibility);
    win.removeEventListener("blur", this.#boundVisibility);
    win.removeEventListener("occlusionstatechange", this.#boundVisibility);
    win.removeEventListener("sizemodechange", this.#boundVisibility);
    if (!this.#isChromeWindow) {
      win.document.removeEventListener(
        "visibilitychange",
        this.#boundVisibility
      );
    }

    if (this.#rafId) {
      win.cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
    for (const { idleHandle } of this.#idleSubs.values()) {
      win.cancelIdleCallback(idleHandle);
    }
    for (const entry of this.#wallClocks.values()) {
      win.clearTimeout(entry.timer);
    }
    this.#frameSubs.clear();
    this.#idleSubs.clear();
    this.#wallClocks.clear();
  }

  // --- Internals -------------------------------------------------------------

  #isVisible() {
    const win = this.#window;
    if (win.isFullyOccluded) {
      return false;
    }
    if (!this.#isChromeWindow) {
      // about:preferences is a tab, not a chrome window: it has no windowState
      // and its document reports no focus while the caret sits in the chrome.
      // Frame work there is driven by whether the tab is on screen at all.
      return win.document.visibilityState !== "hidden";
    }
    if (win.windowState === win.STATE_MINIMIZED) {
      return false;
    }
    // An unfocused window is still visible, but nothing Trance animates is
    // worth a frame in it. Features that genuinely need to keep painting while
    // unfocused should not be using the frame loop in the first place.
    return win.document.hasFocus();
  }

  #onVisibilityChanged() {
    const suspended = !this.#isVisible();
    if (suspended === this.#suspended) {
      return;
    }
    this.#suspended = suspended;
    TranceLog.log(NS, suspended ? "suspended" : "resumed");

    this.#syncFrameLoop();
    for (const unit of this.#wallClocks.keys()) {
      if (suspended) {
        this.#window.clearTimeout(this.#wallClocks.get(unit).timer);
        this.#wallClocks.get(unit).timer = 0;
      } else {
        // Re-sync immediately: the displayed value is stale by definition after
        // any suspension of unknown length.
        this.#fireWallClock(unit);
      }
    }
  }

  #syncFrameLoop() {
    const shouldRun =
      !this.#destroyed && !this.#suspended && this.#frameSubs.size;
    if (shouldRun && !this.#rafId) {
      this.#rafId = this.#window.requestAnimationFrame(this.#boundTick);
    } else if (!shouldRun && this.#rafId) {
      this.#window.cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
  }

  #tick(timestamp) {
    this.#rafId = 0;
    TranceLog.count("scheduler.frames");

    const subs = [...this.#frameSubs.entries()].sort(
      (a, b) => a[1].priority - b[1].priority
    );
    for (const [handle, sub] of subs) {
      if (sub.once) {
        this.#frameSubs.delete(handle);
      }
      this.#run(sub.cb, timestamp);
    }
    this.#syncFrameLoop();
  }

  #armWallClock(unit) {
    const entry = this.#wallClocks.get(unit);
    if (!entry || this.#suspended || this.#destroyed) {
      return;
    }
    this.#window.clearTimeout(entry.timer);
    const period = WALL_CLOCK_UNITS[unit];
    const delay = period - (Date.now() % period);
    entry.timer = this.#window.setTimeout(() => {
      entry.timer = 0;
      this.#fireWallClock(unit);
    }, delay);
  }

  #fireWallClock(unit) {
    const entry = this.#wallClocks.get(unit);
    if (!entry) {
      return;
    }
    TranceLog.count(`scheduler.wallclock.${unit}`);
    for (const cb of [...entry.subs.values()]) {
      this.#run(cb);
    }
    this.#armWallClock(unit);
  }

  /**
   * A throwing subscriber must not take the rest of the tick down with it.
   *
   * @param {Function} cb
   * @param {any} [arg]
   */
  #run(cb, arg) {
    try {
      cb(arg);
    } catch (error) {
      TranceLog.error(NS, "subscriber threw", error);
    }
  }
}
