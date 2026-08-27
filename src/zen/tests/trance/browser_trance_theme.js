/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: theme picker acceptance tests (TRANCE.md §13 Phase 8).
 *
 * This feature is unlike the other five: it does not own a surface, it *extends
 * someone else's*. Five methods on `gZenThemePicker` are wrapped as
 * own-properties of this window's instance, and the whole correctness argument
 * rests on two claims — that the wraps do what they say, and that removing them
 * leaves the panel exactly as Zen ships it (ADR-031).
 *
 * So the assertions here go through Zen's picker rather than through Trance's
 * own state wherever they can. A test that asked `TranceTheme` what angle it
 * held would pass even if the angle never reached a gradient; asking
 * `getGradient` what CSS it produced would not.
 */

"use strict";

const THEME_SHEET = "chrome://browser/content/trance-styles/trance-theme.css";
const PANEL = "PanelUI-zen-gradient-generator";

/**
 * Reads a Trance stylesheet's text.
 *
 * Not via `document.styleSheets`: Trance loads its sheets through
 * `nsIDOMWindowUtils.loadSheetUsingURIString`, so they are in the style set but
 * not in the document's sheet list.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
async function sheetText(url) {
  const response = await fetch(url);
  return response.text();
}

function theme() {
  return window.gTrance.features.find(f => f.name === "Theme");
}

function picker() {
  return window.gZenThemePicker;
}

function panel() {
  return document.getElementById(PANEL);
}

add_task(async function test_feature_is_registered_and_attached() {
  const feature = theme();
  ok(feature, "the theme feature is constructed");
  ok(feature.enabled, "and enabled by default");
  ok(
    window.gTrance.context.styles.loadedSheets.includes(THEME_SHEET),
    "its stylesheet is loaded"
  );
  ok(picker(), "Zen's picker exists in this window");
  is(
    panel().getAttribute("trance-theme"),
    "true",
    "and Trance has attached to its panel"
  );
});

add_task(async function test_the_stylesheet_keeps_the_house_rules() {
  const text = (await sheetText(THEME_SHEET)).replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!text.includes("!important"), "no !important");
  ok(!text.includes("will-change"), "no will-change in CSS");
  ok(!text.includes("backdrop-filter"), "no second blur surface");
  ok(!text.includes("infinite"), "no infinite animation");
});

add_task(async function test_the_controls_are_present() {
  ok(
    panel().querySelector(".trance-theme-slider"),
    "the lightness slider is in the panel"
  );
  ok(panel().querySelector(".trance-theme-knob"), "so is the angle knob");
  ok(panel().querySelector(".trance-theme-heart"), "and the heart");
  ok(panel().querySelector(".trance-theme-palette"), "and the palette button");
  ok(
    panel().querySelector(".trance-theme-hex-input"),
    "and the exact-colour field"
  );

  // Zen's own swatch is borrowed, not duplicated, and not shown: it opens the
  // platform colour picker, so Trance leaves it in the row it hides and reads
  // its value from there.
  const swatches = panel().querySelectorAll(
    "#PanelUI-zen-gradient-generator-custom-input"
  );
  is(swatches.length, 1, "there is one colour swatch, not two");
  is(
    swatches[0].closest(".trance-theme-hex-row"),
    null,
    "and it is not in the Trance row"
  );
  is(
    window.getComputedStyle(swatches[0].parentNode).display,
    "none",
    "the row it is in is hidden, so no OS colour picker can be opened from here"
  );

  // Nor is the opacity spinner: a native stepper for a number `#RRGGBBAA`
  // already carries is both a foreign control and a second owner for it.
  is(
    panel().querySelector('.trance-theme-hex-row > input[type="number"]'),
    null,
    "and neither is the opacity spinner"
  );
  is(
    panel().querySelectorAll(".trance-theme-hex-row > *").length,
    2,
    "the exact-colour row is the field and the add button, nothing else"
  );
});

add_task(async function test_zens_unlabelled_buttons_got_tooltips() {
  for (const id of [
    "PanelUI-zen-gradient-generator-color-add",
    "PanelUI-zen-gradient-generator-color-remove",
    "PanelUI-zen-gradient-generator-color-toggle-algo",
  ]) {
    ok(
      document.getElementById(id).getAttribute("tooltiptext"),
      `${id} says what it does`
    );
  }
  ok(
    panel().querySelector(".trance-theme-knob").title,
    "and so does the angle knob"
  );
});

add_task(async function test_there_is_no_second_translucency_slider() {
  // Requirement 2 of the phase brief is met by Zen's slider. A Trance one would
  // be a second owner for one value, which is the failure this project exists
  // to remove (ADR-031).
  ok(
    document.getElementById("PanelUI-zen-gradient-generator-opacity"),
    "Zen's translucency slider is present"
  );
  is(
    panel().querySelectorAll('input[type="range"]').length,
    2,
    "and there are exactly two sliders: Zen's translucency and Trance's lightness"
  );
});

add_task(async function test_the_translucency_slider_has_its_whole_range() {
  // The ends matter beyond the two extra answers they buy: Zen caches them the
  // first time it repaints and scales the wave behind the thumb to the cached
  // pair, so a range widened *after* that read draws a fill that does not
  // follow the thumb. Widening happens before the picker exists precisely so
  // the cached pair is this one.
  const slider = document.getElementById(
    "PanelUI-zen-gradient-generator-opacity"
  );
  is(slider.getAttribute("min"), "0", "the slider can say no tint at all");
  is(slider.getAttribute("max"), "1", "and it can say solid");
});

add_task(async function test_a_preview_repaint_is_coalesced_onto_a_frame() {
  const zenPicker = picker();
  const workspace = window.gZenWorkspaces.getActiveWorkspace();
  const original = workspace.theme;
  const originalOpacity = zenPicker.currentOpacity;

  workspace.theme = zenPicker.constructor.getTheme([], 0.5, 0);
  zenPicker.currentOpacity = 0.42;

  // Zen calls this straight out of a mousemove handler, so it runs far more
  // often than a frame. A non-saving call must therefore only queue the work.
  zenPicker.updateCurrentWorkspace();
  is(
    workspace.theme.opacity,
    0.5,
    "a preview repaint has not run by the time the caller returns"
  );
  ok(
    zenPicker.updated,
    "but the picker already knows there is something to save"
  );

  // A saving repaint is the end of a gesture and supersedes what is queued.
  zenPicker.updateCurrentWorkspace(false);
  is(workspace.theme.opacity, 0.42, "a saving repaint runs immediately");

  zenPicker.currentOpacity = originalOpacity;
  workspace.theme = original;
  zenPicker.onWorkspaceChange(workspace);
});

add_task(async function test_the_saved_page_is_first_but_not_shown_first() {
  const pages = document.getElementById(
    "PanelUI-zen-gradient-generator-color-pages"
  );
  is(
    pages.firstElementChild.className,
    "trance-theme-saved-page",
    "the saved page is the first page"
  );
  is(pages.children.length, 6, "and the other five are still there");
  ok(
    !document.getElementById("PanelUI-zen-gradient-generator-color-page-left")
      .disabled,
    "the left arrow is live, so the saved page is reachable"
  );
});

add_task(async function test_the_angle_rotates_the_gradient_zen_produced() {
  const zenPicker = picker();
  const colors = [
    { c: [200, 100, 100], isPrimary: true, type: "explicit-lightness" },
    { c: [100, 100, 200], type: "explicit-lightness" },
  ];

  const workspace = window.gZenWorkspaces.getActiveWorkspace();
  const original = workspace.theme;

  // Two colours is Zen's two-linear-gradient case, which is the one with an
  // angle in it that a regex can be checked against.
  workspace.theme = zenPicker.constructor.getTheme(colors, 0.5, 0);
  workspace.theme.tranceAngle = 0;
  const flat = zenPicker.getGradient(colors, true);
  ok(flat.includes("-45deg"), "Zen's own gradient is at its hard-coded -45deg");

  workspace.theme.tranceAngle = 90;
  zenPicker.onWorkspaceChange(workspace);
  const rotated = zenPicker.getGradient(colors, true);
  ok(
    rotated.includes("45deg") && !rotated.includes("-45deg"),
    `90 degrees of rotation lands at 45deg, got: ${rotated}`
  );

  workspace.theme = original;
  zenPicker.onWorkspaceChange(workspace);
});

add_task(async function test_a_palette_reaches_the_colour_zen_computed() {
  const zenPicker = picker();
  const workspace = window.gZenWorkspaces.getActiveWorkspace();
  const original = workspace.theme;

  workspace.theme = zenPicker.constructor.getTheme([], 0.5, 0);
  workspace.theme.trancePalette = "monochrome";
  zenPicker.onWorkspaceChange(workspace);

  const [r, g, b] = zenPicker.getColorFromPosition(
    120,
    80,
    "explicit-lightness"
  );
  is(r, g, "monochrome leaves no hue: red equals green");
  is(g, b, "and green equals blue");

  workspace.theme = original;
  zenPicker.onWorkspaceChange(workspace);
});

add_task(async function test_saving_and_forgetting_a_theme() {
  const zenPicker = picker();
  const workspace = window.gZenWorkspaces.getActiveWorkspace();
  const original = workspace.theme;

  workspace.theme = zenPicker.constructor.getTheme(
    [{ c: [10, 20, 30], isPrimary: true, type: "explicit-lightness" }],
    0.5,
    0
  );

  const heart = panel().querySelector(".trance-theme-heart");
  heart.click();

  const saved = JSON.parse(
    Services.prefs.getStringPref("trance.theme.saved.themes", "[]")
  );
  is(saved.length, 1, "the heart saved one theme");
  ok(heart.hasAttribute("saved"), "and the heart says so");
  is(
    panel().querySelectorAll(".trance-theme-saved-swatch").length,
    1,
    "and a swatch appeared on the saved page"
  );

  heart.click();
  is(
    JSON.parse(Services.prefs.getStringPref("trance.theme.saved.themes", "[]"))
      .length,
    0,
    "pressing it again forgets the theme"
  );
  ok(!heart.hasAttribute("saved"), "and the heart goes back to empty");

  Services.prefs.clearUserPref("trance.theme.saved.themes");
  workspace.theme = original;
  zenPicker.onWorkspaceChange(workspace);
});

add_task(async function test_hex_entry_rejects_what_is_not_a_colour() {
  const input = panel().querySelector(".trance-theme-hex-input");
  input.value = "not a colour";
  panel().querySelector(".trance-theme-hex-add").click();
  ok(input.hasAttribute("invalid"), "a bad value is marked rather than added");

  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  ok(!input.hasAttribute("invalid"), "and the mark clears when it is edited");
});

add_task(async function test_disabling_leaves_zens_panel_as_it_was() {
  const before = panel().querySelectorAll("*").length;

  await SpecialPowers.pushPrefEnv({ set: [["trance.theme.enabled", false]] });

  ok(!theme().enabled, "the feature is off");
  ok(!panel().hasAttribute("trance-theme"), "the panel attribute is gone");
  is(
    panel().querySelectorAll('[class*="trance-theme"]').length,
    0,
    "and no Trance node is left in it"
  );
  ok(
    !window.gTrance.context.styles.loadedSheets.includes(THEME_SHEET),
    "the stylesheet is out of the style set"
  );
  ok(
    !Object.hasOwn(picker(), "getGradient"),
    "and every method wrap is off the picker"
  );
  is(
    document.getElementById("PanelUI-zen-gradient-generator-custom-input")
      .parentNode.parentNode.id,
    "zen-theme-picker-color",
    "Zen's colour swatch is back in Zen's row"
  );
  ok(
    !document
      .getElementById("PanelUI-zen-gradient-generator-color-add")
      .getAttribute("tooltiptext"),
    "and the tooltips Trance filled in are gone again"
  );

  await SpecialPowers.popPrefEnv();

  ok(theme().enabled, "and it comes back on");
  is(
    panel().querySelectorAll("*").length,
    before,
    "with the same number of nodes it had the first time"
  );
});
