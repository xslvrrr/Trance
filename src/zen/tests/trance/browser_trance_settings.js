/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: about:preferences#trance acceptance tests (TRANCE.md §6.6).
 *
 * The settings page is the one part of Trance that lives in a different
 * document, and it turns out that is where things go wrong quietly. Two bugs
 * this file exists to stop coming back, both of which shipped:
 *
 *   1. `trance-settings.css` had never loaded in any build. The `<link>` is
 *      written into a region of preferences.xhtml where the default namespace
 *      in scope is XUL, so a bare `<link>` is a XUL element with a `rel`
 *      attribute and no meaning. Nothing announced this: the page rendered, the
 *      controls worked, and every rule in the sheet was simply absent.
 *   2. The slider readouts read the *element* instead of the *preference*. A
 *      `<html:input type="range">` with no `value` attribute starts at the
 *      midpoint of its own min/max, `Preferences` corrects it from a
 *      main-thread runnable that can land after the page's own init, and it
 *      corrects it by assigning `element.value`, which fires no event. So the
 *      two rail spacing sliders sat at 0 and read "40px".
 *
 * Both are invisible to a check that only asks whether the page opened.
 */

"use strict";

const SETTINGS_SHEET =
  "chrome://browser/content/trance-styles/trance-settings.css";

/**
 * Opens about:preferences#trance and hands back its window.
 *
 * @param {(win: Window) => void | Promise<void>} body
 */
async function withSettings(body) {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:preferences#trance"
  );
  try {
    const win = tab.linkedBrowser.contentWindow;
    await win.document.l10n?.ready;
    await body(win);
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
}

add_task(async function test_the_settings_stylesheet_actually_loads() {
  await withSettings(win => {
    const doc = win.document;

    const link = doc.querySelector('link[href*="trance-settings.css"]');
    ok(link, "the stylesheet is linked from the Trance pane");
    if (link) {
      is(
        link.namespaceURI,
        "http://www.w3.org/1999/xhtml",
        "and the link is an HTML element — a XUL `link` is inert, which is " +
          "what it silently was"
      );
      ok(link.sheet, "and it has an attached sheet");
    }

    const loaded = [...doc.styleSheets].some(
      sheet => sheet.href === SETTINGS_SHEET
    );
    ok(loaded, "the sheet is in the document's sheet list");
  });
});

add_task(async function test_range_readouts_report_the_preference() {
  await withSettings(win => {
    const doc = win.document;

    // The two that shipped wrong: their default is 0 and their slider midpoint
    // is 40, so they are the pair that proves which of the two the readout is
    // reading.
    for (const id of ["tranceRailMarginTop", "tranceRailMarginBottom"]) {
      const input = doc.getElementById(id);
      ok(input, `#${id} exists`);
      if (!input) {
        continue;
      }
      const output = doc.getElementById(`${id}Value`);
      ok(output, `#${id}Value exists`);
      is(
        output?.value,
        "0px",
        `#${id} reads its preference, not the slider's midpoint`
      );
    }

    // And a control whose default is neither zero nor the midpoint, so the
    // assertion above cannot pass by coincidence.
    is(
      doc.getElementById("tranceSurfaceOpacityValue")?.value,
      "20%",
      "chrome opacity reads its preference too"
    );
    is(
      doc.getElementById("tranceRailWidthValue")?.value,
      "60px",
      "and the collapsed rail defaults to the browser's own 60px"
    );
  });
});

add_task(async function test_the_blur_slider_is_absent_where_it_cannot_work() {
  await withSettings(win => {
    const doc = win.document;
    // Same condition trance-surfaces.css uses to decide whether to ship any
    // `backdrop-filter` at all (ADR-022). The two must never disagree: a
    // control that provably cannot do anything is worse than an absent one.
    const translucentWindow = win.matchMedia(
      "(-moz-windows-mica) or (-moz-platform: macos) or " +
        "((-moz-platform: linux) and (-moz-pref('zen.widget.linux.transparency')))"
    ).matches;

    const row = doc.getElementById("tranceSurfaceBlurRow");
    const note = doc.getElementById("tranceSurfaceBlurNote");
    ok(row && note, "the blur row and its replacement note both exist");
    if (!row || !note) {
      return;
    }

    const display = element => win.getComputedStyle(element).display;
    if (translucentWindow) {
      is(display(row), "none", "the blur slider is hidden");
      isnot(display(note), "none", "and the note explaining why is shown");
    } else {
      isnot(display(row), "none", "the blur slider is shown");
      is(display(note), "none", "and the note is not");
    }
  });
});

/**
 * Prefs that hold *state* rather than a setting, and so cannot be a two-way
 * `preference=` binding.
 *
 * There are two, and each had to make the argument rather than inherit it.
 * `trance.theme.saved.themes` is a JSON list the picker writes when the heart
 * is pressed; `trance.firstrun.completed` is a latch the first window to show
 * the panel sets. In both cases a bound control is worse than nothing — a
 * `<button preference="…">` makes Preferences answer `command` by writing the
 * element's own `value` back over the pref, which is the opposite of what the
 * button is for.
 *
 * TRANCE.md §6.6 asks that every `trance.*` pref *appear* on the page, not that
 * every one be a switch. So these are checked against a stronger rule than the
 * binding: a readout showing what is stored, and a control that acts on it —
 * asserted by using it, below.
 *
 * `set` puts the pref in the state the row is for, `full` is what the readout
 * must then say, and `empty` is what it must say once the control has run.
 * `confirms` marks a control that opens the page's confirmation dialog before
 * it does anything — see `test_state_prefs_are_surfaced_and_clearable`.
 */
const TRANCE_STATE_PREFS = {
  "trance.theme.saved.themes": {
    readout: "tranceThemeSavedCount",
    action: "tranceThemeForgetAll",
    confirms: true,
    set: pref =>
      Services.prefs.setStringPref(
        pref,
        JSON.stringify([{ gradientColors: [] }, { gradientColors: [] }])
      ),
    read: pref => Services.prefs.getStringPref(pref, "unset"),
    full: "2",
    empty: "0",
    cleared: "",
  },
  "trance.firstrun.completed": {
    readout: "tranceFirstRunShown",
    action: "tranceFirstRunShow",
    set: pref => Services.prefs.setBoolPref(pref, true),
    read: pref => String(Services.prefs.getBoolPref(pref, true)),
    full: "Shown",
    empty: "Pending",
    cleared: "false",
  },
  "trance.onboarding.completed": {
    readout: "tranceOnboardingShown",
    action: "tranceOnboardingShow",
    set: pref => Services.prefs.setBoolPref(pref, true),
    read: pref => String(Services.prefs.getBoolPref(pref, true)),
    full: "Done",
    empty: "Pending",
    cleared: "false",
  },
  "trance.import.source": {
    readout: "tranceImportSource",
    action: "tranceImportForget",
    set: pref => Services.prefs.setStringPref(pref, "Zen — Default (release)"),
    read: pref => Services.prefs.getStringPref(pref, "unset"),
    full: "Zen — Default (release)",
    empty: "Nothing",
    cleared: "",
  },
};

/**
 * Prefs whose control is on the page but is not a `preference=` binding,
 * because the value is not something a checkbox, a slider or a dropdown can
 * hold.
 *
 * There are two, and they are the same kind of thing: `trance.surface.image` and
 * `trance.surface.newtab.logo` are picture URLs, and a URL is not something
 * anyone should have to type. Each control is a file picker and a button that
 * empties it, with the chosen file's name as the readout — which is the same
 * argument the two state prefs above make, arrived at from the other direction.
 */
const TRANCE_CUSTOM_CONTROL_PREFS = {
  "trance.surface.image": {
    readout: "tranceSurfaceImagePath",
    action: "tranceSurfaceImageClear",
  },
  "trance.surface.newtab.logo": {
    readout: "tranceNewTabLogoPath",
    action: "tranceNewTabLogoClear",
  },
  // The third is a different shape of the same argument. `trance.import.staged`
  // is true only between the flow ending and the restart that adopts the
  // import, and it shares the readout and the button with
  // `trance.import.source` above rather than getting a row of its own — a
  // checkbox for "there is a file waiting" would be a control over something
  // nobody should be setting by hand.
  "trance.import.staged": {
    readout: "tranceImportSource",
    action: "tranceImportForget",
  },
};

add_task(async function test_prefs_with_a_custom_control_have_one() {
  await withSettings(win => {
    const doc = win.document;
    for (const [pref, entry] of Object.entries(TRANCE_CUSTOM_CONTROL_PREFS)) {
      ok(doc.getElementById(entry.readout), `${pref} has a readout`);
      ok(doc.getElementById(entry.action), "and a control that acts on it");
    }
  });
});

add_task(async function test_every_trance_pref_is_on_the_page() {
  // TRANCE.md §6.6: if a pref is not on this page, it should not exist. Checked
  // the other way round as well — a control bound to a pref nobody registered
  // silently does nothing.
  await withSettings(win => {
    const doc = win.document;
    const bound = new Set(
      [...doc.querySelectorAll("[preference]")].map(element =>
        element.getAttribute("preference")
      )
    );
    for (const pref of [
      ...Object.keys(TRANCE_STATE_PREFS),
      ...Object.keys(TRANCE_CUSTOM_CONTROL_PREFS),
    ]) {
      bound.add(pref);
    }

    const missing = Services.prefs
      .getChildList("trance.")
      .filter(pref => !bound.has(pref));
    is(
      missing.join(", "),
      "",
      "every trance.* preference has a control on the page"
    );
  });
});

add_task(async function test_state_prefs_are_surfaced_and_clearable() {
  // The exemption above is only worth having if the row it points at actually
  // works, so this uses it rather than looking at it.
  for (const [pref, { set }] of Object.entries(TRANCE_STATE_PREFS)) {
    set(pref);
  }

  await withSettings(async win => {
    const doc = win.document;
    for (const [pref, entry] of Object.entries(TRANCE_STATE_PREFS)) {
      const value = doc.getElementById(entry.readout);
      const button = doc.getElementById(entry.action);
      ok(value, `${pref} has a readout on the page`);
      ok(button, "and a control that acts on it");
      is(value.value, entry.full, "the readout says what is stored");

      button.doCommand();
      if (entry.confirms) {
        // Forgetting saved themes is the one unrecoverable thing on this page,
        // so the button asks first. Checked by answering it: a dialog nothing
        // drives is indistinguishable from a button that silently does nothing.
        const dialog = doc.getElementById("tranceConfirmDialog");
        ok(dialog?.open, "the confirmation dialog is open");
        is(
          doc.activeElement,
          doc.getElementById("tranceConfirmCancel"),
          "with the safe button focused, so Return does the harmless thing"
        );
        isnot(
          entry.read(pref),
          entry.cleared,
          "and nothing has been cleared yet"
        );
        doc.getElementById("tranceConfirmAccept").click();
        await TestUtils.waitForCondition(
          () => entry.read(pref) === entry.cleared,
          "the answer reaches the preference"
        );
      }
      is(entry.read(pref), entry.cleared, "and the control empties it");
      is(value.value, entry.empty, "which the readout follows");
      ok(button.disabled, "and the control goes inert with nothing to clear");
    }
  });

  for (const pref of Object.keys(TRANCE_STATE_PREFS)) {
    Services.prefs.clearUserPref(pref);
  }
});

add_task(async function test_the_confirmation_dialog_defaults_to_no() {
  // Escape, the backdrop and anything else that closes the dialog all have to
  // read as "no". The failure mode is a dialog that resolves its promise only
  // on the two buttons and leaves the caller waiting forever on any other
  // close — which looks exactly like a button that does nothing.
  Services.prefs.setStringPref(
    "trance.theme.saved.themes",
    JSON.stringify([{ gradientColors: [] }])
  );

  await withSettings(async win => {
    const doc = win.document;
    const button = doc.getElementById("tranceThemeForgetAll");
    const dialog = doc.getElementById("tranceConfirmDialog");
    ok(button && dialog, "the row and the dialog both exist");
    if (!button || !dialog) {
      return;
    }

    button.doCommand();
    await TestUtils.waitForCondition(() => dialog.open, "the dialog opens");

    EventUtils.synthesizeKey("KEY_Escape", {}, win);
    await TestUtils.waitForCondition(() => !dialog.open, "Escape closes it");
    is(
      Services.prefs.getStringPref("trance.theme.saved.themes", ""),
      JSON.stringify([{ gradientColors: [] }]),
      "and the saved themes are still there"
    );

    // And the dialog is reusable afterwards: the listeners are torn down on
    // `close`, so a second question must not be answered by the first one's
    // handlers.
    button.doCommand();
    await TestUtils.waitForCondition(() => dialog.open, "it opens again");
    doc.getElementById("tranceConfirmCancel").click();
    await TestUtils.waitForCondition(
      () => !dialog.open,
      "and Cancel closes it"
    );
    isnot(
      Services.prefs.getStringPref("trance.theme.saved.themes", ""),
      "",
      "Cancel is still no"
    );
  });

  Services.prefs.clearUserPref("trance.theme.saved.themes");
});

add_task(async function test_every_setting_is_a_row_with_a_name() {
  // The pane's one convention: a name, a sentence, a control, in that order and
  // in the same columns every time. Checked structurally because the failure
  // mode is a row added later that puts its name inside its own control's
  // label — which looks fine on its own and breaks the column for the rows
  // around it.
  await withSettings(win => {
    const doc = win.document;
    const rows = [...doc.querySelectorAll(".trance-row")];
    Assert.greater(rows.length, 20, "the pane is built out of rows");

    for (const row of rows) {
      const text = row.querySelector(":scope > .trance-row-text");
      const control = row.querySelector(":scope > .trance-row-control");
      ok(
        text && control,
        `${row.id || "a row"} has a text column and a control column`
      );
      ok(
        text?.querySelector(":scope > label"),
        `${row.id || "a row"} names its setting in the text column`
      );
      is(
        control?.children.length > 0,
        true,
        `${row.id || "a row"} has a control`
      );
    }
  });
});

add_task(async function test_switches_render_as_switches() {
  // A XUL `checkbox` builds `.checkbox-check` and a label box in its light DOM.
  // The switch styling turns the element into the track and the check into the
  // knob, so both have to be there and the empty label box has to be out of the
  // flex layout — otherwise every switch is 34px of track plus an invisible
  // stretch of nothing, and the controls stop lining up.
  await withSettings(win => {
    const doc = win.document;
    const switches = [...doc.querySelectorAll("checkbox.trance-switch")];
    Assert.greater(
      switches.length,
      15,
      "the pane uses switches, not checkboxes"
    );

    const sample = doc.getElementById("tranceEnabled");
    ok(sample?.classList.contains("trance-switch"), "the master switch is one");
    if (!sample) {
      return;
    }
    const style = win.getComputedStyle(sample);
    is(style.width, "34px", "the track has the switch's width");
    isnot(style.borderTopLeftRadius, "0px", "and is a pill");

    const labelBox = sample.querySelector(".checkbox-label-box");
    ok(labelBox, "the label box exists");
    if (labelBox) {
      is(
        win.getComputedStyle(labelBox).display,
        "none",
        "and is taken out of the layout — the name lives in the row's text column"
      );
    }

    const check = sample.querySelector(".checkbox-check");
    ok(check, "the knob exists");
  });
});

add_task(async function test_the_pane_is_translucent_like_everything_else() {
  // "Transparency support which can now be perfectly tailored": the page behind
  // the cards is translucent (trance-internal.css), so a card that painted an
  // opaque background would be the only opaque thing in the window. Both are
  // mixes of the palette's own base at different alphas, and both alphas are
  // derived from `--trance-internal-alpha` — the value the Page opacity slider
  // writes — so they track each other and the slider at once (ADR-028).
  await withSettings(win => {
    const card = win.document.querySelector("groupbox.trance-card");
    ok(card, "the pane is built out of cards");
    if (!card) {
      return;
    }
    const background = win.getComputedStyle(card).backgroundColor;
    const match = background.match(/\/\s*([\d.]+%?)\s*\)/);
    ok(match, `the card's background carries an alpha (${background})`);
    if (match) {
      const alpha = match[1].endsWith("%")
        ? parseFloat(match[1]) / 100
        : parseFloat(match[1]);
      Assert.less(alpha, 1, "and it is translucent");
      Assert.greater(alpha, 0, "but not invisible");
    }
  });
});

add_task(async function test_dropdowns_are_comboboxes_not_platform_popups() {
  // A `<menulist>` here is drawn by the platform — on macOS a real
  // `NSPopUpButton`, which ignores every design token the page sets and opens a
  // system-coloured menu. `gTrancePage` gives each one a combobox face and
  // leaves the menulist in the DOM, because `Preferences` binds to it and
  // Sine's dialogs listen to it (ADR-028).
  await withSettings(async win => {
    const doc = win.document;
    const menulist = doc.getElementById("tranceLoadingPosition");
    ok(menulist, "the loading-bar position is a menulist");
    if (!menulist) {
      return;
    }

    const wrapper = menulist.closest(".trance-combobox");
    ok(wrapper, "and it has been given a combobox face");
    ok(
      menulist.classList.contains("trance-combobox-native"),
      "the menulist itself is still in the DOM, out of sight"
    );

    const button = wrapper?.querySelector(".trance-combobox-button");
    ok(button, "the face has a button");
    is(button?.getAttribute("aria-expanded"), "false", "which starts closed");

    const options = [
      ...(wrapper?.querySelectorAll(".trance-combobox-option") ?? []),
    ];
    is(
      options.length,
      menulist.querySelectorAll("menuitem").length,
      "one option per menuitem"
    );
    const selected = options.filter(
      option => option.getAttribute("aria-selected") === "true"
    );
    is(selected.length, 1, "exactly one is marked selected");
    is(
      selected[0]?.dataset.value,
      menulist.value,
      "and it is the one the menulist holds"
    );

    // Choosing writes the pref, which is the whole point of leaving the
    // menulist in place: the combobox forwards, `Preferences` still owns the
    // write.
    const other = options.find(
      option => option.dataset.value !== menulist.value
    );
    ok(other, "there is another option to pick");
    if (!other) {
      return;
    }
    const wanted = other.dataset.value;
    other.click();
    await TestUtils.waitForCondition(
      () =>
        Services.prefs.getStringPref("trance.feedback.loading.position", "") ===
        wanted,
      "the pref follows the combobox"
    );
    is(menulist.value, wanted, "and so does the menulist it is a face for");

    Services.prefs.clearUserPref("trance.feedback.loading.position");
  });
});

add_task(async function test_the_search_strip_is_a_card_and_not_a_slab() {
  // Two bugs, one element, and the fix for the first caused the second.
  //
  //   1. `preferences.css` paints `#search-container` in
  //      `--background-color-canvas` so that settings scrolling underneath it
  //      are occluded, and pins it there with `.sticky-container`. Since
  //      trance-internal.css clears the root's and the body's background
  //      outright, nothing else in the document painted that colour and the
  //      strip was the only black rectangle on a fully transparent page.
  //      Un-pinning it removed the reason for the occlusion.
  //   2. With the strip transparent and the field on it at 6% white, the
  //      *window* showed through the search box: gradient, texture and frost
  //      directly behind the placeholder and behind anything typed into it,
  //      which reads as two things overlapping because it is.
  //
  // So the strip is a card now — in the flow, not over the page, and painting a
  // surface rather than the page's canvas colour.
  await withSettings(win => {
    const strip = win.document.getElementById("search-container");
    ok(strip, "the search strip exists");
    if (!strip) {
      return;
    }
    Assert.notEqual(
      win.getComputedStyle(strip).backgroundColor,
      "rgba(0, 0, 0, 0)",
      "the strip paints a surface, so what is typed into it is legible"
    );

    const sticky = strip.closest(".sticky-container");
    ok(sticky, "the strip lives in preferences.css's sticky container");
    if (sticky) {
      is(
        win.getComputedStyle(sticky).position,
        "static",
        "which is not pinned, so the card scrolls with what it searches"
      );
    }
  });
});

add_task(async function test_escape_gets_you_out_of_a_text_field() {
  // In an HTML document, `mousedown` on the page body takes focus off whatever
  // had it. In a XUL document it does not: `#preferences-body` is not
  // focusable, so nothing accepts the focus and the caret stays where it was.
  // Once a text box on this page had focus, the only ways out were Tab and
  // clicking another control — "you can't exit out of textboxes until you click
  // on a setting".
  await withSettings(async win => {
    const field = win.document.getElementById("searchInput");
    ok(field, "the settings search field exists");
    if (!field) {
      return;
    }

    field.focus();
    await TestUtils.waitForCondition(
      () => win.document.activeElement === field,
      "the field takes focus"
    );

    EventUtils.synthesizeKey("KEY_Escape", {}, win);
    await TestUtils.waitForCondition(
      () => win.document.activeElement !== field,
      "and Escape gives it back"
    );

    // A range slider is focusable and is not a text field: Escape has to leave
    // it alone, or arrow-keying a value would end the moment anything else on
    // the page sent an Escape.
    const slider = win.document.getElementById("tranceSurfaceOpacity");
    ok(slider, "a slider exists to check the exception against");
    if (!slider) {
      return;
    }
    slider.focus();
    await TestUtils.waitForCondition(
      () => win.document.activeElement === slider,
      "the slider takes focus"
    );
    EventUtils.synthesizeKey("KEY_Escape", {}, win);
    is(
      win.document.activeElement,
      slider,
      "and keeps it: Escape only leaves text fields"
    );
  });
});

/**
 * Opens about:preferences on a named pane and hands back its window.
 *
 * A pane's markup lives in an `<html:template>` and is cloned into
 * `#mainPrefPane` only when `gotoPref` selects it, so a pane that has never been
 * shown cannot be queried from the document at all — `querySelector` finds
 * nothing and a check written against it passes vacuously or fails for the wrong
 * reason.
 *
 * @param {string} pane - A registered pane id, e.g. `paneZenLooks`.
 * @param {(win: Window) => void | Promise<void>} body
 */
async function withPane(pane, body) {
  await withSettings(async win => {
    await win.gotoPref(pane);
    await TestUtils.waitForCondition(
      () => win.document.querySelector(`groupbox[data-category="${pane}"]`),
      `${pane} is built`
    );
    await body(win);
  });
}

add_task(async function test_every_pane_speaks_the_same_language() {
  // The Trance pane is a card of rows with switches; Zen's three panes are a
  // `groupbox` of loose checkboxes. Both were fine and next to each other they
  // read as two products. Nothing was added to the markup to fix that — the
  // `groupbox` is the card and the `checkbox` is the switch — so what this
  // checks is that the platform's own elements came out the other side looking
  // like the ones the Trance pane hand-builds.
  await withPane("paneZenLooks", win => {
    const card = win.document.querySelector(
      'groupbox[data-category="paneZenLooks"]'
    );
    ok(card, "Zen's Look and Feel pane has a group to check");
    if (!card) {
      return;
    }

    const style = win.getComputedStyle(card);
    Assert.greater(
      parseFloat(style.borderTopLeftRadius),
      0,
      `the group is a card, not a bare box (${style.borderTopLeftRadius})`
    );
    Assert.greater(
      parseFloat(style.borderTopWidth),
      0,
      "with the same hairline every other card has"
    );

    const check = card.querySelector("checkbox > .checkbox-check");
    ok(check, "and it has a checkbox to look at");
    if (!check) {
      return;
    }
    const checkStyle = win.getComputedStyle(check);
    is(
      checkStyle.width,
      "34px",
      "which is drawn as the same 34px switch track the Trance pane uses"
    );
  });
});
