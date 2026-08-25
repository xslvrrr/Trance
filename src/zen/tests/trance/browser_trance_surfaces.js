/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: surface layer acceptance tests (TRANCE.md §13 Phase 3).
 *
 * The blur budget is the point. Four mods used to run four independent
 * `backdrop-filter` stacks over overlapping regions; the whole reason this
 * feature exists is that there is now one owner and a hard ceiling of three
 * surfaces, never nested (TRANCE.md §3.3).
 */

"use strict";

const SURFACE_SHEET =
  "chrome://browser/content/trance-styles/trance-surfaces.css";

/** The regions in TRANCE.md §3.3's budget, and the element each one owns. */
const REGIONS = [
  { id: "sidebar", selector: "#navigator-toolbox" },
  { id: "toolbar", selector: "#zen-appcontent-navbar-wrapper" },
  { id: "overlay", selector: "#urlbar" },
];

/**
 * The fourth region. Translucency only, and deliberately not part of the blur
 * budget — a blurred content pane is full-window and its backdrop changes on
 * every scrolled frame (ADR-019).
 */
const CONTENT_REGION = {
  id: "content",
  selector: "#tabbrowser-tabpanels browser[type='content']",
};

/**
 * The two elements the sidebar region makes translucent. Frosting is the chrome
 * getting out of the way, not a tint painted over it — see the header of
 * trance-surfaces.css.
 */
const TRANSLUCENT_SELECTORS = [
  "#zen-browser-background",
  "#zen-toolbar-background",
];

function surfaces() {
  return window.gTrance.features.find(f => f.name === "Surfaces");
}

function blurredElementCount() {
  let count = 0;
  for (const { selector } of REGIONS) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }
    const filter = window.getComputedStyle(element).backdropFilter;
    if (filter && filter !== "none") {
      count++;
    }
  }
  return count;
}

add_task(async function test_feature_is_registered_and_enabled() {
  const feature = surfaces();
  ok(feature, "the surfaces feature is constructed");
  ok(feature.enabled, "and enabled by default");
  ok(
    window.gTrance.context.styles.loadedSheets.includes(SURFACE_SHEET),
    "its stylesheet is loaded"
  );
  is(
    document.documentElement.getAttribute("trance-surface"),
    "nebula",
    "the default preset is Nebula's design language"
  );
});

add_task(async function test_blur_budget_is_respected() {
  Assert.lessOrEqual(
    blurredElementCount(),
    3,
    "at most three blurred regions per window (TRANCE.md §3.3)"
  );

  // Nesting is the one case strictly worse than either surface alone: the
  // parent has to be resolved before the child can sample it.
  const toolbox = document.querySelector("#navigator-toolbox");
  const navbar = document.querySelector("#zen-appcontent-navbar-wrapper");
  if (toolbox && navbar && toolbox.contains(navbar)) {
    const toolboxBlurred =
      window.getComputedStyle(toolbox).backdropFilter !== "none";
    const navbarBlurred =
      window.getComputedStyle(navbar).backdropFilter !== "none";
    ok(!(toolboxBlurred && navbarBlurred), "blur surfaces are never nested");
  }
});

add_task(async function test_sidebar_region_is_translucency_not_a_tint() {
  // The regression this guards: the first implementation painted a
  // 62%-opaque near-black on #navigator-toolbox and called it frosting, which
  // over an already-dark workspace gradient is a black box. What actually
  // frosts the chrome is lowering the opacity of Zen's own background layers so
  // the window's native translucency shows through.
  for (const selector of TRANSLUCENT_SELECTORS) {
    const element = document.querySelector(selector);
    ok(element, `${selector} exists`);
    if (!element) {
      continue;
    }
    const opacity = parseFloat(window.getComputedStyle(element).opacity);
    Assert.less(
      opacity,
      1,
      `${selector} is translucent at the default opacity`
    );
    Assert.greater(opacity, 0, `${selector} is not invisible`);
  }

  // And the sheen Trance does paint is a sheen, not a surface: mostly
  // transparent, or it would be hiding the backdrop it exists to reveal.
  const toolbox = document.querySelector("#navigator-toolbox");
  const background = window.getComputedStyle(toolbox).backgroundColor;
  const alpha = background.startsWith("rgba")
    ? parseFloat(background.split(",").pop())
    : background === "transparent"
      ? 0
      : 1;
  Assert.lessOrEqual(
    alpha,
    0.35,
    "the sidebar sheen leaves the backdrop visible"
  );
});

add_task(async function test_sidebar_translucency_follows_its_region_pref() {
  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.region.sidebar", false]],
  });

  for (const selector of TRANSLUCENT_SELECTORS) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }
    is(
      window.getComputedStyle(element).opacity,
      "1",
      `${selector} is opaque again with the region off`
    );
  }

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_content_region_is_off_and_never_blurred() {
  const root = document.documentElement;
  ok(
    !root.hasAttribute("trance-surface-content"),
    "the content region is off by default — it is the one region that can put " +
      "a gradient behind body text"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.region.content", true]],
  });

  is(
    root.getAttribute("trance-surface-content"),
    "true",
    "and it turns on live"
  );

  const pane = document.querySelector(CONTENT_REGION.selector);
  if (pane) {
    is(
      window.getComputedStyle(pane).backdropFilter,
      "none",
      "the content pane is translucency only — it never joins the blur budget"
    );
  }
  Assert.lessOrEqual(
    blurredElementCount(),
    3,
    "and the blur budget is still three with it on"
  );

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_flat_preset_costs_no_blur() {
  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.preset", "flat"]],
  });

  is(
    document.documentElement.getAttribute("trance-surface"),
    "flat",
    "the preset applies live"
  );
  is(
    blurredElementCount(),
    0,
    "flat is translucency with zero Gaussian passes"
  );

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_regions_toggle_independently() {
  const root = document.documentElement;

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.region.sidebar", false]],
  });
  ok(
    !root.hasAttribute("trance-surface-sidebar"),
    "disabling a region removes its attribute, so its rules stop matching"
  );
  await SpecialPowers.popPrefEnv();

  ok(
    root.hasAttribute("trance-surface-sidebar"),
    "and re-enabling restores it"
  );
});

add_task(async function test_disabled_surfaces_cost_nothing() {
  const root = document.documentElement;

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.enabled", false]],
  });

  ok(!surfaces().enabled, "the feature reports disabled");
  ok(
    !window.gTrance.context.styles.loadedSheets.includes(SURFACE_SHEET),
    "its stylesheet is unloaded, not merely overridden"
  );
  ok(!root.hasAttribute("trance-surface"), "the preset attribute is gone");
  for (const { id } of [...REGIONS, CONTENT_REGION]) {
    ok(
      !root.hasAttribute(`trance-surface-${id}`),
      `the ${id} region attribute is gone`
    );
  }
  is(blurredElementCount(), 0, "and nothing is blurred");
  for (const selector of TRANSLUCENT_SELECTORS) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }
    is(
      window.getComputedStyle(element).opacity,
      "1",
      `${selector} is back to Zen's own opacity`
    );
  }

  await SpecialPowers.popPrefEnv();

  ok(surfaces().enabled, "re-enabling works without a restart");
});

add_task(async function test_zen_acrylic_is_restored() {
  // TranceSurfaces claims zen.theme.acrylic-elements so that Zen's own
  // compact-mode blur cannot stack with Trance's toolbar surface (ADR-011).
  // The contract is that it restores the user's value exactly.
  const original = Services.prefs.getBoolPref(
    "zen.theme.acrylic-elements",
    false
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.enabled", false]],
  });
  await SpecialPowers.popPrefEnv();

  is(
    Services.prefs.getBoolPref("zen.theme.acrylic-elements", false),
    original,
    "zen.theme.acrylic-elements survives a disable/enable cycle unchanged"
  );
});
