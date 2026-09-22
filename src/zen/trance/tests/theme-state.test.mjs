// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Lightweight source/lifecycle check: bun src/zen/trance/tests/theme-state.test.mjs
// DOM and services are mocks; browser_trance_theme.js exercises real popups.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../../../", import.meta.url);
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
const prefs = new Map([
  ["trance.theme.enabled", true],
  ...[
    "controls.lightness",
    "controls.angle",
    "controls.hex",
    "palettes.enabled",
    "saved.enabled",
    "notifications",
  ].map(p => ["trance.theme." + p, false]),
]);
const observers = new Map();
const prefObservers = new Map();
const track = (map, key, observer) => {
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key).add(observer);
};
const fakeServices = {
  prefs: {
    getBoolPref: (p, fallback = false) => prefs.get(p) ?? fallback,
    getStringPref: (p, fallback = "") => prefs.get(p) ?? fallback,
    setBoolPref: (p, v) => prefs.set(p, v),
    addObserver: (p, o) => track(prefObservers, p, o),
    removeObserver: (p, o) => prefObservers.get(p)?.delete(o),
  },
  obs: {
    addObserver: (o, t) => track(observers, t, o),
    removeObserver: (o, t) => observers.get(t)?.delete(o),
    notifyObservers: (_, t) => {
      for (const o of [...(observers.get(t) ?? [])]) {
        o.observe();
      }
    },
  },
};
const errors = [];
const sandbox = vm.createContext({
  Services: fakeServices,
  TranceLog: { log() {}, error: (...args) => errors.push(args), warn() {} },
  ChromeUtils: {
    importESModule: () => ({
      TranceGlobalPrefOwner: class {},
      TranceGlobalSheetOwner: class {},
    }),
  },
});
function load(relative, names) {
  const source = readFileSync(new URL(relative, root), "utf8")
    .replace(/^import [\s\S]*?;\n/gm, "")
    .replace(/^export /gm, "");
  const module = vm.runInContext(
    "(() => { " + source + "\nreturn {" + names.join(",") + "}; })()",
    sandbox,
    { filename: relative }
  );
  Object.assign(sandbox, module);
  return module;
}
load("src/zen/trance/core/TranceFeature.mjs", ["TranceFeature"]);
const { TranceThemeState } = load(
  "src/zen/trance/features/theme/TranceThemeState.mjs",
  ["TranceThemeState", "PALETTES"]
);
const { TranceTheme } = load("src/zen/trance/features/theme/TranceTheme.mjs", [
  "TranceTheme",
]);
const zen = readFileSync(
  new URL("src/zen/spaces/ZenGradientGenerator.mjs", root),
  "utf8"
);
// Exercise the extracted owner with Zen's actual RGB/HSL conversions.
const conversions = vm.runInContext(
  "({" +
    zen
      .slice(
        zen.indexOf("  hslToRgb("),
        zen.indexOf("  calculateInitialPosition(")
      )
      .replace(/\n {2}}\n/g, "\n  },\n") +
    "})",
  sandbox
);

class FakeElement extends EventTarget {
  attributes = new Map();
  children = [];
  state = "closed";
  getAttribute(n) {
    return this.attributes.get(n) ?? null;
  }
  setAttribute(n, v) {
    this.attributes.set(n, String(v));
  }
  removeAttribute(n) {
    this.attributes.delete(n);
  }
  hasAttribute(n) {
    return this.attributes.has(n);
  }
  appendChild(n) {
    n.parent = this;
    this.children.push(n);
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter(n => n !== this);
    }
  }
  querySelector(s) {
    return s === ".zen-theme-picker-gradient" ? this.gradient : null;
  }
}

function environment({ late = false, fault = false } = {}) {
  const panel = new FakeElement();
  panel.gradient = new FakeElement();
  const slider = new FakeElement();
  slider.setAttribute("min", "0.3");
  slider.setAttribute("max", "0.9");
  const byId = new Map([
    ["PanelUI-zen-gradient-generator-opacity", slider],
    ["PanelUI-zen-gradient-generator", panel],
  ]);
  const fakeDocument = {
    getElementById: id => byId.get(id) ?? null,
    createElement: () => new FakeElement(),
  };
  const workspace = {
    uuid: "one",
    theme: {
      gradientColors: [{ c: [200, 100, 50] }],
      opacity: 0.5,
      tranceLightness: 62,
      tranceAngle: 90,
      trancePalette: "monochrome",
    },
  };
  const win = new EventTarget();
  win.document = fakeDocument;
  win.gZenWorkspaces = { getActiveWorkspace: () => workspace };
  class Picker {
    panel = panel;
    calls = 0;
    static getTheme(colors = [], opacity = 0.5, texture = 0) {
      return { gradientColors: colors, opacity, texture };
    }
    getColorFromPosition() {
      return [200, 100, 50];
    }
    getGradient() {
      return "linear-gradient(-45deg, red, blue), radial-gradient(circle at 95% 0%, red, blue)";
    }
    getGradientForWorkspace(w) {
      if (w.fail) {
        throw Error("preview failure");
      }
      return this.getGradient();
    }
    onWorkspaceChange() {
      this.calls++;
      this.render = this.getGradient();
      fakeServices.obs.notifyObservers(null, "zen-space-gradient-update");
    }
    updateCurrentWorkspace() {
      this.calls++;
      workspace.theme = this.constructor.getTheme(
        workspace.theme.gradientColors
      );
    }
  }
  Object.assign(Picker.prototype, conversions);
  const picker = new Picker();
  if (fault) {
    Object.defineProperty(picker, "getGradient", {
      value: picker.getGradient,
      writable: false,
      configurable: true,
    });
  }
  if (late) {
    win.gZenThemePicker = picker;
  }
  const frameCallbacks = new Map();
  const sheets = new Set();
  let nextHandle = 1;
  const context = {
    window: win,
    document: fakeDocument,
    scheduler: {
      onFrame(cb) {
        const h = nextHandle++;
        frameCallbacks.set(h, cb);
        return h;
      },
      cancel(h) {
        frameCallbacks.delete(h);
      },
    },
    styles: { load: s => sheets.add(s), unload: s => sheets.delete(s) },
    tokens: {},
    observers: {},
    navigation: {},
  };
  return {
    win,
    picker,
    panel,
    slider,
    workspace,
    context,
    frameCallbacks,
    sheets,
  };
}

const env = environment();
const state = new TranceThemeState(env.context);
state.init({ observePref: false });
check(state.enabled, "startup state enabled without UI");
check(
  env.slider.getAttribute("min") === "0" &&
    env.slider.getAttribute("max") === "1",
  "bounds widened before picker exists"
);
check(
  !env.panel.children.length && !env.sheets.size && !env.frameCallbacks.size,
  "state allocates no controls, styles or scheduled work"
);
check(
  observers.get("zen-space-gradient-update").size === 1,
  "one temporary arrival observer"
);
env.win.gZenThemePicker = env.picker;
fakeServices.obs.notifyObservers(null, "zen-space-gradient-update");
check(
  observers.get("zen-space-gradient-update").size === 0,
  "arrival observer removed once picker exists"
);
check(
  env.picker.render.includes("45deg") && env.picker.render.includes("100% 95%"),
  "saved linear and radial rotation render on arrival"
);
const rgb = env.picker.getColorFromPosition();
check(
  rgb.every(n => n === rgb[0]) && Math.abs(rgb[0] / 255 - 0.62) < 0.005,
  "saved lightness and monochrome use Zen color math"
);
check(
  env.picker.constructor.getTheme().tranceAngle === 90,
  "startup serializer preserves saved fields"
);
check(
  !Object.hasOwn(env.picker, "updateCurrentWorkspace"),
  "startup does not wrap UI preview repaint"
);
env.workspace.theme.tranceLightness = null;
env.workspace.theme.trancePalette = "full";
env.picker.onWorkspaceChange(env.workspace);
check(
  env.picker.constructor.getTheme().tranceLightness === null,
  "auto lightness round-trips null"
);
check(
  env.picker.getColorFromPosition()[0] === 200,
  "auto/full preserves stock color"
);
check(
  env.picker
    .getGradientForWorkspace({ theme: { tranceAngle: 180 } })
    .includes("135deg"),
  "inactive workspace uses own angle"
);
assert.throws(() =>
  env.picker.getGradientForWorkspace({
    fail: true,
    theme: { tranceAngle: 180 },
  })
);
check(
  env.picker.getGradient().includes("45deg"),
  "preview exception restores active angle"
);
const wraps = [
  "getGradient",
  "getColorFromPosition",
  "getGradientForWorkspace",
  "onWorkspaceChange",
].map(k => [k, env.picker[k]]);
const serialize = env.picker.constructor.getTheme;
const ui = new TranceTheme(env.context);
ui.init({ observePref: false });
check(
  ui.enabled && env.panel.hasAttribute("trance-theme") && env.sheets.size === 1,
  "UI attaches using startup owner"
);
check(
  wraps.every(([k, v]) => env.picker[k] === v) &&
    env.picker.constructor.getTheme === serialize,
  "UI adds no redundant rendering or state wrappers"
);
check(env.panel.gradient.children.length === 1, "UI constructs one toast");
env.picker.updateCurrentWorkspace();
env.picker.updateCurrentWorkspace();
check(env.frameCallbacks.size === 1, "UI preview repaint coalesces");
env.picker.updateCurrentWorkspace(false);
check(env.frameCallbacks.size === 0, "saving cancels preview frame");
const savedBeforeDisable = JSON.stringify(env.workspace.theme);
ui.destroy();
check(
  !env.panel.gradient.children.length &&
    !env.sheets.size &&
    !env.panel.hasAttribute("trance-theme"),
  "UI teardown removes controls and styles"
);
check(
  env.picker.getGradient === wraps[0][1],
  "UI teardown leaves renderer owned by state"
);
state.destroy();
check(
  !TranceThemeState.forWindow(env.win),
  "state owner registration released"
);
check(
  !Object.hasOwn(env.picker, "getGradient") &&
    !Object.hasOwn(env.picker, "getColorFromPosition"),
  "state teardown removes wraps"
);
check(
  JSON.stringify(env.workspace.theme) === savedBeforeDisable,
  "disable does not erase persisted Trance fields"
);
check(
  env.slider.getAttribute("min") === "0.3" &&
    env.slider.getAttribute("max") === "0.9",
  "disable restores borrowed slider bounds"
);
const again = new TranceThemeState(env.context);
again.init({ observePref: false });
check(
  again.enabled && env.slider.getAttribute("min") === "0",
  "new state owner remembers this picker cached widened bounds"
);
again.destroy();
const late = environment({ late: true });
const lateState = new TranceThemeState(late.context);
lateState.init({ observePref: false });
check(
  late.slider.getAttribute("min") === "0.3",
  "mid-session first enable preserves stock cached bounds"
);
lateState.destroy();
const bad = environment({ late: true, fault: true });
const badState = new TranceThemeState(bad.context);
badState.init({ observePref: false });
check(
  !badState.enabled && !TranceThemeState.forWindow(bad.win),
  "failed synchronous state setup rolls back registration"
);
check(
  !Object.hasOwn(bad.picker, "getColorFromPosition"),
  "failed state setup rolls back earlier wraps"
);
const rollback = environment({ late: true });
const rollbackState = new TranceThemeState(rollback.context);
rollbackState.init({ observePref: false });
const getString = fakeServices.prefs.getStringPref;
fakeServices.prefs.getStringPref = () => {
  throw Error("UI sync failure");
};
const badUI = new TranceTheme(rollback.context);
badUI.init({ observePref: false });
fakeServices.prefs.getStringPref = getString;
check(
  !badUI.enabled &&
    !rollback.panel.gradient.children.length &&
    !rollback.sheets.size,
  "UI sync failure rolls back DOM and styles"
);
check(
  !Object.hasOwn(rollback.picker, "updateCurrentWorkspace") &&
    Object.hasOwn(rollback.picker, "getGradient"),
  "UI rollback removes only its wrapper"
);
badUI.init({ observePref: false });
check(
  badUI.enabled && rollback.panel.gradient.children.length === 1,
  "failed UI can retry without duplicate nodes"
);
badUI.destroy();
rollbackState.destroy();
check(
  (observers.get("zen-space-gradient-update")?.size ?? 0) === 0 &&
    [...prefObservers.values()].every(s => !s.size),
  "all mock observers released"
);
assert.equal(
  errors.length,
  2,
  "only the two injected setup failures were logged"
);
console.log(
  checks + " split/lifecycle assertions passed using current feature sources."
);
