/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: foundation layer acceptance tests (TRANCE.md §13 Phase 2).
 *
 * The load-bearing one is `zero cost when disabled`. Everything else in Trance
 * is built on the promise that a pref-disabled feature loads no stylesheet,
 * registers no observer and arms no timer — so that promise gets an automated
 * check rather than a code review.
 */

"use strict";

const TOKEN_SHEET_PROBE = "--trance-radius-md";

/** Custom properties only resolve if the token stylesheet is in the style set. */
function tokenValue(name) {
  return window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** Two frames: one for the hub to flush into, one for it to have happened. */
function nextFrames() {
  return new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

add_task(async function test_core_is_active_by_default() {
  ok(window.gTrance, "TranceCore is on the window");
  ok(
    window.gTrance.active,
    "Trance is active with trance.enabled defaulting true"
  );
  is(
    document.documentElement.getAttribute("trance"),
    "true",
    "the root carries the trance attribute so stylesheets can gate on it"
  );
  ok(
    window.gTrance.context.styles.loadedSheets.includes(
      "chrome://browser/content/trance-styles/trance.css"
    ),
    "the entry-point stylesheet is loaded"
  );
  ok(tokenValue(TOKEN_SHEET_PROBE), "design tokens resolve");
});

add_task(async function test_disabled_costs_nothing() {
  const core = window.gTrance;

  await SpecialPowers.pushPrefEnv({ set: [["trance.enabled", false]] });

  ok(!core.active, "TranceCore reports inactive");
  is(core.context, null, "the shared context is released");
  is(core.features.length, 0, "no feature instances survive");
  ok(
    !document.documentElement.hasAttribute("trance"),
    "the root attribute is removed"
  );
  is(
    tokenValue(TOKEN_SHEET_PROBE),
    "",
    "no Trance stylesheet is left in the style set"
  );
  ok(
    !document.documentElement.hasAttribute("trance-motion"),
    "the motion attribute is removed"
  );

  await SpecialPowers.popPrefEnv();

  ok(core.active, "flipping the pref back rebuilds the layer, with no restart");
  ok(tokenValue(TOKEN_SHEET_PROBE), "tokens resolve again");
});

add_task(async function test_scheduler_runs_and_stops() {
  const { scheduler } = window.gTrance.context;

  is(scheduler.timerCount, 0, "no Trance timer is armed at idle");
  ok(!scheduler.suspended, "the scheduler is running in a focused window");

  let ticks = 0;
  const handle = scheduler.onFrame(() => ticks++);
  is(scheduler.frameSubscriberCount, 1, "one frame subscriber");

  await nextFrames();
  Assert.greater(ticks, 0, "the frame loop ran");

  scheduler.cancel(handle);
  is(scheduler.frameSubscriberCount, 0, "the subscription is gone");

  const before = ticks;
  await nextFrames();
  is(ticks, before, "and the loop stopped with it");
});

add_task(async function test_wall_clock_arms_one_timer() {
  const { scheduler } = window.gTrance.context;

  const first = scheduler.onWallClock(() => {}, "minute");
  const second = scheduler.onWallClock(() => {}, "minute");
  is(
    scheduler.timerCount,
    1,
    "two subscribers to the same unit share one timer — the anti-polling rule"
  );

  scheduler.cancel(first);
  scheduler.cancel(second);
  is(scheduler.timerCount, 0, "and it is disarmed when the last one leaves");
});

add_task(async function test_observer_hub_batches() {
  const { observers } = window.gTrance.context;
  const target = document.documentElement;

  // Relative to whatever is already subscribed, not to zero. Features hold
  // their own subscriptions for the life of the window — TranceTabStrip keeps
  // exactly one, to track folders appearing and disappearing — so "the hub
  // disconnects when nothing is subscribed" is a claim about this
  // subscription's effect on the count, not about the count's value.
  const baseline = observers.observerCount;

  let callbacks = 0;
  let records = 0;
  const handle = observers.observeMutations(
    ":root",
    mutations => {
      callbacks++;
      records += mutations.length;
    },
    { attributes: true, attributeFilter: ["trance-test"], subtree: false }
  );

  for (let i = 0; i < 5; i++) {
    target.setAttribute("trance-test", String(i));
  }
  await nextFrames();

  is(callbacks, 1, "five mutations in one task produce one callback, not five");
  Assert.greater(records, 0, "and the records are delivered");

  observers.unobserve(handle);
  target.removeAttribute("trance-test");

  await nextFrames();
  is(callbacks, 1, "no callbacks after unsubscribing");
  is(
    observers.observerCount,
    baseline,
    "and the hub is back to exactly the subscriptions it had before"
  );
});

add_task(async function test_motion_level() {
  const { motion } = window.gTrance.context;
  const root = document.documentElement;

  is(
    root.getAttribute("trance-motion"),
    String(motion.level),
    "level published"
  );

  await SpecialPowers.pushPrefEnv({ set: [["trance.motion.level", 0]] });
  is(root.getAttribute("trance-motion"), "0", "level 0 applied");
  is(tokenValue("--trance-dur-base"), "0ms", "durations collapse to zero");
  is(
    motion.animate(root, [{ opacity: 1 }], { duration: 100 }),
    null,
    "animate() is a no-op at level 0 so callers jump to the end state"
  );
  await SpecialPowers.popPrefEnv();

  Assert.notEqual(tokenValue("--trance-dur-base"), "0ms", "and restored after");
});
