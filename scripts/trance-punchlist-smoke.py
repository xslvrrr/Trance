#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance 1.0.0 punch-list V2: run scriptable release assertions against a fresh
# throwaway profile. Pass a packaged .app path, or omit it for the dev build.
# Writes /tmp/trance-punchlist-smoke-result.json and a browser log alongside it.

import importlib.util
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULT = pathlib.Path("/tmp/trance-punchlist-smoke-result.json")
LOG = pathlib.Path("/tmp/trance-punchlist-smoke-browser.log")
DEV_BINARY = ROOT / "engine/obj-aarch64-apple-darwin/dist/Trance.app/Contents/MacOS/trance"
spec = importlib.util.spec_from_file_location("trance_perf", ROOT / "scripts/trance-perf.py")
perf = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = perf
spec.loader.exec_module(perf)


def resolve_binary(argv):
    """A .app bundle, a binary, or the development build when given nothing."""
    if not argv:
        return DEV_BINARY
    candidate = pathlib.Path(argv[0]).expanduser().resolve()
    if candidate.is_dir() and candidate.suffix == ".app":
        return candidate / "Contents/MacOS/trance"
    return candidate


class Browser:
    """One throwaway profile, one chrome-context Marionette session."""

    def __init__(self, binary, prefs):
        self.profile = pathlib.Path(tempfile.mkdtemp(prefix="trance-punchlist-smoke-"))
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        prefs = {
            "marionette.port": port, "marionette.enabled": True, "trance.debug": True,
            "toolkit.policies.perUserDir": True, "browser.shell.checkDefaultBrowser": False,
            "browser.startup.page": 0, "browser.startup.homepage": "about:blank",
            "browser.aboutwelcome.enabled": False, "zen.welcome-screen.seen": True,
            "zen.updates.show-update-notification": False,
            **prefs,
        }
        (self.profile / "user.js").write_text(
            "".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});\n" for k, v in prefs.items())
        )
        env = {**os.environ, "MOZ_MARIONETTE": "1", "MOZ_CRASHREPORTER_DISABLE": "1"}
        self.log = open(LOG, "w")
        self.process = subprocess.Popen(
            [str(binary), "--profile", str(self.profile), "--no-remote", "--marionette",
             "-remote-allow-system-access"],
            env=env, stdout=self.log, stderr=subprocess.STDOUT,
        )
        self.client = perf.Marionette(port=port)
        self.client.connect(timeout=45, process=self.process)
        self.client.set_chrome_context()

    def js(self, body, timeout_ms):
        """Runs an async chrome-privileged body; `return` gives its value."""
        wrapped = (
            "const done = arguments[arguments.length - 1];"
            "(async () => {" + body + "})().then(value => done(value),"
            " error => done({error: String(error), stack: error && error.stack}));"
        )
        return self.client.script(wrapped, timeout_ms=timeout_ms)

    def quit(self):
        try:
            self.client.quit()
            self.client.close()
        finally:
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.terminate()
            self.log.close()
            shutil.rmtree(self.profile, ignore_errors=True)


def main():
    binary = resolve_binary(sys.argv[1:])
    if not binary.exists():
        sys.exit(f"no Trance binary at {binary}")
    print(f"smoking {binary}")
    browser = Browser(
        binary,
        {
            "trance.onboarding.completed": True,
            "trance.firstrun.completed": True,
            "trance.feedback.enabled": False,
        },
    )
    try:
        report = browser.js(r"""
const checks = [];
let queue = Promise.resolve();
const check = (name, fn) => {
  queue = queue.then(async () => {
    try {
      const value = await fn();
      const passed = value && typeof value === "object"
        ? (value.pass ?? value.present ?? false)
        : !!value;
      checks.push({name, passed: !!passed, detail: value && typeof value === "object" ? value : null});
    } catch (error) {
      checks.push({name, passed: false, detail: String(error) + "\n" + (error.stack || "")});
    }
  });
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

check("zen.library.enabled defaults true", () => Services.prefs.getBoolPref("zen.library.enabled", false) === true);
check("zen-library-button is in sidebar foot", () => {
  const foot = document.getElementById("zen-sidebar-foot-buttons");
  return {present: !!foot?.querySelector("#zen-library-button"), selector: "#zen-sidebar-foot-buttons #zen-library-button"};
});

// Apply architecture defaults through the same service exported to the live UI.
check("x86_64 architecture defaults use default branch", () => {
  const {TranceOnboardingSettingsService: svc} = ChromeUtils.importESModule("chrome://browser/content/trance-components/TranceOnboardingSettings.mjs");
  const names = ["trance.surface.blur.radius", "trance.surface.internal.blur", "trance.chrome.urlbar.focus-blur"];
  for (const name of names) Services.prefs.clearUserPref(name);
  svc.applyArch("x86_64");
  const actual = [Services.prefs.getIntPref(names[0]), Services.prefs.getBoolPref(names[1]), Services.prefs.getBoolPref(names[2])];
  return {actual, expected: [10, false, false], noUserValues: names.every(name => !Services.prefs.prefHasUserValue(name)), pass: JSON.stringify(actual) === JSON.stringify([10, false, false]) && names.every(name => !Services.prefs.prefHasUserValue(name))};
});
check("user-set blur radius survives arm64 tuning", () => {
  const {TranceOnboardingSettingsService: svc} = ChromeUtils.importESModule("chrome://browser/content/trance-components/TranceOnboardingSettings.mjs");
  Services.prefs.setIntPref("trance.surface.blur.radius", 37);
  svc.applyArch("arm64");
  const value = Services.prefs.getIntPref("trance.surface.blur.radius");
  const hasUser = Services.prefs.prefHasUserValue("trance.surface.blur.radius");
  Services.prefs.clearUserPref("trance.surface.blur.radius");
  return {value, hasUser, pass: value === 37 && hasUser};
});

check("onboarding omits channel and zen-internet and has 8 pages", async () => {
  Services.prefs.setBoolPref("trance.onboarding.completed", false);
  const onboarding = window.gTrance.ensureFeature("Onboarding");
  onboarding.start();
  await sleep(150);
  document.getElementById("trance-onboarding-start")?.click();
  await sleep(1400);
  const dots = [...document.querySelectorAll("#trance-onboarding-progress .trance-onboarding-dot")];
  const pageText = document.getElementById("trance-onboarding-copy")?.textContent || "";
  const source = await (await fetch("chrome://browser/content/trance-components/TranceOnboarding.mjs")).text();
  const removedIdsAbsent =
    !/id:\s*["']channel["']/.test(source) &&
    !/id:\s*["']zen-internet["']/.test(source) &&
    !/#pageChannel\s*\(|#pageZenInternet\s*\(/.test(source);
  Services.prefs.setBoolPref("trance.onboarding.enabled", false);
  return {progressDots: dots.length, renderedCopy: pageText.trim(), removedIdsAbsent, pass: dots.length === 8 && removedIdsAbsent && !/zen internet/i.test(pageText)};
});

check("9 saved themes create multiple picker pages", async () => {
  const themes = Array.from({length: 9}, (_, i) => ({gradientColors: [{c: [i + 1, 20, 30]}, {c: [40, i + 1, 50]}], opacity: 1, texture: ""}));
  Services.prefs.setStringPref("trance.theme.saved.themes", JSON.stringify(themes));
  const panel = document.getElementById("PanelUI-zen-gradient-generator");
  panel.openPopup(document.getElementById("PanelUI-menu-button"), "after_start");
  await sleep(1200);
  const savedPages = panel.querySelectorAll("#PanelUI-zen-gradient-generator-color-pages .trance-theme-saved-page").length;
  panel.hidePopup();
  return {savedPages, expectedMinimum: 2, pass: savedPages > 1};
});

check("pressed tilt token resolves and differs", () => {
  const style = getComputedStyle(document.documentElement);
  const pressed = style.getPropertyValue("--trance-newtab-logo-tilt-pressed").trim();
  const regular = style.getPropertyValue("--trance-newtab-logo-tilt").trim();
  return {pressed, regular, pass: !!pressed && !!regular && pressed !== regular};
});

check("app-menu and reload hover-painted boxes match within 1px", () => {
  const buttons = ["PanelUI-menu-button", "reload-button"].map(id => document.getElementById(id));
  const painted = buttons.map(button => {
    InspectorUtils.addPseudoClassLock(button, ":hover");
    const icon = button.querySelector(".toolbarbutton-icon");
    const buttonStyle = getComputedStyle(button);
    const iconStyle = getComputedStyle(icon);
    const buttonColor = buttonStyle.backgroundColor;
    const iconColor = iconStyle.backgroundColor;
    const transparent = color =>
      color === "transparent" || /,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);
    const target = !transparent(iconColor) ? icon : !transparent(buttonColor) ? button : icon;
    const rect = target.getBoundingClientRect();
    const result = {
      id: button.id,
      paintedElement: target === icon ? ".toolbarbutton-icon" : "toolbarbutton",
      hoverBackground: target === icon ? iconColor : buttonColor,
      buttonBackground: buttonColor,
      iconBackground: iconColor,
      box: [rect.width, rect.height],
    };
    InspectorUtils.removePseudoClassLock(button, ":hover");
    return result;
  });
  const [menu, reload] = painted;
  return {painted, pass: menu.box.every((value, index) => Math.abs(value - reload.box[index]) <= 1)};
});

check("closed appMenu-popup has matching macOS arrow opacity rule", () => {
  const popup = document.getElementById("appMenu-popup");
  const closed = popup.state === "closed" || !popup.hasAttribute("panelopen");
  const rules = InspectorUtils.getMatchingCSSRules(popup, null, false, true);
  const rule = rules.find(candidate =>
    (candidate.selectorText || "").includes('panel[type="arrow"]:not([animate])') &&
    /-moz-window-opacity\s*:\s*0/.test(candidate.cssText)
  );
  return {closed, type: popup.getAttribute("type"), selectorMatches: !!rule, matchingRule: rule?.cssText ?? null, pass: closed && !!rule};
});
await queue;
return {checks};
""", timeout_ms=60000)
        if isinstance(report, dict) and "error" in report:
            sys.exit(f"smoke script threw: {report['error']}\n{report.get('stack')}")
        results = report.get("checks", []) if isinstance(report, dict) else []
        output = {
            "binary": str(binary),
            "profile": str(browser.profile),
            "checks": results,
            "passed": sum(1 for result in results if result.get("passed")),
            "failed": sum(1 for result in results if not result.get("passed")),
        }
        RESULT.write_text(json.dumps(output, indent=2) + "\n")
        print(json.dumps(output, indent=2))
        return 1 if output["failed"] else 0
    finally:
        browser.quit()


if __name__ == "__main__":
    sys.exit(main())
