#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# AUDIT.md Phase 5: quick macOS arm64 runtime checks using the existing UI build.
# Creates and closes its own throwaway profile. Never builds or measures performance.
# Output: /tmp/trance-phase5-smoke-result.json and browser log alongside it.
#
# By default this runs the development build. Pass a path to run a different one:
#
#   python3 scripts/trance-startup-smoke.py /Volumes/Trance/Trance.app
#
# TRANCE.md §13 Phase 12 requires that anything Trance claims to ship is asserted
# against the *packaged* artefact by running it, not by listing its files — three
# separate releases shipped without something the browser advertised because the
# only thing ever exercised was `npm start` (ADR-052, ADR-055, ADR-058). Pointing
# this script at the mounted DMG's `.app` is that assertion.

import importlib.util, json, os, pathlib, socket, subprocess, sys, tempfile
root = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('trance_perf', root / 'scripts/trance-perf.py')
perf = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = perf
spec.loader.exec_module(perf)
profile = pathlib.Path(tempfile.mkdtemp(prefix='trance-phase5-smoke-'))
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
prefs = {
 'marionette.port': port, 'marionette.enabled': True, 'trance.debug': True,
 'toolkit.policies.perUserDir': True, 'browser.shell.checkDefaultBrowser': False,
 'browser.startup.page': 0, 'browser.startup.homepage': 'about:blank',
 'browser.aboutwelcome.enabled': False, 'zen.welcome-screen.seen': True,
 'trance.onboarding.completed': True, 'trance.firstrun.completed': True,
 'trance.feedback.enabled': False, 'trance.surface.enabled': False,
}
(profile/'user.js').write_text(''.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});\n' for k,v in prefs.items()))


def resolve_binary(argv):
    """A .app bundle, a binary, or the development build when given nothing."""
    if not argv:
        return root / 'engine/obj-aarch64-apple-darwin/dist/Trance.app/Contents/MacOS/trance'
    candidate = pathlib.Path(argv[0]).expanduser().resolve()
    if candidate.is_dir() and candidate.suffix == '.app':
        return candidate / 'Contents/MacOS/trance'
    return candidate


binary = resolve_binary(sys.argv[1:])
if not binary.exists():
    sys.exit(f'no Trance binary at {binary}')
print(f'smoking {binary}')
env = {**os.environ, 'MOZ_MARIONETTE':'1', 'MOZ_CRASHREPORTER_DISABLE':'1'}
log = open('/tmp/trance-phase5-smoke-browser.log','w')
process = subprocess.Popen([str(binary),'--profile',str(profile),'--no-remote','--marionette','-remote-allow-system-access'],env=env,stdout=log,stderr=subprocess.STDOUT)
client = perf.Marionette(port=port)
try:
    client.connect(timeout=35, process=process)
    client.set_chrome_context()
    report = client.script('''
const done = arguments[arguments.length - 1];
(async () => {
 const checks = [];
 const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
 const core = window.gTrance;
 check(core?.active, "core active");
 const initial = core.registrations;
 for (const name of ["Onboarding", "FirstRun", "Theme", "Feedback", "Surfaces"]) {
   check(!initial.find(f => f.name === name)?.loaded, name + " absent at startup");
 }
 check(!document.getElementById("PanelUI-zen-gradient-generator").querySelector(".trance-theme-slider"), "theme controls absent before opening");
 Services.prefs.setBoolPref("trance.feedback.enabled", true);
 Services.prefs.setBoolPref("trance.surface.enabled", true);
 for (const name of ["Feedback", "Surfaces"]) check(core.features.find(f => f.name === name)?.enabled, name + " enabled live");
 const panel = document.getElementById("PanelUI-zen-gradient-generator");
 panel.openPopup(document.getElementById("PanelUI-menu-button"), "after_start");
 check(core.features.find(f => f.name === "Theme")?.enabled, "first popup enables theme");
 check(panel.querySelector(".trance-theme-slider"), "first popup has controls");
 panel.hidePopup();
 Services.prefs.setBoolPref("trance.theme.enabled", false);
 check(!panel.querySelector(".trance-theme-slider"), "theme disable removes controls");
 Services.prefs.setBoolPref("trance.theme.enabled", true);
 check(core.features.find(f => f.name === "Theme")?.enabled, "theme re-enable succeeds");
 Services.prefs.setBoolPref("trance.onboarding.completed", false);
 const onboarding = core.ensureFeature("Onboarding");
 check(onboarding?.enabled, "onboarding rerun lazily loads flow");
 onboarding.start();
 check(onboarding.running, "onboarding starts");
 Services.prefs.setBoolPref("trance.onboarding.enabled", false);
 check(!onboarding.running && !document.getElementById("trance-onboarding"), "mid-flow disable restores browser");
 Services.prefs.setBoolPref("trance.enabled", false);
 check(!core.active && core.context === null && core.features.length === 0, "master disable clears owners");
 Services.prefs.setBoolPref("trance.enabled", true);
 check(core.active, "master re-enable succeeds");
 done({ checks, initial, final: core.registrations });
})().catch(error => done({error: error.message, stack: error.stack}));
''', timeout_ms=25000)
    pathlib.Path('/tmp/trance-phase5-smoke-result.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
    if 'error' in report: sys.exit(1)
finally:
    client.quit()
    client.close()
    try: process.wait(timeout=10)
    except subprocess.TimeoutExpired: process.terminate()
    log.close()
