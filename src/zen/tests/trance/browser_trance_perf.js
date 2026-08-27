/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: performance budget assertions (TRANCE.md §12.1, §13 Phase 11).
 *
 * `scripts/trance-perf.py` measures the budgets that need a real profile, real
 * extensions and wall-clock time. This file covers the ones that do not, and
 * the one it cannot reach at all.
 *
 * ── The one it cannot reach ───────────────────────────────────────────────
 *
 * §12.1 asks for zero GPU frames while the window is fully occluded. Occlusion
 * means "covered by another window", and one process cannot cover its own
 * window — the harness minimises instead and says so in the scorecard
 * (ADR-034). What *can* be checked here is the half that is Trance's: that
 * `TranceScheduler` suspends when the platform reports occlusion, whatever it
 * takes for the platform to report it. `isFullyOccluded` is a getter on the
 * chrome window, so the test drives the state change the way the platform
 * would and asserts the scheduler followed.
 *
 * That distinction matters for TRANCE.md §13 Phase 11 B2: if macOS never
 * reports a translucent window as occluded, this test still passes and the
 * browser still burns frames. The test proves the wiring, not the platform.
 */

"use strict";

/** Two frames: one for work to be scheduled into, one for it to have run. */
function nextFrames() {
  return new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

/**
 * Every element whose computed style forces the compositor to keep a separate
 * surface. ADR-034: this replaces §12.1's `layers.draw-borders` count, which
 * measures nothing under WebRender.
 */
function compositorSurfaces(doc = document) {
  const found = [];
  for (const el of doc.querySelectorAll("*")) {
    // `<template>` content and anything else parked in an inert document has no
    // defaultView, and nothing without one is being composited.
    const view = el.ownerDocument?.defaultView;
    if (!view) {
      continue;
    }
    const cs = view.getComputedStyle(el);
    const reasons = [];
    if (cs.backdropFilter && cs.backdropFilter !== "none") {
      reasons.push("backdrop-filter");
    }
    if (cs.filter && cs.filter !== "none") {
      reasons.push("filter");
    }
    if (/transform|opacity|filter/.test(cs.willChange || "")) {
      reasons.push(`will-change:${cs.willChange}`);
    }
    if (cs.transform?.startsWith("matrix3d")) {
      reasons.push("transform-3d");
    }
    if (reasons.length) {
      found.push({ el, reasons });
    }
  }
  return found;
}

function describe(entry) {
  const { el } = entry;
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof el.className === "string" && el.className
      ? `.${el.className.trim().split(/\s+/).join(".")}`
      : "";
  return `${el.localName}${id}${cls} [${entry.reasons.join(", ")}]`;
}

add_task(async function test_compositor_surface_budget() {
  const surfaces = compositorSurfaces();
  info(surfaces.map(describe).join("\n"));
  Assert.lessOrEqual(
    surfaces.length,
    6,
    "chrome compositor surfaces at idle are within the §12.1 budget of 6"
  );
});

add_task(async function test_backdrop_filter_budget() {
  const blurred = compositorSurfaces().filter(entry =>
    entry.reasons.includes("backdrop-filter")
  );
  info(blurred.map(describe).join("\n"));
  Assert.lessOrEqual(
    blurred.length,
    3,
    "at most three backdrop-filter surfaces per window (§12.1)"
  );

  // "Never nested" is the half of that budget a count cannot express: three
  // surfaces stacked over the same pixels cost three passes on every frame,
  // which is the whole of TRANCE.md §3.3.
  for (const outer of blurred) {
    for (const inner of blurred) {
      if (outer === inner) {
        continue;
      }
      ok(
        !outer.el.contains(inner.el),
        `${describe(outer)} does not contain ${describe(inner)}`
      );
    }
  }
});

add_task(async function test_no_trance_will_change_survives_the_reset_layer() {
  // TRANCE.md §3.5 and the four static `will-change` declarations Zen ships.
  // trance-reset.css takes back the three that promote; this asserts the reset
  // still matches after an upstream rebase, which is the thing most likely to
  // silently stop being true.
  const background = document.querySelector(".zen-browser-generic-background");
  if (!background) {
    info("no .zen-browser-generic-background in this window; nothing to check");
    return;
  }
  for (const pseudo of ["::before", "::after"]) {
    const value = window
      .getComputedStyle(background, pseudo)
      .getPropertyValue("will-change");
    is(
      value,
      "auto",
      `${pseudo} of the window background has no static will-change`
    );
  }
});

add_task(async function test_no_trance_timers_at_idle() {
  const { scheduler, observers } = window.gTrance.context;
  await nextFrames();

  is(scheduler.timerCount, 0, "no Trance wall-clock timer is armed at idle");
  is(
    scheduler.frameSubscriberCount,
    0,
    "no Trance frame subscriber is running at idle"
  );
  Assert.lessOrEqual(
    observers.observerCount,
    3,
    "one MutationObserver, one ResizeObserver and at most one " +
      "IntersectionObserver per window (§12.1, §6.4)"
  );
});

add_task(async function test_scheduler_suspends_when_occluded() {
  const { scheduler } = window.gTrance.context;

  // A subscriber, so the frame loop has a reason to be running at all.
  let ticks = 0;
  const handle = scheduler.onFrame(() => ticks++);
  registerCleanupFunction(() => scheduler.cancel(handle));

  await nextFrames();
  ok(!scheduler.suspended, "the scheduler runs while the window is visible");
  ok(ticks > 0, "and the subscriber is being called");

  // `isFullyOccluded` is a getter on the chrome window. Overriding it is how
  // the state is reached without a second application covering the window —
  // the event is what the scheduler listens for, and the getter is what it
  // reads when the event arrives.
  const original = Object.getOwnPropertyDescriptor(window, "isFullyOccluded");
  Object.defineProperty(window, "isFullyOccluded", {
    configurable: true,
    get: () => true,
  });
  registerCleanupFunction(() => {
    if (original) {
      Object.defineProperty(window, "isFullyOccluded", original);
    } else {
      delete window.isFullyOccluded;
    }
  });

  window.dispatchEvent(new CustomEvent("occlusionstatechange"));
  await nextFrames();

  ok(scheduler.suspended, "the scheduler suspends when the window is occluded");

  const parked = ticks;
  await nextFrames();
  is(ticks, parked, "and stops calling frame subscribers entirely");

  // Back again, so the rest of the suite is not left in a suspended window.
  Object.defineProperty(window, "isFullyOccluded", {
    configurable: true,
    get: () => false,
  });
  window.dispatchEvent(new CustomEvent("occlusionstatechange"));
  await nextFrames();
  ok(!scheduler.suspended, "and resumes when the window is visible again");
});

add_task(
  async function test_workspace_cross_fade_is_a_waapi_opacity_animation() {
    // ADR-038. The space switch used to animate `--zen-background-opacity`, which
    // Gecko cannot run on the compositor, and which Motion cannot run on WAAPI at
    // all — so every frame was a main-thread restyle plus a repaint of two
    // window-sized gradient layers. It now animates `opacity` on the two
    // pseudo-elements through `motion.animateMini`.
    //
    // What this asserts is the *mechanism*, because the mechanism is what an
    // upstream Motion bump would take away silently: `animateMini` is the only
    // entry point that accepts `pseudoElement`, `spring` has to be passed as a
    // function, and the spring only reaches the compositor if it is converted to
    // a `linear()` easing rather than driven from script.
    const background = document.querySelector(
      ".zen-browser-generic-background"
    );
    if (!background) {
      info(
        "no .zen-browser-generic-background in this window; nothing to check"
      );
      return;
    }

    const { motion } = gZenUIManager;
    is(
      typeof motion.animateMini,
      "function",
      "Motion still exposes animateMini, its WAAPI-only entry point"
    );
    is(typeof motion.spring, "function", "Motion still exposes spring");
    ok(
      "applyToOptions" in motion.spring,
      "and spring can still be handed to animateMini as a generator"
    );

    // Long enough that it is unambiguously still running when it is inspected.
    const controls = motion.animateMini(
      [background],
      { opacity: [0, 1] },
      { type: motion.spring, bounce: 0, duration: 5, pseudoElement: "::after" }
    );
    registerCleanupFunction(() => controls.cancel());

    const running = background
      .getAnimations({ subtree: true })
      .filter(animation => animation.effect?.pseudoElement === "::after");
    is(running.length, 1, "one WAAPI animation is running on ::after");

    const [animation] = running;
    const keyframes = animation.effect.getKeyframes();
    ok(
      keyframes.length && keyframes.every(frame => "opacity" in frame),
      "it animates opacity, not a custom property"
    );

    // Truncated on purpose: a sampled spring is a thousand-stop `linear()`, and
    // the whole of it in a failure message is noise. The prefix is the claim.
    const { easing } = animation.effect.getTiming();
    ok(
      easing.startsWith("linear("),
      `the spring was sampled into a linear() easing rather than driven from ` +
        `script (got ${easing.slice(0, 40)}…)`
    );

    // The claim the change rests on is not "WAAPI" but "off the main thread",
    // and that one is not assertable here. `Animation.isRunningOnCompositor`
    // is the instrument, and it stays false in a mochitest window — the
    // animation has to survive a real paint before the compositor is told
    // about it. In a real window it goes true, which is why the assertion
    // lives in `scripts/trance-perf.py` (row `space_switch_on_compositor`)
    // rather than being written here in a form that would be permanently red.
    //
    // `nsIDOMWindowUtils.getOMTAStyle` looks like the better instrument and is
    // not: under WebRender it returns "" even for an animation that is
    // demonstrably compositing, including a plain element used as a control.
    // See ADR-038.
    info(`isRunningOnCompositor here: ${animation.isRunningOnCompositor}`);

    controls.cancel();
  }
);

add_task(
  async function test_background_opacity_variable_still_drives_the_layers() {
    // The other half of ADR-038. The cross-fade cancels itself when the switch
    // ends and hands the two layers back to `--zen-background-opacity`, which the
    // swipe gesture and the theme picker both still write directly. If Zen ever
    // stops reading the variable as `opacity`, that hand-back leaves the window
    // showing the wrong gradient — and nothing else in the tree would notice.
    const background = document.querySelector(
      ".zen-browser-generic-background"
    );
    if (!background) {
      info(
        "no .zen-browser-generic-background in this window; nothing to check"
      );
      return;
    }

    const previous = background.style.getPropertyValue(
      "--zen-background-opacity"
    );
    registerCleanupFunction(() => {
      if (previous) {
        background.style.setProperty("--zen-background-opacity", previous);
      } else {
        background.style.removeProperty("--zen-background-opacity");
      }
    });

    background.style.setProperty("--zen-background-opacity", "0.25");
    is(
      window.getComputedStyle(background, "::after").opacity,
      "0.25",
      "the incoming gradient reads the variable"
    );
    is(
      window.getComputedStyle(background, "::before").opacity,
      "0.75",
      "and the outgoing one reads its complement"
    );
  }
);

add_task(async function test_trance_owns_the_loading_indicator() {
  // TRANCE.md §3.1: one owner per behaviour. TranceFeedback ships a loading
  // bar, and Zen's own `#zen-loading-progress-bar` does the same job from the
  // same signal, so exactly one of them may be switched on at a time.
  const tranceBarOn = Services.prefs.getBoolPref(
    "trance.feedback.loading.enabled",
    true
  );
  const zenBarOn = Services.prefs.getBoolPref(
    "zen.view.enable-loading-indicator",
    true
  );
  ok(
    !(tranceBarOn && zenBarOn),
    "Zen's loading indicator is off while Trance's bar is on"
  );
});
