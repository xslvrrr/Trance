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

/**
 * Reads a Trance stylesheet's text.
 *
 * Not via `document.styleSheets`: Trance loads its sheets through
 * `nsIDOMWindowUtils.loadSheetUsingURIString`, and a sheet loaded that way is
 * in the style set but not in the document's sheet list, so `cssRules` is not
 * reachable from here. Fetching the chrome URL reads the same bytes the style
 * system parsed, which is what these assertions are actually about.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function sheetText(url) {
  const response = await fetch(url);
  return response.text();
}

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
  ok(
    window.gTrance.context.styles.loadedSheets.includes(FEEDBACK_SHEET),
    "the feedback sheet is loaded"
  );

  // Comments stripped: this file explains at length what it does not contain,
  // and that explanation must not be what satisfies the assertion.
  const text = (await sheetText(FEEDBACK_SHEET)).replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );

  ok(!text.includes("infinite"), "no infinite animation anywhere");
  ok(!text.includes("!important"), "and no !important");
  ok(!text.includes("will-change"), "and no will-change in CSS");
  ok(
    !text.includes("@keyframes"),
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
  //
  // The bar does now *have* a length — a share of the edge it runs along, one
  // declaration, set when the slider moves and at no other time. What matters is
  // that progress is never expressed that way, on either axis, and that nothing
  // transitions a layout property.
  const text = await sheetText(FEEDBACK_SHEET);
  ok(
    text.includes("scaleX(var(--trance-loading-progress"),
    "progress on a horizontal bar is a horizontal scale"
  );
  ok(
    text.includes("scaleY(var(--trance-loading-progress"),
    "and on a vertical one it is a vertical scale"
  );

  for (const property of ["width", "height", "inset", "margin", "padding"]) {
    ok(
      !new RegExp(`transition:[^;]*\\b${property}\\b`, "s").test(text),
      `nothing transitions ${property}, which would reflow the pane`
    );
  }

  // The two halves transition two different things, which is the track/fill
  // split (ADR-045): the track fades so the distance appears, the fill scales so
  // the covered part grows. Neither touches a layout property.
  const bar = document.getElementById("trance-loading-bar");
  const track = window.getComputedStyle(bar).transitionProperty;
  ok(
    /opacity/.test(track) && !/\bwidth\b|\bheight\b/.test(track),
    `the track transitions opacity only (${track})`
  );

  const fill = document.getElementById("trance-loading-fill");
  const moving = window.getComputedStyle(fill).transitionProperty;
  ok(
    /transform/.test(moving) && !/\bwidth\b|\bheight\b/.test(moving),
    `the fill transitions transform only (${moving})`
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
  is(tokenValue("--trance-loading-thickness"), "5px", "thickness is bound");

  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.loading.thickness", 6]],
  });
  is(tokenValue("--trance-loading-thickness"), "6px", "and follows its slider");
  await SpecialPowers.popPrefEnv();

  // The page gesture's blur is a filter *function*, so that "no blur" is `none`
  // and not `blur(0px)`. An identity filter still forces a render pass, and the
  // element it would force one over is the whole content pane — which is the
  // single most expensive place in the window to spend one.
  is(
    tokenValue("--trance-loading-zoom-blur-fn"),
    "blur(4px)",
    "the page blur is bound as a filter function"
  );
  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.loading.zoom.blur", 0]],
  });
  is(
    tokenValue("--trance-loading-zoom-blur-fn"),
    "none",
    "and resolves to a genuine no-op at zero rather than to an identity filter"
  );
  await SpecialPowers.popPrefEnv();

  is(
    tokenValue("--trance-loading-zoom"),
    "1.03",
    "the zoom is bound as a scale"
  );
});

add_task(async function test_the_loading_bar_is_a_track_and_a_fill() {
  // The bar used to be one element whose scale *was* the progress, so a load
  // started and a quarter of a bar appeared out of nowhere with nothing on
  // screen for it to be a quarter of. Two elements: the track is the distance,
  // the fill is how much of it has been covered — and the fill grows out of the
  // centre, because a fill anchored to one end of a short centred object makes
  // the whole thing look off-centre until it completes (ADR-045).
  const bar = document.getElementById("trance-loading-bar");
  ok(bar, "the bar exists");
  if (!bar) {
    return;
  }
  const fill = document.getElementById("trance-loading-fill");
  ok(fill, "and it holds a fill");
  if (!fill) {
    return;
  }
  is(fill.parentElement, bar, "the fill is inside the track, so it is clipped");

  const trackBackground = window.getComputedStyle(bar).backgroundColor;
  isnot(
    trackBackground,
    "rgba(0, 0, 0, 0)",
    `the track paints something to be a fraction of (${trackBackground})`
  );
  // `transform-origin` computes to a length pair, so the check is "half the
  // track" rather than the keyword — and with a tolerance, because the track's
  // width is a percentage of the pane and lands on a fraction of a pixel.
  const origin = parseFloat(
    window.getComputedStyle(fill).transformOrigin.split(" ")[0]
  );
  const half = bar.getBoundingClientRect().width / 2;
  Assert.less(
    Math.abs(origin - half),
    1,
    `the fill grows from the track's centre (${origin} vs ${half})`
  );
});

add_task(async function test_the_page_gesture_is_gated_on_its_own_switch() {
  // The blur is the most expensive thing this feature draws, so "off" has to
  // mean no rule matches rather than a filter resolving to the identity.
  const root = document.documentElement;
  ok(
    !root.hasAttribute("trance-feedback-loading-page"),
    "nothing is loading, so the page carries no gesture"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.loading.zoom", false]],
  });
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.com/"
  );
  ok(
    !root.hasAttribute("trance-feedback-loading-page"),
    "and with the switch off a real load does not set it either"
  );
  BrowserTestUtils.removeTab(tab);
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
  // No `browserLoaded` wait: `about:blank` is already loaded by the time the
  // tab exists, so waiting for its load event never resolves. The burst is
  // driven by `TabClose`, which does not care whether anything loaded.
  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  BrowserTestUtils.removeTab(tab);

  const layer = document.getElementById("trance-burst-layer");
  ok(layer, "the burst layer exists");

  // Wait on the burst's own animations, not on `document.getAnimations()`:
  // the chrome document holds animations that never finish, so awaiting all of
  // them hangs the test rather than failing it.
  //
  // Every bubble removes itself on `finished` rather than after a timer, so
  // once they are done nothing Trance created is left behind.
  await TestUtils.waitForCondition(
    () => !layer.querySelector(".trance-burst-bubble"),
    "every bubble removed itself when its animation finished"
  );

  is(
    layer.querySelectorAll(".trance-burst-bubble").length,
    0,
    "and no bubble is left in the DOM afterwards"
  );
});

/**
 * The end keyframe of every bubble in the layer, as `{x, y}` offsets.
 *
 * Read from the animation rather than from the element: the bubbles are placed
 * at the origin and moved by a `transform` that only exists in the keyframes,
 * so the DOM says nothing about where any of them is going.
 *
 * @param {Element} layer
 * @returns {Array<{x: number, y: number}>}
 */
function burstVectors(layer) {
  return [...layer.querySelectorAll(".trance-burst-bubble")]
    .map(bubble => {
      const [, end] = bubble.getAnimations()[0]?.effect?.getKeyframes() ?? [];
      const match = end?.transform?.match(
        /translate\(calc\(-50% \+ (-?[\d.]+)px\), calc\(-50% \+ (-?[\d.]+)px\)\)/
      );
      return match
        ? { x: parseFloat(match[1]), y: parseFloat(match[2]) }
        : null;
    })
    .filter(Boolean);
}

add_task(async function test_the_burst_is_sampled_not_stepped() {
  // The first version placed bubble `i` at exactly `i / count` of a circle and
  // sent all of them exactly `travel` pixels — a ring expanding at a constant
  // rate, identical on every close. Angle, distance and end scale are each an
  // evenly-spaced mean plus a clamped normal deviate now, so no two bubbles are
  // the same distance out and no two bursts are the same burst.
  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  BrowserTestUtils.removeTab(tab);

  const layer = document.getElementById("trance-burst-layer");
  const vectors = burstVectors(layer);
  Assert.greater(vectors.length, 2, "the burst produced bubbles to measure");

  const radii = vectors.map(({ x, y }) => Math.hypot(x, y));
  const spread = Math.max(...radii) - Math.min(...radii);
  Assert.greater(
    spread,
    0.5,
    `the bubbles are not all the same distance out (${radii.join(", ")})`
  );

  await TestUtils.waitForCondition(
    () => !layer.querySelector(".trance-burst-bubble"),
    "and they still clean themselves up"
  );
});

add_task(async function test_the_line_shape_stays_on_one_axis() {
  // `line` is the same scatter sent along the row the tab was in rather than
  // around it: the cross-axis spread is a fraction of the along-axis reach, and
  // both arms are used whatever the bubble count.
  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.bubbles.shape", "line"]],
  });

  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  BrowserTestUtils.removeTab(tab);

  const layer = document.getElementById("trance-burst-layer");
  const vectors = burstVectors(layer);
  Assert.greater(vectors.length, 2, "the burst produced bubbles to measure");

  const reach = Math.max(...vectors.map(({ x }) => Math.abs(x)));
  const thickness = Math.max(...vectors.map(({ y }) => Math.abs(y)));
  Assert.less(
    thickness,
    reach,
    `the spread across the axis is smaller than the reach along it ` +
      `(${thickness.toFixed(1)} vs ${reach.toFixed(1)})`
  );
  ok(
    vectors.some(({ x }) => x < 0) && vectors.some(({ x }) => x > 0),
    "and the burst uses both arms"
  );

  await TestUtils.waitForCondition(
    () => !layer.querySelector(".trance-burst-bubble"),
    "and cleans itself up like the circle does"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_motion_level_zero_suppresses_the_burst() {
  await SpecialPowers.pushPrefEnv({ set: [["trance.motion.level", 0]] });

  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
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

add_task(async function test_the_marks_are_visible_against_the_chrome() {
  // The regression this guards: both halves of this feature drew in
  // `--trance-accent`, which is `--zen-primary-color`, which on a space with no
  // gradient picked is `rgb(47, 47, 47)`. The bar ran, the burst measured and
  // animated and cleaned up, and neither could be seen — near-black on
  // near-black. Every setting under them was reported as doing nothing because
  // the thing they configure was invisible.
  //
  // The fix is a token, so the check is on the token: whatever the theme, the
  // vivid accent has to differ from the chrome it is drawn on.
  const style = window.getComputedStyle(document.documentElement);
  const vivid = style.getPropertyValue("--trance-accent-vivid").trim();
  const raw = style.getPropertyValue("--trance-accent").trim();

  ok(vivid, "--trance-accent-vivid resolves");
  isnot(
    vivid,
    raw,
    "and is lifted away from the raw accent rather than aliasing it"
  );

  const bar = document.getElementById("trance-loading-bar");
  ok(bar, "the loading bar exists");
  if (bar) {
    const background = window.getComputedStyle(bar).backgroundImage;
    ok(
      background && background !== "none",
      "and is painted with a gradient rather than nothing"
    );
  }
});

add_task(async function test_the_bar_and_burst_do_not_use_the_raw_accent() {
  // Stated as a rule about the stylesheet as well as about the computed value,
  // because the computed value only proves today's theme. A *foreground* mark
  // uses `--trance-accent-vivid`; the raw accent is for tints and fills, where
  // the surface behind supplies the contrast.
  const text = await sheetText(FEEDBACK_SHEET);
  const marks = text.match(/var\(--trance-accent\)/g) || [];
  is(marks.length, 0, "no mark in the feedback layer paints in the raw accent");
});
