// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Lightweight lifecycle checks against the real modules, without Gecko/builds.
// node --experimental-vm-modules --test src/zen/trance/tests/startup.test.mjs

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function fixture() {
  const prefs = new Map();
  const observers = new Map();
  const errors = [];
  const owned = new Set();
  const events = new Map();
  const prefService = {
    getBoolPref: (pref, fallback) => prefs.get(pref) ?? fallback,
    addObserver(pref, observer) {
      if (!observers.has(pref)) {
        observers.set(pref, new Set());
      }
      observers.get(pref).add(observer);
    },
    removeObserver: (pref, observer) => observers.get(pref)?.delete(observer),
    setBoolPref(pref, value) {
      const old = prefs.get(pref);
      prefs.set(pref, value);
      if (old !== value) {
        for (const observer of [...(observers.get(pref) ?? [])]) {
          observer.observe(null, "nsPref:changed", pref);
        }
      }
    },
  };
  class Owner {
    held = new Set();
    claim(value) {
      owned.add(value);
      this.held.add(value);
    }
    hold(value) {
      this.claim(value);
    }
    releaseAll() {
      for (const value of this.held) {
        owned.delete(value);
      }
      this.held.clear();
    }
  }
  const sandbox = vm.createContext({
    Services: { prefs: prefService },
    Cu: { isInAutomation: false },
    Ci: { nsIWebProgressListener: {} },
    ChromeUtils: {
      importESModule: () => ({
        TranceGlobalPrefOwner: Owner,
        TranceGlobalSheetOwner: Owner,
      }),
    },
  });
  const log = new vm.SyntheticModule(
    ["TranceLog"],
    function () {
      this.setExport("TranceLog", {
        log() {},
        error: (...args) => errors.push(args),
      });
    },
    { context: sandbox }
  );
  async function load(moduleName) {
    const source = await readFile(
      new URL(`../core/${moduleName}.mjs`, import.meta.url),
      "utf8"
    );
    const module = new vm.SourceTextModule(source, { context: sandbox });
    await module.link(() => log);
    await module.evaluate();
    return module.namespace[moduleName];
  }
  const [Feature, Registry, Styles, Router, TabCache] = await Promise.all([
    load("TranceFeature"),
    load("TranceFeatureRegistry"),
    load("TranceStyles"),
    load("TranceNavigation"),
    load("TranceTabCache"),
  ]);
  let serial = 0;
  const take = () => {
    const handle = ++serial;
    owned.add(handle);
    return handle;
  };
  const release = handle => owned.delete(handle);
  const fakeWindow = {
    windowUtils: {
      AUTHOR_SHEET: 1,
      loadSheetUsingURIString(url) {
        if (url === "missing") {
          throw Error("missing sheet");
        }
        owned.add(url);
      },
      removeSheetUsingURIString: release,
    },
    addEventListener(type, listener) {
      if (!events.has(type)) {
        events.set(type, new Set());
      }
      events.get(type).add(listener);
    },
    removeEventListener: (type, listener) => events.get(type)?.delete(listener),
  };
  const context = {
    window: fakeWindow,
    document: { getElementById: () => ({ state: "closed" }) },
    styles: new Styles(fakeWindow),
    observers: {
      observeMutations: take,
      observeResize: take,
      observeIntersection: take,
      unobserve: release,
    },
    scheduler: {
      onFrame: take,
      onIdle: take,
      onWallClock: take,
      cancel: release,
    },
    navigation: { subscribe: take, unsubscribe: release },
    tokens: { bind: take, release },
  };
  return {
    Feature,
    Registry,
    Navigation: Router,
    TabCache,
    context,
    prefs: prefService,
    observers,
    errors,
    owned,
    events,
  };
}

test("failed setup rolls back every resource and remains retryable", async () => {
  const f = await fixture();
  const order = [];
  let fail = true;
  class Broken extends f.Feature {
    static prefName = "test.enabled";
    static styles = ["feature.css"];
    onEnable() {
      assert.equal(this.enabled, false, "enabled is committed after setup");
      this.observeMutations("node", () => {});
      this.observeResize({}, () => {});
      this.observeIntersection({}, () => {});
      this.onFrame(() => {});
      this.onIdle(() => {});
      this.onWallClock(() => {}, "minute");
      this.observeNavigation({});
      this.bindTokens([{}, {}]);
      this.claimGlobalPref("borrowed", false);
      this.globalSheets.hold("global.css");
      this.addListener(f.context.window, "click", () => {});
      this.addDisposer(() => order.push("first"));
      this.addDisposer(() => {
        order.push("second");
        throw Error("cleanup");
      });
      if (fail) {
        throw Error("setup");
      }
    }
    onDisable() {
      throw Error("subclass cleanup");
    }
  }
  f.prefs.setBoolPref("test.enabled", true);
  const feature = new Broken(f.context);
  feature.init();
  assert.equal(feature.enabled, false);
  assert.equal(f.owned.size, 0);
  assert.equal(f.events.get("click").size, 0);
  assert.deepEqual(order, ["second", "first"]);
  fail = false;
  f.prefs.setBoolPref("test.enabled", false);
  f.prefs.setBoolPref("test.enabled", true);
  assert.equal(feature.enabled, true);
  feature.destroy();
  feature.destroy();
  assert.equal(f.owned.size, 0);
  assert.equal(f.observers.get("test.enabled").size, 0);
});

test("partial sheet/token failures release only acquired resources", async () => {
  const f = await fixture();
  class MissingSheet extends f.Feature {
    static prefName = "test.enabled";
    static styles = ["shared.css", "missing", "someone-elses.css"];
    onEnable() {
      assert.fail("must not set up without sheets");
    }
  }
  f.context.styles.load("shared.css");
  f.context.styles.load("someone-elses.css");
  f.prefs.setBoolPref("test.enabled", true);
  const feature = new MissingSheet(f.context);
  feature.init();
  assert.equal(feature.enabled, false);
  assert.deepEqual([...f.owned].sort(), ["shared.css", "someone-elses.css"]);
  feature.destroy();
  f.context.styles.destroy();
  let calls = 0;
  const bind = f.context.tokens.bind;
  f.context.tokens.bind = () => {
    if (++calls === 2) {
      throw Error("token");
    }
    return bind();
  };
  class MissingToken extends f.Feature {
    static prefName = "test.enabled";
    onEnable() {
      this.bindTokens([{}, {}]);
    }
  }
  const second = new MissingToken(f.context);
  second.init();
  assert.equal(second.enabled, false);
  assert.equal(f.owned.size, 0);
  second.destroy();
});

test("reentrant disable and destroy during setup cannot commit resources", async () => {
  for (const destroy of [false, true]) {
    const f = await fixture();
    class Reentrant extends f.Feature {
      static prefName = "test.enabled";
      onEnable() {
        this.onFrame(() => {});
        if (destroy) {
          this.destroy();
        } else {
          f.prefs.setBoolPref("test.enabled", false);
        }
        this.onIdle(() => {});
      }
    }
    f.prefs.setBoolPref("test.enabled", true);
    const feature = new Reentrant(f.context);
    feature.init();
    assert.equal(feature.enabled, false);
    assert.equal(f.owned.size, 0);
    feature.destroy();
  }
});

test("throwing constructors leave no preference observers", async () => {
  const f = await fixture();
  class Broken extends f.Feature {
    static prefName = "test.enabled";
    constructor(context) {
      super(context);
      throw Error("constructor");
    }
  }
  assert.throws(() => new Broken(f.context));
  assert.equal(f.observers.size, 0);
});

test("shared preference enables dependencies first and disables them last", async () => {
  const f = await fixture();
  const order = [];
  const registry = new f.Registry(
    f.context,
    ["State", "UI"].map(featureName => ({
      name: featureName,
      prefName: "shared.enabled",
      url: featureName,
      exportName: "Feature",
    })),
    featureName => ({
      Feature: class extends f.Feature {
        static prefName = "shared.enabled";
        onEnable() {
          order.push(`enable ${featureName}`);
        }
        onDisable() {
          order.push(`disable ${featureName}`);
        }
      },
    })
  );
  registry.init();
  assert.equal(f.observers.get("shared.enabled").size, 1);
  f.prefs.setBoolPref("shared.enabled", true);
  f.prefs.setBoolPref("shared.enabled", false);
  f.prefs.setBoolPref("shared.enabled", true);
  assert.deepEqual(order, [
    "enable State",
    "enable UI",
    "disable UI",
    "disable State",
    "enable State",
    "enable UI",
  ]);
  registry.destroy();
});

test("registrations skip disabled/completed implementations and load on demand", async () => {
  const f = await fixture();
  const imported = [];
  const descriptor = (featureName, extra = {}) => ({
    name: featureName,
    prefName: `${featureName}.enabled`,
    url: featureName,
    exportName: "Feature",
    ...extra,
  });
  const descriptors = [
    descriptor("Feedback"),
    descriptor("Onboarding", { completedPref: "done", restart: "start" }),
    descriptor("Theme", { popup: "picker" }),
  ];
  f.prefs.setBoolPref("Onboarding.enabled", true);
  f.prefs.setBoolPref("done", true);
  f.prefs.setBoolPref("Theme.enabled", true);
  let starts = 0;
  const registry = new f.Registry(f.context, descriptors, moduleName => {
    imported.push(moduleName);
    return {
      Feature: class extends f.Feature {
        static prefName = `${moduleName}.enabled`;
        onEnable() {
          this.onFrame(() => {});
        }
        start() {
          starts++;
          f.prefs.setBoolPref("done", true);
        }
      },
    };
  });
  registry.init();
  assert.deepEqual(imported, []);
  assert.equal(registry.features.length, 0);
  assert.equal(f.owned.size, 0);
  f.prefs.setBoolPref("Feedback.enabled", true);
  assert.deepEqual(imported, ["Feedback"]);
  assert.equal(f.observers.get("Feedback.enabled").size, 1);
  for (const show of f.events.get("popupshowing")) {
    show({ target: { id: "irrelevant" } });
  }
  assert.deepEqual(imported, ["Feedback"]);
  for (const show of f.events.get("popupshowing")) {
    show({ target: { id: "picker" } });
  }
  assert.deepEqual(imported, ["Feedback", "Theme"]);
  f.prefs.setBoolPref("done", false);
  assert.deepEqual(imported, ["Feedback", "Theme", "Onboarding"]);
  f.prefs.setBoolPref("done", true);
  assert.equal(
    registry.features[1].enabled,
    true,
    "claiming completion leaves flow alive"
  );
  f.prefs.setBoolPref("done", false);
  assert.equal(starts, 1);
  f.prefs.setBoolPref("Theme.enabled", false);
  assert.equal(
    registry.ensure("Theme"),
    null,
    "explicit demand cannot override disabled pref"
  );
  registry.destroy();
  assert.equal(f.owned.size, 0);
  assert.equal(
    [...f.observers.values()].reduce((sum, set) => sum + set.size, 0),
    0
  );
  assert.equal(f.events.get("popupshowing").size, 0);
});

test("navigation and tab cache own no listeners before demand or after last release", async () => {
  const f = await fixture();
  const progress = new Set();
  const browser = { currentURI: "about:blank" };
  f.context.window.gBrowser = {
    tabContainer: f.context.window,
    selectedBrowser: browser,
    browsers: [browser],
    addTabsProgressListener: listener => progress.add(listener),
    removeTabsProgressListener: listener => progress.delete(listener),
  };
  const router = new f.Navigation(f.context.window, f.context.scheduler);
  assert.equal(progress.size, 0);
  const first = router.subscribe({});
  const second = router.subscribe({});
  assert.equal(progress.size, 1);
  router.unsubscribe(first);
  assert.equal(progress.size, 1);
  router.unsubscribe(second);
  assert.equal(progress.size, 0);
  assert.equal(f.events.get("TabClose").size, 0);
  assert.equal(f.events.get("TabSelect").size, 0);
  assert.equal(router.trackedCount, 0);
  router.subscribe({});
  assert.equal(progress.size, 1);
  router.destroy();
  assert.equal(progress.size, 0);
  const root = { getElementsByTagName: () => [{}] };
  f.context.window.document = { getElementById: () => root };
  const cache = new f.TabCache(f.context.window, f.context.observers);
  assert.equal(f.owned.size, 0);
  const handle = cache.subscribe(() => {});
  assert.equal(f.owned.size, 1);
  assert.equal(cache.folderCount, 1);
  cache.unsubscribe(handle);
  assert.equal(f.owned.size, 0);
  assert.equal(cache.folderCount, 0);
  cache.destroy();
});

test("destroying unused owners cancels pending window readiness listeners", async () => {
  const f = await fixture();
  f.context.window.document = { getElementById: () => null };
  const router = new f.Navigation(f.context.window, f.context.scheduler);
  const cache = new f.TabCache(f.context.window, f.context.observers);
  router.subscribe({});
  cache.subscribe(() => {});
  assert.equal(f.events.get("load").size, 2);
  router.destroy();
  cache.destroy();
  assert.equal(f.events.get("load").size, 0);
});
