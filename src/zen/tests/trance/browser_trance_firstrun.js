/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: first-run panel acceptance tests (TRANCE.md §13 Phase 9).
 *
 * The feature's whole job is to say something true about a thing that already
 * happened somewhere else, so the assertions here are about *where its facts
 * come from* rather than about its appearance:
 *
 *   - the extension list comes from the active policy, not from a list in the
 *     module (ADR-032) — asserted by comparing the rows against
 *     `Services.policies` rather than against seven hardcoded names;
 *   - a build with no policy says so, instead of showing empty rows;
 *   - the panel shows once, and `trance.firstrun.completed` is what makes that
 *     true;
 *   - disabled means zero, which for this feature means no panel node at all.
 *
 * `show()` is called directly. `#maybeShow` refuses to run under automation on
 * purpose — a fresh mochitest profile is a first run, and a panel opening over
 * every suite in the tree five seconds in is not worth the report.
 */

"use strict";

const FIRSTRUN_SHEET =
  "chrome://browser/content/trance-styles/trance-firstrun.css";
const PREF_ENABLED = "trance.firstrun.enabled";
const PREF_COMPLETED = "trance.firstrun.completed";
const PANEL_ID = "trance-firstrun-panel";

function feature() {
  return window.gTrance.features.find(f => f.name === "FirstRun");
}

function panel() {
  return document.getElementById(PANEL_ID);
}

/** The ids the active policy says are installed, or [] if there is no policy. */
function policyIds() {
  const settings = Services.policies.getActivePolicies()?.ExtensionSettings;
  if (!settings) {
    return [];
  }
  return Object.entries(settings)
    .filter(
      ([id, entry]) =>
        id !== "*" &&
        ["normal_installed", "force_installed"].includes(
          entry?.installation_mode
        )
    )
    .map(([id]) => id);
}

async function openPanel() {
  Services.prefs.setBoolPref(PREF_COMPLETED, false);
  feature().show();
  const node = panel();
  ok(node, "the panel was built");
  await BrowserTestUtils.waitForPopupEvent(node, "shown");
  return node;
}

/**
 * Closes the panel and waits for the close to have happened.
 *
 * `hidePopup()` is not synchronous, and the feature tears the node down on
 * `popuphidden` — so a test that closed and immediately reopened would be
 * asserting against the panel it thought it had closed.
 */
async function closePanel() {
  const node = panel();
  if (!node) {
    return;
  }
  node.hidePopup();
  // `waitForPopupEvent`, not `waitForEvent`: a panel that never finished
  // opening fires no `popuphidden`, and a test that waited for one would hang
  // rather than fail.
  await BrowserTestUtils.waitForPopupEvent(node, "hidden");
}

registerCleanupFunction(async () => {
  await closePanel();
  Services.prefs.clearUserPref(PREF_ENABLED);
  Services.prefs.clearUserPref(PREF_COMPLETED);
});

add_task(async function test_feature_is_registered_and_idle() {
  const first = feature();
  ok(first, "the first-run feature is constructed");
  ok(first.enabled, "and enabled by default");
  ok(
    window.gTrance.context.styles.loadedSheets.includes(FIRSTRUN_SHEET),
    "its stylesheet is loaded"
  );
  ok(!panel(), "and no panel has opened by itself under automation");
});

add_task(async function test_the_stylesheet_keeps_the_house_rules() {
  const response = await fetch(FIRSTRUN_SHEET);
  const text = (await response.text()).replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!text.includes("!important"), "no !important");
  ok(!text.includes("will-change"), "no will-change in CSS");
  ok(!text.includes("backdrop-filter"), "no second blur surface");
  ok(!text.includes("infinite"), "no infinite animation");
});

add_task(async function test_rows_come_from_the_policy() {
  const node = await openPanel();
  const ids = policyIds();
  const rows = node.querySelectorAll(".trance-firstrun-row");

  if (!ids.length) {
    is(rows.length, 0, "no policy means no rows");
    ok(
      node.querySelector(".trance-firstrun-empty"),
      "and the panel says the policy is missing rather than showing nothing"
    );
  } else {
    is(
      rows.length,
      ids.length,
      "one row per extension the policy installs, and no more"
    );
    ok(
      node.querySelector(".trance-firstrun-status"),
      "each row carries a status"
    );
  }

  await closePanel();
});

add_task(async function test_it_claims_the_first_run_when_it_opens() {
  await openPanel();
  ok(
    Services.prefs.getBoolPref(PREF_COMPLETED, false),
    "opening the panel completes the first run"
  );

  await closePanel();
  ok(!panel(), "the panel node is removed on close, not merely hidden");

  // A window that has already shown it does not show it again, and the pref is
  // the only thing that decides so.
  feature().show();
  ok(!panel(), "a second show() with the pref set opens nothing");
});

add_task(async function test_disabled_costs_nothing() {
  await openPanel();
  Services.prefs.setBoolPref(PREF_ENABLED, false);

  const first = feature();
  ok(!first.enabled, "the feature reports itself disabled");
  ok(!panel(), "its panel is gone");
  ok(
    !window.gTrance.context.styles.loadedSheets.includes(FIRSTRUN_SHEET),
    "and its stylesheet left the style set"
  );

  Services.prefs.clearUserPref(PREF_ENABLED);
  ok(feature().enabled, "flipping the pref back re-enables it");
  await closePanel();
});
