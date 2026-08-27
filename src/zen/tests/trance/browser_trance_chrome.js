/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: chrome furniture acceptance tests (TRANCE.md §13 Phase 5).
 *
 * Phase 5's acceptance is three claims, and all three are still checkable now
 * that the icon packs are gone (ADR-039):
 *
 *   "no duplicate glyphs"       → Trance ships no glyph the browser already
 *                                 draws, so there is no second owner to find
 *   "no data-URI icons in CSS"  → every glyph Trance does ship is a chrome://
 *                                 URL to a real file
 *   "every sub-feature independently toggleable with zero residual cost"
 *                               → one attribute each, gone when the pref is off
 *
 * Four mods used to ship four copies of the same glyph set, inlined into CSS as
 * data URIs — the same padlock parsed four times and cached never
 * (TRANCE.md §3.8). Trance's answer is now to ship none of them.
 */

"use strict";

const CHROME_SHEET = "chrome://browser/content/trance-styles/trance-chrome.css";
/** Every sub-feature: its pref, and the root attribute its rules gate on. */
const FLAGS = [
  { pref: "trance.chrome.panels.enabled", attribute: "trance-chrome-panels" },
  { pref: "trance.chrome.menus.tint", attribute: "trance-chrome-menus" },
  {
    pref: "trance.chrome.logo-menu-button",
    attribute: "trance-chrome-logo",
  },
  {
    pref: "trance.chrome.urlbar.hide-extension-name",
    attribute: "trance-chrome-urlbar-noextname",
  },
  {
    pref: "trance.chrome.urlbar.focus-dim",
    attribute: "trance-chrome-urlbar-dim",
  },
  {
    pref: "trance.chrome.urlbar.focus-blur",
    attribute: "trance-chrome-urlbar-blur",
  },
  {
    pref: "trance.chrome.topbuttons.reveal-on-hover",
    attribute: "trance-chrome-topbuttons",
  },
];

function chrome() {
  return window.gTrance.features.find(f => f.name === "Chrome");
}

function loadedSheets() {
  return window.gTrance.context.styles.loadedSheets;
}

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

function tokenValue(name) {
  return window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

add_task(async function test_feature_is_registered_and_enabled() {
  const feature = chrome();
  ok(feature, "the chrome feature is constructed");
  ok(feature.enabled, "and enabled by default");
  ok(loadedSheets().includes(CHROME_SHEET), "its stylesheet is loaded");
  is(
    loadedSheets().filter(url => url.includes("trance-icons")).length,
    0,
    "and no icon-pack sheet exists to load — Trance ships none (ADR-039)"
  );
});

add_task(async function test_sub_features_toggle_independently() {
  const root = document.documentElement;

  for (const { pref, attribute } of FLAGS) {
    const wasSet = root.hasAttribute(attribute);

    await SpecialPowers.pushPrefEnv({ set: [[pref, !wasSet]] });
    is(
      root.hasAttribute(attribute),
      !wasSet,
      `${pref} owns exactly ${attribute}, and nothing else moved`
    );
    await SpecialPowers.popPrefEnv();

    is(root.hasAttribute(attribute), wasSet, `${pref} restores cleanly`);
  }
});

add_task(async function test_tokens_follow_their_prefs() {
  is(tokenValue("--trance-icon-scale"), "1", "100% is the identity scale");
  is(tokenValue("--trance-menu-icon-size"), "16px", "and the identity size");

  // Stored as percent dimmed, consumed as a brightness multiplier: the pref is
  // the way a person thinks about it and the token is what CSS needs.
  is(tokenValue("--trance-urlbar-dim"), "0.7", "30% dim is brightness(0.7)");

  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.urlbar.focus-dim.strength", 50]],
  });
  is(tokenValue("--trance-urlbar-dim"), "0.5", "and it follows the slider");
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_no_important_anywhere() {
  ok(loadedSheets().includes(CHROME_SHEET), "the chrome sheet is loaded");
  const text = await sheetText(CHROME_SHEET);
  // The comment block explains why there is none; strip comments so the
  // explanation cannot satisfy the assertion.
  const rules = text.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!rules.includes("!important"), "and it contains no !important at all");
});

add_task(async function test_disabled_chrome_costs_nothing() {
  const root = document.documentElement;

  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.enabled", false]],
  });

  ok(!chrome().enabled, "the feature reports disabled");
  ok(
    !loadedSheets().includes(CHROME_SHEET),
    "its stylesheet is unloaded, not merely overridden"
  );
  ok(!root.hasAttribute("trance-chrome"), "the root attribute is gone");
  for (const { attribute } of FLAGS) {
    ok(!root.hasAttribute(attribute), `${attribute} is gone`);
  }

  await SpecialPowers.popPrefEnv();

  ok(chrome().enabled, "re-enabling works without a restart");
});

add_task(async function test_the_address_bar_dim_stays_inside_the_page() {
  // Two regressions in one rule.
  //
  //   1. A `filter: blur()` paints outside the box it is applied to, so the
  //      dimmed page bled a halo over the sidebar and the gutter and the effect
  //      read as belonging to the window rather than to the page. `clip-path`
  //      runs after `filter`, so an inset clip is what "within the tab window
  //      bounds" means.
  //   2. It borrowed `--trance-surface-blur` — the *frosted chrome* radius — so
  //      widening a surface smeared the page by 24px.
  const text = await sheetText(CHROME_SHEET);

  ok(
    text.includes("clip-path: inset("),
    "the treatment is clipped to the content pane's own rectangle"
  );
  ok(
    !text.includes("blur(var(--trance-surface-blur))"),
    "and no longer borrows the surface layer's blur radius"
  );

  const wrapper = document.getElementById("zen-tabbox-wrapper");
  ok(wrapper, "#zen-tabbox-wrapper exists");
  if (wrapper) {
    isnot(
      window.getComputedStyle(wrapper).clipPath,
      "none",
      "and the clip is live while the sub-feature is on"
    );
  }
});

add_task(async function test_dim_and_blur_switch_independently() {
  const wrapper = document.getElementById("zen-tabbox-wrapper");
  ok(wrapper, "#zen-tabbox-wrapper exists");
  if (!wrapper) {
    return;
  }
  const fn = name =>
    window.getComputedStyle(wrapper).getPropertyValue(name).trim();

  // `filter` takes a single list, so a rule per half would overwrite rather
  // than compose. Each half is a named function that resolves to an identity
  // when its switch is off.
  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.urlbar.focus-blur", false]],
  });
  is(fn("--trance-urlbar-blur-fn"), "blur(0px)", "blur off is an identity");
  isnot(
    fn("--trance-urlbar-dim-fn"),
    "brightness(1)",
    "and the dim is untouched by it"
  );
  await SpecialPowers.popPrefEnv();

  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.urlbar.focus-dim", false]],
  });
  is(fn("--trance-urlbar-dim-fn"), "brightness(1)", "dim off is an identity");
  isnot(
    fn("--trance-urlbar-blur-fn"),
    "blur(0px)",
    "and the blur is untouched by it"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_the_icon_scale_reaches_the_toolbar() {
  // The regression this guards is the whole reason the setting was reported as
  // doing nothing: `trance.chrome.icons.size` wrote a token that only the pack
  // stylesheets read, and the packs were off by default. Moving the slider
  // changed a variable nothing consumed.
  //
  // The scale now goes through `--zen-toolbar-button-size`, which is the
  // variable Firefox's own toolbar-button rule multiplies into the icon box —
  // so it reaches the browser's glyphs, and an icon mod's, without owning
  // either.
  const button = document.getElementById("back-button");
  ok(button, "#back-button exists");
  if (!button) {
    return;
  }
  const iconWidth = () => {
    const icon = button.querySelector(".toolbarbutton-icon");
    return icon ? parseFloat(window.getComputedStyle(icon).width) : 0;
  };

  const before = iconWidth();
  Assert.greater(before, 0, "the icon has a width to begin with");

  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.icons.scale", 125]],
  });
  is(tokenValue("--trance-icon-scale"), "1.25", "125% is a 1.25 multiplier");
  is(tokenValue("--trance-menu-icon-size"), "20px", "and 20px for menu rows");
  Assert.greater(
    iconWidth(),
    before,
    "and the toolbar button actually grows — the token is consumed"
  );
  await SpecialPowers.popPrefEnv();

  is(iconWidth(), before, "and it comes back exactly");
});

add_task(async function test_the_scale_is_clamped_to_its_range() {
  // about:config is not a slider. A value off the end is clamped rather than
  // honoured into a toolbar nobody can use. The range is a quarter either way:
  // the scale multiplies the browser's own 16px icon box, so 50% is an 8px
  // glyph and 200% no longer fits the button drawn around it.
  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.icons.scale", 10_000]],
  });
  is(tokenValue("--trance-icon-scale"), "1.25", "125% is the ceiling");
  await SpecialPowers.popPrefEnv();

  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.icons.scale", 0]],
  });
  is(tokenValue("--trance-icon-scale"), "0.75", "75% is the floor");
  await SpecialPowers.popPrefEnv();

  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.icons.scale", 107]],
  });
  is(
    tokenValue("--trance-icon-scale"),
    "1.07",
    "and every whole percent in between is a value it can hold"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_the_app_menu_button_wears_the_trance_mark() {
  // Zen declares `list-style-image: url("menu.svg") !important` on the button
  // itself, and Trance may not answer an !important with one of its own
  // (TRANCE.md §6.2 rule 1). It does not have to: the `<image
  // class="toolbarbutton-icon">` inside is what paints the glyph, and a normal
  // declaration on the child beats a value it merely inherited.
  //
  // It is a mask rather than a `list-style-image`, and that is the fix for "the
  // logo is tiny". `about-logo.svg` is a 1024×1024 branding canvas with the
  // mark inset well inside it, so as a list-style-image the whole canvas scales
  // into the 16px box and the mark lands at whatever fraction of 1024 it
  // occupies. `mask-size: contain` fits the *drawing* to the box instead, and
  // `background-color: currentColor` makes it the same colour as every glyph
  // beside it in either theme.
  const button = document.getElementById("PanelUI-menu-button");
  ok(button, "#PanelUI-menu-button exists");
  if (!button) {
    return;
  }
  const icon = button.querySelector(".toolbarbutton-icon");
  ok(icon, "and it has an icon image");
  if (!icon) {
    return;
  }
  const style = () => window.getComputedStyle(icon);
  const mask = () => style().maskImage;

  ok(
    mask().includes("about-logo.svg"),
    `the app menu wears the Trance mark by default (${mask()})`
  );
  is(
    style().maskSize,
    "contain",
    "sized to the icon box rather than to the artwork's own canvas"
  );
  // And the icon box has to be given a size, which is the whole of "the mark
  // disappeared". `.toolbarbutton-icon` is a XUL `<image>`, and a XUL `<image>`
  // with no image has no intrinsic size — so `list-style-image: none` collapsed
  // it to 0×0 and the mask painted a zero-sized mark. Nothing about the rule
  // was wrong; it was drawing correctly into no space.
  Assert.greater(
    parseFloat(style().width),
    0,
    `the icon box has a size of its own to draw into (${style().width})`
  );
  is(
    style().width,
    style().height,
    "and it is square, so `contain` fits the artwork rather than letterboxing it"
  );
  is(
    style().backgroundColor,
    style().color,
    "and drawn in the toolbar's own ink, so it follows the theme"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.logo-menu-button", false]],
  });
  ok(
    !mask().includes("about-logo.svg"),
    "and opting out gives the browser's own glyph straight back"
  );
  await SpecialPowers.popPrefEnv();

  ok(mask().includes("about-logo.svg"), "reversibly");
});
