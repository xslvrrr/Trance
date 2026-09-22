/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_compact_mode_suspends_hidden_activity() {
  const manager = gZenCompactModeManager;
  const toolbox = document.getElementById("navigator-toolbox");
  const marker = document.createXULElement("toolbarbutton");

  toolbox.setAttribute("zen-has-hover", "true");
  manager._onWindowActivityChanged({ suspended: false, focused: true });
  manager._scheduleHoverTimeout(
    () => Assert.ok(false, "suspended hover timeout must not run"),
    10_000
  );
  Assert.equal(manager._hoverTimeouts.size, 1, "hover timeout is tracked");
  manager._onWindowActivityChanged(
    { suspended: true, focused: false },
    { suspended: false, focused: true },
    ["focused"]
  );
  Assert.equal(
    manager._hoverTimeouts.size,
    0,
    "suspending cancels pending hover timeout"
  );
  Assert.ok(
    !toolbox.hasAttribute("zen-has-hover"),
    "Suspending clears stale hover state"
  );

  toolbox.removeAttribute("zen-compact-mode-active");
  marker.setAttribute("open", "true");
  toolbox.append(marker);
  Assert.ok(
    !toolbox.hasAttribute("zen-compact-mode-active"),
    "Disconnected observer ignores hidden-window mutations"
  );

  manager._onWindowActivityChanged({ suspended: false, focused: true });
  Assert.ok(
    toolbox.hasAttribute("zen-compact-mode-active"),
    "Resume collapses hidden mutations into one state refresh"
  );

  marker.remove();
  manager._refreshCompactActiveState();
  manager._onWindowActivityChanged(
    window.gZenWindowActivity?.state ?? {
      suspended: false,
      focused: true,
    }
  );
});
