/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: chrome furniture acceptance tests (TRANCE.md §13 Phase 5).
 *
 * Phase 5's acceptance is three claims, and all three are checkable:
 *
 *   "no duplicate glyphs"       → exactly one icon pack is in the style set,
 *                                 and switching packs swaps rather than adds
 *   "no data-URI icons in CSS"  → every glyph is a chrome:// URL to a real file
 *   "every sub-feature independently toggleable with zero residual cost"
 *                               → one attribute each, gone when the pref is off
 *
 * Four mods used to ship four copies of the same glyph set, inlined into CSS as
 * data URIs — the same padlock parsed four times and cached never
 * (TRANCE.md §3.8). That is what the first two guard.
 */

"use strict";

const CHROME_SHEET = "chrome://browser/content/trance-styles/trance-chrome.css";
const iconSheet = pack =>
  `chrome://browser/content/trance-styles/trance-icons-${pack}.css`;

/** Every sub-feature: its pref, and the root attribute its rules gate on. */
const FLAGS = [
  { pref: "trance.chrome.panels.enabled", attribute: "trance-chrome-panels" },
  { pref: "trance.chrome.menus.tint", attribute: "trance-chrome-menus" },
  { pref: "trance.chrome.newtab.compact", attribute: "trance-chrome-newtab" },
  {
    pref: "trance.chrome.urlbar.hide-extension-name",
    attribute: "trance-chrome-urlbar-noextname",
  },
  {
    pref: "trance.chrome.urlbar.focus-dim",
    attribute: "trance-chrome-urlbar-dim",
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
    document.documentElement.getAttribute("trance-chrome-icons"),
    "true",
    "icons are on by default"
  );
});

add_task(async function test_exactly_one_icon_pack_is_loaded() {
  const packs = ["fluent", "zen"].filter(pack =>
    loadedSheets().includes(iconSheet(pack))
  );
  is(packs.length, 1, "exactly one icon pack is in the style set");
  is(packs[0], "fluent", "and Fluent is the default");
});

add_task(async function test_switching_packs_swaps_rather_than_adds() {
  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.icons.pack", "zen"]],
  });

  ok(loadedSheets().includes(iconSheet("zen")), "the Zen pack is loaded");
  ok(
    !loadedSheets().includes(iconSheet("fluent")),
    "and Fluent is unloaded, not merely overridden — the pack you are not " +
      "using is not in the style set at all"
  );

  await SpecialPowers.popPrefEnv();

  ok(loadedSheets().includes(iconSheet("fluent")), "and it swaps back");
});

add_task(async function test_an_unknown_pack_falls_back() {
  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.icons.pack", "nonsense"]],
  });
  ok(
    loadedSheets().includes(iconSheet("fluent")),
    "an unrecognised pack name falls back to the default rather than leaving " +
      "the browser with no icons"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_no_glyph_is_a_data_uri() {
  // TRANCE.md §3.8 and the Phase 5 acceptance criterion, verified against the
  // live stylesheet rather than against the source.
  for (const pack of ["fluent", "zen"]) {
    await SpecialPowers.pushPrefEnv({
      set: [["trance.chrome.icons.pack", pack]],
    });

    ok(
      loadedSheets().includes(iconSheet(pack)),
      `the ${pack} sheet is in the style set`
    );

    const source = await sheetText(iconSheet(pack));
    // Comments stripped: the generated header explains that every `!important`
    // was removed on the way in, and that sentence must not be what fails —
    // or passes — this assertion.
    const text = source.replace(/\/\*[\s\S]*?\*\//g, "");

    ok(!text.includes("data:"), `no data URI in the ${pack} pack`);
    ok(!text.includes("!important"), `and no !important in the ${pack} pack`);
    ok(
      text.includes(`trance-icons/${pack}/`),
      `and its glyphs resolve to real files in the ${pack} directory`
    );

    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_icons_off_unloads_the_pack() {
  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.icons.enabled", false]],
  });

  ok(
    !document.documentElement.hasAttribute("trance-chrome-icons"),
    "the attribute is gone"
  );
  for (const pack of ["fluent", "zen"]) {
    ok(
      !loadedSheets().includes(iconSheet(pack)),
      `and the ${pack} sheet is unloaded`
    );
  }

  await SpecialPowers.popPrefEnv();

  ok(
    loadedSheets().includes(iconSheet("fluent")),
    "turning icons back on restores the pack without a restart"
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
  is(tokenValue("--trance-menu-icon-size"), "16px", "the icon size is bound");

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

add_task(async function test_macos_context_menus_are_left_alone_by_default() {
  // The platform pref is a real trade, so Trance does not take it silently.
  // Off by default; claimed and restored exactly when it is asked for
  // (ADR-020, and ADR-011 for the same pattern in TranceSurfaces).
  // Deliberately not asserting the platform default here: the mochitest
  // harness sets this pref itself, because a native AppKit menu cannot be
  // driven from a test. What Trance owes is the round trip — whatever the value
  // was, it comes back.
  const original = Services.prefs.getBoolPref(
    "widget.macos.native-context-menus",
    true
  );

  await SpecialPowers.pushPrefEnv({
    set: [["trance.chrome.icons.macos-emulated-menus", true]],
  });
  is(
    Services.prefs.getBoolPref("widget.macos.native-context-menus", true),
    false,
    "turning the option on claims the platform pref"
  );
  await SpecialPowers.popPrefEnv();

  is(
    Services.prefs.getBoolPref("widget.macos.native-context-menus", true),
    original,
    "and turning it off gives the user's value back"
  );
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
  for (const pack of ["fluent", "zen"]) {
    ok(!loadedSheets().includes(iconSheet(pack)), `no ${pack} pack either`);
  }
  ok(!root.hasAttribute("trance-chrome"), "the root attribute is gone");
  ok(!root.hasAttribute("trance-chrome-icons"), "the icon attribute is gone");
  for (const { attribute } of FLAGS) {
    ok(!root.hasAttribute(attribute), `${attribute} is gone`);
  }

  await SpecialPowers.popPrefEnv();

  ok(chrome().enabled, "re-enabling works without a restart");
});
