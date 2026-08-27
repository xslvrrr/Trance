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

/**
 * Every element that may carry a `backdrop-filter`, which is now two.
 *
 * The per-region switches are gone (ADR-040): the frost is one layer on
 * `#zen-main-app-wrapper`, spanning the sidebar, the toolbar and the space
 * around the page, and the expanded address bar keeps its own because it floats
 * over the page rather than over the chrome.
 */
const SURFACES = [
  { id: "app", selector: "#zen-main-app-wrapper" },
  { id: "overlay", selector: "#urlbar" },
];

/**
 * The web view, which is never blurred and no longer has a region of its own.
 * The `content` region — a translucent backdrop for websites — is removed
 * (ADR-042); a blurred content pane was never in the budget either, being
 * full-window with a backdrop that changes on every scrolled frame (ADR-019).
 */
const CONTENT_PANE_SELECTOR = "#tabbrowser-tabpanels browser[type='content']";

/**
 * The two elements the transparency switch makes translucent. Frosting is the
 * chrome getting out of the way, not a tint painted over it — see the header of
 * trance-surfaces.css.
 */
const TRANSLUCENT_SELECTORS = [
  "#zen-browser-background",
  "#zen-toolbar-background",
];

function surfaces() {
  return window.gTrance.features.find(f => f.name === "Surfaces");
}

/**
 * The alpha of a computed colour, whatever Gecko chose to serialise it as.
 *
 * A `color-mix(in srgb, …)` result comes back as `rgb(r g b / a)`, not as
 * `rgba(r, g, b, a)`, so a check that only understands the legacy form reads
 * every mixed colour as fully opaque — which is the wrong answer for exactly
 * the token this file exists to check.
 *
 * @param {string} color - A computed `background-color`.
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

function blurredElementCount() {
  let count = 0;
  for (const { selector } of SURFACES) {
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
    document.documentElement.getAttribute("trance-surface-transparent"),
    "true",
    "and the transparency master is on, so the chrome is translucent"
  );
});

add_task(async function test_blur_budget_is_respected() {
  Assert.lessOrEqual(
    blurredElementCount(),
    3,
    "at most three blurred surfaces per window (TRANCE.md §3.3)"
  );

  // Nesting is the one case strictly worse than either surface alone: the
  // parent has to be resolved before the child can sample it. The one chrome
  // layer is an ancestor of everything, so nothing else in the chrome may
  // carry a filter of its own.
  const wrapper = document.querySelector("#zen-main-app-wrapper");
  const toolbox = document.querySelector("#navigator-toolbox");
  if (wrapper && toolbox && wrapper.contains(toolbox)) {
    is(
      window.getComputedStyle(toolbox).backdropFilter,
      "none",
      "blur surfaces are never nested"
    );
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
  const wrapper = document.querySelector("#zen-main-app-wrapper");
  const background = window.getComputedStyle(wrapper).backgroundImage;
  ok(
    background.includes("linear-gradient"),
    `the one surface paints a sheen layer (${background})`
  );
});

add_task(async function test_translucency_follows_the_master_switch() {
  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.transparency", false]],
  });

  ok(
    !document.documentElement.hasAttribute("trance-surface-transparent"),
    "the master switch takes its attribute off"
  );
  for (const selector of TRANSLUCENT_SELECTORS) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }
    is(
      window.getComputedStyle(element).opacity,
      "1",
      `${selector} is opaque again with transparency off`
    );
  }

  await SpecialPowers.popPrefEnv();

  ok(
    document.documentElement.hasAttribute("trance-surface-transparent"),
    "and turning it back on restores it"
  );
});

add_task(async function test_there_is_no_content_region_left() {
  // ADR-042 removed it. The assertion is not "the pref is false" — a pref that
  // still exists is a pref that can be turned on — but that nothing anywhere
  // answers to it any more.
  const root = document.documentElement;

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.region.content", true]],
  });

  ok(
    !root.hasAttribute("trance-surface-content"),
    "setting the removed pref does nothing: there is no attribute for it"
  );

  const pane = document.querySelector(CONTENT_PANE_SELECTOR);
  if (pane) {
    is(
      window.getComputedStyle(pane).backdropFilter,
      "none",
      "and the content pane is still never part of the blur budget"
    );
  }

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_the_empty_tab_mark_follows_the_selected_tab() {
  const root = document.documentElement;

  // The mark is drawn by the chrome over the content pane, so what is asserted
  // here is the attribute that gates it and the element it gates — not a
  // computed background on a page this test cannot reach into.
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    is(
      root.getAttribute("trance-surface-newtab"),
      "true",
      "a blank tab is an empty tab"
    );
    ok(
      document.getElementById("trance-newtab-logo"),
      "and the mark exists while there is one configured"
    );
  });

  await BrowserTestUtils.withNewTab("https://example.com/", async () => {
    ok(
      !root.hasAttribute("trance-surface-newtab"),
      "a tab with a page in it is not"
    );
  });

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.newtab.logo", ""]],
  });
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    ok(
      !document.getElementById("trance-newtab-logo"),
      "no mark configured, no element: an empty setting costs nothing"
    );
  });
  await SpecialPowers.popPrefEnv();
});

add_task(
  async function test_the_mark_reacts_to_the_pointer_and_stops_when_it_should() {
    const root = document.documentElement;

    is(
      window
        .getComputedStyle(root)
        .getPropertyValue("--trance-newtab-logo-size")
        .trim(),
      "250px",
      "the mark is a watermark behind an empty page, not the page's content"
    );

    await BrowserTestUtils.withNewTab("about:blank", async () => {
      is(
        root.getAttribute("trance-surface-newtab-holographic"),
        "true",
        "the sheen is on by default"
      );
      is(
        root.getAttribute("trance-surface-newtab-tilt"),
        "true",
        "so is the tilt"
      );

      const logo = document.getElementById("trance-newtab-logo");
      ok(logo, "the mark exists to be pointed at");
      if (!logo) {
        return;
      }

      // The pointer position is written on the element, not on the root: it
      // changes on every frame the mouse is moving, and on the root that would
      // re-resolve every rule in every Trance sheet.
      const rect = logo.getBoundingClientRect();
      EventUtils.synthesizeMouse(
        document.documentElement,
        rect.left + rect.width * 0.75,
        rect.top + rect.height / 2,
        { type: "mousemove" },
        window
      );
      await TestUtils.waitForCondition(
        () => logo.style.getPropertyValue("--trance-newtab-logo-px") !== "",
        "the mark learns where the pointer is"
      );
      Assert.greater(
        parseFloat(logo.style.getPropertyValue("--trance-newtab-logo-px")),
        0,
        "and a pointer right of centre reads as positive"
      );
      Assert.less(
        Math.abs(
          parseFloat(logo.style.getPropertyValue("--trance-newtab-logo-py"))
        ),
        0.02,
        "a pointer on the horizontal centre stays vertically centred"
      );

      EventUtils.synthesizeMouse(
        document.documentElement,
        rect.left + rect.width / 2,
        rect.top + rect.height * 0.75,
        { type: "mousemove" },
        window
      );
      await TestUtils.waitForCondition(
        () =>
          parseFloat(logo.style.getPropertyValue("--trance-newtab-logo-py")) >
          0,
        "the mark learns vertical pointer movement too"
      );

      // Switching hover off detaches the listener and puts the mark back to
      // level by *removing* the properties, so what it falls back to is the
      // token rather than a second opinion about what "at rest" means.
      await SpecialPowers.pushPrefEnv({
        set: [["trance.surface.newtab.logo.hover", false]],
      });
      is(
        logo.style.getPropertyValue("--trance-newtab-logo-px"),
        "",
        "with hover off the mark is level again"
      );
      await SpecialPowers.popPrefEnv();
    });

    // And the listener is not held for a tab that has a page in it — a
    // `mousemove` handler that runs during every scroll of every page is exactly
    // what TRANCE.md §3.2 is about.
    await BrowserTestUtils.withNewTab("https://example.com/", async () => {
      ok(
        !root.hasAttribute("trance-surface-newtab"),
        "the mark is not shown, so there is nothing to react"
      );
    });
  }
);

add_task(async function test_the_background_image_is_off_until_asked_for() {
  const root = document.documentElement;
  ok(
    !root.hasAttribute("trance-surface-image"),
    "no image, no pseudo-element — a box costs a box whether or not its " +
      "background resolves to anything"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.image", "file:///tmp/trance-test-texture.png"]],
  });

  is(root.getAttribute("trance-surface-image"), "true", "and it turns on live");
  const image = window
    .getComputedStyle(root)
    .getPropertyValue("--trance-surface-image");
  ok(
    image.includes("trance-test-texture.png"),
    `the token carries the chosen file (${image})`
  );

  await SpecialPowers.popPrefEnv();
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
  for (const attribute of [
    "trance-surface-transparent",
    "trance-surface-edgeless",
    "trance-surface-image",
    "trance-surface-newtab",
    "trance-surface-newtab-holographic",
    "trance-surface-newtab-tilt",
    "trance-surface-internal",
  ]) {
    ok(!root.hasAttribute(attribute), `${attribute} is gone`);
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

add_task(async function test_the_visibility_attribute_is_set_at_startup() {
  // The regression this guards, and it is the largest one this phase has had:
  // every `backdrop-filter` in trance-surfaces.css is gated on
  // `trance-surface-visible`, and that attribute was only ever set from a
  // `focus` event. A chrome window that is already frontmost when the feature
  // initialises never fires one — which is every startup, because TranceCore
  // enters at MozBeforeInitialXULLayout. The blur budget was three surfaces of
  // which zero were ever drawn, for the whole session, and the blur radius
  // slider was correctly reported as doing nothing.
  //
  // Focus the window first so the assertion is about the bug rather than about
  // whatever had focus when the harness started.
  await SimpleTest.promiseFocus(window);

  is(
    document.documentElement.getAttribute("trance-surface-visible"),
    "true",
    "a focused, unoccluded window is marked visible without waiting for an event"
  );
});

add_task(async function test_keeping_transparency_unfocused_claims_zens_pref() {
  // `zen.view.grey-out-inactive-windows` decides whether the macOS window
  // material follows the window's active state. It is claimed, not mirrored, so
  // the contract is the same as zen.theme.acrylic-elements': it is only touched
  // while the opt-in is on, and the user's value comes back afterwards
  // (ADR-011).
  const PREF = "zen.view.grey-out-inactive-windows";
  const original = Services.prefs.getBoolPref(PREF, true);

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.keep-transparent-unfocused", true]],
  });
  is(
    Services.prefs.getBoolPref(PREF, true),
    false,
    "turning the opt-in on stops the window material greying out when inactive"
  );

  await SpecialPowers.popPrefEnv();
  is(
    Services.prefs.getBoolPref(PREF, true),
    original,
    "and turning it off gives the user's value back"
  );
});

add_task(async function test_internal_pages_claim_page_transparency() {
  // A CSS background on the <browser> sits behind the content process's canvas,
  // and the canvas is opaque — so on its own the declaration could only ever
  // tint the rounded corners, which is what "no proper page transparency
  // support" meant. `browser.tabs.allow_transparent_browser` is what makes
  // tabbrowser build browsers with `transparent="true"`, which is what makes the
  // canvas composite with alpha. Two switches want it — internal pages, and
  // edgeless, whose "the pane paints nothing" only means anything if there is
  // something behind the pane to show. The `content` region that used to share
  // it is gone (ADR-042).
  const PREF = "browser.tabs.allow_transparent_browser";

  ok(
    Services.prefs.getBoolPref(PREF, false),
    "internal-page transparency turns real page transparency on"
  );

  // One switch off is not enough, and that is the point: edgeless declares
  // `background: transparent` on the content browser, so an opaque canvas
  // underneath leaves the content process's own white or near-black showing —
  // a rectangle in a slightly different colour from the rest of the window,
  // which is the exact seam edgeless exists to remove.
  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.internal-pages", false]],
  });
  ok(
    Services.prefs.getBoolPref(PREF, false),
    "edgeless still wants it with internal pages switched off"
  );
  await SpecialPowers.popPrefEnv();

  await SpecialPowers.pushPrefEnv({
    set: [
      ["trance.surface.internal-pages", false],
      ["trance.surface.edgeless", false],
    ],
  });
  ok(
    !Services.prefs.getBoolPref(PREF, false),
    "and gives the user's value back when nothing wants it"
  );

  await SpecialPowers.popPrefEnv();
  ok(
    Services.prefs.getBoolPref(PREF, false),
    "turning it back on claims it again"
  );
});

add_task(
  async function test_the_page_opacity_slider_writes_once_not_per_pixel() {
    // The bug: `trance.surface.internal.opacity` shared `#applyShape` with four
    // other prefs, and `#applyShape` swaps a registered `nsIStyleSheetService`
    // user sheet — a synchronous parse plus a style-data invalidation of every
    // document in the application. A `range` input notifies on every pixel of a
    // drag, so a sweep across the slider was a hundred of those and the browser
    // stopped responding (ADR-046).
    //
    // What is asserted is the coalescing rather than the timing: a burst of
    // writes must leave exactly one sheet registered, and it must be the one for
    // the value the slider stopped on.
    const registered = () => {
      const service = Cc[
        "@mozilla.org/content/style-sheet-service;1"
      ].getService(Ci.nsIStyleSheetService);
      return percent =>
        service.sheetRegistered(
          Services.io.newURI(
            "data:text/css;charset=utf-8," +
              encodeURIComponent(
                `@-moz-document url-prefix("about:"){:root{--trance-internal-alpha:${percent}%}}`
              )
          ),
          service.USER_SHEET
        );
    };
    const isRegistered = registered();

    for (let value = 30; value <= 40; value++) {
      Services.prefs.setIntPref("trance.surface.internal.opacity", value);
    }

    await TestUtils.waitForCondition(
      () => isRegistered(40),
      "the value the slider stopped on is the one that lands"
    );
    for (const skipped of [30, 33, 36, 39]) {
      ok(
        !isRegistered(skipped),
        `${skipped}% was passed through and never registered a sheet`
      );
    }

    Services.prefs.clearUserPref("trance.surface.internal.opacity");
  }
);

add_task(async function test_toggling_transparency_re_marks_live_browsers() {
  // The regression this exists for: `#releaseTransparentBrowser` strips
  // `transparent="true"` from every live browser — it has to, or a Trance-less
  // window keeps a white veil over the page — and nothing put it back when the
  // switch came on again, because `tabbrowser` only reads the pref when it
  // *creates* a browser. The already-open tab therefore kept the wrong
  // background until it was closed and reopened, which reads as "until
  // restart".
  await BrowserTestUtils.withNewTab("about:blank", async browser => {
    await SpecialPowers.pushPrefEnv({
      set: [["trance.surface.internal-pages", false]],
    });
    await SpecialPowers.popPrefEnv();

    is(
      browser.getAttribute("transparent"),
      "true",
      "a browser that was open across the round trip is marked again"
    );
  });
});

add_task(
  async function test_surface_saturation_reaches_the_chrome_background() {
    // Saturation used to live only inside the `backdrop-filter`, and on macOS a
    // chrome region's backdrop is the transparent window surface — the frost
    // comes from an NSVisualEffectView *behind* Gecko. So the slider had nothing
    // to act on and was reported as inert. It now also applies to Zen's own
    // background elements, which is the thing a person moving a slider called
    // "surface saturation" is looking at.
    const background = document.querySelector("#zen-browser-background");
    ok(background, "#zen-browser-background exists");
    if (!background) {
      return;
    }

    await SpecialPowers.pushPrefEnv({
      set: [["trance.surface.saturation", 200]],
    });
    is(
      window.getComputedStyle(background).filter,
      "saturate(2)",
      "the saturation pref reaches the element the gradient is painted on"
    );
    await SpecialPowers.popPrefEnv();
  }
);

add_task(async function test_a_translucent_window_carries_no_backdrop_filter() {
  // The most consequential thing this feature has learned, and the answer to
  // three separate reports at once: on a platform whose window is translucent
  // in its own right — macOS vibrancy, Windows Mica, a transparent GTK window —
  // the frost is produced behind Gecko by the compositor. A `backdrop-filter`
  // over that does not soften it; it establishes a backdrop root, filters the
  // empty region behind the element and composites the result over the
  // transparent area, replacing the operating system's frost with flat black.
  //
  // Measured, not theorised: with the filter on #navigator-toolbox the sidebar
  // rendered solid black, and with identical translucency and no filter it
  // rendered as glass over the desktop.
  const translucentWindow = window.matchMedia(
    "(-moz-windows-mica) or (-moz-platform: macos) or " +
      "((-moz-platform: linux) and (-moz-pref('zen.widget.linux.transparency')))"
  ).matches;

  if (!translucentWindow) {
    Assert.lessOrEqual(
      blurredElementCount(),
      3,
      "an opaque window keeps the three-surface budget (TRANCE.md §3.3)"
    );
    return;
  }

  is(
    blurredElementCount(),
    0,
    "a translucent window spends none of the blur budget: the compositor is " +
      "the frost, and filtering it would paint black over it"
  );
});

add_task(async function test_page_transparency_reaches_a_real_tab() {
  // Checked end to end rather than at the pref: a CSS background on the
  // <browser> sits behind the content process's canvas, so "the pref is set"
  // proves nothing about whether a page is actually translucent.
  //
  // `tabbrowser.js` reads `browser.tabs.allow_transparent_browser` when it
  // *creates* a browser, so the tab has to be opened after the switch is on —
  // which is also why the settings page says the change reaches pages opened
  // from that point rather than pretending it is retroactive.
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );
  try {
    is(
      tab.linkedBrowser.getAttribute("transparent"),
      "true",
      "a tab opened with internal-page transparency on is built with a " +
        "transparent canvas"
    );

    const background = window.getComputedStyle(tab.linkedBrowser).background;
    ok(
      background.includes("none") || alphaOf(background) < 1,
      `and the pane behind it paints nothing of its own (${background})`
    );
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_the_frost_is_one_layer() {
  // The frost is one surface on `#zen-main-app-wrapper` — the sidebar, the
  // toolbar and the space around the page at once — and nothing inside it
  // paints a second. Check both halves: the layer is painted, and the elements
  // the per-region switches used to own are not.
  is(
    document.documentElement.getAttribute("trance-surface-edgeless"),
    "true",
    "edgeless is on by default"
  );

  const wrapper = document.getElementById("zen-main-app-wrapper");
  ok(wrapper, "#zen-main-app-wrapper exists");
  // A background *layer*, not a background colour: Zen paints the browser's
  // base colour on this element with the `background` shorthand, and replacing
  // that would make Trance responsible for what an opaque window looks like on
  // every platform. `#browser` — the obvious element — is unusable because Zen
  // declares `background: transparent !important` on it.
  const layer = window.getComputedStyle(wrapper).backgroundImage;
  ok(
    layer.includes("gradient"),
    `the single frost layer is painted over Zen's own colour (${layer})`
  );
  ok(
    layer.includes("color-mix") || alphaOf(layer) < 1,
    "and it is a sheen, not an opaque fill"
  );

  const toolbox = document.getElementById("navigator-toolbox");
  is(
    window
      .getComputedStyle(toolbox)
      .getPropertyValue("--zen-navigator-toolbox-background"),
    "",
    "and the sidebar's own sheen is not also painted"
  );

  Assert.lessOrEqual(
    blurredElementCount(),
    2,
    "the chrome layer, and at most the expanded address bar on top of it"
  );
});

add_task(
  async function test_edgeless_squares_only_the_corners_that_meet_an_edge() {
    // Two wrong answers preceded this one, in opposite directions.
    //
    //   1. One rounded corner beside the sidebar's top, kept "so that the sidebar
    //      and the page still read as two things" — but the *other* three were
    //      arbitrary, and which corner it was had to be restated for every layout
    //      Zen adds.
    //   2. All four square, unconditionally. That squares the corner on the
    //      sidebar side, where there is no window edge to meet, and it removes
    //      nothing: the edge it was smoothing was internal.
    //
    // The rule is neither. A corner is square when one of its edges runs along
    // the window, rounded when neither does — so in the shipped layout exactly
    // one survives, on the sidebar side, and it moves with the sidebar.
    const container = document.querySelector(
      "#tabbrowser-tabpanels .browserSidebarContainer.deck-selected"
    );
    if (!container) {
      info("no selected sidebar container in this window; nothing to check");
      return;
    }
    const style = window.getComputedStyle(container);
    const radius = corner => parseFloat(style[corner]);

    const mirrored =
      document.documentElement.getAttribute("zen-right-side") === "true";
    const near = mirrored ? "borderTopRightRadius" : "borderTopLeftRadius";
    const far = mirrored ? "borderTopLeftRadius" : "borderTopRightRadius";

    // The bottom is the bottom of the window in every layout.
    is(radius("borderBottomLeftRadius"), 0, "the bottom-left meets the window");
    is(radius("borderBottomRightRadius"), 0, "and so does the bottom-right");
    is(radius(far), 0, `${far} meets the far side of the window`);

    // The top corner on the sidebar side depends on whether anything is above the
    // pane. Both answers are correct; what must not happen is a rounded corner on
    // an edge that touches the window.
    const singleToolbar =
      document.documentElement.getAttribute("zen-single-toolbar") === "true";
    const bookmarks =
      document.documentElement.hasAttribute("zen-has-bookmarks");
    if (singleToolbar && !bookmarks) {
      is(radius(near), 0, `${near} meets the top of the window too`);
    } else {
      Assert.greater(
        radius(near),
        0,
        `${near} meets the sidebar and the toolbar, not the window`
      );
    }

    is(
      style.boxShadow,
      "none",
      "and the web view casts no shadow: it is not floating"
    );
  }
);

add_task(async function test_the_page_recede_clip_uses_the_same_corners() {
  // The clip-path in trance-chrome.css had its own radius —
  // `--zen-webview-border-radius`, Zen's number for a floating card — so an
  // edgeless window squared the pane and the clip rounded every corner straight
  // back. One source of truth, two consumers.
  const wrapper = document.getElementById("zen-tabbox-wrapper");
  ok(wrapper, "#zen-tabbox-wrapper exists");
  if (!wrapper) {
    return;
  }
  const container = document.querySelector(
    "#tabbrowser-tabpanels .browserSidebarContainer.deck-selected"
  );
  if (!container) {
    info("no selected sidebar container in this window; nothing to check");
    return;
  }

  const paneStyle = window.getComputedStyle(container);
  const wrapperStyle = window.getComputedStyle(wrapper);
  for (const token of [
    "--trance-webview-radius-tl",
    "--trance-webview-radius-tr",
    "--trance-webview-radius-br",
    "--trance-webview-radius-bl",
  ]) {
    const value = wrapperStyle.getPropertyValue(token).trim();
    ok(value, `${token} resolves on the wrapper (${value})`);
  }

  const clip = wrapperStyle.clipPath;
  isnot(clip, "none", "the clip is live while the address-bar recede is on");
  // The bottom of the pane is flush with the window, so the clip must not round
  // it — whatever else it does.
  is(
    parseFloat(paneStyle.borderBottomLeftRadius),
    0,
    "and the pane it is clipping is square at the bottom"
  );
});

add_task(async function test_edgeless_paints_one_gradient_not_two() {
  // Zen renders the workspace gradient twice: `#zen-browser-background` across
  // the whole browser area, and `#zen-toolbar-background` across the vertical
  // tab strip, from a *separately generated* `-toolbar` variant. Both are inline
  // styles on those elements, so the seam between them cannot be re-pointed
  // without `!important` — edgeless stops painting the second copy instead.
  const toolbarBackground = document.querySelector("#zen-toolbar-background");
  ok(toolbarBackground, "#zen-toolbar-background exists");
  if (!toolbarBackground) {
    return;
  }
  is(
    window.getComputedStyle(toolbarBackground).display,
    "none",
    "the tab strip's own gradient is not painted while edgeless is on"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.edgeless", false]],
  });
  Assert.notEqual(
    window.getComputedStyle(toolbarBackground).display,
    "none",
    "and it comes back with edgeless off, where the two panes are two panes"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(
  async function test_internal_pages_are_translucent_but_websites_are_not() {
    // Two halves that have to agree. The page half is a USER sheet registered
    // against `about:` documents, because no chrome stylesheet is in scope inside
    // a content document. The chrome half is the `<browser>` element, which has to
    // stop painting a backdrop for those pages only — the platform switch this
    // needs is per-browser, not per-URL, so without the marker every website
    // would go translucent too.
    is(
      document.documentElement.getAttribute("trance-surface-internal"),
      "true",
      "internal-page transparency is on by default"
    );

    const uri = Services.io.newURI(
      "chrome://browser/content/trance-styles/trance-internal.css"
    );
    const sheets = Cc["@mozilla.org/content/style-sheet-service;1"].getService(
      Ci.nsIStyleSheetService
    );
    ok(
      sheets.sheetRegistered(uri, sheets.USER_SHEET),
      "the about: user sheet is registered"
    );

    const settings = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      "about:preferences"
    );
    const site = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      "about:blank"
    );
    try {
      is(
        settings.linkedBrowser.getAttribute("trance-internal-page"),
        "true",
        "an about: page is marked"
      );
      Assert.less(
        alphaOf(
          window.getComputedStyle(settings.linkedBrowser).backgroundColor
        ),
        1,
        "and its browser paints no backdrop, so the page's own alpha shows the window"
      );

      // about:blank is also an about: page, so use the marker rather than the URL
      // to say what the *unmarked* case looks like.
      site.linkedBrowser.removeAttribute("trance-internal-page");
      const background = window.getComputedStyle(site.linkedBrowser).background;
      ok(
        !background.startsWith("rgba(0, 0, 0, 0)"),
        `an unmarked browser keeps an opaque backdrop (${background})`
      );
    } finally {
      BrowserTestUtils.removeTab(site);
      BrowserTestUtils.removeTab(settings);
    }
  }
);

add_task(async function test_the_internal_page_frost_follows_its_own_switch() {
  // The frost behind the browser's own pages: a `backdrop-filter` on the
  // `<browser>` holding an `about:` page, gated on its own pref *and* on the
  // switch above it — blurring what is behind an opaque page is a pass spent on
  // something nobody can see (ADR-026).
  is(
    document.documentElement.getAttribute("trance-surface-internal-blur"),
    "true",
    "the frost is on by default, because internal-page transparency is"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.internal-pages", false]],
  });
  is(
    document.documentElement.getAttribute("trance-surface-internal-blur"),
    null,
    "and it is dropped with the pages it frosts, not left running behind them"
  );
  await SpecialPowers.popPrefEnv();

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.internal.blur", false]],
  });
  is(
    document.documentElement.getAttribute("trance-surface-internal-blur"),
    null,
    "and its own switch turns it off while the pages stay translucent"
  );
  is(
    document.documentElement.getAttribute("trance-surface-internal"),
    "true",
    "which is the point of it being a separate switch"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_edgeless_paints_the_page_the_same_colour() {
  // "The same colour as the surroundings" was previously
  // `--zen-main-browser-background`: the workspace gradient at full strength,
  // where what the chrome around the pane actually shows is that gradient at
  // `--trance-surface-alpha`, over the window's own translucency, under the
  // edgeless sheen. Three layers against one, so the pane read as a slightly
  // different shade — a visible rectangle wherever the page did not paint.
  //
  // Transparent is the only value that cannot be a near miss.
  const browser = gBrowser.selectedBrowser;
  ok(browser, "there is a selected browser");
  if (!browser) {
    return;
  }
  const backgroundColor = () =>
    window.getComputedStyle(browser).backgroundColor;

  is(
    backgroundColor(),
    "rgba(0, 0, 0, 0)",
    `the content pane paints nothing of its own (${backgroundColor()})`
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.surface.edgeless", false]],
  });
  isnot(
    backgroundColor(),
    "rgba(0, 0, 0, 0)",
    "and with edgeless off the pane is a card again, with its own backdrop"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_edgeless_reaches_the_window_edge() {
  // The bug this pins down: Trance's `margin: 0` sat at a *lower* specificity
  // than the rule in zen-browser-ui.css that insets the web view, so Zen won
  // and "edgeless" still left a gutter down the right-hand side and along the
  // bottom. Only two edges were wrong — Zen zeroes the top and the sidebar side
  // itself — which is why it read as a rounding error rather than as a dead
  // declaration.
  const wrapper = document.getElementById("zen-tabbox-wrapper");
  ok(wrapper, "#zen-tabbox-wrapper exists");

  const style = window.getComputedStyle(wrapper);
  for (const side of [
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
  ]) {
    is(
      parseFloat(style[side]),
      0,
      `the web view has no ${side} while edgeless is on (${style[side]})`
    );
  }
});
