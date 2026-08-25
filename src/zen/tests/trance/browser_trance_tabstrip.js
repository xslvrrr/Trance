/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: tab strip acceptance tests (TRANCE.md §13 Phase 4).
 *
 * The Phase 4 acceptance criterion is a count, not a look: *one* observer
 * subscription for the whole tab strip, and at most two observer callbacks per
 * tab open. Five mods used to hold at least three MutationObservers on this one
 * subtree, so every chrome mutation fanned out to all of them (TRANCE.md §3.2).
 * That is what these tests pin down; the visual result needs a human.
 */

"use strict";

const TABSTRIP_SHEET =
  "chrome://browser/content/trance-styles/trance-tabstrip.css";

/** Every sub-feature: its pref, and the root attribute its rules gate on. */
const FLAGS = [
  {
    pref: "trance.tabstrip.connectors",
    attribute: "trance-tabstrip-connectors",
  },
  {
    pref: "trance.tabstrip.folders.arc-style",
    attribute: "trance-tabstrip-folders-arc",
  },
  {
    pref: "trance.tabstrip.pins.sticky",
    attribute: "trance-tabstrip-pins-sticky",
  },
  {
    pref: "trance.tabstrip.unloaded.enabled",
    attribute: "trance-tabstrip-unloaded",
  },
  { pref: "trance.tabstrip.rail.enabled", attribute: "trance-tabstrip-rail" },
  {
    pref: "trance.tabstrip.rail.stack-top-buttons",
    attribute: "trance-tabstrip-rail-stack",
  },
];

/**
 * Reads a Trance stylesheet's text. Not via `document.styleSheets`: Trance
 * loads its sheets through `nsIDOMWindowUtils.loadSheetUsingURIString`, which
 * puts them in the style set but not in the document's sheet list.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function sheetText(url) {
  const response = await fetch(url);
  return response.text();
}

function tabStrip() {
  return window.gTrance.features.find(f => f.name === "TabStrip");
}

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

add_task(async function test_feature_is_registered_and_enabled() {
  const feature = tabStrip();
  ok(feature, "the tab strip feature is constructed");
  ok(feature.enabled, "and enabled by default");
  ok(
    window.gTrance.context.styles.loadedSheets.includes(TABSTRIP_SHEET),
    "its stylesheet is loaded"
  );
  is(
    document.documentElement.getAttribute("trance-tabstrip"),
    "true",
    "the root carries the tab-strip attribute"
  );
});

add_task(async function test_one_subscription_for_the_whole_tab_strip() {
  // The hub keeps one MutationObserver for however many subscribers exist, so
  // the budget is stated in observers, which is what actually costs anything.
  Assert.lessOrEqual(
    window.gTrance.context.observers.observerCount,
    1,
    "the whole tab strip runs on one observer (TRANCE.md §3.2, §12.1)"
  );
});

add_task(async function test_tab_open_does_not_fan_out() {
  // Counters are only kept while `trance.debug` is on; that is the point of
  // them existing (TranceLog.count is free when off).
  await SpecialPowers.pushPrefEnv({ set: [["trance.debug", true]] });

  const { TranceLog } = ChromeUtils.importESModule(
    "chrome://browser/content/trance-components/TranceLog.mjs",
    { global: "current" }
  );
  TranceLog.resetCounters();

  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );
  await nextFrames();

  const callbacks = TranceLog.snapshot()["observer.mutation.callbacks"] ?? 0;
  Assert.lessOrEqual(
    callbacks,
    2,
    "at most two observer callbacks per tab open (TRANCE.md §13 Phase 4)"
  );

  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_sub_features_toggle_independently() {
  const root = document.documentElement;

  for (const { pref, attribute } of FLAGS) {
    const wasSet = root.hasAttribute(attribute);

    await SpecialPowers.pushPrefEnv({ set: [[pref, !wasSet]] });
    is(
      root.hasAttribute(attribute),
      !wasSet,
      `${pref} drives ${attribute}, so its rules stop matching when it is off`
    );
    await SpecialPowers.popPrefEnv();

    is(root.hasAttribute(attribute), wasSet, `${pref} restores cleanly`);
  }
});

add_task(async function test_rail_tokens_follow_their_prefs() {
  is(
    tokenValue("--trance-rail-width"),
    "48px",
    "the rail width token is bound"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.tabstrip.rail.width", 64]],
  });
  is(
    tokenValue("--trance-rail-width"),
    "64px",
    "a slider costs one setProperty, not a stylesheet rebuild"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_rail_spacing_is_additive() {
  // The regression this guards: the rail's two spacing prefs used to be written
  // as absolute paddings on #navigator-toolbox. That replaced Zen's own
  // `padding-bottom: var(--zen-toolbox-padding)` — the rail lost its bottom
  // padding — and stacked on top of the `#titlebar` padding Zen already applies
  // to clear the macOS window buttons, which pushed the sidebar icons down.
  is(
    tokenValue("--trance-rail-margin-top"),
    "0px",
    "extra space above defaults to nothing, so Zen's layout is untouched"
  );
  is(
    tokenValue("--trance-rail-margin-bottom"),
    "0px",
    "and so does extra space below"
  );

  const toolbox = document.getElementById("navigator-toolbox");
  if (toolbox && !toolbox.hasAttribute("zen-sidebar-expanded")) {
    const padding = window.getComputedStyle(toolbox);
    Assert.greater(
      parseFloat(padding.paddingBottom),
      0,
      "the collapsed rail keeps Zen's bottom padding at the default"
    );
  }
});

add_task(async function test_sticky_pins_do_not_paint_an_empty_band() {
  // The sticky pinned section is an occluder: it exists to hide tabs scrolling
  // beneath it. It used to borrow the frosted-chrome token for that, which
  // painted a dark band under the space name — and it painted that band even
  // when there were no pinned tabs to keep visible.
  const text = await sheetText(TABSTRIP_SHEET);

  ok(
    !text.includes("var(--trance-surface-bg)"),
    "the tab strip no longer reaches into the surface feature's tokens"
  );
  ok(
    text.includes("hide-separator"),
    "and the sticky treatment is gated on the section actually having pins"
  );

  for (const section of document.querySelectorAll(
    ".zen-workspace-pinned-tabs-section[hide-separator]"
  )) {
    is(
      window.getComputedStyle(section).position,
      "static",
      "an empty pinned section is not sticky and paints nothing"
    );
  }
});

add_task(async function test_rail_overrides_zen_without_important() {
  // Zen declares `--tab-min-width` and `--zen-toolbox-padding` !important on
  // :root but declares `--zen-toolbox-max-width` — the one the toolbox actually
  // consumes — normally. Trance re-declares it on the toolbox instead, which is
  // why this whole feature contains no `!important` (TRANCE.md §6.2 rule 1).
  ok(
    window.gTrance.context.styles.loadedSheets.includes(TABSTRIP_SHEET),
    "the tab-strip sheet is loaded"
  );

  // Comments stripped: this file explains at length why it has no `!important`,
  // and that explanation must not be what satisfies the assertion.
  const text = (await sheetText(TABSTRIP_SHEET)).replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );
  ok(!text.includes("!important"), "and it contains no !important at all");
});

add_task(async function test_folder_colours_need_no_storage() {
  const feature = tabStrip();
  ok(feature.enabled, "the feature is enabled");

  const menu = document.getElementById("trance-folder-color-menu");
  ok(menu, "the colour submenu is appended to Zen's own folder context menu");
  is(
    menu.parentElement.id,
    "zenFolderActions",
    "into Zen's popup, not a parallel menu of Trance's own"
  );
  // Nine platform colours plus a Default entry. Trance defines no palette.
  is(
    menu.querySelectorAll("menuitem").length,
    10,
    "nine platform colours and a default"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.tabstrip.folders.colors", false]],
  });
  ok(
    !document.getElementById("trance-folder-color-menu"),
    "turning the sub-feature off removes the menu item entirely"
  );
  await SpecialPowers.popPrefEnv();

  ok(
    document.getElementById("trance-folder-color-menu"),
    "and turning it back on restores it, without a restart"
  );
});

add_task(async function test_disabled_tab_strip_costs_nothing() {
  const root = document.documentElement;

  await SpecialPowers.pushPrefEnv({
    set: [["trance.tabstrip.enabled", false]],
  });

  ok(!tabStrip().enabled, "the feature reports disabled");
  ok(
    !window.gTrance.context.styles.loadedSheets.includes(TABSTRIP_SHEET),
    "its stylesheet is unloaded, not merely overridden"
  );
  ok(!root.hasAttribute("trance-tabstrip"), "the root attribute is gone");
  for (const { attribute } of FLAGS) {
    ok(!root.hasAttribute(attribute), `${attribute} is gone`);
  }
  ok(
    !document.getElementById("trance-folder-color-menu"),
    "the context-menu item is gone"
  );
  is(
    document.querySelectorAll("zen-folder[trance-folder-color]").length,
    0,
    "no folder is left marked"
  );
  is(
    window.gTrance.context.observers.observerCount,
    0,
    "and the shared observer is disconnected — nothing else was using it"
  );

  await SpecialPowers.popPrefEnv();

  ok(tabStrip().enabled, "re-enabling works without a restart");
});
