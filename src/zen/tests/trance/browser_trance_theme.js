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
  ok(panel().querySelector(".trance-theme-knob-angle"), "so is the angle knob");
  ok(
    panel().querySelector(".trance-theme-master-wrapper .trance-theme-slider"),
    "and the master opacity slider"
  );
  ok(panel().querySelector(".trance-theme-knob-blur"), "and the blur knob");
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
    panel().querySelector(".trance-theme-knob-angle").title,
    "and so does the angle knob"
  );
  ok(
    panel().querySelector(".trance-theme-knob-blur").title,
    "and the blur knob, in whichever of its two states this platform is in"
  );
});

add_task(async function test_there_is_no_second_translucency_slider() {
  // Requirement 2 of the phase brief is met by Zen's slider. A Trance one over
  // the same value would be a second owner for it, which is the failure this
  // project exists to remove (ADR-031).
  //
  // The third slider is not that. Zen's writes the theme's tint strength and
  // Trance's two write lightness and `trance.surface.opacity` — three
  // controls, three values, and the count is here so that a fourth has to be
  // justified rather than merely added.
  ok(
    document.getElementById("PanelUI-zen-gradient-generator-opacity"),
    "Zen's tint-strength slider is present"
  );
  is(
    panel().querySelectorAll('input[type="range"]').length,
    3,
    "and there are exactly three sliders: tint, lightness and surface opacity"
  );
});

add_task(async function test_tint_strength_does_not_change_transparency() {
  // The whole of the 0.2.0 change. `currentOpacity` used to reach the CSS as
  // the alpha of every wheel colour, so one slider answered both "how much
  // colour" and "how transparent" and neither could be answered alone.
  //
  // Two assertions, and the first is the invariant: whatever the slider says,
  // the gradient Zen produces carries no partial alpha, so transparency is
  // `--trance-surface-alpha`'s job alone. That holds on every platform — where
  // the window cannot be transparent Zen already flattened, and where it can,
  // `#flattenTint` does.
  const zenPicker = picker();
  const colors = [
    { c: [200, 100, 100], isPrimary: true, type: "explicit-lightness" },
  ];
  const previousOpacity = zenPicker.currentOpacity;
  const partialAlpha = /rgba\([^)]*,\s*0?\.\d+\s*\)/;

  zenPicker.currentOpacity = 0.25;
  const weak = zenPicker.getGradient(colors);
  zenPicker.currentOpacity = 1;
  const full = zenPicker.getGradient(colors);

  ok(
    !partialAlpha.test(weak),
    `a quarter-strength tint is still opaque, got: ${weak}`
  );
  ok(!partialAlpha.test(full), `and so is a full-strength one, got: ${full}`);
  isnot(
    weak,
    full,
    "and the slider still does something: it moves the colour, not the alpha"
  );
  // Full strength is Zen's own `rgba(…, 1)`, untouched: the flatten only has
  // work to do where the alpha is partial, and an opaque colour is already the
  // answer. So the assertion is on the channels, not on the function name.
  ok(
    full.includes("200, 100, 100"),
    `at full strength the colour is the wheel's own, got: ${full}`
  );

  zenPicker.currentOpacity = previousOpacity;
});

add_task(async function test_an_exact_colours_own_alpha_survives() {
  // The hex field promises eight digits sets the colour's opacity, so the one
  // alpha in this panel that a person typed is the one `#flattenTint` must not
  // touch. Zen emits customs verbatim; the flatten only matches `rgba()`.
  const zenPicker = picker();
  const css = zenPicker.getGradient([
    { c: "#11223380", isCustom: true, isPrimary: true },
    { c: "#44556677", isCustom: true },
  ]);
  ok(
    css.includes("#11223380") && css.includes("#44556677"),
    `exact colours keep the alpha they were given, got: ${css}`
  );
});

add_task(async function test_the_master_controls_write_the_surface_prefs() {
  // Neither control owns its value: the pref does, the settings page writes the
  // same one, and each surface reads itself back through an observer. So the
  // assertions are on the pref and on the readout, in both directions.
  const blurPref = "trance.surface.blur.radius";
  const opacityPref = "trance.surface.opacity";
  const knob = panel().querySelector(".trance-theme-knob-blur");
  const slider = panel().querySelector(
    ".trance-theme-master-wrapper .trance-theme-slider"
  );

  await SpecialPowers.pushPrefEnv({
    set: [
      [blurPref, 30],
      [opacityPref, 40],
    ],
  });
  is(knob.textContent, "30px", "the knob says the radius, in pixels");
  is(slider.value, "40", "and the slider sits at the surface opacity");

  slider.value = "70";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  is(
    Services.prefs.getIntPref(opacityPref),
    70,
    "dragging the slider writes the pref"
  );

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_the_blur_knob_is_inert_where_nothing_reads_it() {
  // The knob writes `trance.surface.blur.radius`, and where the *window* is
  // translucent in its own right nothing consumes that value: the frost comes
  // from the compositor at a radius the operating system owns. A control with
  // no effect is worse than no control, so it goes inert and says why.
  //
  // Driven from the same switch trance-surfaces.css gates its blur on, so the
  // knob and the stylesheet cannot come to different conclusions.
  const knob = panel().querySelector(".trance-theme-knob-blur");
  const switches = [
    ["(-moz-platform: macos)", "zen.widget.macos.window-vibrancy"],
    ["(-moz-platform: linux)", "zen.widget.linux.transparency"],
  ].filter(([media]) => window.matchMedia(media).matches);

  if (!switches.length) {
    // Windows asks `-moz-windows-mica`, and everywhere else the answer is
    // always "Gecko paints the backdrop", so there is nothing to drive.
    ok(
      knob.title.length > 0,
      "the knob says what it does on a platform with no switch to flip"
    );
    return;
  }

  for (const [, pref] of switches) {
    await SpecialPowers.pushPrefEnv({ set: [[pref, true]] });
    ok(
      knob.hasAttribute("disabled"),
      `${pref} on: the knob is inert, because the radius has no consumer`
    );
    ok(knob.title.includes("inert"), "and it says so rather than looking grey");
    await SpecialPowers.popPrefEnv();

    await SpecialPowers.pushPrefEnv({ set: [[pref, false]] });
    ok(
      !knob.hasAttribute("disabled"),
      `${pref} off: the window is opaque, so the knob is live again`
    );

    const before = Services.prefs.getIntPref("trance.surface.blur.radius");
    knob.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
    );
    const after = Services.prefs.getIntPref("trance.surface.blur.radius");
    Assert.greater(after, before, "an arrow key moves the radius");
    is(knob.textContent, `${after}px`, "and the readout follows it");

    Services.prefs.clearUserPref("trance.surface.blur.radius");
    await SpecialPowers.popPrefEnv();
  }
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
