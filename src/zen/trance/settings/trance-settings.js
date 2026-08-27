/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Trance: about:preferences#trance
 *
 * Loaded into the preferences document (not a browser window), so none of the
 * Trance foundation modules are available as globals here — this file talks to
 * prefs directly and TranceCore picks the changes up through its own observers.
 * It does import TranceScheduler and TranceObserverHub, for the same reason
 * trance-mod-guard.js does: this page needs a subscription, and a private
 * MutationObserver is exactly what those two exist to prevent (CLAUDE.md
 * rule 4).
 *
 * Every `trance.*` pref must be registered below and must appear in
 * tranceSettings.inc.xhtml. A pref that exists but is not on the page is a bug
 * (TRANCE.md §6.6).
 *
 * There are two objects here, and the split matters:
 *
 *   `gTranceSettings` is the *pane* module. `preferences.js` registers it and
 *   calls `init()` the first time the Trance pane is shown, so nothing in it
 *   runs for someone who never opens the pane.
 *
 *   `gTrancePage` is the *document* layer: the scheduler, the observer hub and
 *   the combobox that replaces every platform-drawn `<menulist>` on the page —
 *   including the ones inside Sine's mod dialogs, which is why it cannot hang
 *   off the Trance pane's own lifecycle. trance-mod-guard.js borrows its hub
 *   rather than building a second one.
 *
 * Refs: TRANCE.md §6.4, §6.6, §13 Phase 2, §13 Phase 3; ADR-028
 */

/* eslint-env mozilla/browser-window */
/* global Preferences */

Preferences.addAll([
  // Foundation (TRANCE.md §6)
  { id: "trance.enabled", type: "bool", default: true },
  { id: "trance.motion.level", type: "int", default: 2 },
  { id: "trance.debug", type: "bool", default: false },

  // Mod guard (see trance-mod-guard.js)
  { id: "trance.modguard.enabled", type: "bool", default: true },

  // Surfaces (TRANCE.md §13 Phase 3)
  { id: "trance.surface.enabled", type: "bool", default: true },
  { id: "trance.surface.transparency", type: "bool", default: true },
  { id: "trance.surface.edgeless", type: "bool", default: true },
  { id: "trance.surface.blur.radius", type: "int", default: 24 },
  { id: "trance.surface.opacity", type: "int", default: 20 },
  { id: "trance.surface.saturation", type: "int", default: 130 },
  {
    id: "trance.surface.image",
    type: "string",
    default: "chrome://browser/content/trance-images/topo.png",
  },
  { id: "trance.surface.image.opacity", type: "int", default: 15 },
  { id: "trance.surface.image.blur", type: "int", default: 8 },
  {
    id: "trance.surface.newtab.logo",
    type: "string",
    default: "chrome://browser/content/trance-images/wave-light.png",
  },
  { id: "trance.surface.newtab.logo.size", type: "int", default: 250 },
  { id: "trance.surface.newtab.logo.opacity", type: "int", default: 35 },
  {
    id: "trance.surface.newtab.logo.holographic",
    type: "bool",
    default: true,
  },
  { id: "trance.surface.newtab.logo.hover", type: "bool", default: true },
  { id: "trance.surface.newtab.logo.tilt", type: "bool", default: true },
  { id: "trance.surface.internal-pages", type: "bool", default: true },
  { id: "trance.surface.internal.opacity", type: "int", default: 20 },
  { id: "trance.surface.internal.blur", type: "bool", default: true },
  // There is no `trance.surface.preset` and there are no regions at all any
  // more. The frost is one layer over the whole browser (ADR-041), and
  // `content` — a translucent backdrop for websites — is gone too, because a
  // site that paints its background covered it and Zen Internet had already
  // decided the rest (ADR-042).
  { id: "trance.surface.suspend-when-unfocused", type: "bool", default: true },
  {
    id: "trance.surface.keep-transparent-unfocused",
    type: "bool",
    default: false,
  },

  // Tab strip (TRANCE.md §13 Phase 4)
  //
  // There is no `trance.tabstrip.connectors`. Folder tree connectors are the
  // preinstalled Zen Folder Tree Connectors mod now, not a Trance drawing, so
  // there is nothing here to configure — the mod's own settings are in Mods
  // (ADR-027).
  { id: "trance.tabstrip.enabled", type: "bool", default: true },
  { id: "trance.tabstrip.folders.colors", type: "bool", default: true },
  { id: "trance.tabstrip.folders.arc-style", type: "bool", default: false },
  { id: "trance.tabstrip.pins.sticky", type: "bool", default: true },
  { id: "trance.tabstrip.unloaded.enabled", type: "bool", default: true },
  { id: "trance.tabstrip.unloaded.opacity", type: "int", default: 55 },
  { id: "trance.tabstrip.unloaded.saturation", type: "int", default: 0 },
  { id: "trance.tabstrip.rail.enabled", type: "bool", default: true },
  { id: "trance.tabstrip.rail.width", type: "int", default: 60 },
  { id: "trance.tabstrip.rail.tab-size", type: "int", default: 36 },
  { id: "trance.tabstrip.rail.icon-size", type: "int", default: 16 },
  { id: "trance.tabstrip.rail.margin-top", type: "int", default: 0 },
  { id: "trance.tabstrip.rail.margin-bottom", type: "int", default: 0 },
  { id: "trance.tabstrip.rail.stack-top-buttons", type: "bool", default: true },
  { id: "trance.tabstrip.glow.mode", type: "string", default: "none" },
  { id: "trance.tabstrip.glow.spread", type: "int", default: 6 },
  { id: "trance.tabstrip.glow.opacity", type: "int", default: 80 },

  // Chrome furniture (TRANCE.md §13 Phase 5)
  { id: "trance.chrome.enabled", type: "bool", default: true },
  // There are no icon packs and no pack switch: Trance preinstalls the "New
  // Icons" mod rather than reimplementing it, so size is the only icon setting
  // left (ADR-024, ADR-039).
  { id: "trance.chrome.icons.scale", type: "int", default: 100 },
  { id: "trance.chrome.panels.enabled", type: "bool", default: true },
  { id: "trance.chrome.menus.tint", type: "bool", default: true },
  { id: "trance.chrome.logo-menu-button", type: "bool", default: true },
  {
    id: "trance.chrome.topbuttons.reveal-on-hover",
    type: "bool",
    default: true,
  },
  {
    id: "trance.chrome.urlbar.hide-extension-name",
    type: "bool",
    default: true,
  },
  { id: "trance.chrome.urlbar.focus-dim", type: "bool", default: true },
  {
    id: "trance.chrome.urlbar.focus-dim.strength",
    type: "int",
    default: 30,
  },
  { id: "trance.chrome.urlbar.focus-blur", type: "bool", default: true },
  {
    id: "trance.chrome.urlbar.focus-blur.radius",
    type: "int",
    default: 15,
  },

  // Motion and feedback (TRANCE.md §13 Phase 6)
  { id: "trance.feedback.enabled", type: "bool", default: true },
  { id: "trance.feedback.loading.enabled", type: "bool", default: true },
  { id: "trance.feedback.loading.thickness", type: "int", default: 5 },
  { id: "trance.feedback.loading.position", type: "string", default: "top" },
  { id: "trance.feedback.loading.width", type: "int", default: 25 },
  { id: "trance.feedback.loading.offset", type: "int", default: 10 },
  { id: "trance.feedback.loading.flourish", type: "bool", default: true },
  { id: "trance.feedback.loading.zoom", type: "bool", default: true },
  { id: "trance.feedback.loading.zoom.scale", type: "int", default: 3 },
  { id: "trance.feedback.loading.zoom.blur", type: "int", default: 4 },
  { id: "trance.feedback.bubbles.enabled", type: "bool", default: true },
  { id: "trance.feedback.bubbles.count", type: "int", default: 12 },
  { id: "trance.feedback.bubbles.shape", type: "string", default: "line" },
  { id: "trance.feedback.animations.tab-switch", type: "bool", default: true },
  { id: "trance.feedback.animations.search", type: "bool", default: true },

  // Theme picker (TRANCE.md §13 Phase 8)
  //
  // There is no `trance.theme.translucency`: Zen's picker already owns that
  // slider, and a second one over the same value is the two-owners problem
  // (ADR-031). Lightness, angle and palette are per space, so they live on the
  // theme object Zen already saves rather than in prefs.
  { id: "trance.theme.enabled", type: "bool", default: true },
  { id: "trance.theme.controls.lightness", type: "bool", default: true },
  { id: "trance.theme.controls.angle", type: "bool", default: true },
  { id: "trance.theme.controls.hex", type: "bool", default: true },
  { id: "trance.theme.palettes.enabled", type: "bool", default: true },
  { id: "trance.theme.saved.enabled", type: "bool", default: true },
  { id: "trance.theme.saved.themes", type: "string", default: "" },
  { id: "trance.theme.notifications", type: "bool", default: true },

  // Extensions and first run (TRANCE.md §13 Phase 9)
  //
  // The seven extensions themselves are not prefs and are not here: they are an
  // enterprise policy, and about:addons is where an installed add-on is
  // configured (ADR-032). `completed` is state, surfaced as a button rather
  // than a checkbox for the same reason `trance.theme.saved.themes` is
  // surfaced as a count.
  { id: "trance.firstrun.enabled", type: "bool", default: true },
  { id: "trance.firstrun.completed", type: "bool", default: false },

  // Onboarding (TRANCE.md §13 Phase 13)
  //
  // `completed` is state, surfaced as a button for the same reason
  // `trance.firstrun.completed` is. The other three are ordinary settings that
  // happen to be *asked* during the flow rather than owned by it — which is why
  // they are here as well as there, and why `TranceOnboarding` keeps a pref
  // observer on each for the whole session rather than only while it is running
  // (ADR-051).
  { id: "trance.onboarding.enabled", type: "bool", default: true },
  { id: "trance.onboarding.completed", type: "bool", default: false },
  { id: "trance.onboarding.channel", type: "string", default: "stable" },
  { id: "trance.mods.channel", type: "string", default: "cosine" },
  { id: "trance.perf.arch", type: "string", default: "arm64" },

  // The Zen import (ADR-053). Both are state, not settings: `source` records
  // what was brought across so that "where did these spaces come from" has an
  // answer later than the one screen that asked, and `staged` is true only
  // between the flow ending and the restart that adopts the import. Surfaced as
  // one readout and one button, the same treatment the two `completed` prefs
  // above get.
  { id: "trance.import.staged", type: "bool", default: false },
  { id: "trance.import.source", type: "string", default: "" },

  // Floating Status Bar's behaviour is Zen's `zen.theme.styled-status-panel`,
  // surfaced rather than mirrored — the same treatment SuperPins' lazy pinned
  // tabs got in Phase 4, and for the same reason: mirroring Zen or platform
  // state into a `trance.*` pref creates two owners for one setting
  // (docs/trance/mods/floating-status-bar.md §6).
  { id: "zen.theme.styled-status-panel", type: "bool", default: true },

  // SuperPins' "load pinned tabs only when using them" is this platform pref.
  // It is surfaced here rather than mirrored into a `trance.*` pref: mirroring
  // platform state would create two owners for one setting, which is the exact
  // failure this project exists to remove (docs/trance/mods/superpins.md §6).
  {
    id: "browser.sessionstore.restore_pinned_tabs_on_demand",
    type: "bool",
    default: false,
  },
]);

/**
 * Range inputs read as bare numbers, which is useless next to a slider. Each
 * one gets a live readout, and the readouts are the only DOM the pane owns.
 */
const TRANCE_RANGE_READOUTS = [
  { input: "tranceSurfaceBlur", output: "tranceSurfaceBlurValue", unit: "px" },
  {
    input: "tranceSurfaceOpacity",
    output: "tranceSurfaceOpacityValue",
    unit: "%",
  },
  {
    input: "tranceSurfaceSaturation",
    output: "tranceSurfaceSaturationValue",
    unit: "%",
  },
  {
    input: "tranceSurfaceImageOpacity",
    output: "tranceSurfaceImageOpacityValue",
    unit: "%",
  },
  {
    input: "tranceSurfaceImageBlur",
    output: "tranceSurfaceImageBlurValue",
    unit: "px",
  },
  {
    input: "tranceInternalOpacity",
    output: "tranceInternalOpacityValue",
    unit: "%",
  },
  {
    input: "tranceUnloadedOpacity",
    output: "tranceUnloadedOpacityValue",
    unit: "%",
  },
  {
    input: "tranceUnloadedSaturation",
    output: "tranceUnloadedSaturationValue",
    unit: "%",
  },
  { input: "tranceRailWidth", output: "tranceRailWidthValue", unit: "px" },
  { input: "tranceRailTabSize", output: "tranceRailTabSizeValue", unit: "px" },
  {
    input: "tranceRailIconSize",
    output: "tranceRailIconSizeValue",
    unit: "px",
  },
  {
    input: "tranceRailMarginTop",
    output: "tranceRailMarginTopValue",
    unit: "px",
  },
  {
    input: "tranceRailMarginBottom",
    output: "tranceRailMarginBottomValue",
    unit: "px",
  },
  { input: "tranceIconScale", output: "tranceIconScaleValue", unit: "%" },
  { input: "tranceUrlbarDim", output: "tranceUrlbarDimValue", unit: "%" },
  { input: "tranceUrlbarBlur", output: "tranceUrlbarBlurValue", unit: "px" },
  {
    input: "tranceLoadingThickness",
    output: "tranceLoadingThicknessValue",
    unit: "px",
  },
  { input: "tranceLoadingWidth", output: "tranceLoadingWidthValue", unit: "%" },
  {
    input: "tranceLoadingOffset",
    output: "tranceLoadingOffsetValue",
    unit: "px",
  },
  {
    input: "tranceLoadingZoomScale",
    output: "tranceLoadingZoomScaleValue",
    unit: "%",
  },
  {
    input: "tranceLoadingZoomBlur",
    output: "tranceLoadingZoomBlurValue",
    unit: "px",
  },
  { input: "tranceBubbleCount", output: "tranceBubbleCountValue", unit: "" },
  { input: "tranceGlowSpread", output: "tranceGlowSpreadValue", unit: "px" },
  { input: "tranceGlowOpacity", output: "tranceGlowOpacityValue", unit: "%" },
];

var gTranceSettings = {
  __hasInitialized: false,

  /**
   * Wires each readout to its slider.
   *
   * The readout reads the *preference* except while the slider is being
   * dragged, and that is the whole of the "the extra-space sliders say 40px
   * when the default is 0" bug.
   *
   * A `<html:input type="range">` with no `value` attribute starts at the
   * midpoint of its own `min`/`max` — 40 for a 0..80 slider, 30 for the 0..60
   * blur one, and so on. `Preferences` corrects that from
   * `queueUpdateOfAllElements`, which is dispatched to the main thread and can
   * land after this function; and it corrects it by assigning `element.value`,
   * which fires no event. Reading the element here meant reading whatever the
   * midpoint happened to be, and nothing ever came back to correct it.
   *
   * Reading the pref removes the ordering question rather than trying to win
   * it. `Preference` extends `EventEmitter` and emits `change` whenever its
   * value moves — from a reset, from about:config, from another window — so the
   * readout stays true afterwards too. The element is still the source while
   * dragging, because during a drag it is ahead of the pref by design.
   */
  init() {
    if (this.__hasInitialized) {
      return;
    }
    this.__hasInitialized = true;

    for (const { input, output, unit } of TRANCE_RANGE_READOUTS) {
      const inputElement = document.getElementById(input);
      const outputElement = document.getElementById(output);
      if (!inputElement || !outputElement) {
        continue;
      }
      const preference = Preferences.get(
        inputElement.getAttribute("preference")
      );

      const show = value => {
        outputElement.value = `${value}${unit}`;
      };
      const showFromPreference = () =>
        show(preference ? preference.value : inputElement.value);

      inputElement.addEventListener("input", () => show(inputElement.value));
      preference?.on("change", showFromPreference);
      showFromPreference();
    }

    this.initSavedThemes();
    this.initFirstRun();
    this.initOnboarding();
    this.initImport();
    this.initImagePicker({
      pref: "trance.surface.image",
      path: "tranceSurfaceImagePath",
      choose: "tranceSurfaceImageChoose",
      clear: "tranceSurfaceImageClear",
      title: "Choose a background image",
      empty: "No image",
    });
    this.initImagePicker({
      pref: "trance.surface.newtab.logo",
      path: "tranceNewTabLogoPath",
      choose: "tranceNewTabLogoChoose",
      clear: "tranceNewTabLogoClear",
      title: "Choose an empty-tab mark",
      empty: "No mark",
    });

    // The pane's own menulists exist from parse time, so they are upgraded the
    // moment the pane is built rather than waiting for a mutation.
    window.gTrancePage?.upgradeComboboxes();
  },

  /**
   * The saved-themes row.
   *
   * `trance.theme.saved.themes` is the one Trance pref that is state rather
   * than a setting, and TRANCE.md §6.6 says every `trance.*` pref appears on
   * this page. It appears as what it is worth showing here — how many themes
   * are stored — with the only whole-list operation the picker itself does not
   * offer. Forgetting one theme is a right-click on its swatch, where the
   * theme is.
   */
  initSavedThemes() {
    const count = document.getElementById("tranceThemeSavedCount");
    const forget = document.getElementById("tranceThemeForgetAll");
    const preference = Preferences.get("trance.theme.saved.themes");
    if (!count || !forget || !preference) {
      return;
    }

    const show = () => {
      let total = 0;
      try {
        const parsed = JSON.parse(preference.value || "[]");
        total = Array.isArray(parsed) ? parsed.length : 0;
      } catch (error) {
        total = 0;
      }
      count.value = String(total);
      forget.disabled = total === 0;
    };

    forget.addEventListener("command", async () => {
      // Asked first, and this is the one control on the page that has to ask.
      // Every other destructive-looking button here clears a pref back to a
      // default the browser can produce again; a saved theme is a set of
      // colours that exists nowhere else once it is gone.
      const total = Number(count.value) || 0;
      const confirmed = await this.confirm({
        title: "Forget every saved theme?",
        body:
          `${total} saved ${total === 1 ? "theme" : "themes"} will be removed. ` +
          "The colours are not stored anywhere else, so this cannot be undone.",
        accept: "Forget all",
      });
      if (confirmed) {
        preference.value = "";
      }
    });
    preference.on("change", show);
    show();
  },

  /**
   * The page's one confirmation dialog.
   *
   * One element reused by every destructive control rather than one dialog per
   * button: there is a single shape of question here — "this cannot be undone,
   * do it?" — and building a second one is how two of them end up disagreeing
   * about which button is on the right.
   *
   * `<dialog>.showModal()` rather than a hand-built overlay, because the
   * platform already implements the four things that are easy to get wrong:
   * the top layer (so nothing on the page can paint over it), the `::backdrop`,
   * the focus trap, and Escape. Escape and the backdrop both resolve `false` —
   * the safe answer is the one a stray keypress gives.
   *
   * Resolves `false` rather than throwing if the dialog is missing, so a caller
   * can never take silence for consent.
   *
   * @param {object} options
   * @param {string} options.title
   * @param {string} options.body
   * @param {string} options.accept - Label for the confirming button.
   * @returns {Promise<boolean>}
   */
  confirm({ title, body, accept }) {
    const dialog = document.getElementById("tranceConfirmDialog");
    const titleElement = document.getElementById("tranceConfirmTitle");
    const bodyElement = document.getElementById("tranceConfirmBody");
    const cancelButton = document.getElementById("tranceConfirmCancel");
    const acceptButton = document.getElementById("tranceConfirmAccept");
    if (
      !dialog ||
      !titleElement ||
      !bodyElement ||
      !cancelButton ||
      !acceptButton
    ) {
      return Promise.resolve(false);
    }

    titleElement.textContent = title;
    bodyElement.textContent = body;
    acceptButton.textContent = accept;

    return new Promise(resolve => {
      let answer = false;
      const onAccept = () => {
        answer = true;
        dialog.close();
      };
      const onCancel = () => dialog.close();
      // `close` fires however the dialog went away — the buttons, Escape, or
      // anything else that closes it — so the teardown and the answer live
      // here rather than in each of the paths that can reach it.
      const onClose = () => {
        acceptButton.removeEventListener("click", onAccept);
        cancelButton.removeEventListener("click", onCancel);
        dialog.removeEventListener("close", onClose);
        resolve(answer);
      };

      acceptButton.addEventListener("click", onAccept);
      cancelButton.addEventListener("click", onCancel);
      dialog.addEventListener("close", onClose);

      dialog.showModal();
      // The safe button takes focus, so Return does the harmless thing.
      cancelButton.focus();
    });
  },

  /**
   * The first-run row.
   *
   * `trance.firstrun.completed` is the second Trance pref that is state rather
   * than a setting, and it gets the same treatment the saved themes do: a
   * readout of what it holds, and the one operation anyone would want on it.
   * Clearing it is all "show it again" takes — every window with the feature
   * enabled is watching the pref, and the first one to reach an idle moment
   * claims the panel back by setting it again.
   *
   * The button is inert while the panel is already pending, which is the same
   * rule as "Forget all" with nothing to forget.
   */
  initFirstRun() {
    const shown = document.getElementById("tranceFirstRunShown");
    const button = document.getElementById("tranceFirstRunShow");
    const preference = Preferences.get("trance.firstrun.completed");
    if (!shown || !button || !preference) {
      return;
    }

    const show = () => {
      const completed = preference.value === true;
      shown.value = completed ? "Shown" : "Pending";
      button.disabled = !completed;
    };

    button.addEventListener("command", () => {
      preference.value = false;
    });
    preference.on("change", show);
    show();
  },

  /**
   * The onboarding rows.
   *
   * Two jobs, and neither of them writes a pref this file owns:
   *
   * The "Run it again" button is `initFirstRun`'s button over a different pref,
   * and works the same way — clearing `trance.onboarding.completed` is the whole
   * operation, because every window with the feature enabled is watching it and
   * the first one to reach an idle moment claims the flow back.
   *
   * The architecture menulist's *labels* are wrong off macOS: "Apple Silicon"
   * and "Intel" are the names of two Macs, and the same two architectures are
   * called something else everywhere else. The values are unchanged — this is a
   * label, not a third option — and it is done here rather than in the XHTML
   * because a static markup file cannot ask what platform it is on.
   */
  initOnboarding() {
    const shown = document.getElementById("tranceOnboardingShown");
    const button = document.getElementById("tranceOnboardingShow");
    const preference = Preferences.get("trance.onboarding.completed");
    if (shown && button && preference) {
      const show = () => {
        const completed = preference.value === true;
        shown.value = completed ? "Done" : "Pending";
        button.disabled = !completed;
      };
      button.addEventListener("command", () => {
        preference.value = false;
      });
      preference.on("change", show);
      show();
    }

    // Imported rather than assumed: `AppConstants` is a global in a browser
    // window and is not one in every `about:preferences` script scope, and the
    // failure mode of assuming it is a ReferenceError that takes the rest of
    // this method's caller with it.
    const { AppConstants } = ChromeUtils.importESModule(
      "resource://gre/modules/AppConstants.sys.mjs"
    );
    if (AppConstants.platform === "macosx") {
      return;
    }
    const generic = { arm64: "ARM64", x86_64: "x86-64" };
    for (const item of document.querySelectorAll("#tranceArch menuitem")) {
      const label = generic[item.getAttribute("value")];
      if (label) {
        item.setAttribute("label", label);
      }
    }
  },

  /**
   * The Zen import row.
   *
   * `trance.import.source` is the readout and `trance.import.staged` is the
   * reason the button is not only a pref clear: when an import is staged there
   * is a file behind it, and clearing the pref alone would leave
   * `trance-zen-import.jsonlz4` in the profile forever with nothing left to
   * adopt it.
   *
   * The button is inert when both prefs are empty, which is the same rule
   * "Forget all" and "Show it again" follow — a button that does nothing should
   * look like one.
   */
  initImport() {
    const shown = document.getElementById("tranceImportSource");
    const button = document.getElementById("tranceImportForget");
    const source = Preferences.get("trance.import.source");
    const staged = Preferences.get("trance.import.staged");
    if (!shown || !button || !source || !staged) {
      return;
    }

    const show = () => {
      const value = source.value || "";
      shown.value = staged.value
        ? `${value || "Zen"} (on restart)`
        : value || "Nothing";
      button.disabled = !value && !staged.value;
    };

    button.addEventListener("command", () => {
      source.value = "";
      staged.value = false;
      IOUtils.remove(
        PathUtils.join(PathUtils.profileDir, "trance-zen-import.jsonlz4"),
        { ignoreAbsent: true }
      ).catch(error =>
        console.error("Trance: could not drop the staged import", error)
      );
    });
    source.on("change", show);
    staged.on("change", show);
    show();
  },

  /**
   * A row whose preference is the URL of a picture.
   *
   * There are two — the chrome's background texture and the empty-tab mark —
   * and they are the same control over two prefs, so they are one method rather
   * than two nearly-identical ones. Adding a third is a call, not a copy.
   *
   * A URL is not something anyone should have to type, so the control is a file
   * picker and the pref is what it writes. The row shows the file's name rather
   * than the whole URL: the path of a picture is usually longer than this column
   * and the only part of it anyone reads is the end.
   *
   * `nsIFilePicker` is used directly rather than through `<input type="file">`,
   * which does not exist in a XUL document, and it is opened with
   * `filterImages` so the list is the files this can actually paint.
   *
   * Both prefs ship with a `chrome://` URL rather than an empty string — the
   * pictures Trance itself provides — so the readout has to survive a value that
   * is not a file path. It does: the last path segment of a chrome URL is still
   * the file's name, which is what this shows.
   *
   * @param {object} row
   * @param {string} row.pref - The preference holding the URL.
   * @param {string} row.path - Id of the element that names the current file.
   * @param {string} row.choose - Id of the button that opens the picker.
   * @param {string} row.clear - Id of the button that empties the preference.
   * @param {string} row.title - The picker's window title.
   * @param {string} row.empty - What the readout says when nothing is set.
   */
  initImagePicker({ pref, path, choose, clear, title, empty }) {
    const pathElement = document.getElementById(path);
    const chooseElement = document.getElementById(choose);
    const clearElement = document.getElementById(clear);
    const preference = Preferences.get(pref);
    if (!pathElement || !chooseElement || !clearElement || !preference) {
      return;
    }

    const show = () => {
      const url = (preference.value || "").trim();
      // `decodeURIComponent` because the picker percent-encodes anything a
      // filename may hold and a name with a space in it should read as one.
      let name = "";
      try {
        name = decodeURIComponent(url.split("/").pop() || "");
      } catch (error) {
        name = url;
      }
      pathElement.textContent = name || empty;
      clearElement.disabled = !url;
    };

    chooseElement.addEventListener("command", () => {
      const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
        Ci.nsIFilePicker
      );
      picker.init(window.browsingContext, title, Ci.nsIFilePicker.modeOpen);
      picker.appendFilters(Ci.nsIFilePicker.filterImages);
      picker.open(result => {
        if (result !== Ci.nsIFilePicker.returnOK || !picker.file) {
          return;
        }
        preference.value = Services.io.newFileURI(picker.file).spec;
      });
    });

    clearElement.addEventListener("command", () => {
      preference.value = "";
    });

    preference.on("change", show);
    show();
  },
};

/* ── The combobox ───────────────────────────────────────────────────────────
 *
 * A `<menulist>` in this document is drawn by the platform. On macOS that is a
 * real `NSPopUpButton`: it ignores every design token the page sets, it opens a
 * menu in the system's own colours at the system's own metrics, and it is the
 * one control on the settings page that cannot be made to look like the rest of
 * it. Two of them sit in the Trance pane and every mod with a dropdown
 * preference adds another to Sine's.
 *
 * The menulist is not replaced. It stays in the DOM, moved out of sight inside
 * a wrapper, because it is what everything else is bound to: `Preferences`
 * reads and writes `element.value` on it, and Sine's own dialogs listen for
 * `command` on it and read its `value` attribute. The combobox is a second face
 * for that element — it renders the options, and a selection is forwarded back
 * as `menulist.value = …` plus a bubbling `command`, which is exactly what a
 * click on the native popup would have produced.
 *
 * Keeping the state on the menulist is also what makes the sync one-directional
 * and therefore correct. Two things move the value without a click — the
 * platform's own `selectedItem` setter, which fires `ValueChange`, and Sine,
 * which writes the `value` attribute directly and fires nothing — so the
 * combobox listens for the first and watches the attribute for the second,
 * through the shared observer hub rather than an observer of its own.
 */

const TRANCE_HTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * Where a platform-drawn dropdown is allowed to be replaced.
 *
 * Deliberately not every `menulist` on the page. Firefox's own panes have
 * dozens, several of which are populated and re-populated by pane code that
 * reaches for `.menupopup` and `.selectedItem` at times this file cannot
 * predict; replacing those would be a large behavioural change dressed up as a
 * visual one.
 *
 * Zen's three panes are in scope as of the settings pass: all six of their
 * menulists are written out in full in
 * browser/components/preferences/zen{LooksAndFeel,TabsManagement}.inc.xhtml
 * with a static `menupopup`, so none of them is repopulated after parse and the
 * option list a combobox reads once stays true. That is the condition — not
 * "which pane it is" — and it is why Firefox's own panes remain out.
 */
const TRANCE_COMBOBOX_SCOPE = [
  '[data-category="paneTrance"] menulist',
  'groupbox[data-category^="paneZen"] menulist',
  ".sineItemPreferenceDialogContent menulist",
].join(", ");

var gTrancePage = {
  __hasInitialized: false,

  /** @type {object | null} */
  scheduler: null,
  /** @type {object | null} */
  hub: null,

  /** Menulist -> its combobox face. */
  _comboboxes: new WeakMap(),
  /** The combobox whose list is open, if any. */
  _openCombobox: null,
  /** The capture-phase listener that closes it, while one is open. */
  _dismiss: null,

  init() {
    if (this.__hasInitialized) {
      return;
    }
    this.__hasInitialized = true;

    const { TranceScheduler } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceScheduler.mjs"
    );
    const { TranceObserverHub } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceObserverHub.mjs"
    );

    this.scheduler = new TranceScheduler(window);
    this.hub = new TranceObserverHub(window, this.scheduler);

    // Sine renders its panes and its mod dialogs long after this script parses,
    // and re-renders them on search, pagination, install and uninstall. One
    // subscription covers all of it.
    this.hub.observeMutations("#mainPrefPane", () => this.upgradeComboboxes(), {
      childList: true,
      subtree: true,
    });

    // The other half of the sync: a `value` written straight onto the menulist,
    // which is what Sine does when it reflects a pref it did not change here.
    this.hub.observeMutations(
      "menulist",
      records => this._onMenulistAttributes(records),
      { attributes: true, attributeFilter: ["value", "label"], subtree: true }
    );

    this._observeTextFieldEscape();

    window.addEventListener("unload", () => this.destroy(), { once: true });

    this.upgradeComboboxes();

    // And once more when Fluent has finished. The subscription above catches a
    // `label` that arrives *after* this runs; a translation that landed before
    // it fires no record at all, and there is no third case worth a second
    // mechanism — asking every face to sync once is a handful of property
    // writes on nodes that already exist.
    document.l10n?.ready.then(
      () => this.syncComboboxes(),
      () => {}
    );
  },

  /* ── Getting out of a text field ─────────────────────────────────────────
   *
   * In an HTML document, `mousedown` on the page body moves focus off whatever
   * had it. In a XUL document it does not: `#preferences-body` is not
   * focusable, so nothing accepts the focus and the caret stays in the field.
   * Once a text box on this page had focus — Sine's marketplace search, its
   * `username/repo` input, a shortcut recorder, the settings search — the only
   * ways out were Tab and clicking another control, and Escape did nothing at
   * all. That is the whole of "you can't exit out of textboxes until you click
   * on a setting".
   *
   * Two listeners, both on the window, both cheap enough to be unconditional:
   * they read `document.activeElement` and return immediately unless it is a
   * text field, which is the common case.
   */
  _observeTextFieldEscape() {
    // Bubble phase, and `defaultPrevented` is honoured, so a field that handles
    // Escape itself still gets first refusal — `moz-input-search` clears its own
    // value on the first press, and this then blurs on the second.
    window.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      const field = this._focusedTextField();
      if (!field) {
        return;
      }
      field.blur();
      event.preventDefault();
    });

    // Capture, because a click on a control that *is* focusable would otherwise
    // move focus before this ran and `activeElement` would already be the new
    // one — harmless, but then the blur is a no-op rather than the thing that
    // committed the field.
    window.addEventListener(
      "pointerdown",
      event => {
        const field = this._focusedTextField();
        if (!field || field === event.target || field.contains(event.target)) {
          return;
        }
        field.blur();
      },
      true
    );
  },

  /**
   * @returns {Element | null} The focused text field, if the focus is in one.
   */
  _focusedTextField() {
    const active = document.activeElement;
    if (!active || active === document.documentElement) {
      return null;
    }
    if (active.isContentEditable) {
      return active;
    }
    const name = active.localName;
    if (name === "textarea" || name === "html:textarea") {
      return active;
    }
    // `moz-input-search` and friends put the real `<input>` in a shadow tree, so
    // the host is what `activeElement` reports and the host is what has to be
    // blurred. Sine's own inputs and the shortcut recorder are plain `<input>`s.
    if (name.startsWith("moz-input-") || name === "search-textbox") {
      return active;
    }
    if (name !== "input" && name !== "html:input") {
      return null;
    }
    // A range slider is focusable and is not a text field: blurring it on
    // Escape would take the keyboard away from someone adjusting it by arrow
    // key, which is the one control on this page that is worth keeping focus in.
    const type = (active.getAttribute("type") ?? "text").toLowerCase();
    return type === "range" || type === "checkbox" || type === "radio"
      ? null
      : active;
  },

  destroy() {
    this._closeList();
    this.hub?.destroy();
    this.scheduler?.destroy();
    this.hub = null;
    this.scheduler = null;
  },

  /** Gives every eligible, not-yet-upgraded menulist a combobox face. */
  upgradeComboboxes() {
    for (const menulist of document.querySelectorAll(TRANCE_COMBOBOX_SCOPE)) {
      if (!this._comboboxes.has(menulist)) {
        this._upgrade(menulist);
      }
    }
  },

  /** Re-reads every face's labels and selection from its menulist. */
  syncComboboxes() {
    for (const menulist of document.querySelectorAll(TRANCE_COMBOBOX_SCOPE)) {
      this._comboboxes.get(menulist)?.sync();
    }
  },

  /**
   * @param {MutationRecord[]} records
   */
  _onMenulistAttributes(records) {
    for (const record of records) {
      // `closest`, not the target itself. The subscription is `subtree: true`,
      // so a `label` written onto a *menuitem* lands here too — and that is the
      // record that matters: Zen's panes label their options through Fluent, so
      // the attribute arrives after this page is built. Reading only
      // `record.target` meant those records were looked up in the map, missed,
      // and dropped, which is why the comboboxes on Look and Feel and Tab
      // Management drew an empty button.
      const menulist =
        record.target.nodeType === record.target.ELEMENT_NODE
          ? record.target.closest("menulist")
          : null;
      if (!menulist) {
        continue;
      }
      this._comboboxes.get(menulist)?.sync();
    }
  },

  /**
   * @param {Element} menulist
   */
  _upgrade(menulist) {
    // The `menuitem`s themselves, not a snapshot of their labels.
    //
    // Trance's own pane writes `label="…"` literally, so a snapshot was true
    // there. Zen's three panes do not: their options carry `data-l10n-id` and
    // Fluent writes the `label` attribute asynchronously, after this page is
    // built. A snapshot taken at upgrade time was therefore a list of empty
    // strings — a combobox with the right options, the right values and no
    // visible text, which is exactly what the Look and Feel and Tab Management
    // dropdowns looked like. Reading the element each time makes the label
    // whatever it currently is, and the attribute subscription above brings
    // the button back when Fluent fills them in.
    const items = [...menulist.querySelectorAll("menuitem")];
    if (!items.length) {
      // A menulist with nothing in it yet — Sine builds some of them in two
      // steps. It will come back through the childList subscription.
      return;
    }
    const labelOf = item =>
      item.getAttribute("label") || item.textContent.trim();
    const valueOf = item => item.getAttribute("value") ?? "";

    const wrapper = document.createElementNS(TRANCE_HTML_NS, "div");
    wrapper.className = "trance-combobox";
    menulist.before(wrapper);
    wrapper.append(menulist);
    menulist.classList.add("trance-combobox-native");

    const button = document.createElementNS(TRANCE_HTML_NS, "button");
    button.className = "trance-combobox-button";
    button.type = "button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");

    const value = document.createElementNS(TRANCE_HTML_NS, "span");
    value.className = "trance-combobox-value";
    button.append(value);

    const arrow = document.createElementNS(TRANCE_HTML_NS, "span");
    arrow.className = "trance-combobox-arrow";
    button.append(arrow);

    const list = document.createElementNS(TRANCE_HTML_NS, "div");
    list.className = "trance-combobox-popup";
    list.setAttribute("role", "listbox");
    list.hidden = true;

    const optionElements = items.map(item => {
      const element = document.createElementNS(TRANCE_HTML_NS, "button");
      element.className = "trance-combobox-option";
      element.type = "button";
      element.setAttribute("role", "option");
      element.dataset.value = valueOf(item);
      element.addEventListener("click", () => {
        this._choose(menulist, valueOf(item));
        this._closeList();
        button.focus();
      });
      list.append(element);
      return element;
    });

    wrapper.append(button, list);

    const face = {
      menulist,
      button,
      list,
      value,
      options: optionElements,
      sync: () => {
        const current = menulist.value;
        const match = items.find(item => valueOf(item) === current) ?? items[0];
        value.textContent =
          labelOf(match) || menulist.getAttribute("label") || "";
        items.forEach((item, index) => {
          const element = optionElements[index];
          element.dataset.value = valueOf(item);
          element.textContent = labelOf(item);
          element.setAttribute(
            "aria-selected",
            String(valueOf(item) === current)
          );
        });
      },
    };
    this._comboboxes.set(menulist, face);

    button.addEventListener("click", () => this._toggleList(face));
    button.addEventListener("keydown", event => this._onButtonKey(face, event));
    // The platform's own path: `selectedItem` mirrors `value` and `label` onto
    // the menulist and fires this, so anything that selects an item — including
    // `Preferences` writing the stored value in — lands here.
    menulist.addEventListener("ValueChange", face.sync);

    face.sync();
  },

  /**
   * @param {Element} menulist
   * @param {string} value
   */
  _choose(menulist, value) {
    if (menulist.value === value) {
      return;
    }
    menulist.value = value;
    // What a click on the native popup would have produced. `Preferences`
    // writes the pref from this, and Sine's dialogs read the `value` attribute
    // from it; `change` is dispatched too because Preferences accepts either
    // and a mod may have chosen the other.
    menulist.dispatchEvent(new Event("command", { bubbles: true }));
    menulist.dispatchEvent(new Event("change", { bubbles: true }));
  },

  /**
   * @param {object} face
   */
  _toggleList(face) {
    if (this._openCombobox === face) {
      this._closeList();
      return;
    }
    this._closeList();

    // `position: fixed`, so a combobox inside one of Sine's scrolling dialogs
    // is not clipped by it. Measured once, on open — a list that repositioned
    // itself on scroll would be a scroll listener this page does not need.
    const rect = face.button.getBoundingClientRect();
    face.list.hidden = false;
    face.list.style.minWidth = `${rect.width}px`;
    const height = face.list.getBoundingClientRect().height;
    const below = window.innerHeight - rect.bottom;
    face.list.style.insetInlineStart = `${rect.left}px`;
    face.list.style.insetBlockStart =
      below < height + 8 && rect.top > height
        ? `${rect.top - height - 4}px`
        : `${rect.bottom + 4}px`;

    face.button.setAttribute("aria-expanded", "true");
    this._openCombobox = face;

    this._dismiss = event => this._onDismiss(face, event);
    window.addEventListener("pointerdown", this._dismiss, true);
    window.addEventListener("keydown", this._dismiss, true);
    window.addEventListener("blur", this._dismiss, true);
  },

  _closeList() {
    const face = this._openCombobox;
    if (!face) {
      return;
    }
    face.list.hidden = true;
    face.button.setAttribute("aria-expanded", "false");
    this._openCombobox = null;
    window.removeEventListener("pointerdown", this._dismiss, true);
    window.removeEventListener("keydown", this._dismiss, true);
    window.removeEventListener("blur", this._dismiss, true);
    this._dismiss = null;
  },

  /**
   * @param {object} face
   * @param {Event} event
   */
  _onDismiss(face, event) {
    if (event.type === "keydown") {
      if (event.key === "Escape") {
        this._closeList();
        face.button.focus();
        event.preventDefault();
      }
      return;
    }
    if (event.type === "pointerdown" && face.list.contains(event.target)) {
      return;
    }
    if (event.type === "pointerdown" && face.button.contains(event.target)) {
      // The button's own click handler toggles; closing here as well would
      // reopen it on the same press.
      return;
    }
    this._closeList();
  },

  /**
   * Arrow keys move the selection without opening the list, which is what a
   * platform dropdown does and what anyone reaching for the keyboard expects.
   *
   * @param {object} face
   * @param {KeyboardEvent} event
   */
  _onButtonKey(face, event) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const values = face.options.map(option => option.dataset.value);
    const index = values.indexOf(face.menulist.value);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    if (next < 0 || next >= values.length) {
      return;
    }
    this._choose(face.menulist, values[next]);
    event.preventDefault();
  },
};

window.addEventListener("DOMContentLoaded", () => gTrancePage.init(), {
  once: true,
});
