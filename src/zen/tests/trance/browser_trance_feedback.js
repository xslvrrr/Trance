/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: motion and feedback acceptance tests (TRANCE.md §13 Phase 6).
 *
 * The acceptance criteria are "zero infinite animations; zero Trance timers at
 * idle; motion level 0 disables all of it with no layout shift" — all three
 * countable, and all three are what the mods this replaces got wrong.
 *
 * The loading bar's MIT original runs `animation: … 1.2s … infinite alternate`
 * animating `width` — a layout property — with a `filter: blur()` on every
 * frame, at display rate, for the whole page load, in unfocused and occluded
 * windows too. Trance's bar is a `transform: scaleX()` whose value comes from
 * nsIWebProgressListener, so it holds no loop at all except in the
 * indeterminate case, where the loop belongs to TranceScheduler and suspends
 * with the window (TRANCE.md §3.4).
 */

"use strict";

const FEEDBACK_SHEET =
  "chrome://browser/content/trance-styles/trance-feedback.css";

function feedback() {
  return window.gTrance.features.find(f => f.name === "Feedback");
}

function scheduler() {
  return window.gTrance.context.scheduler;
}

function tokenValue(name) {
  return window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

add_task(async function test_feature_is_registered_and_enabled() {
  const feature = feedback();
  ok(feature, "the feedback feature is constructed");
  ok(feature.enabled, "and enabled by default");
  ok(
    window.gTrance.context.styles.loadedSheets.includes(FEEDBACK_SHEET),
    "its stylesheet is loaded"
  );
  is(
    document.documentElement.getAttribute("trance-feedback-loading"),
    "top",
    "the loading bar defaults to the top of the page"
  );
});

add_task(async function test_the_loading_bar_exists_and_is_inert() {
  const bar = document.getElementById("trance-loading-bar");
  ok(bar, "the bar is in the DOM");
  is(bar.parentElement.id, "zen-tabbox-wrapper", "inside the content wrapper");

  const style = window.getComputedStyle(bar);
  is(style.position, "absolute", "out of flow, so it measures as nothing");
  is(style.pointerEvents, "none", "and cannot be clicked");
  ok(!bar.hasAttribute("active"), "and is inactive while nothing is loading");
});

add_task(async function test_no_infinite_animation_and_no_keyframes() {
  const sheet = [...document.styleSheets].find(s => s.href === FEEDBACK_SHEET);
  ok(sheet, "the feedback sheet is in the style set");

  const rules = [...sheet.cssRules];
  const text = rules.map(rule => rule.cssText).join("\n");

  ok(!text.includes("infinite"), "no infinite animation anywhere");
  ok(!text.includes("!important"), "and no !important");
  ok(!text.includes("will-change"), "and no will-change in CSS");
  is(
    rules.filter(rule => rule instanceof CSSKeyframesRule).length,
    0,
    "and no keyframes at all — the bar is a transition, not an animation"
  );

  const bar = document.getElementById("trance-loading-bar");
  is(
    window.getComputedStyle(bar).animationName,
    "none",
    "the bar runs no animation while idle"
  );
});

add_task(async function test_the_bar_scales_rather_than_resizes() {
  // `width` is a layout property; `transform` composites. The original animates
  // width on every frame, which is a reflow of the content pane each time.
  const sheet = [...document.styleSheets].find(s => s.href === FEEDBACK_SHEET);
  const barRule = [...sheet.cssRules].map(rule => rule.cssText).join("\n");
  ok(
    barRule.includes("scalex(var(--trance-loading-progress") ||
      barRule.includes("scaleX(var(--trance-loading-progress"),
    "progress is expressed as a horizontal scale"
  );
});

add_task(async function test_idle_costs_no_frame_subscriber() {
  // TRANCE.md §12.1: zero Trance timers at idle. The indeterminate creep is the
  // only frame subscriber this feature ever holds, and it exists only while a
  // load with no reported length is in flight.
  is(
    scheduler().frameSubscriberCount,
    0,
    "no frame subscriber while nothing is loading"
  );
  is(scheduler().timerCount, 0, "and no timer armed");
});

add_task(async function test_tokens_follow_their_prefs() {
  is(tokenValue("--trance-loading-thickness"), "3px", "thickness is bound");

  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.loading.thickness", 6]],
  });
  is(tokenValue("--trance-loading-thickness"), "6px", "and follows its slider");
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_bubble_count_is_clamped() {
  // Uncapped, this is a way to schedule arbitrary work from about:config.
  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.bubbles.count", 9999]],
  });
  is(tokenValue("--trance-bubble-count"), "16", "clamped at the top");
  await SpecialPowers.popPrefEnv();

  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.bubbles.count", 0]],
  });
  is(tokenValue("--trance-bubble-count"), "3", "and at the bottom");
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_closing_a_tab_bursts_and_cleans_up() {
  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  await BrowserTestUtils.browserLoaded(gBrowser.getBrowserForTab(tab));

  BrowserTestUtils.removeTab(tab);

  const layer = document.getElementById("trance-burst-layer");
  ok(layer, "the burst layer exists");

  // Every bubble removes itself on `finished` rather than after a timer, so
  // once the animations are done nothing Trance created is left behind.
  await Promise.all(
    document
      .getAnimations()
      .map(animation => animation.finished.catch(() => {}))
  );

  is(
    layer.querySelectorAll(".trance-burst-bubble").length,
    0,
    "and no bubble is left in the DOM afterwards"
  );
});

add_task(async function test_motion_level_zero_suppresses_the_burst() {
  await SpecialPowers.pushPrefEnv({ set: [["trance.motion.level", 0]] });

  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  await BrowserTestUtils.browserLoaded(gBrowser.getBrowserForTab(tab));
  BrowserTestUtils.removeTab(tab);

  const layer = document.getElementById("trance-burst-layer");
  is(
    layer?.querySelectorAll(".trance-burst-bubble").length ?? 0,
    0,
    "no bubble is even created at motion level 0"
  );

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_sub_features_toggle_independently() {
  const root = document.documentElement;

  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.loading.enabled", false]],
  });
  ok(
    !root.hasAttribute("trance-feedback-loading"),
    "turning the loading bar off removes its attribute"
  );
  ok(
    !document.getElementById("trance-loading-bar"),
    "and its DOM node, not merely its visibility"
  );
  await SpecialPowers.popPrefEnv();

  ok(
    document.getElementById("trance-loading-bar"),
    "and it comes back without a restart"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.bubbles.enabled", false]],
  });
  ok(
    !root.hasAttribute("trance-feedback-bubbles"),
    "and the burst toggles on its own"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_disabled_feedback_costs_nothing() {
  const root = document.documentElement;

  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.enabled", false]],
  });

  ok(!feedback().enabled, "the feature reports disabled");
  ok(
    !window.gTrance.context.styles.loadedSheets.includes(FEEDBACK_SHEET),
    "its stylesheet is unloaded, not merely overridden"
  );
  ok(!root.hasAttribute("trance-feedback"), "the root attribute is gone");
  ok(!document.getElementById("trance-loading-bar"), "the bar is gone");
  ok(!document.getElementById("trance-burst-layer"), "the burst layer is gone");

  await SpecialPowers.popPrefEnv();

  ok(feedback().enabled, "re-enabling works without a restart");
});
