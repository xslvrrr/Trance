/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: onboarding acceptance tests (TRANCE.md §13 Phase 13).
 *
 * The flow's visible half is ten screens of copy, and testing copy is testing
 * nothing. What is worth asserting is the half that survives the flow:
 *
 *   - the window is *given back*. This is the only Trance feature that hides
 *     every child of `#browser`, and a bug here is a browser with no UI. The
 *     test therefore builds the flow, tears it down through the pref, and
 *     checks the window is whole again — which is also the `disabled means
 *     zero` assertion every other Trance suite makes;
 *   - the three prefs the flow asks about are applied *by the feature*, for the
 *     whole session, not only while it is on screen. The settings page writes
 *     them and cannot act on them, so this is the contract that makes those
 *     rows real rather than decorative (ADR-051);
 *   - "stable" clears the twilight prefs rather than writing the opposite
 *     value, so a later change to Zen's own default is inherited;
 *   - the flow claims the first run when it starts, not when it ends.
 *
 * `start()` is called directly. `onEnable` refuses to schedule itself under
 * automation on purpose — every mochitest profile is a fresh profile, and a
 * full-window takeover a few seconds into every suite in the tree is not worth
 * the coverage.
 */

"use strict";

const ONBOARDING_SHEET =
  "chrome://browser/content/trance-styles/trance-onboarding.css";
const PREF_ENABLED = "trance.onboarding.enabled";
const PREF_COMPLETED = "trance.onboarding.completed";
const PREF_CHANNEL = "trance.onboarding.channel";
const PREF_ARCH = "trance.perf.arch";
const ATTR_STAGE = "trance-onboarding-stage";
const ROOT_ID = "trance-onboarding";

/** The twilight-gated prefs the channel page owns. */
const TWILIGHT_PREFS = [
  "zen.view.context-menu.refresh",
  "zen.theme.acrylic-elements",
  "services.sync.engine.spaces",
];

function feature() {
  return window.gTrance.features.find(f => f.name === "Onboarding");
}

function root() {
  return document.getElementById(ROOT_ID);
}

/**
 * Builds the flow, and returns its root.
 *
 * The pref is cleared first because `start()` refuses to run a first run that
 * has already been claimed — which is the behaviour a later task asserts.
 */
function begin() {
  Services.prefs.setBoolPref(PREF_COMPLETED, false);
  feature().start();
  return root();
}

/**
 * Ends the flow the way a user turning it off would.
 *
 * Through the pref rather than through an internal method: the disposers the
 * base class runs on disable are what restore the window, and a test that
 * unwound it some other way would not be testing the path that matters.
 */
function end() {
  Services.prefs.setBoolPref(PREF_ENABLED, false);
  Services.prefs.clearUserPref(PREF_ENABLED);
}

registerCleanupFunction(() => {
  end();
  for (const pref of [
    PREF_COMPLETED,
    PREF_CHANNEL,
    PREF_ARCH,
    ...TWILIGHT_PREFS,
  ]) {
    Services.prefs.clearUserPref(pref);
  }
  Services.prefs.clearUserPref("trance.surface.blur.radius");
  Services.prefs.clearUserPref("trance.surface.internal.blur");
  Services.prefs.clearUserPref("trance.chrome.urlbar.focus-blur");
  Services.prefs.clearUserPref("trance.surface.suspend-when-unfocused");
});

add_task(async function test_feature_is_registered_and_idle() {
  const onboarding = feature();
  ok(onboarding, "the onboarding feature is constructed");
  ok(onboarding.enabled, "and enabled by default");
  ok(
    window.gTrance.context.styles.loadedSheets.includes(ONBOARDING_SHEET),
    "its stylesheet is loaded"
  );
  ok(
    !root(),
    "and nothing has taken the window over by itself under automation"
  );
  ok(
    !document.documentElement.hasAttribute(ATTR_STAGE),
    "so the stage attribute is absent"
  );
});

add_task(async function test_the_stylesheet_keeps_the_house_rules() {
  const response = await fetch(ONBOARDING_SHEET);
  const text = (await response.text()).replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!text.includes("!important"), "no !important");
  ok(!text.includes("will-change"), "no will-change in CSS");
  ok(!text.includes("backdrop-filter"), "no second blur surface");
  ok(!text.includes("infinite"), "no infinite animation");
});

add_task(async function test_starting_takes_the_window_and_claims_the_run() {
  const node = begin();
  ok(node, "the flow builds its root");
  ok(
    document.documentElement.hasAttribute(ATTR_STAGE),
    "and marks the document, which is what TranceFirstRun waits on"
  );
  ok(
    Services.prefs.getBoolPref(PREF_COMPLETED, false),
    "starting claims the first run, rather than finishing it doing so"
  );
  ok(
    node.querySelector("#trance-onboarding-splash"),
    "the splash is the first thing on screen"
  );

  const browser = document.getElementById("browser");
  const hidden = [...browser.children].filter(
    element =>
      element.id !== ROOT_ID &&
      !["zen-browser-background", "zen-toast-container"].includes(element.id) &&
      element.style.display === "none"
  );
  ok(hidden.length, "the rest of the browser is hidden behind it");

  // A second start is a no-op, not a second flow.
  feature().start();
  is(
    document.querySelectorAll(`#${ROOT_ID}`).length,
    1,
    "and a second start() builds nothing"
  );
});

add_task(async function test_disabling_gives_the_window_back() {
  ok(root(), "the flow from the previous task is still up");
  end();

  ok(!root(), "its root is gone");
  ok(
    !document.documentElement.hasAttribute(ATTR_STAGE),
    "the stage attribute is gone"
  );

  const browser = document.getElementById("browser");
  const stillHidden = [...browser.children].filter(
    element => element.style.display === "none"
  );
  is(stillHidden.length, 0, "and every child of #browser is visible again");

  ok(feature().enabled, "the feature is back on after the pref was cleared");
  ok(
    window.gTrance.context.styles.loadedSheets.includes(ONBOARDING_SHEET),
    "and its stylesheet is back in the style set"
  );
});

add_task(async function test_twilight_writes_and_stable_clears() {
  Services.prefs.setStringPref(PREF_CHANNEL, "twilight");
  for (const pref of TWILIGHT_PREFS) {
    ok(
      Services.prefs.prefHasUserValue(pref),
      `${pref} is written on the twilight channel`
    );
    ok(Services.prefs.getBoolPref(pref), `${pref} is on`);
  }

  Services.prefs.setStringPref(PREF_CHANNEL, "stable");
  for (const pref of TWILIGHT_PREFS) {
    ok(
      !Services.prefs.prefHasUserValue(pref),
      `${pref} is handed back to Zen's own default rather than overwritten`
    );
  }
});

add_task(async function test_architecture_tunes_blur_and_only_blur() {
  Services.prefs.setStringPref(PREF_ARCH, "x86_64");
  is(
    Services.prefs.getIntPref("trance.surface.blur.radius"),
    10,
    "the Intel tuning lowers the surface blur"
  );
  ok(
    !Services.prefs.getBoolPref("trance.surface.internal.blur"),
    "and drops the second full-viewport pass over internal pages"
  );
  ok(
    !Services.prefs.getBoolPref("trance.chrome.urlbar.focus-blur"),
    "and the address bar's focus blur"
  );

  Services.prefs.setStringPref(PREF_ARCH, "arm64");
  is(
    Services.prefs.getIntPref("trance.surface.blur.radius"),
    24,
    "and switching back restores the full frost"
  );
  ok(
    Services.prefs.getBoolPref("trance.surface.internal.blur"),
    "including internal pages"
  );
});

add_task(async function test_the_prefs_are_applied_with_the_flow_over() {
  // The whole point of the observers: `trance.onboarding.completed` is true by
  // now, so the flow is not running and never will again in this session. The
  // settings page still has to work.
  ok(
    Services.prefs.getBoolPref(PREF_COMPLETED, false),
    "the first run is over"
  );
  ok(!root(), "and no flow is on screen");

  Services.prefs.setStringPref(PREF_ARCH, "x86_64");
  is(
    Services.prefs.getIntPref("trance.surface.blur.radius"),
    10,
    "the architecture setting still applies"
  );
  Services.prefs.setStringPref(PREF_ARCH, "arm64");
});

add_task(async function test_disabled_costs_nothing() {
  Services.prefs.setBoolPref(PREF_ENABLED, false);

  const onboarding = feature();
  ok(!onboarding.enabled, "the feature reports itself disabled");
  ok(!root(), "there is no flow");
  ok(
    !window.gTrance.context.styles.loadedSheets.includes(ONBOARDING_SHEET),
    "its stylesheet left the style set"
  );

  // And the pref observers went with it: a write that would have retuned blur
  // does nothing at all.
  Services.prefs.setIntPref("trance.surface.blur.radius", 17);
  Services.prefs.setStringPref(PREF_ARCH, "x86_64");
  is(
    Services.prefs.getIntPref("trance.surface.blur.radius"),
    17,
    "a disabled feature applies nothing"
  );

  Services.prefs.clearUserPref(PREF_ENABLED);
  ok(feature().enabled, "flipping the pref back re-enables it");
  Services.prefs.setStringPref(PREF_ARCH, "arm64");
});
