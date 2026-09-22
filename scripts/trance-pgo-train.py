#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Bounded Trance PGO workload. Invoke via trance-build-matrix.py run.

Independent of trance-perf.py. Training is not a performance measurement.
Only the matrix runner calls train(), after explicit heavy-execution consent.
"""

import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def seed_digest(seed):
    items = []
    for file in sorted(seed.rglob("*")):
        require(not file.is_symlink(), f"Seed contains symlink: {file}")
        if file.is_file():
            items.append([str(file.relative_to(seed)), sha(file)])
    return hashlib.sha256(json.dumps(items).encode()).hexdigest()


def validate_seed(seed, policy):
    require(seed.is_dir(), "A dedicated, closed training seed profile is required")
    require(not any((seed / name).exists() or (seed / name).is_symlink()
                    for name in (".parentlock", "parent.lock", "lock")),
            "Seed appears locked; use a closed disposable profile")
    metadata = json.loads((seed / "trance-pgo-seed.json").read_text())
    require(metadata.get("disposable") is True, "Seed must be explicitly marked disposable")
    extensions = metadata["extensions"]
    require(isinstance(extensions, dict) and extensions, "Seed must pin extension IDs and versions")
    expected = {key for key, value in policy["policies"]["ExtensionSettings"].items()
                if value.get("installation_mode") == "normal_installed"}
    require(set(extensions) == expected, "Seed extension IDs must match Trance distribution policy")
    require(all(isinstance(version, str) and version for version in extensions.values()),
            "Every extension needs an exact version")
    return extensions


class Marionette:
    """Small synchronous wire client; APIs in engine/remote/marionette/driver.sys.mjs."""

    def __init__(self, port, process):
        self.serial = 0
        self.buffer = b""
        self.socket = None
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            require(process.poll() is None, "Browser exited before Marionette startup")
            try:
                self.socket = socket.create_connection(("127.0.0.1", port), timeout=2)
                break
            except ConnectionRefusedError:
                time.sleep(0.2)
        require(self.socket is not None, "Marionette startup timed out")
        self.socket.settimeout(65)
        hello = self.receive()
        require(hello.get("applicationType") == "gecko", "Unexpected Marionette peer")
        self.call("WebDriver:NewSession", {})
        self.call("Marionette:SetContext", {"value": "chrome"})

    def receive(self):
        def more():
            chunk = self.socket.recv(65536)
            require(chunk, "Marionette closed connection")
            self.buffer += chunk
            require(len(self.buffer) <= 8 * 1024 * 1024, "Oversized Marionette response")
        while b":" not in self.buffer:
            more()
        length, rest = self.buffer.split(b":", 1)
        count = int(length)
        require(0 < count <= 8 * 1024 * 1024, "Invalid Marionette frame length")
        self.buffer = rest
        while len(self.buffer) < count:
            more()
        body, self.buffer = self.buffer[:count], self.buffer[count:]
        return json.loads(body)

    def call(self, name, parameters):
        self.serial += 1
        body = json.dumps([0, self.serial, name, parameters]).encode()
        self.socket.sendall(str(len(body)).encode() + b":" + body)
        response = self.receive()
        require(isinstance(response, list) and len(response) == 4
                and response[:2] == [1, self.serial], "Unexpected Marionette response")
        require(response[2] is None, f"{name}: {response[2]}")
        return response[3]

    def script(self, source, *args):
        # Any rejected promise becomes a hard failure, not a skipped workload.
        wrapped = """const finish = arguments[arguments.length - 1];
        (async () => { SOURCE })().then(
          value => finish({ok: true, value}),
          error => finish({ok: false, error: String(error)}));""".replace("SOURCE", source)
        result = self.call("WebDriver:ExecuteAsyncScript", {
            "script": wrapped, "args": list(args), "newSandbox": False, "scriptTimeout": 60000,
        })
        if isinstance(result, dict) and "value" in result:
            result = result["value"]
        require(result.get("ok") is True, f"Workload failed: {result}")
        return result.get("value")

    def context(self, name):
        self.call("Marionette:SetContext", {"value": name})


READY = """
await window.delayedStartupPromise;
if (!window.gBrowser || !window.gZenWorkspaces || !gZenWorkspaces.workspaceEnabled)
  throw new Error('Trance/Zen workspace startup not complete');
if (!Services.prefs.getBoolPref('trance.enabled', false))
  throw new Error('Trance disabled in training seed');
return {tabs: gBrowser.tabs.length, spaces: gZenWorkspaces.getWorkspaces().length};
"""

EXTENSIONS = """
const {AddonManager} = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const all = await AddonManager.getAllAddons();
const expected = arguments[0];
for (const [id, version] of Object.entries(expected)) {
  const addon = all.find(a => a.id === id);
  if (!addon || !addon.isActive || addon.version !== version)
    throw new Error('Missing/inactive/drifted extension: ' + id);
}
const extras = all.filter(a => a.type === 'extension' && a.isActive &&
  !a.isBuiltin && !a.isSystem && !(a.id in expected));
if (extras.length) throw new Error('Unexpected enabled extensions: ' + extras.map(a => a.id));
return Object.entries(expected);
"""

TABS = """
const base = arguments[0];
window.tranceTrainingTabs = [];
for (let i = 0; i < 12; ++i) {
  const url = base + '/article.html?tab=' + i;
  const tab = gBrowser.addTab(url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  gBrowser.selectedTab = tab;
  window.tranceTrainingTabs.push(tab);
}
return window.tranceTrainingTabs.length;
"""

SPACES = """
const ws = gZenWorkspaces;
if (ws.getWorkspaces().length < 2) await ws.createAndSaveWorkspace('Trance PGO', undefined, true);
const spaces = ws.getWorkspaces();
if (spaces.length < 2) throw new Error('Second workspace missing');
for (let i = 0; i < 8; ++i) await ws.changeWorkspace(spaces[i % 2]);
await ws.changeWorkspace(spaces[0]);
return {switches: 8, spaces: spaces.map(s => s.uuid)};
"""

SELECT_TAB = """
const tab = window.tranceTrainingTabs[arguments[0]];
gBrowser.selectedTab = tab;
return tab.linkedBrowser.currentURI.spec;
"""

CONTENT = """
if (document.readyState !== 'complete') await new Promise(resolve =>
  window.addEventListener('load', resolve, {once: true}));
if (!document.getElementById('trance-pgo-article')) throw new Error('Wrong training document');
window.scrollTo(0, document.body.scrollHeight);
document.getElementById('toggle').click();
await new Promise(resolve => window.requestAnimationFrame(resolve));
return document.body.dataset.toggled === 'yes';
"""

SAVE = """
const {SessionSaver} = ChromeUtils.importESModule('resource:///modules/sessionstore/SessionSaver.sys.mjs');
await SessionSaver.run();
return Array.from(gBrowser.tabs, t => t.linkedBrowser.currentURI.spec)
  .filter(url => url.startsWith(arguments[0] + '/article.html'));
"""

RESTORE = """
const {SessionStore} = ChromeUtils.importESModule('resource:///modules/sessionstore/SessionStore.sys.mjs');
const state = JSON.parse(SessionStore.getBrowserState());
const urls = state.windows.flatMap(w => w.tabs.flatMap(t => t.entries.map(e => e.url)))
  .filter(url => url.startsWith(arguments[0] + '/article.html'));
const spaces = gZenWorkspaces.getWorkspaces().map(s => s.uuid);
return {urls, spaces};
"""


def train(plan, row, generated, output, environment):
    require(plan.get("seed") and plan.get("media"), "Regenerate plan with --seed and --media")
    seed, media = Path(plan["seed"]), Path(plan["media"])
    require(media.is_file() and media.suffix.lower() in (".mp4", ".webm"), "Supply a local MP4/WebM training clip")
    extensions = validate_seed(seed, json.loads((Path(plan["root"]) /
        "src/zen/trance/distribution/policies.json").read_text()))
    seed_before = seed_digest(seed)
    inputs = {"seed_sha256": seed_before, "media_sha256": sha(media), "extensions": extensions}
    # All CPU/Rust groups must train against exactly the same input payload.
    inputs_file = Path(plan["work_dir"]) / "training-inputs.json"
    if inputs_file.exists():
        require(json.loads(inputs_file.read_text()) == inputs, "Training inputs drifted between groups")
    else:
        with inputs_file.open("x") as stream:
            json.dump(inputs, stream, indent=2)
    output.mkdir(parents=True, exist_ok=False)
    profile = output / "profile"
    shutil.copytree(seed, profile)
    raw = output / "raw"
    raw.mkdir()
    site = output / "site"
    site.mkdir()
    (site / "article.html").write_text("""<!doctype html><meta charset=utf-8>
<title>Trance PGO article</title><style>body{font:18px sans-serif;max-width:65ch;margin:2em auto}
article{padding:1em;border-bottom:1px solid}body[data-toggled=yes]{color:#265}</style>
<h1 id=trance-pgo-article>Trance training article</h1>
<button id=toggle onclick="document.body.dataset.toggled='yes'">Change text color</button>
""" + "<article><h2>Local reading workload</h2><p>Tabs, layout and scrolling.</p></article>" * 80)
    shutil.copyfile(media, site / ("clip" + media.suffix.lower()))
    (site / "media.html").write_text(f"""<!doctype html><meta charset=utf-8><title>Trance media</title>
<video id=clip controls width=640 src="clip{media.suffix.lower()}"></video>""")

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(site)))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    prefs = {"marionette.port": port, "trance.enabled": True,
             "trance.onboarding.completed": True, "zen.welcome-screen.seen": True,
             "browser.startup.page": 3, "browser.shell.checkDefaultBrowser": False,
             "browser.sessionstore.resume_from_crash": True,
             "extensions.update.enabled": False, "extensions.systemAddon.update.enabled": False,
             "zen.workspaces.debug": False, "zen.session-store.log": False}
    # Preserve seed user.js, then override only explicit training controls.
    with (profile / "user.js").open("a") as stream:
        stream.write("\n// Trance disposable training profile\n")
        for key, value in prefs.items():
            stream.write(f"user_pref({json.dumps(key)}, {json.dumps(value)});\n")
    binary = Path(generated["bundle"]) / "Contents/MacOS/trance"
    evidence = {"inputs": inputs, "startup": [], "tabs": 0}
    saved = None
    try:
        for launch in range(2):
            env = dict(environment, MOZ_MARIONETTE="1", MOZ_CRASHREPORTER_DISABLE="1",
                       LLVM_PROFILE_FILE=str(raw / f"launch-{launch}-%p-%m.profraw"),
                       MOZ_JAR_LOG_FILE=str(output / f"jar-{launch}.log"))
            client = None
            with (output / f"browser-{launch}.log").open("xb") as log:
                process = subprocess.Popen([str(binary), "--profile", str(profile), "--no-remote",
                    "--marionette", "-remote-allow-system-access"], env=env, stdout=log, stderr=subprocess.STDOUT)
                try:
                    client = Marionette(port, process)
                    evidence["startup"].append(client.script(READY))
                    client.script(EXTENSIONS, extensions)
                    if launch == 0:
                        evidence["tabs"] = client.script(TABS, base)
                        for index in range(12):
                            client.script(SELECT_TAB, index)
                            # Explicit navigation waits for load and proves each
                            # document ran, rather than counting merely created tabs.
                            client.context("content")
                            client.call("WebDriver:Navigate", {"url": f"{base}/article.html?tab={index}"})
                            require(client.script(CONTENT) is True, "Article interaction failed")
                            client.context("chrome")
                        evidence["spaces"] = client.script(SPACES)
                        client.script(SELECT_TAB, 11)
                        client.context("content")
                        client.call("WebDriver:Navigate", {"url": base + "/media.html"})
                        require(client.script("""
                          const v = document.getElementById('clip');
                          v.muted = true;
                          await v.play();
                          return !v.paused;
                        """) is True, "Media did not start")
                        time.sleep(5)
                        evidence["media"] = client.script("""
                          const v = document.getElementById('clip');
                          const result = {time: v.currentTime,
                            frames: v.getVideoPlaybackQuality().totalVideoFrames};
                          v.pause(); return result;
                        """)
                        require(evidence["media"]["time"] >= 2 and evidence["media"]["frames"] > 0,
                                "Media decode/playback did not progress")
                        client.context("chrome")
                        # Return selected tab to its article so all twelve URLs
                        # become assertions on the next process's session restore.
                        client.script(SELECT_TAB, 11)
                        client.context("content")
                        client.call("WebDriver:Navigate", {"url": base + "/article.html?tab=11"})
                        client.context("chrome")
                        saved = client.script(SAVE, base)
                        require(len(set(saved)) == 12, "Expected 12 distinct saved training tabs")
                    else:
                        restored = client.script(RESTORE, base)
                        require(set(saved) <= set(restored["urls"]), "Session tabs were not restored")
                        require(set(evidence["spaces"]["spaces"]) <= set(restored["spaces"]),
                                "Workspace identities were not restored")
                        evidence["restore"] = restored
                    client.script(EXTENSIONS, extensions)
                    client.call("Marionette:Quit", {"flags": ["eAttemptQuit"]})
                    require(process.wait(timeout=60) == 0, "Browser shutdown failed")
                finally:
                    if client and client.socket:
                        client.socket.close()
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
            require(list(raw.glob(f"launch-{launch}-*.profraw")), "Launch produced no raw PGO profiles")
            require("LLVM Profile Error" not in (output / f"browser-{launch}.log").read_text(errors="replace"),
                    "LLVM reported a profile error")
        require(not list(profile.rglob("*.dmp")), "Training produced a crash dump")
        require(seed_digest(seed) == seed_before, "Seed changed during training")
        require(sha(media) == inputs["media_sha256"], "Media changed during training")
        files = sorted(raw.glob("*.profraw"))
        require(all(file.stat().st_size > 0 for file in files), "Empty raw PGO profile")
        with (output / "merge.log").open("xb") as log:
            subprocess.run([plan["profdata"], "merge", "-o", str(output / "merged.profdata"),
                            *map(str, files)], check=True, stdout=log, stderr=subprocess.STDOUT)
        # Warnings about rejected/incompatible data can accompany exit status 0.
        merge_log = (output / "merge.log").read_text(errors="replace").lower()
        require("warning" not in merge_log and "error" not in merge_log, "Profile merge reported a warning/error")
        jar = b""
        for launch in range(2):
            part = (output / f"jar-{launch}.log").read_bytes()
            require(part.strip(), "Missing jar access log; train the staged package")
            jar += part + b"\n"
        (output / "en-US.log").write_bytes(jar)
        require((output / "merged.profdata").stat().st_size > 0, "Profile merge produced no data")
        evidence["raw_profiles"] = {file.name: sha(file) for file in files}
        evidence["artifacts"] = {name: sha(output / name) for name in ("merged.profdata", "en-US.log")}
        return evidence
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    raise SystemExit("Use trance-build-matrix.py run --stage train (dry by default).")
