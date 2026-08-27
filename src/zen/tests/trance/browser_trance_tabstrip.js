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
  // No connectors entry: folder tree connectors are the preinstalled Zen Folder
  // Tree Connectors mod now, not a Trance sub-feature (ADR-027).
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

/**
 * The alpha of a computed colour, whatever Gecko chose to serialise it as. A
 * `color-mix()` result comes back as `rgb(r g b / a)`, so a check that only
 * understands `rgba(…)` reads every mixed colour as fully opaque.
 *
 * @param {string} color
 * @returns {number} 0..1
 */
function alphaOf(color) {
  if (!color || color === "transparent") {
    return 0;
  }
  const modern = color.match(/\/\s*([\d.]+%?)\s*\)/);
  if (modern) {
    const value = parseFloat(modern[1]);
    return modern[1].endsWith("%") ? value / 100 : value;
  }
  const legacy = color.match(/^rgba?\(([^)]*)\)/);
  if (legacy) {
    const parts = legacy[1].split(",");
    return parts.length > 3 ? parseFloat(parts[3]) : 1;
  }
  return 1;
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
    "60px",
    "the rail width token is bound, and defaults to Zen's own 60px rail"
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
    text.includes(".zen-workspace-pinned-tabs-section:has(tab)"),
    "and the sticky treatment is gated on the section actually having pins"
  );

  // `[hide-separator]` was the wrong test for "empty": Zen only sets it in some
  // of the empty cases, so a fresh profile with no pinned tabs still got a 22px
  // slab under the space name — a section holding nothing but its own
  // separator, painted as though it held something. `:has(tab)` asks the
  // question the rule means, so check every section rather than only the ones
  // Zen happened to flag.
  for (const section of document.querySelectorAll(
    ".zen-workspace-pinned-tabs-section"
  )) {
    if (section.querySelector("tab")) {
      continue;
    }
    const style = window.getComputedStyle(section);
    is(style.position, "static", "an empty pinned section is not sticky");
    is(
      alphaOf(style.backgroundColor),
      0,
      "and paints nothing under the space name"
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

add_task(async function test_the_sticky_slab_paints_only_over_something() {
  // The "folders have a grey background" report. Sticky positioning is free and
  // is unconditional; the *paint* is an occluder, and an occluder with nothing
  // passing under it is a grey block behind the pinned rows — which is exactly
  // what a pinned folder shows, because a folder paints no background of its
  // own.
  const text = await sheetText(TABSTRIP_SHEET);
  ok(
    text.includes("[overflowing]:not([scrolledtostart])"),
    "the background is gated on the scrollbox both scrolling and being scrolled"
  );

  for (const section of document.querySelectorAll(
    ".zen-workspace-pinned-tabs-section"
  )) {
    const scrollbox = section.closest(".workspace-arrowscrollbox");
    const scrolled =
      scrollbox?.hasAttribute("overflowing") &&
      !scrollbox.hasAttribute("scrolledtostart");
    if (scrolled) {
      continue;
    }
    is(
      alphaOf(window.getComputedStyle(section).backgroundColor),
      0,
      "a pinned section with nothing scrolling under it paints nothing"
    );
  }
});

add_task(async function test_trance_draws_no_folder_tree_connectors() {
  // Trance used to draw the trunk and the elbows itself. It preinstalls the mod
  // instead (ADR-027), and the point of that decision is that there is exactly
  // one owner — so the failure this guards against is Trance quietly growing a
  // second drawing of the same line back.
  const text = await sheetText(TABSTRIP_SHEET);
  ok(
    !text.includes(".zen-tab-group-start"),
    "the tab strip sheet does not style the folder container's trunk anchor"
  );
  ok(
    !text.includes("--trance-connector"),
    "and no connector token survives in it"
  );

  const width = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--trance-connector-width");
  is(width.trim(), "", "the token layer declares no connector width either");
});

add_task(async function test_the_collapsed_rail_does_not_indent_folders() {
  // Indentation is a depth cue only where depth is visible. In the icon rail
  // there are no labels and no tree line, so an indent is just a column of
  // icons that do not line up with the column above them.
  const text = await sheetText(TABSTRIP_SHEET);
  ok(
    text.includes("&:not([zen-sidebar-expanded]) .tab-group-container > *"),
    "the rail zeroes the folder indent for a folder's children"
  );
  ok(
    text.includes("--zen-folder-indent: 0px"),
    "and it does so by clearing the variable the margin rules read"
  );
});

add_task(async function test_the_active_tab_glow_is_opt_in_and_three_valued() {
  // `none` is not a mode that draws nothing — it is the absence of the
  // attribute, so no rule matches and no pseudo-element is generated. That
  // distinction is TRANCE.md §6.6 applied to a dropdown rather than to a
  // checkbox, and it is what this checks.
  const root = document.documentElement;

  ok(
    !root.hasAttribute("trance-tabstrip-glow"),
    "the glow is off by default: it is the one thing in the sidebar that " +
      "paints outside a tab's own box"
  );

  for (const mode of ["theme", "icon"]) {
    await SpecialPowers.pushPrefEnv({
      set: [["trance.tabstrip.glow.mode", mode]],
    });
    is(
      root.getAttribute("trance-tabstrip-glow"),
      mode,
      `${mode} publishes itself as the attribute the stylesheet gates on`
    );
    await SpecialPowers.popPrefEnv();
  }

  ok(
    !root.hasAttribute("trance-tabstrip-glow"),
    "and going back to none removes the attribute rather than setting it"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.tabstrip.glow.mode", "not-a-mode"]],
  });
  ok(
    !root.hasAttribute("trance-tabstrip-glow"),
    "a value from about:config that is not a mode reads as none"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(
  async function test_the_active_tab_glow_defaults_are_compact_and_vivid() {
    is(
      tokenValue("--trance-tab-glow-spread"),
      "6px",
      "the glow reaches 6px past its selected tab by default"
    );
    is(
      tokenValue("--trance-tab-glow-alpha"),
      "0.8",
      "the glow defaults to 80% strength"
    );
  }
);

add_task(async function test_the_glow_reaches_past_the_tab_it_belongs_to() {
  // The glow is drawn on the tab and not on `.tab-background`, because Zen
  // declares `overflow: hidden` on the latter — a glow drawn there is clipped
  // to exactly the box it exists to escape. The tab's own clipping is
  // `overflow: clip` with a margin, which is the same clipping with a dial on
  // it, so the dial is what has to be opened.
  const text = await sheetText(TABSTRIP_SHEET);
  ok(
    text.includes("overflow-clip-margin: var(--trance-tab-glow-spread)"),
    "the selected tab's clip margin is opened to the glow's reach"
  );
  ok(
    text.includes("overflow: clip"),
    "the selected tab creates a clipping box so its clip margin can apply"
  );
  ok(
    text.includes("border-radius: 50% 50% 0 0 / 100% 100% 0 0"),
    "and the shape is a half-ellipse: out past the top and sides, flush at " +
      "the bottom where the tab sits on the row below it"
  );
});

add_task(async function test_the_glow_stops_at_the_tab_container() {
  // "Reaches past the tab" and "reaches out of the sidebar" are two different
  // things, and the clip margin above only bounds the first. Without an outer
  // bound the glow on a tab near either end of the list spilled over the
  // essentials grid and out of the strip entirely.
  await SpecialPowers.pushPrefEnv({
    set: [["trance.tabstrip.glow.mode", "theme"]],
  });

  const container = document.getElementById("tabbrowser-tabs");
  ok(container, "#tabbrowser-tabs exists");
  if (!container) {
    await SpecialPowers.popPrefEnv();
    return;
  }
  const style = window.getComputedStyle(container);
  is(style.overflowX, "clip", "the container clips while the glow is on");
  is(
    style.overflowClipMargin,
    "0px",
    "with no margin: the container is the boundary being asked for"
  );

  // And the selected tab is raised above its neighbours, or the part of the
  // glow that reaches into the row below is painted over by that row.
  const selected = gBrowser.selectedTab;
  is(
    window.getComputedStyle(selected).overflowX,
    "clip",
    "the selected tab creates the clipping box its reach depends on"
  );
  Assert.greater(
    parseInt(window.getComputedStyle(selected).zIndex, 10) || 0,
    0,
    "the selected tab stacks above the rows its glow reaches into"
  );

  await SpecialPowers.popPrefEnv();
  isnot(
    window.getComputedStyle(container).overflowX,
    "clip",
    "and the clip goes away with the glow — a switched-off feature costs nothing"
  );
});

add_task(async function test_the_collapsed_rail_keeps_tab_overlays_visible() {
  const text = await sheetText(TABSTRIP_SHEET);
  ok(
    text.includes('&:not([zen-sidebar-expanded="true"]) .tab-icon-overlay'),
    "the collapsed rail sizes icon overlays with favicons"
  );
});

add_task(
  async function test_icon_mode_paints_a_colour_and_not_a_blurred_icon() {
    // It used to draw the favicon itself behind a `blur()` as wide as the spread,
    // which is a Gaussian pass on the busiest element in the sidebar re-run on
    // every repaint — and which reveals the average of the icon and the empty
    // space around it rather than the icon's colour (ADR-047).
    const text = await sheetText(TABSTRIP_SHEET);
    ok(
      !text.includes("--trance-tab-glow-image"),
      "the favicon is not painted into the glow any more"
    );
    ok(text.includes("var(--trance-tab-glow-color)"), "a sampled colour is");
    ok(
      !/filter: blur\(var\(--trance-tab-glow-spread\)\)/.test(text),
      "and the blur that made it expensive is gone"
    );
  }
);
