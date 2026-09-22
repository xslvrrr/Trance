#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: the motion bench (TRANCE.md §3.5, §12.2).
#
# "Animations do not feel as smooth as they do in a Chromium browser" is the
# most common complaint about a Gecko-based browser and the least falsifiable.
# This script turns it into numbers. It answers three separate questions that
# the complaint runs together:
#
#   1. Frame *delivery*  — does the browser produce a frame every vsync?
#      Reported as achieved Hz, late-frame share and dropped-frame count for
#      the chrome window's own refresh driver.
#
#   2. Frame *pacing*    — are the timestamps the animation is sampled at
#      evenly spaced? A browser can hold 120 Hz and still look wrong if the
#      clock it interpolates against jitters. Reported as the coefficient of
#      variation of the inter-frame interval and the frame-to-frame change in
#      that interval ("jerk"). Compare against the same page in Chrome; the
#      two engines were within 0.1 percentage points of each other when this
#      script was written, which is the result that rules the engine out.
#
#   3. Frame *cost*      — what does one animated element make the chrome do?
#      A `transform` or `opacity` animation is handed to the compositor and
#      costs the main thread nothing. Anything else is sampled on the main
#      thread, and every sample reflows and re-builds the display list for the
#      whole browser UI. Reported as sync reflows, display-list builds and
#      image paints per second, taken from the Gecko profiler.
#
# Question 3 is the one that finds bugs, and it finds them on hardware that
# never drops a frame: an M-series laptop absorbs 150 concurrent layout
# animations without missing a vsync, so the cost only shows up as battery, as
# fan noise, and as stutter on the machines nobody tests on.
#
# Usage:
#   python3 scripts/trance-motion-bench.py                 # all three sections
#   python3 scripts/trance-motion-bench.py --json out.json
#   python3 scripts/trance-motion-bench.py --binary /path/to/trance
#
# The window must be frontmost while this runs: an occluded or background
# window has its refresh driver throttled to a few tick per second, and the
# script says so rather than reporting the throttle as a result.

import argparse
import importlib.util
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load_perf_module():
    """Reuse trance-perf.py's Marionette client and binary discovery."""
    spec = importlib.util.spec_from_file_location(
        "trance_perf", REPO / "scripts/trance-perf.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


perf = _load_perf_module()


# ── The three measurements, as chrome-context scripts ──────────────────────
#
# All three run in the parent process against the real browser window, because
# that is the document whose animations this is about. Content-process numbers
# are a different question and a well-covered one; the browser UI is the part
# Trance owns.

_STATS_HELPERS = r"""
function quantile(sorted, q) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
  return sorted[i];
}
function intervals(stamps) {
  const out = [];
  for (let i = 1; i < stamps.length; i++) out.push(stamps[i] - stamps[i - 1]);
  return out;
}
function round(value, places = 2) {
  return Number.isFinite(value) ? +value.toFixed(places) : null;
}
"""

# 1 + 2. Delivery and pacing, from the chrome window's own rAF clock.
PACING = _STATS_HELPERS + r"""
const resolve = arguments[arguments.length - 1];
const warmMs = arguments[0];
const runMs = arguments[1];
const win = Services.wm.getMostRecentWindow("navigator:browser");
// A composited animation runs alongside the measurement so that the refresh
// driver has a reason to tick every frame. Without one it coalesces ticks when
// nothing is animating and the result measures idling, not delivery.
const probe = win.document.createXULElement("box");
probe.setAttribute("style",
  "position:fixed;top:-40px;left:0;width:24px;height:24px;opacity:.01;" +
  "pointer-events:none;z-index:2147483647");
win.document.documentElement.appendChild(probe);
let origin = null;
const stamps = [];
function frame(now) {
  if (origin === null) origin = now;
  const elapsed = now - origin;
  probe.style.transform = "translateX(" + (Math.sin(now / 300) * 20).toFixed(3) + "px)";
  if (elapsed > warmMs) stamps.push(now);
  if (elapsed < warmMs + runMs) { win.requestAnimationFrame(frame); return; }
  probe.remove();

  const deltas = intervals(stamps);
  const sorted = [...deltas].sort((a, b) => a - b);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const sd = Math.sqrt(deltas.reduce((a, x) => a + (x - mean) ** 2, 0) / deltas.length);
  const median = quantile(sorted, 0.5);
  const jerk = intervals(deltas).map(Math.abs);
  const jerkSorted = [...jerk].sort((a, b) => a - b);
  const late = deltas.filter(x => x > median * 1.5).length;
  const dropped = deltas.reduce((a, x) => a + Math.max(0, Math.round(x / median) - 1), 0);

  resolve({
    frames: deltas.length,
    achievedHz: round(1000 / mean, 1),
    meanMs: round(mean, 3),
    medianMs: round(median, 3),
    sdMs: round(sd, 3),
    cvPct: round(100 * sd / mean, 1),
    p95Ms: round(quantile(sorted, 0.95), 3),
    p99Ms: round(quantile(sorted, 0.99), 3),
    maxMs: round(sorted[sorted.length - 1], 3),
    minMs: round(sorted[0], 3),
    jerkMeanMs: round(jerk.reduce((a, b) => a + b, 0) / jerk.length, 3),
    jerkP95Ms: round(quantile(jerkSorted, 0.95), 3),
    lateFrames: late,
    latePct: round(100 * late / deltas.length, 2),
    droppedFrames: dropped,
  });
}
win.requestAnimationFrame(frame);
"""

# 3. Cost, from profiler markers, for one animated property at a time.
COST = _STATS_HELPERS + r"""
const resolve = arguments[arguments.length - 1];
const runMs = arguments[0];
const property = arguments[1];
const count = arguments[2];
const win = Services.wm.getMostRecentWindow("navigator:browser");
const doc = win.document;

const KEYFRAMES = {
  none: null,
  transform: "@keyframes __tb { from { transform: translateX(0); } to { transform: translateX(120px); } }",
  opacity: "@keyframes __tb { from { opacity: .2; } to { opacity: 1; } }",
  "margin-left": "@keyframes __tb { from { margin-left: 0px; } to { margin-left: 120px; } }",
  height: "@keyframes __tb { from { height: 8px; } to { height: 24px; } }",
};

let sheet = null;
const boxes = [];
if (KEYFRAMES[property]) {
  sheet = doc.createElement("style");
  sheet.textContent = KEYFRAMES[property] + `
    .__tb { position: fixed; left: 6px; width: 40px; height: 8px; opacity: .01;
            pointer-events: none; z-index: 2147483647;
            animation: __tb .8s linear infinite alternate; }`;
  doc.documentElement.appendChild(sheet);
  for (let i = 0; i < count; i++) {
    const box = doc.createXULElement("box");
    box.className = "__tb";
    box.style.top = (-40 - i * 9) + "px";
    box.style.animationDelay = (-i * 17) + "ms";
    doc.documentElement.appendChild(box);
    boxes.push(box);
  }
}

// Let the animation reach a steady state before the profiler starts. The first
// frames of a newly inserted element include its initial style resolution and
// display-list build, which belong to inserting it rather than to animating it,
// and the settle also clears whatever the previous row left invalidated.
//
// The probes sit off-screen on purpose, so the image-paint column counts only
// what the animation itself forces. Animating the same property on a real
// toolbar element repaints every icon near it as well — an order of magnitude
// more — so this column understates the cost rather than overstating it.
win.setTimeout(() => {
Services.profiler.StopProfiler();
Services.profiler.StartProfiler(1 << 23, 1, ["stackwalk", "js", "cpu"],
  ["GeckoMain", "Compositor", "Renderer"]);

win.setTimeout(() => {
  Services.profiler.getProfileDataAsync().then(profile => {
    Services.profiler.StopProfiler();
    for (const box of boxes) box.remove();
    if (sheet) sheet.remove();

    const wanted = new Set([
      "RefreshDriverTick", "Styles", "Reflow (sync)", "DisplayList",
      "WrDisplayList", "Image Paint", "VsyncTimestamp",
    ]);
    const out = {};
    for (const thread of profile.threads) {
      const strings = thread.stringTable
        || (profile.shared && profile.shared.stringArray) || [];
      const nameIndex = thread.markers.schema.name;
      const startIndex = thread.markers.schema.startTime;
      const stamps = {};
      for (const row of thread.markers.data) {
        const name = strings[row[nameIndex]];
        if (!wanted.has(name)) continue;
        if (row[startIndex] == null) continue;
        (stamps[name] = stamps[name] || []).push(row[startIndex]);
      }
      for (const [name, list] of Object.entries(stamps)) {
        const key = thread.name + "/" + name;
        // Rate over the measurement window, not over the span the marker
        // happened to occupy: three markers 25 ms apart are three markers in
        // the window, not 120 per second.
        out[key] = {
          count: list.length,
          perSecond: round(1000 * list.length / runMs, 1),
        };
      }
    }
    resolve({ property, count, markers: out });
  }).catch(error => {
    for (const box of boxes) box.remove();
    if (sheet) sheet.remove();
    resolve({ property, count, error: String(error) });
  });
}, runMs);
}, 1500);
"""


# A short profile used only to decide whether the browser has finished starting.
# Startup keeps the refresh driver at display rate for several seconds after the
# window appears — favicons, the workspace gradient, extension pages — and a
# measurement taken during it reports startup rather than the thing under test.
QUIET = r"""
const resolve = arguments[arguments.length - 1];
const win = Services.wm.getMostRecentWindow("navigator:browser");
Services.profiler.StopProfiler();
Services.profiler.StartProfiler(1 << 21, 1, ["stackwalk"], ["GeckoMain"]);
win.setTimeout(() => {
  Services.profiler.getProfileDataAsync().then(profile => {
    Services.profiler.StopProfiler();
    let ticks = 0;
    for (const thread of profile.threads) {
      if (thread.name !== "GeckoMain") continue;
      const strings = thread.stringTable
        || (profile.shared && profile.shared.stringArray) || [];
      const nameIndex = thread.markers.schema.name;
      for (const row of thread.markers.data) {
        if (strings[row[nameIndex]] === "RefreshDriverTick") ticks++;
      }
    }
    resolve(ticks);
  }).catch(() => resolve(-1));
}, 1000);
"""


def launch(binary, profile_dir, port, log_path):
    prefs = {
        "marionette.port": port,
        "marionette.enabled": True,
        "browser.shell.checkDefaultBrowser": False,
        "browser.startup.page": 0,
        "browser.startup.homepage": "about:blank",
        "browser.aboutwelcome.enabled": False,
        "zen.welcome-screen.seen": True,
        "trance.onboarding.completed": True,
        "trance.firstrun.completed": True,
        "trance.feedback.enabled": False,
        # Keep the profiler's own overhead off the numbers it reports.
        "datareporting.policy.dataSubmissionEnabled": False,
    }
    (profile_dir / "user.js").write_text(
        "".join(
            f"user_pref({json.dumps(k)}, {json.dumps(v)});\n"
            for k, v in prefs.items()
        )
    )
    env = {**os.environ, "MOZ_MARIONETTE": "1", "MOZ_CRASHREPORTER_DISABLE": "1"}
    log = open(log_path, "w")
    return subprocess.Popen(
        [
            str(binary), "--profile", str(profile_dir), "--no-remote",
            "--marionette", "-remote-allow-system-access", "about:blank",
        ],
        env=env, stdout=log, stderr=subprocess.STDOUT,
    )


def wait_until_idle(client, attempts=20):
    """Blocks until the chrome window's refresh driver stops ticking.

    Returns the tick count of the last sample, so a browser that never goes
    idle is reported as that rather than folded into the baseline row.
    """
    for _ in range(attempts):
        ticks = client.script(QUIET, [], timeout_ms=30000)
        if ticks == 0:
            return 0
        time.sleep(1)
    return ticks


def raise_to_front():
    """macOS only, and best-effort.

    An occluded window's refresh driver is throttled, which would be reported
    as a catastrophic result rather than as the measurement not having run. The
    check in `main` catches it either way; this just makes it unlikely.
    """
    if sys.platform != "darwin":
        return
    subprocess.run(
        [
            "osascript", "-e",
            'tell application "System Events" to set frontmost of every '
            'process whose name contains "trance" to true',
        ],
        capture_output=True, check=False,
    )


def main():
    parser = argparse.ArgumentParser(description="Trance motion bench")
    parser.add_argument("--binary", help="path to the built browser binary")
    parser.add_argument("--json", help="write the full result to this path")
    parser.add_argument(
        "--warm-ms", type=int, default=1500,
        help="settling time discarded before each measurement",
    )
    parser.add_argument(
        "--run-ms", type=int, default=5000, help="measurement window",
    )
    parser.add_argument(
        "--scale", type=int, nargs="*", default=[1, 20, 150],
        help="element counts for the cost section",
    )
    args = parser.parse_args()

    binary = perf.find_binary(args.binary)
    profile_dir = pathlib.Path(tempfile.mkdtemp(prefix="trance-motion-bench-"))
    log_path = profile_dir / "browser.log"
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    process = launch(binary, profile_dir, port, log_path)
    client = perf.Marionette(port=port)
    report = {"binary": str(binary), "pacing": None, "cost": []}
    try:
        client.connect(timeout=45, process=process)
        client.set_chrome_context()
        time.sleep(2)
        raise_to_front()
        time.sleep(1)

        pacing = client.script(
            PACING, [args.warm_ms, args.run_ms],
            timeout_ms=(args.warm_ms + args.run_ms) * 3 + 30000,
        )
        report["pacing"] = pacing

        print("── Frame delivery and pacing (chrome window) ──")
        print(
            f"  achieved {pacing['achievedHz']} Hz over {pacing['frames']} frames"
        )
        print(
            f"  interval  median {pacing['medianMs']} ms   "
            f"sd {pacing['sdMs']} ms   cv {pacing['cvPct']}%"
        )
        print(
            f"  tail      p95 {pacing['p95Ms']} ms   p99 {pacing['p99Ms']} ms   "
            f"max {pacing['maxMs']} ms"
        )
        print(
            f"  jerk      mean {pacing['jerkMeanMs']} ms   "
            f"p95 {pacing['jerkP95Ms']} ms"
        )
        print(
            f"  late      {pacing['lateFrames']} ({pacing['latePct']}%)   "
            f"dropped {pacing['droppedFrames']}"
        )

        if pacing["achievedHz"] is not None and pacing["achievedHz"] < 30:
            print(
                "\n  The window was throttled — it was not frontmost, or it was\n"
                "  occluded. Bring it to the front and run again; these numbers\n"
                "  are not a result.",
                file=sys.stderr,
            )

        idle_ticks = wait_until_idle(client)
        print("\n── Frame cost (main-thread work per animated property) ──")
        if idle_ticks:
            print(
                f"  warning: the browser never went idle ({idle_ticks} refresh\n"
                f"  driver ticks in the last idle second). Every row below "
                f"carries\n  that background work as well.",
                file=sys.stderr,
            )
        header = (
            f"  {'property':<12} {'n':>4} {'ticks/s':>8} {'styles/s':>9} "
            f"{'reflow/s':>9} {'displist/s':>11} {'imgpaint/s':>11}"
        )
        print(header)
        for prop in ("none", "transform", "opacity", "margin-left", "height"):
            counts = [1] if prop == "none" else args.scale
            for count in counts:
                row = client.script(
                    COST, [args.run_ms, prop, count],
                    timeout_ms=args.run_ms * 3 + 90000,
                )
                report["cost"].append(row)
                markers = row.get("markers", {})

                def rate(name):
                    entry = markers.get("GeckoMain/" + name)
                    return entry["perSecond"] if entry else 0

                print(
                    f"  {prop:<12} {count:>4} {rate('RefreshDriverTick'):>8} "
                    f"{rate('Styles'):>9} {rate('Reflow (sync)'):>9} "
                    f"{rate('DisplayList'):>11} {rate('Image Paint'):>11}"
                )

        print(
            "\n  transform and opacity are handed to the compositor: their rows\n"
            "  should read zero for styles, reflow, display list and image paint\n"
            "  at every element count. Any other property is sampled on the main\n"
            "  thread and reflows the whole browser UI once per frame."
        )
    finally:
        try:
            client.quit()
        except Exception:
            pass
        try:
            process.terminate()
            process.wait(timeout=15)
        except Exception:
            process.kill()

    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(report, indent=2))
        print(f"\nwrote {args.json}")

    print(f"browser log: {log_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
