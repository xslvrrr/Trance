#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Trance: the performance regression harness (TRANCE.md §12.2).
#
# Launches a real packaged build against a real profile, drives a scripted
# workload over Marionette, and emits a JSON scorecard against the §12.1
# budgets — which until this script existed were assertions in a document
# rather than numbers taken from a browser.
#
# ── Why a real profile and not a mochitest ────────────────────────────────
#
# The mochitest profile has no enterprise policy, so it has none of the seven
# extensions Trance preinstalls (§9), and no Cosine. Those are the largest
# thing Trance adds to a Zen window, and a harness that cannot see them cannot
# answer the question this phase exists to answer. So: the shipped binary, a
# fresh profile, and the browser that a new user actually gets.
#
# ── Why a hand-written Marionette client ──────────────────────────────────
#
# `engine/testing/marionette/client` is vendored, but its `marionette_driver`
# package wants mozrunner, mozversion and psutil, which live in mach's
# virtualenv rather than in the Python this repo pins. The wire protocol is
# `digit+ ":" json`, a hello frame on connect, and `[0, id, name, params]` out
# / `[1, id, error, result]` back. That is ~80 lines, has no dependencies, and
# does not break the next time mach reorganises its venv.
#
# ── The build you measure, and what it is not ─────────────────────────────
#
# A plain `npm run build` from this tree *is* optimised: Gecko defaults
# `MOZ_OPTIMIZE` on and `MOZ_DEBUG` off when neither is asked for, and the
# objdir confirms `-O3` with `NDEBUG`. The reading of `configs/common/mozconfig`
# that says otherwise — that `--enable-optimize` lives inside
# `if test "$ZEN_RELEASE"`, so a dev build lacks it — is true about the flag and
# wrong about the outcome, because the flag is only restating the default.
#
# Three things a dev build genuinely does not have, in descending order of how
# much they matter here:
#
#   1. `MOZILLA_OFFICIAL` is unset, so `zen.workspaces.debug` defaults *true*
#      (`prefs/zen/workspaces.yaml`: `@cond / !defined(MOZILLA_OFFICIAL)`) and
#      the workspace code paths log. That is real overhead on the exact paths
#      Phase 11 cares about, so the harness profile turns it off explicitly —
#      see `write_profile_prefs`.
#   2. No LTO and no PGO. A constant factor across the whole binary, not a
#      distortion of one subsystem, so it does not change which row of the
#      scorecard is red. It does mean absolute numbers here read slightly worse
#      than a shipped build, and the scorecard records that.
#   3. `--enable-tests`, which is wanted: the same build runs the mochitests.
#
# So this script does not demand a special build. It refuses only on a genuine
# `--enable-debug` build, and stamps the build's provenance either way.
#
# ── Do not leave Cosine installed while running this ──────────────────────
#
# Same reason `scripts/trance-cosine.py` gives for the mochitests: `config.js`
# is autoconfig, it runs with chrome privileges before the UI, and Marionette
# never comes up behind it. `--uninstall` first.
#
# Refs: TRANCE.md §12.1, §12.2, §12.3, §13 Phase 11; docs/trance/DECISIONS.md
#       ADR-034 (the two budgets whose measurement had to be redefined)

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_OBJDIR_GLOB = "engine/obj-*"
MARIONETTE_PORT = 2828

# How long to wait for the browser to answer a Marionette handshake. A cold
# first run installs seven extensions from AMO before it settles.
CONNECT_TIMEOUT_S = 180
COMMAND_TIMEOUT_S = 120


# ───────────────────────────── Marionette ──────────────────────────────────


class MarionetteError(RuntimeError):
    pass


class Marionette:
    """Minimal Marionette client. See the module docstring for why."""

    def __init__(self, port=MARIONETTE_PORT, host="127.0.0.1"):
        self.host = host
        self.port = port
        self.sock = None
        self.buf = b""
        self.msgid = 0

    # -- connection ---------------------------------------------------------

    def connect(self, timeout=CONNECT_TIMEOUT_S):
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            try:
                self.sock = socket.create_connection(
                    (self.host, self.port), timeout=COMMAND_TIMEOUT_S
                )
                hello = self._recv()
                if hello.get("applicationType") != "gecko":
                    raise MarionetteError(f"unexpected peer: {hello!r}")
                self._call("WebDriver:NewSession", {})
                return
            except (ConnectionRefusedError, OSError) as exc:
                last = exc
                if self.sock:
                    self.sock.close()
                    self.sock = None
                time.sleep(0.5)
        raise MarionetteError(f"no Marionette on {self.host}:{self.port}: {last}")

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            finally:
                self.sock = None

    # -- framing ------------------------------------------------------------

    def _recv(self):
        while b":" not in self.buf:
            self._fill()
        length, _, rest = self.buf.partition(b":")
        need = int(length)
        self.buf = rest
        while len(self.buf) < need:
            self._fill()
        body, self.buf = self.buf[:need], self.buf[need:]
        return json.loads(body.decode("utf-8"))

    def _fill(self):
        chunk = self.sock.recv(65536)
        if not chunk:
            raise MarionetteError("connection closed by the browser")
        self.buf += chunk

    def _call(self, name, params):
        self.msgid += 1
        payload = json.dumps([0, self.msgid, name, params]).encode("utf-8")
        self.sock.sendall(str(len(payload)).encode("ascii") + b":" + payload)
        while True:
            frame = self._recv()
            # Anything that is not a response to our id is an out-of-band
            # notification; there is nothing here that needs to read them.
            if isinstance(frame, list) and len(frame) == 4 and frame[1] == self.msgid:
                _, _, error, result = frame
                if error:
                    raise MarionetteError(f"{name}: {error}")
                return result

    # -- API ----------------------------------------------------------------

    def set_chrome_context(self):
        self._call("Marionette:SetContext", {"value": "chrome"})

    def script(self, body, args=None, timeout_ms=COMMAND_TIMEOUT_S * 1000):
        """Runs `body` in the chrome window and returns its value."""
        result = self._call(
            "WebDriver:ExecuteAsyncScript",
            {
                "script": body,
                "args": args or [],
                "newSandbox": False,
                "scriptTimeout": timeout_ms,
            },
        )
        if isinstance(result, dict) and "value" in result:
            return result["value"]
        return result

    def quit(self):
        if not self.sock:
            return
        try:
            self._call("Marionette:Quit", {"flags": ["eForceQuit"]})
        except (MarionetteError, OSError):
            # A browser that has already gone is the outcome we wanted.
            pass


# ─────────────────────────── chrome-side probes ────────────────────────────
#
# Every probe is an async script: it resolves `arguments[arguments.length - 1]`,
# which is Marionette's completion callback.

PROBE_BUILD_CONFIG = """
  const done = arguments[arguments.length - 1];
  const { AppConstants } = ChromeUtils.importESModule(
    "resource://gre/modules/AppConstants.sys.mjs"
  );
  done({
    debugBuild: AppConstants.DEBUG,
    officialBuild: AppConstants.MOZILLA_OFFICIAL,
    version: AppConstants.MOZ_APP_VERSION_DISPLAY,
    workspacesDebug: Services.prefs.getBoolPref("zen.workspaces.debug", false),
    tranceEnabled: Services.prefs.getBoolPref("trance.enabled", false),
    surfacesEnabled: Services.prefs.getBoolPref("trance.surface.enabled", false),
  });
"""

# §12.1 "MutationObserver callbacks per tab open" and "active timers at idle"
# come straight from the counters TranceLog already keeps behind `trance.debug`,
# and the observer/scheduler objects TranceCore hangs off the window.
PROBE_TRANCE_STATE = """
  const done = arguments[arguments.length - 1];
  const core = window.gTrance ?? window.TranceCore ?? null;
  const context = core?.context ?? null;
  // Read through TranceCore, not by importing TranceLog here. TranceCore is
  // imported per-window with `{ global: "current" }`, so the module — and the
  // Map holding the counters — lives in the window's global; an import from
  // this sandbox resolves to a different instance of the same module whose Map
  // has never been written to. That failure is silent: it returns a
  // plausible-looking `{}`. See `nsTranceCore.counters`.
  let counters = {};
  try {
    counters = core?.counters ?? {};
  } catch (e) {
    counters = { error: String(e) };
  }
  done({
    found: !!context,
    counters,
    observerCount: context?.observers?.observerCount ?? null,
    timerCount: context?.scheduler?.timerCount ?? null,
    frameSubscriberCount: context?.scheduler?.frameSubscriberCount ?? null,
    schedulerSuspended: context?.scheduler?.suspended ?? null,
  });
"""

PROBE_RESET_COUNTERS = """
  const done = arguments[arguments.length - 1];
  try {
    // Via TranceCore for the same reason the snapshot is — see PROBE_TRANCE_STATE.
    (window.gTrance ?? window.TranceCore).resetCounters();
    done(true);
  } catch (e) {
    done(String(e));
  }
"""

# ADR-034: WebRender has no layers, and `layers.draw-borders` is a visual
# overlay rather than a count. What §12.1 was reaching for is "how many chrome
# elements force the compositor to keep a separate surface", and that is a
# property of computed style, so it can be counted exactly and gated in CI.
PROBE_COMPOSITOR_SURFACES = """
  const done = arguments[arguments.length - 1];
  const promoting = [];
  const blurred = [];
  const walk = root => {
    for (const el of root.querySelectorAll("*")) {
      // <template> content and anything else parked in an inert document has
      // no defaultView, and nothing without one is being composited.
      const view = el.ownerDocument && el.ownerDocument.defaultView;
      if (!view) {
        continue;
      }
      const cs = view.getComputedStyle(el);
      const reasons = [];
      if (cs.backdropFilter && cs.backdropFilter !== "none") {
        reasons.push("backdrop-filter");
        blurred.push(el.id || el.className || el.localName);
      }
      if (cs.filter && cs.filter !== "none") {
        reasons.push("filter");
      }
      const wc = cs.willChange || "";
      if (/transform|opacity|filter|backdrop-filter/.test(wc)) {
        reasons.push("will-change:" + wc);
      }
      if (cs.transform && cs.transform.startsWith("matrix3d")) {
        reasons.push("transform-3d");
      }
      if (reasons.length) {
        promoting.push({
          id: el.id || null,
          cls: (typeof el.className === "string" ? el.className : "") || null,
          tag: el.localName,
          reasons,
        });
      }
    }
  };
  walk(document);
  done({ surfaces: promoting, backdropFilters: blurred });
"""

PROBE_PROCINFO = """
  const done = arguments[arguments.length - 1];
  ChromeUtils.requestProcInfo().then(info => {
    // `memory` is the resident figure ProcInfo actually reports on macOS.
    // `residentSetSize`/`residentUniqueSize` are documented but come back null
    // here, which is how the first version of this harness measured 0 MB.
    const flatten = p => ({
      type: p.type,
      pid: p.pid,
      memory: p.memory ?? p.residentUniqueSize ?? p.residentSetSize ?? 0,
      cpuTime: p.cpuTime,
      origin: p.origin ?? null,
    });
    done({
      parent: flatten(info),
      children: (info.children ?? []).map(flatten),
    });
  }, e => done({ error: String(e) }));
"""

PROBE_OCCLUSION = """
  const done = arguments[arguments.length - 1];
  done({
    isFullyOccluded: window.isFullyOccluded ?? null,
    windowState: window.windowState ?? null,
    minimized: window.windowState === window.STATE_MINIMIZED,
    hasFocus: document.hasFocus(),
  });
"""


def probe_open_tabs(count):
    return f"""
      const done = arguments[arguments.length - 1];
      const urls = [];
      for (let i = 0; i < {count}; i++) {{
        urls.push("about:blank?trance-perf=" + i);
      }}
      Promise.all(
        urls.map(u => gBrowser.addTab(u, {{
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        }}))
      ).then(() => done(gBrowser.tabs.length), e => done("error: " + e));
    """


# A fresh profile has exactly one space, so this probe used to skip itself and
# the workload never touched the space-switch path at all — the cross-fade this
# harness most wanted to see was the one thing it never ran. It now creates the
# second space it needs. `dontChange` is passed so the creation itself does not
# animate; only the loop below does, and the loop is what gets stamped into the
# profile.
PROBE_SWITCH_SPACES = """
  const done = arguments[arguments.length - 1];
  const rounds = arguments[0];
  const ws = window.gZenWorkspaces;
  if (!ws || typeof ws.changeWorkspace !== "function") {
    done({ skipped: "gZenWorkspaces.changeWorkspace is not available" });
  } else {
    (async () => {
      // `getWorkspaces()` is the live list. An earlier version of this probe
      // asked for `_workspaces()`, which does not exist on gZenWorkspaces — it
      // therefore reported "fewer than two spaces" on every run, including runs
      // where there were plenty, and the space-switch workload never ran at all.
      const read = () =>
        typeof ws.getWorkspaces === "function" ? ws.getWorkspaces() : [];
      let list = read();
      let created = false;
      if (list.length < 2) {
        if (typeof ws.createAndSaveWorkspace !== "function") {
          return { skipped: "one space, and no way to create a second" };
        }
        await ws.createAndSaveWorkspace("Trance perf", undefined, true);
        created = true;
        list = read();
        if (list.length < 2) {
          return { skipped: "the second space was not created" };
        }
      }
      // Whether the background cross-fade actually reaches the compositor
      // (ADR-038). Sampled per frame across the switches rather than asserted
      // once, because an animation is not handed to the compositor until a
      // frame carrying it has been painted — the first sample of any of them
      // is false, and so is the last.
      //
      // `Animation.isRunningOnCompositor` is chrome-only and is the only
      // instrument that answers this. `nsIDOMWindowUtils.getOMTAStyle` returns
      // "" under WebRender even for an animation that is demonstrably
      // compositing, checked against a plain element as a control, so it
      // cannot be used.
      const bg = document.getElementById("zen-browser-background");
      const tb = document.getElementById("zen-toolbar-background");
      const fade = { sampled: 0, onCompositor: 0, pseudos: [] };
      let sampling = true;
      const sample = () => {
        if (!sampling) { return; }
        for (const el of [bg, tb]) {
          for (const a of el?.getAnimations({ subtree: true }) ?? []) {
            const pseudo = a.effect?.pseudoElement;
            if (!pseudo) { continue; }
            fade.sampled++;
            if (a.isRunningOnCompositor) {
              fade.onCompositor++;
              if (!fade.pseudos.includes(pseudo)) { fade.pseudos.push(pseudo); }
            }
          }
        }
        window.requestAnimationFrame(sample);
      };
      window.requestAnimationFrame(sample);

      ChromeUtils.addProfilerMarker("TrancePerf:SpaceSwitchStart");
      for (let i = 0; i < rounds; i++) {
        await ws.changeWorkspace(list[i % list.length]);
        await new Promise(r => window.setTimeout(r, 400));
      }
      ChromeUtils.addProfilerMarker("TrancePerf:SpaceSwitchEnd");
      sampling = false;

      // The resting state the switch has to leave behind: the variable back in
      // charge, the incoming layer opaque, the outgoing one gone, and no
      // filled-forever pseudo-element animation left holding either of them.
      const resting = {};
      for (const el of [bg, tb]) {
        if (!el) { continue; }
        resting[el.id] = {
          variable: el.style.getPropertyValue("--zen-background-opacity"),
          after: window.getComputedStyle(el, "::after").opacity,
          before: window.getComputedStyle(el, "::before").opacity,
          leftoverAnimations: el.getAnimations({ subtree: true })
            .filter(a => a.effect?.pseudoElement).length,
        };
      }
      return {
        rounds,
        spaces: list.length,
        createdSecondSpace: created,
        fade,
        resting,
      };
    })().then(done, e => done({ error: String(e) }));
  }
"""

# 120 chrome frames with the tab strip scrolling under them. The workload only
# needs the compositor to be doing work; it does not need a content script to
# observe it, so everything here stays in the chrome window.
PROBE_SCROLL = """
  const done = arguments[arguments.length - 1];
  const strip = document.getElementById("tabbrowser-arrowscrollbox");
  // Time-bounded, not frame-bounded. A frame-counting loop hangs forever the
  // moment the window stops painting — which is exactly what happens when
  // another application covers it, and on this machine the terminal running
  // the harness does. Counting frames inside a fixed wall-clock window turns
  // that hang into the measurement: 0 frames in 2s *is* the occlusion result.
  const DURATION_MS = 2000;
  const started = Date.now();
  let n = 0;
  const step = () => {
    window.requestAnimationFrame(() => {
      n++;
      if (strip) {
        strip.scrollTop = (n % 2) ? 400 : 0;
      }
      if (Date.now() - started < DURATION_MS) {
        step();
      }
    });
  };
  step();
  window.setTimeout(() => done({ frames: n, durationMs: Date.now() - started }),
                    DURATION_MS + 500);
"""

# The minimised window is stamped into the Gecko profile from inside the
# browser, so `composite_markers_minimized` can be counted against the same
# clock the Composite markers use. Wall-clock time from this script is a
# different clock and cannot be compared to profile timestamps.
PROBE_MINIMIZE = """
  const done = arguments[arguments.length - 1];
  ChromeUtils.addProfilerMarker("TrancePerf:MinimizeStart");
  window.minimize();
  window.setTimeout(() => done(window.windowState === window.STATE_MINIMIZED), 500);
"""

PROBE_RESTORE = """
  const done = arguments[arguments.length - 1];
  ChromeUtils.addProfilerMarker("TrancePerf:MinimizeEnd");
  window.restore();
  window.setTimeout(() => done(window.windowState), 500);
"""

PROBE_RESIZE = """
  const done = arguments[arguments.length - 1];
  const w = window.outerWidth;
  const h = window.outerHeight;
  let i = 0;
  const step = () => {
    if (i++ >= 10) {
      window.resizeTo(w, h);
      done(i);
      return;
    }
    window.resizeTo(w - (i % 2 ? 200 : 0), h - (i % 2 ? 120 : 0));
    window.setTimeout(step, 150);
  };
  step();
"""


# ────────────────────────────── the budgets ────────────────────────────────
#
# TRANCE.md §12.1, verbatim in intent. `measured_as` is what this script
# actually reads, which for two rows is not what §12.1 says — see ADR-034.

BUDGETS = [
    {
        "id": "compositor_surfaces_idle",
        "budget": "<= 6",
        "limit": 6,
        "compare": "lte",
        "measured_as": "chrome elements whose computed style forces a compositor "
        "surface (ADR-034 replacement for the layers.draw-borders count)",
    },
    {
        "id": "backdrop_filter_surfaces",
        "budget": "<= 3, never nested",
        "limit": 3,
        "compare": "lte",
        "measured_as": "chrome elements with a non-none computed backdrop-filter",
    },
    {
        "id": "idle_cpu_percent_focused",
        "budget": "< 0.5",
        "limit": 0.5,
        "compare": "lt",
        "measured_as": "parent-process cpuTime delta over the idle window, as a "
        "percentage of one core",
    },
    {
        "id": "idle_cpu_percent_minimized",
        "budget": "~ 0",
        "limit": 0.2,
        "compare": "lte",
        "measured_as": "same, while minimised. ADR-034: minimise is the scripted "
        "proxy for occlusion; true occlusion needs a second application",
    },
    {
        "id": "composite_markers_minimized",
        "budget": "0",
        "limit": 0,
        "compare": "lte",
        "measured_as": "Composite markers on the Renderer/Compositor thread during "
        "the minimised window",
    },
    {
        "id": "style_flush_tab_switch_ms",
        "budget": "< 2",
        "limit": 2.0,
        "compare": "lt",
        "measured_as": "longest Styles/RestyleDocument marker within 250ms of a "
        "TabSelect",
    },
    {
        "id": "style_flush_space_switch_ms",
        "budget": "< 2",
        "limit": 2.0,
        "compare": "lt",
        "measured_as": "longest Styles/RestyleDocument marker inside the space-"
        "switch window. Not a §12.1 row; added with ADR-038, because the "
        "cross-fade it measures used to be a per-frame main-thread restyle and "
        "a row with no number behind it cannot show that it stopped being one",
    },
    {
        "id": "space_switch_on_compositor",
        "budget": "2",
        "limit": 2,
        "compare": "gte",
        "measured_as": "how many of the cross-fade's two pseudo-elements were "
        "seen running on the compositor during the space switches "
        "(Animation.isRunningOnCompositor). Both, or the animation is back on "
        "the main thread and ADR-038 has been undone",
    },
    {
        "id": "style_total_space_switch_ms",
        "budget": "record only",
        "limit": None,
        "compare": None,
        "measured_as": "sum of every Styles/RestyleDocument marker inside the "
        "space-switch window. The row above is a worst frame; this one is the "
        "whole animation, and it is the one that moves when a per-frame restyle "
        "stops happening at all (ADR-038)",
    },
    {
        "id": "mutation_callbacks_per_tab_open",
        "budget": "<= 2",
        "limit": 2.0,
        "compare": "lte",
        "measured_as": "TranceLog observer.mutation.callbacks delta / tabs opened",
    },
    {
        "id": "trance_timers_at_idle",
        "budget": "0",
        "limit": 0,
        "compare": "lte",
        "measured_as": "TranceScheduler.timerCount + frameSubscriberCount at idle",
    },
    {
        "id": "resident_mb_one_tab",
        "budget": "record only",
        "limit": None,
        "compare": None,
        "measured_as": "sum of residentUniqueSize across all processes, 1 tab. "
        "Not a §12.1 row; added in Phase 11 because the memory claim needs one",
    },
    {
        "id": "resident_mb_twenty_tabs",
        "budget": "record only",
        "limit": None,
        "compare": None,
        "measured_as": "same, after the 20-tab workload",
    },
]


def evaluate(value, budget):
    if value is None or budget["compare"] is None:
        return "recorded"
    if budget["compare"] == "lte":
        return "green" if value <= budget["limit"] else "red"
    # "gte" is the one row where more is better — see space_switch_on_compositor.
    if budget["compare"] == "gte":
        return "green" if value >= budget["limit"] else "red"
    return "green" if value < budget["limit"] else "red"


# ───────────────────────────── profile parsing ─────────────────────────────


def load_profile(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def iter_markers(profile):
    """Yields (thread_name, marker_name, start_ms, end_ms) for every marker.

    Two things about the format that are easy to get wrong, and were:

    - The string pool is `thread["stringTable"]` in the profiles this build
      writes. Newer formats hoist it to `profile["shared"]["stringArray"]`, so
      both are tried; looking only for the newer one yields no markers at all
      and reads as "the markers were never emitted".
    - A shutdown profile nests every child process under `profile["processes"]`
      as a complete profile of its own. The parent's `threads` alone is six
      threads out of fourteen processes, and the Compositor markers this needs
      may be in either.

    Marker fields are parallel arrays, so column indices come from the table's
    own schema rather than being assumed.
    """
    profiles = [profile]
    profiles.extend(profile.get("processes", []) or [])
    for sub in profiles:
        shared_strings = (sub.get("shared") or {}).get("stringArray") or []
        for thread in sub.get("threads", []):
            name = thread.get("name", "?")
            markers = thread.get("markers", {})
            schema = markers.get("schema", {})
            strings = thread.get("stringTable") or shared_strings
            i_name = schema.get("name", 0)
            i_start = schema.get("startTime", 1)
            i_end = schema.get("endTime", 2)
            for row in markers.get("data", []):
                try:
                    label = strings[row[i_name]]
                except (IndexError, TypeError, KeyError):
                    continue
                yield name, label, row[i_start], row[i_end]


def marker_window(profile, name):
    """(start, end) in profile time, from a pair of TrancePerf:<name>{Start,End}."""
    start = end = None
    for _thread, label, m_start, _m_end in iter_markers(profile):
        if label == f"TrancePerf:{name}Start":
            start = m_start
        elif label == f"TrancePerf:{name}End":
            end = m_start
    if start is None or end is None or end <= start:
        return None
    return (start, end)


def minimized_window(profile):
    """(start, end) in profile time, from the markers PROBE_MINIMIZE stamps."""
    return marker_window(profile, "Minimize")


def count_composites(profile, window):
    """Composite markers on the compositor/renderer threads inside `window`.

    Returns None — not 0 — when the profile contains no Composite markers at
    all. Those are two completely different findings: "the compositor did no
    work while minimised", which is the budget being met, and "the compositor
    threads were never sampled", which is the budget not being measured. A
    harness that reports the second as the first is worse than one that reports
    nothing, because it manufactures a green row.
    """
    if window is None:
        return None
    start, end = window
    if start is None:
        return None
    total = 0
    seen_any = False
    for thread, label, m_start, m_end in iter_markers(profile):
        if "Compositor" not in thread and "Renderer" not in thread:
            continue
        if not label.startswith("Composite"):
            continue
        seen_any = True
        at = m_start if m_start is not None else m_end
        if at is not None and start <= at <= end:
            total += 1
    return total if seen_any else None


def longest_style_flush_near_tab_switch(profile):
    """Longest Styles marker within 250 ms after any TabSelect-ish marker."""
    switches = []
    styles = []
    for _thread, label, m_start, m_end in iter_markers(profile):
        if m_start is None:
            continue
        if "TabSelect" in label or label == "AsyncTabSwitch:Start":
            switches.append(m_start)
        elif label in ("Styles", "RestyleDocument", "Restyle"):
            if m_end is not None:
                styles.append((m_start, m_end - m_start))
    if not switches or not styles:
        return None
    worst = 0.0
    for switch_at in switches:
        for style_at, duration in styles:
            if switch_at <= style_at <= switch_at + 250:
                worst = max(worst, duration)
    return round(worst, 3) if worst else None


def style_flushes_in(profile, window):
    """(longest, total) Styles-marker milliseconds inside `window`.

    Both, because they answer different questions about the same animation. The
    longest is the worst single frame, which is what a budget can be written
    against. The total is the whole animation's main-thread style cost, and it
    is the one that collapses when a per-frame restyle stops happening at all —
    a change that moves an opacity animation onto the compositor barely moves
    the worst frame, because the worst frame is usually the DOM work at the
    start of the switch, not the fade (ADR-038).

    Returns (None, None) when the window is missing or the profile has no style
    markers at all. See `count_composites` for why that is not a pair of zeroes.
    """
    if window is None:
        return (None, None)
    start, end = window
    worst = 0.0
    total = 0.0
    seen_any = False
    for _thread, label, m_start, m_end in iter_markers(profile):
        if label not in ("Styles", "RestyleDocument", "Restyle"):
            continue
        if m_start is None or m_end is None:
            continue
        seen_any = True
        if start <= m_start <= end:
            duration = m_end - m_start
            worst = max(worst, duration)
            total += duration
    if not seen_any:
        return (None, None)
    return (round(worst, 3), round(total, 3))


# ──────────────────────────────── the run ──────────────────────────────────


def find_binary(explicit):
    if explicit:
        path = Path(explicit)
        if not path.exists():
            sys.exit(f"trance-perf: no binary at {path}")
        return path
    # The objdir keeps more than one bundle — `Nightly.app` is Gecko's default
    # name and is still produced alongside the branded one. Measuring it would
    # silently measure the wrong browser, so the branded binary wins outright
    # and the fallbacks are only for a tree that has been rebranded again.
    for name in ("trance", "zen", "firefox"):
        for candidate in sorted(
            REPO.glob(f"{DEFAULT_OBJDIR_GLOB}/dist/*.app/Contents/MacOS/{name}")
        ):
            if candidate.is_file():
                return candidate
    for candidate in sorted(REPO.glob(f"{DEFAULT_OBJDIR_GLOB}/dist/bin/firefox")):
        if candidate.is_file():
            return candidate
    sys.exit(
        "trance-perf: could not find a built binary. Pass --binary, or run\n"
        "  npm run import && npm run build"
    )


def write_profile_prefs(profile_dir, extensions_mode, trance_enabled):
    """user.js for the throwaway profile.

    Deliberately minimal: the point is to measure the browser a user gets, so
    anything set here has to earn it. Marionette needs its port; the rest is
    either about not measuring the network (`--extensions none`) or about the
    A/B that isolates Trance's own cost.
    """
    lines = [
        '// Generated by scripts/trance-perf.py. Do not edit.',
        f'user_pref("marionette.port", {MARIONETTE_PORT});',
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.startup.homepage_override.mstone", "ignore");',
        'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
        'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
        # The counters the §12.1 observer and timer rows are read from.
        'user_pref("trance.debug", true);',
        # A dev build has no MOZILLA_OFFICIAL, so this defaults true and Zen's
        # workspace code logs on the paths this harness measures. See the
        # module docstring.
        'user_pref("zen.workspaces.debug", false);',
        'user_pref("zen.session-store.log", false);',
    ]
    if not trance_enabled:
        lines.append('user_pref("trance.enabled", false);')
    if extensions_mode == "none":
        lines.append('user_pref("extensions.installDistroAddons", false);')
        lines.append('user_pref("extensions.autoDisableScopes", 15);')
    (profile_dir / "user.js").write_text("\n".join(lines) + "\n", encoding="utf-8")


def launch(binary, profile_dir, gecko_profile_path, extra_env=None, log_path=None):
    env = dict(os.environ)
    env.update(
        {
            "MOZ_PROFILER_STARTUP": "1",
            "MOZ_PROFILER_STARTUP_FEATURES": "js,stackwalk,cpu,memory",
            # Without an explicit filter the compositor threads are not
            # sampled, the profile contains no Composite markers at all, and
            # the "GPU frames while minimised" row silently reads 0.
            "MOZ_PROFILER_STARTUP_FILTERS": "GeckoMain,Compositor,Renderer",
            "MOZ_PROFILER_STARTUP_INTERVAL": "2",
            "MOZ_PROFILER_SHUTDOWN": str(gecko_profile_path),
            # A crash reporter dialog would hang the run forever.
            "MOZ_CRASHREPORTER_DISABLE": "1",
        }
    )
    if extra_env:
        env.update(extra_env)
    # The browser's own output is the only diagnosis available when Marionette
    # never comes up — which is what an autoconfig `config.js` left behind by
    # trance-cosine.py looks like from out here. Keeping it is the difference
    # between a fixable failure and "timed out".
    # `--marionette` alone does not start the server in this build; `MOZ_MARIONETTE`
    # is what Gecko actually checks, and without it the port never opens and the
    # only symptom is a connect timeout. `-remote-allow-system-access` is required
    # for `Marionette:SetContext` to accept "chrome" — every probe here runs in
    # the chrome window, so without it the session connects and then refuses
    # everything with "System access is required".
    env["MOZ_MARIONETTE"] = "1"
    sink = open(log_path, "wb") if log_path else subprocess.DEVNULL
    return subprocess.Popen(
        [
            str(binary),
            "--profile",
            str(profile_dir),
            "--no-remote",
            "--marionette",
            "-remote-allow-system-access",
        ],
        env=env,
        stdout=sink,
        stderr=subprocess.STDOUT if log_path else subprocess.DEVNULL,
    )


def cpu_percent(before, after, seconds):
    """cpuTime is nanoseconds of CPU across the process tree."""
    if before is None or after is None or not seconds:
        return None
    delta_ns = after - before
    return round((delta_ns / 1e9) / seconds * 100.0, 3)


def total_cpu_ns(procinfo):
    if not procinfo or "error" in procinfo:
        return None
    total = procinfo["parent"].get("cpuTime") or 0
    for child in procinfo.get("children", []):
        total += child.get("cpuTime") or 0
    return total


def _by_pid(procinfo):
    if not procinfo or "error" in procinfo:
        return {}
    entries = [procinfo["parent"], *procinfo.get("children", [])]
    return {entry.get("pid"): entry for entry in entries}


def cpu_by_process(before, after, seconds):
    """Per-process share of one core, busiest first, so a red row names names."""
    old, new = _by_pid(before), _by_pid(after)
    rows = []
    for pid, entry in new.items():
        was = old.get(pid, {}).get("cpuTime")
        percent = cpu_percent(was, entry.get("cpuTime"), seconds)
        if percent:
            rows.append(
                {
                    "pid": pid,
                    "type": entry.get("type"),
                    "origin": entry.get("origin"),
                    "percent": percent,
                }
            )
    rows.sort(key=lambda row: row["percent"], reverse=True)
    return rows[:10]


def resident_by_process(procinfo):
    rows = [
        {
            "pid": entry.get("pid"),
            "type": entry.get("type"),
            "origin": entry.get("origin"),
            "mb": round((entry.get("memory") or 0) / (1024 * 1024), 1),
        }
        for entry in _by_pid(procinfo).values()
    ]
    rows.sort(key=lambda row: row["mb"], reverse=True)
    return rows[:12]


def total_resident_mb(procinfo):
    if not procinfo or "error" in procinfo:
        return None
    total = procinfo["parent"].get("memory") or 0
    for child in procinfo.get("children", []):
        total += child.get("memory") or 0
    return round(total / (1024 * 1024), 1)


def wait_until_quiet(client, args):
    """Blocks until the process tree stops burning CPU, or the timeout expires.

    Returns what happened, so a browser that never goes quiet is reported as
    that rather than silently folded into the idle figure.
    """
    sample_s = 5
    quiet_streak = 0
    history = []
    deadline = time.monotonic() + args.settle_timeout
    previous = total_cpu_ns(client.script(PROBE_PROCINFO))
    previous_at = time.monotonic()

    while time.monotonic() < deadline:
        time.sleep(sample_s)
        now = time.monotonic()
        current = total_cpu_ns(client.script(PROBE_PROCINFO))
        percent = cpu_percent(previous, current, now - previous_at)
        history.append(percent)
        previous, previous_at = current, now
        if percent is not None and percent < args.settle_threshold:
            quiet_streak += 1
            if quiet_streak >= 2:
                return {"settled": True, "samples": history}
        else:
            quiet_streak = 0

    return {"settled": False, "samples": history}


def run_workload(client, args, results):
    """The §12.2 workload, recording what each budget row needs as it goes.

    A step that throws records the failure and the run continues. Half a
    scorecard with a named gap in it is worth more than no scorecard, and the
    steps are deliberately ordered so the cheap universal measurements happen
    before the ones that depend on a particular window arrangement.
    """

    def step(name, body, default=None):
        try:
            return body()
        except MarionetteError as exc:
            print(f"  ! {name} failed: {exc}")
            results.setdefault("failedSteps", []).append(f"{name}: {exc}")
            return default

    client.set_chrome_context()

    results["build"] = client.script(PROBE_BUILD_CONFIG)
    results["trance_initial"] = client.script(PROBE_TRANCE_STATE)

    # --- settle -----------------------------------------------------------
    #
    # A browser that has just started is not idle: it is restoring a session,
    # installing seven extensions from AMO, building its places database and
    # painting a first-run panel. The first version of this harness measured
    # that window and reported 74% of a core as the *idle* figure, which is a
    # true number about the wrong thing.
    #
    # So: wait for the CPU to stop moving before starting the clock. Two
    # consecutive quiet samples, or `--settle-timeout` seconds, whichever comes
    # first — and the scorecard records which of the two it was, because "never
    # went quiet" is itself the answer to a §12.1 question.
    print(f"  settling (up to {args.settle_timeout}s)...")
    results["settle"] = wait_until_quiet(client, args)

    # --- idle, focused, one tab -------------------------------------------
    print(f"  idle, focused, 1 tab ({args.idle}s)...")
    before = client.script(PROBE_PROCINFO)
    idle_start = time.monotonic()
    time.sleep(args.idle)
    after = client.script(PROBE_PROCINFO)
    elapsed = time.monotonic() - idle_start
    results["idle_cpu_percent_focused"] = cpu_percent(
        total_cpu_ns(before), total_cpu_ns(after), elapsed
    )
    # A red idle row is only useful if it says which process was busy.
    results["idle_cpu_by_process"] = cpu_by_process(before, after, elapsed)
    results["resident_mb_one_tab"] = total_resident_mb(after)
    results["resident_mb_by_process"] = resident_by_process(after)
    results["surfaces_idle"] = client.script(PROBE_COMPOSITOR_SURFACES)
    results["trance_at_idle"] = client.script(PROBE_TRANCE_STATE)

    # --- open 20 tabs ------------------------------------------------------
    print(f"  opening {args.tabs} tabs...")
    client.script(PROBE_RESET_COUNTERS)
    results["tabs_after_open"] = client.script(probe_open_tabs(args.tabs))
    time.sleep(3)
    opened = client.script(PROBE_TRANCE_STATE)
    results["trance_after_tabs"] = opened
    callbacks = (opened.get("counters") or {}).get("observer.mutation.callbacks")
    if callbacks is not None and args.tabs:
        results["mutation_callbacks_per_tab_open"] = round(callbacks / args.tabs, 3)
    results["resident_mb_twenty_tabs"] = total_resident_mb(
        client.script(PROBE_PROCINFO)
    )

    # --- switch spaces -----------------------------------------------------
    print("  switching spaces...")
    results["spaces"] = step(
        "space switching",
        lambda: client.script(PROBE_SWITCH_SPACES, args=[args.space_switches]),
    )

    # --- resize and scroll -------------------------------------------------
    print("  resizing and scrolling...")
    results["resize"] = step("resize", lambda: client.script(PROBE_RESIZE))
    results["scroll_frames"] = step("scroll", lambda: client.script(PROBE_SCROLL))

    # --- minimised ---------------------------------------------------------
    print(f"  minimised ({args.idle}s)...")
    results["occlusion_before_minimize"] = client.script(PROBE_OCCLUSION)
    step("minimize", lambda: client.script(PROBE_MINIMIZE))
    before = client.script(PROBE_PROCINFO)
    min_wall_start = time.monotonic()
    time.sleep(args.idle)
    after = client.script(PROBE_PROCINFO)
    elapsed = time.monotonic() - min_wall_start
    results["idle_cpu_percent_minimized"] = cpu_percent(
        total_cpu_ns(before), total_cpu_ns(after), elapsed
    )
    results["occlusion_while_minimized"] = client.script(PROBE_OCCLUSION)
    results["trance_while_minimized"] = client.script(PROBE_TRANCE_STATE)
    step("restore", lambda: client.script(PROBE_RESTORE))

    return results


def build_scorecard(results, profile_data, notes):
    idle = results.get("trance_at_idle") or {}
    timers = idle.get("timerCount")
    frames = idle.get("frameSubscriberCount")
    trance_timers = None
    if timers is not None and frames is not None:
        trance_timers = timers + frames

    # Distinct pseudo-elements seen compositing, not a sample count: the number
    # that means something is "both layers made it", and two runs of different
    # length must produce the same value for the same outcome.
    spaces = results.get("spaces") or {}
    fade = spaces.get("fade") if isinstance(spaces, dict) else None
    on_compositor = len(fade.get("pseudos", [])) if isinstance(fade, dict) else None

    surfaces = results.get("surfaces_idle") or {}
    measured = {
        "compositor_surfaces_idle": len(surfaces.get("surfaces", []))
        if surfaces
        else None,
        "backdrop_filter_surfaces": len(surfaces.get("backdropFilters", []))
        if surfaces
        else None,
        "idle_cpu_percent_focused": results.get("idle_cpu_percent_focused"),
        "idle_cpu_percent_minimized": results.get("idle_cpu_percent_minimized"),
        "composite_markers_minimized": results.get("composite_markers_minimized"),
        "style_flush_tab_switch_ms": results.get("style_flush_tab_switch_ms"),
        "style_flush_space_switch_ms": results.get("style_flush_space_switch_ms"),
        "space_switch_on_compositor": on_compositor,
        "style_total_space_switch_ms": results.get("style_total_space_switch_ms"),
        "mutation_callbacks_per_tab_open": results.get(
            "mutation_callbacks_per_tab_open"
        ),
        "trance_timers_at_idle": trance_timers,
        "resident_mb_one_tab": results.get("resident_mb_one_tab"),
        "resident_mb_twenty_tabs": results.get("resident_mb_twenty_tabs"),
    }

    rows = []
    for budget in BUDGETS:
        value = measured.get(budget["id"])
        rows.append(
            {
                "id": budget["id"],
                "budget": budget["budget"],
                "value": value,
                "verdict": evaluate(value, budget),
                "measured_as": budget["measured_as"],
            }
        )

    return {
        "schema": 1,
        "build": results.get("build"),
        "notes": notes,
        "geckoProfile": bool(profile_data),
        "rows": rows,
        "detail": {
            "surfaces": surfaces.get("surfaces", []),
            "backdropFilters": surfaces.get("backdropFilters", []),
            "spaces": results.get("spaces"),
            "occlusion": {
                "beforeMinimize": results.get("occlusion_before_minimize"),
                "whileMinimized": results.get("occlusion_while_minimized"),
            },
            "tranceAtIdle": idle,
            "tranceWhileMinimized": results.get("trance_while_minimized"),
            "settle": results.get("settle"),
            "idleCpuByProcess": results.get("idle_cpu_by_process"),
            "residentByProcess": results.get("resident_mb_by_process"),
            "failedSteps": results.get("failedSteps"),
        },
    }


def print_scorecard(card):
    width = max(len(row["id"]) for row in card["rows"])
    print("\n  §12.1 scorecard")
    print("  " + "-" * (width + 34))
    for row in card["rows"]:
        mark = {"green": "PASS", "red": "FAIL", "recorded": " -- "}[row["verdict"]]
        value = "n/a" if row["value"] is None else row["value"]
        print(f"  [{mark}] {row['id']:<{width}}  {value}   (budget {row['budget']})")
    print()


def note_unrested_cross_fade(results, notes):
    """The cross-fade's resting state, as a note rather than a budget row.

    A space switch that leaves a pseudo-element animation filled forever, or
    leaves the wrong layer opaque, is a visual bug — and it is a visual bug that
    every timing row on the scorecard would happily call an improvement, since
    an animation that never ran is the fastest animation there is. ADR-038.
    """
    resting = (results.get("spaces") or {}).get("resting") or {}
    for element_id, state in resting.items():
        if (
            state.get("leftoverAnimations")
            or state.get("after") != "1"
            or state.get("before") != "0"
        ):
            notes.append(
                f"{element_id} did not come to rest after the space switches: "
                f"{state} — expected after=1, before=0, no leftover animations"
            )


def diff_baseline(card, baseline_path):
    if not baseline_path or not Path(baseline_path).exists():
        return []
    with open(baseline_path, "r", encoding="utf-8") as handle:
        baseline = json.load(handle)
    previous = {row["id"]: row["value"] for row in baseline.get("rows", [])}
    directions = {budget["id"]: budget["compare"] for budget in BUDGETS}
    regressions = []
    for row in card["rows"]:
        was, now = previous.get(row["id"]), row["value"]
        if was is None or now is None or not isinstance(now, (int, float)):
            continue
        # Every other row is a cost, where up is worse. `gte` rows are counts of
        # something wanted, where *down* is worse, so any drop at all is the
        # regression — there is no drift to tolerate in "two of two".
        if directions.get(row["id"]) == "gte":
            if now < was:
                regressions.append((row["id"], was, now))
            continue
        # 10% or the budget's own granularity, whichever is looser: this is a
        # gate against drift, not a stopwatch.
        if now > was * 1.10 and now - was > 0.05:
            regressions.append((row["id"], was, now))
    return regressions


def main():
    parser = argparse.ArgumentParser(
        description="Trance performance harness (TRANCE.md §12.2)."
    )
    parser.add_argument("--binary", help="Path to the built browser binary.")
    parser.add_argument(
        "--baseline",
        default=str(REPO / "docs/trance/perf-baseline.json"),
        help="Scorecard to diff against. Missing file means no diff.",
    )
    parser.add_argument("--out", help="Write the scorecard here (default: stdout only).")
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="Overwrite --baseline with this run.",
    )
    parser.add_argument("--tabs", type=int, default=20)
    parser.add_argument("--space-switches", type=int, default=10)
    parser.add_argument(
        "--idle", type=int, default=60, help="Seconds per idle sample (§12.2 says 60)."
    )
    parser.add_argument(
        "--settle-timeout",
        type=int,
        default=120,
        help="Seconds to wait for startup work to finish before the idle sample.",
    )
    parser.add_argument(
        "--settle-threshold",
        type=float,
        default=5.0,
        help="Percent of one core below which the browser counts as quiet.",
    )
    parser.add_argument(
        "--extensions",
        choices=["all", "none"],
        default="all",
        help="'none' disables the distribution add-ons, for the ablation.",
    )
    parser.add_argument(
        "--disable-trance",
        action="store_true",
        help="Run with trance.enabled=false, for the zero-cost A/B.",
    )
    parser.add_argument(
        "--allow-debug-build",
        action="store_true",
        help="Record a scorecard even from an --enable-debug build.",
    )
    parser.add_argument("--keep-profile", action="store_true")
    args = parser.parse_args()

    binary = find_binary(args.binary)
    profile_dir = Path(tempfile.mkdtemp(prefix="trance-perf-profile-"))
    gecko_profile = profile_dir.parent / f"{profile_dir.name}.profile.json"

    print(f"trance-perf: binary   {binary}")
    print(f"trance-perf: profile  {profile_dir}")

    write_profile_prefs(profile_dir, args.extensions, not args.disable_trance)

    browser_log = profile_dir.parent / f"{profile_dir.name}.browser.log"
    print(f"trance-perf: log      {browser_log}")
    proc = launch(binary, profile_dir, gecko_profile, log_path=browser_log)
    client = Marionette()
    results = {}
    notes = []
    exit_code = 0

    try:
        print("trance-perf: waiting for Marionette...")
        try:
            client.connect()
        except MarionetteError:
            if browser_log.exists():
                tail = browser_log.read_text(errors="replace").splitlines()[-25:]
                print("\ntrance-perf: the browser said:")
                for line in tail:
                    print(f"  | {line}")
            print(
                "\ntrance-perf: if this is a fresh checkout, check that "
                "scripts/trance-cosine.py has been --uninstall'd: its config.js "
                "runs before the UI and Marionette never comes up behind it.\n"
            )
            raise
        print("trance-perf: connected. Running the workload.")
        run_workload(client, args, results)
        note_unrested_cross_fade(results, notes)

        build = results.get("build") or {}
        if build.get("debugBuild"):
            message = (
                "this is an --enable-debug build; its numbers describe a browser "
                "nobody ships"
            )
            notes.append(message)
            if not args.allow_debug_build:
                print(f"\ntrance-perf: refusing to record. {message}")
                print("trance-perf: pass --allow-debug-build to record it anyway.\n")
                exit_code = 2
        if not build.get("officialBuild"):
            # Not a refusal: optimisation is on by default and the one pref this
            # actually changed is already overridden in the harness profile.
            notes.append(
                "MOZILLA_OFFICIAL is unset (dev build): no LTO and no PGO, so "
                "absolute numbers read slightly worse than a shipped build. "
                "zen.workspaces.debug and zen.session-store.log are forced off in "
                "the harness profile so they do not also contribute."
            )
        if args.extensions != "all":
            notes.append(f"extensions={args.extensions}")
        if args.disable_trance:
            notes.append("trance.enabled=false")
    finally:
        # This block runs on every path out, including a connect timeout. An
        # earlier version let an exception past `client.quit()` and left a
        # browser and its eleven content processes running against a temp
        # profile, which then made the next run look like a different bug.
        try:
            client.quit()
        finally:
            client.close()
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                pass

    profile_data = None
    if gecko_profile.exists():
        try:
            profile_data = load_profile(gecko_profile)
        except (json.JSONDecodeError, OSError) as exc:
            notes.append(f"gecko profile unreadable: {exc}")
    else:
        notes.append("no gecko profile was written at shutdown")

    if profile_data:
        results["style_flush_tab_switch_ms"] = longest_style_flush_near_tab_switch(
            profile_data
        )
        switch_window = marker_window(profile_data, "SpaceSwitch")
        (
            results["style_flush_space_switch_ms"],
            results["style_total_space_switch_ms"],
        ) = style_flushes_in(profile_data, switch_window)
        if switch_window is None:
            notes.append(
                "the TrancePerf:SpaceSwitch markers are not in the profile, so "
                "style_flush_space_switch_ms was not measured — the space probe "
                "skipped, or the profile lost the markers"
            )
        window = minimized_window(profile_data)
        results["composite_markers_minimized"] = count_composites(profile_data, window)
        if window is None:
            notes.append(
                "the TrancePerf:Minimize markers are not in the profile, so "
                "composite_markers_minimized was not measured"
            )
        elif results["composite_markers_minimized"] is None:
            notes.append(
                "the profile contains no Composite markers on any thread, so "
                "composite_markers_minimized was not measured — this is not a "
                "zero. Check MOZ_PROFILER_STARTUP_FILTERS."
            )

    card = build_scorecard(results, profile_data, notes)
    print_scorecard(card)
    for note in notes:
        print(f"  note: {note}")

    regressions = diff_baseline(card, args.baseline)
    for name, was, now in regressions:
        print(f"  REGRESSION {name}: {was} -> {now}")
        exit_code = max(exit_code, 1)

    if args.out:
        Path(args.out).write_text(json.dumps(card, indent=2) + "\n", encoding="utf-8")
        print(f"\ntrance-perf: scorecard written to {args.out}")
    if args.write_baseline and exit_code == 0:
        Path(args.baseline).write_text(
            json.dumps(card, indent=2) + "\n", encoding="utf-8"
        )
        print(f"trance-perf: baseline written to {args.baseline}")

    if not args.keep_profile:
        shutil.rmtree(profile_dir, ignore_errors=True)
        if gecko_profile.exists():
            gecko_profile.unlink()
    else:
        print(f"trance-perf: kept {profile_dir} and {gecko_profile}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
