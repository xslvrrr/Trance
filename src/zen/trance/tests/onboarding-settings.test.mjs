// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Persistent onboarding settings and UI entry checks without Gecko or builds.
// Run: bun test ./src/zen/trance/tests/onboarding-settings.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { setImmediate as settle } from "node:timers/promises";

const source = readFileSync(
  new URL(
    "../features/onboarding/TranceOnboardingSettings.mjs",
    import.meta.url
  ),
  "utf8"
);
const ui = readFileSync(
  new URL("../features/onboarding/TranceOnboarding.mjs", import.meta.url),
  "utf8"
);
const url =
  "chrome://browser/content/trance-components/TranceOnboardingSettings.mjs";
const channelPref = "trance.onboarding.channel";
const archPref = "trance.perf.arch";
const modsPref = "trance.mods.channel";
const radiusPref = "trance.surface.blur.radius";
const syncPref = "services.sync.engine.spaces";

// Every `const PREF_… = "…"` the UI module declares, read out of the module
// rather than restated here. The sandbox below evaluates a slice of the real
// `start()`, so any pref constant that slice reaches has to exist in it — and
// listing them by hand meant that adding one to production turned this test
// red with a `ReferenceError` that named the constant and not the cause.
const uiPrefConstants = Object.fromEntries(
  [...ui.matchAll(/^const (PREF_[A-Z0-9_]+) = "([^"]+)";$/gm)].map(m => [
    m[1],
    m[2],
  ])
);

function world(platform = "macosx") {
  const values = new Map([["trance.onboarding.completed", true]]);
  const defaults = new Map([[syncPref, false]]);
  const locked = new Set([syncPref]);
  const observers = new Map();
  const counts = new Map();
  const errors = [];
  const imports = [];
  const io = {
    engine: { version: "1.2c", other: 42 },
    reads: 0,
    writes: 0,
    active: 0,
    maxActive: 0,
  };
  const prefs = {
    failPref: null,
    getStringPref: (p, d) => values.get(p) ?? defaults.get(p) ?? d,
    getBoolPref: (p, d) => values.get(p) ?? defaults.get(p) ?? d,
    setStringPref: write,
    setBoolPref: write,
    setIntPref: write,
    clearUserPref(p) {
      values.delete(p);
    },
    prefIsLocked: p => locked.has(p),
    unlockPref: p => locked.delete(p),
    lockPref: p => locked.add(p),
    addObserver(p, o) {
      if (this.failPref === p) {
        throw new Error("injected observer failure");
      }
      if (!observers.has(p)) {
        observers.set(p, new Set());
      }
      observers.get(p).add(o);
    },
    removeObserver(p, o) {
      observers.get(p)?.delete(o);
      if (!observers.get(p)?.size) {
        observers.delete(p);
      }
    },
  };
  function write(p, v) {
    if (locked.has(p)) {
      throw new Error("locked " + p);
    }
    counts.set(p, (counts.get(p) ?? 0) + 1);
    values.set(p, v);
    // Deliberately notify even for identical writes to expose feedback loops.
    for (const o of [...(observers.get(p) ?? [])]) {
      o.observe();
    }
  }
  class Feature {
    static styles = [];
    disposers = [];
    enabled = false;
    addDisposer(cb) {
      this.disposers.push(cb);
    }
    init() {
      try {
        this.onEnable();
        this.enabled = true;
      } catch (e) {
        this.destroy();
        throw e;
      }
    }
    destroy() {
      this.enabled = false;
      for (const cb of this.disposers.splice(0)) {
        cb();
      }
    }
  }
  let shared;
  function load() {
    const context = vm.createContext({
      TranceFeature: Feature,
      TranceLog: {
        log() {},
        error(...args) {
          errors.push(args);
        },
      },
      Services: { prefs, dirsvc: { get: () => ({ path: "/fake-profile" }) } },
      Ci: { nsIFile: "nsIFile" },
      PathUtils: { join: (...args) => args.join("/") },
      IOUtils: {
        async readJSON() {
          io.reads++;
          if (!io.engine) {
            throw new Error("missing");
          }
          io.active++;
          io.maxActive = Math.max(io.maxActive, io.active);
          await Promise.resolve();
          const result = structuredClone(io.engine);
          io.active--;
          return result;
        },
        async writeJSON(file, value) {
          assert.equal(file, "/fake-profile/chrome/JS/engine.json");
          io.writes++;
          io.active++;
          io.maxActive = Math.max(io.maxActive, io.active);
          await Promise.resolve();
          if (io.failWrite) {
            io.active--;
            throw new Error("write failed");
          }
          io.engine = structuredClone(value);
          io.active--;
        },
      },
      ChromeUtils: {
        importESModule(actual, options) {
          if (actual === "resource://gre/modules/AppConstants.sys.mjs") {
            return { AppConstants: { platform } };
          }
          imports.push(actual);
          assert.equal(actual, url);
          assert.equal(options, undefined);
          return shared;
        },
      },
    });
    vm.runInContext(
      source.replace(/^import .*;\n/gm, "").replace(/^export /gm, "") +
        "\nglobalThis.exports = {TranceOnboardingSettings, TranceOnboardingSettingsService};",
      context
    );
    return context.exports;
  }
  shared = load();
  return {
    ...shared,
    prefs,
    values,
    locked,
    observers,
    counts,
    errors,
    imports,
    io,
    load,
  };
}

function enable(w) {
  const instance = new (w.load().TranceOnboardingSettings)();
  instance.init();
  return instance;
}

test("completed profiles apply settings without importing UI, with one watcher set across globals", () => {
  const w = world();
  const a = enable(w),
    b = enable(w);
  assert.equal(a.constructor.prefName, "trance.onboarding.enabled");
  assert.equal(a.constructor.featureName, "OnboardingSettings");
  assert.deepEqual(a.constructor.styles, []);
  assert.deepEqual(
    [...w.observers.values()].map(set => set.size),
    [1, 1, 1]
  );
  w.prefs.setStringPref(archPref, "x86_64");
  assert.equal(w.values.get(radiusPref), 10);
  assert.equal(w.counts.get(radiusPref), 1);
  a.destroy();
  w.prefs.setStringPref(archPref, "arm64");
  assert.equal(w.counts.get(radiusPref), 2);
  b.destroy();
  assert.equal(w.observers.size, 0);
  w.prefs.setIntPref(radiusPref, 17);
  w.prefs.setStringPref(archPref, "x86_64");
  assert.equal(w.values.get(radiusPref), 17);
  assert.deepEqual(w.imports, [url, url]);
  assert.deepEqual(w.errors, []);
});

test("channel switching preserves default clearing, sync lock, macOS exception and acrylic removal", () => {
  for (const platform of ["macosx", "linux"]) {
    const w = world(platform);
    enable(w);
    w.prefs.setStringPref(channelPref, "twilight");
    assert.equal(w.values.get(syncPref), true);
    assert.equal(w.locked.has(syncPref), false);
    assert.equal(
      w.values.has("zen.theme.styled-status-panel"),
      platform !== "macosx"
    );
    assert.equal(w.values.has("zen.theme.acrylic-elements"), false);
    assert.equal(w.counts.get(syncPref), 1);
    w.prefs.setStringPref(channelPref, "stable");
    assert.equal(w.values.has(syncPref), false);
    assert.equal(w.locked.has(syncPref), true);
    assert.equal(w.values.has("zen.view.context-menu.refresh"), false);
    assert.deepEqual(w.errors, []);
  }
});

test("direct UI actions reapply unchanged tuning exactly once", () => {
  const w = world();
  enable(w);
  const s = w.TranceOnboardingSettingsService;
  s.applyArch("arm64");
  w.prefs.setIntPref(radiusPref, 99);
  s.applyArch("arm64");
  assert.equal(w.values.get(radiusPref), 24);
  assert.equal(w.counts.get(radiusPref), 3);
  assert.equal(w.values.get("trance.surface.internal.blur"), true);
  assert.equal(w.values.get("trance.chrome.urlbar.focus-blur"), true);
  assert.equal(w.values.get("trance.surface.suspend-when-unfocused"), true);
});

test("mod changes from settings or UI serialize without recursive or multiwindow writes", async () => {
  const w = world();
  enable(w);
  enable(w);
  w.prefs.setStringPref(modsPref, "sine");
  await settle();
  assert.deepEqual(w.io.engine, { version: "1.2", other: 42 });
  assert.equal(w.io.reads, 1);
  assert.equal(w.io.writes, 1);
  const s = w.TranceOnboardingSettingsService;
  await Promise.all([
    s.applyModChannel("cosine"),
    s.applyModChannel("sine"),
    s.applyModChannel("cosine"),
  ]);
  assert.equal(w.io.engine.version, "1.2c");
  assert.equal(w.io.reads, 4);
  assert.equal(w.io.writes, 4);
  assert.equal(w.io.maxActive, 1);
  assert.deepEqual(w.errors, []);
});

test("missing engine and write failure remain recoverable", async () => {
  const w = world();
  const s = w.TranceOnboardingSettingsService;
  w.io.engine = null;
  await s.applyModChannel("sine");
  assert.equal(w.values.get(modsPref), "sine");
  w.io.engine = { version: "1.2c" };
  w.io.failWrite = true;
  await s.applyModChannel("sine");
  assert.equal(w.errors.length, 1);
  w.io.failWrite = false;
  await s.applyModChannel("sine");
  assert.equal(w.io.engine.version, "1.2");
});

test("partial watcher setup rolls back and can retry before enabled is committed", () => {
  const w = world();
  const feature = new (w.load().TranceOnboardingSettings)();
  w.prefs.failPref = archPref;
  assert.throws(() => feature.init(), { message: "injected observer failure" });
  assert.equal(feature.enabled, false);
  assert.equal(w.observers.size, 0);
  w.prefs.failPref = null;
  feature.init();
  assert.equal(feature.enabled, true);
  assert.equal(w.observers.size, 3);
  feature.destroy();
  feature.destroy();
  assert.equal(w.observers.size, 0);
});

test("UI startup defers, respects automation and claims completion before building", () => {
  // Execute the production entry methods with only the rendering work stubbed.
  // No stored source snapshot or pre-split checkout is needed.
  const method = (from, to) => {
    const start = ui.indexOf(from);
    const end = ui.indexOf(to, start);
    assert.ok(start > -1);
    assert.ok(end > start);
    return ui.slice(start, end);
  };
  const values = new Map();
  const pending = [];
  const cancelled = [];
  const automation = { isInAutomation: false };
  let headless = "";
  const sandbox = vm.createContext({
    Services: {
      prefs: {
        getBoolPref: (pref, fallback) => values.get(pref) ?? fallback,
        getStringPref: (pref, fallback) => values.get(pref) ?? fallback,
        setBoolPref: (pref, value) => values.set(pref, value),
      },
      env: { get: () => headless },
    },
    Cu: automation,
    TranceLog: {
      error: () => {
        throw new Error("unexpected UI error");
      },
    },
    NS: "Onboarding",
    ...uiPrefConstants,
    pending,
    cancelled,
  });
  vm.runInContext(
    `
    class Flow {
      #idleHandle = 0;
      #running = false;
      #answers = {};
      #pendingEssentials = [];
      #pages = [];
      builds = 0;
      claimedWhenBuilt = false;
      context = { scheduler: { cancel: handle => cancelled.push(handle) } };
      onIdle(callback, options) { return pending.push({ callback, options }); }
      #detectArch() { return 'arm64'; }
      #build() {
        this.builds++;
        this.claimedWhenBuilt = Services.prefs.getBoolPref(PREF_COMPLETED, false);
      }
      #buildPages() { return []; }
      #showSplash() {}
      #dismantle() { throw new Error('unexpected teardown'); }
      ${method("  onEnable() {", "  onDisable() {")}
      ${method("  start() {", "  get running()")}
      get running() { return this.#running; }
    }
    globalThis.Flow = Flow;
  `,
    sandbox
  );
  const completedPref = "trance.onboarding.completed";
  const first = new sandbox.Flow();
  first.onEnable();
  assert.equal(first.builds, 0);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].options.timeout, 3000);
  pending[0].callback();
  assert.equal(first.builds, 1);
  assert.equal(first.claimedWhenBuilt, true);
  assert.equal(first.running, true);
  assert.deepEqual(cancelled, [1]);
  first.start();
  assert.equal(first.builds, 1);

  const completed = new sandbox.Flow();
  completed.onEnable();
  completed.start();
  assert.equal(completed.builds, 0);
  assert.equal(pending.length, 1);

  values.set(completedPref, false);
  first.start();
  assert.equal(first.builds, 1); // Restarting a running flow remains a no-op.
  automation.isInAutomation = true;
  const automated = new sandbox.Flow();
  automated.onEnable();
  assert.equal(pending.length, 1);
  assert.equal(values.get(completedPref), false);
  automated.start(); // Tests and explicit callers may still start it.
  assert.equal(automated.builds, 1);
  assert.equal(automated.claimedWhenBuilt, true);

  automation.isInAutomation = false;
  values.set(completedPref, false);
  headless = "1";
  new sandbox.Flow().onEnable();
  assert.equal(values.get(completedPref), true);
  assert.equal(pending.length, 1);

  headless = "";
  values.set(completedPref, false);
  const otherWindow = new sandbox.Flow();
  otherWindow.onEnable();
  values.set(completedPref, true); // Another window claims before idle fires.
  pending[1].callback();
  assert.equal(otherWindow.builds, 0);
  assert.ok(!ui.includes("#watchPref"));
  assert.ok(!ui.includes("#applyChannel"));
  assert.ok(!ui.includes("#applyArch"));
  assert.ok(!ui.includes("#applyModChannel"));
  assert.ok(ui.includes("TranceOnboardingSettingsService.applyChannel("));
  assert.ok(
    ui.includes("TranceOnboardingSettingsService.applyArch(this.#answers.arch)")
  );
  assert.ok(ui.includes("TranceOnboardingSettingsService.applyModChannel("));
  assert.ok(!source.includes("TranceOnboarding.mjs"));
  assert.ok(!source.includes("trance-onboarding.css"));
});
