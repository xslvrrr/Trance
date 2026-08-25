/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Trance: about:preferences#trance
 *
 * Loaded into the preferences document (not a browser window), so none of the
 * Trance foundation modules are available here — this file talks to prefs
 * directly and TranceCore picks the changes up through its own observers.
 *
 * Every `trance.*` pref must be registered below and must appear in
 * tranceSettings.inc.xhtml. A pref that exists but is not on the page is a bug
 * (TRANCE.md §6.6).
 *
 * Refs: TRANCE.md §6.6, §13 Phase 2, §13 Phase 3
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
  { id: "trance.surface.preset", type: "string", default: "nebula" },
  { id: "trance.surface.blur.radius", type: "int", default: 24 },
  { id: "trance.surface.opacity", type: "int", default: 62 },
  { id: "trance.surface.saturation", type: "int", default: 130 },
  { id: "trance.surface.region.sidebar", type: "bool", default: true },
  { id: "trance.surface.region.toolbar", type: "bool", default: true },
  { id: "trance.surface.region.overlay", type: "bool", default: true },
  { id: "trance.surface.region.content", type: "bool", default: false },
  { id: "trance.surface.content.opacity", type: "int", default: 85 },
  { id: "trance.surface.suspend-when-unfocused", type: "bool", default: true },

  // Tab strip (TRANCE.md §13 Phase 4)
  { id: "trance.tabstrip.enabled", type: "bool", default: true },
  { id: "trance.tabstrip.connectors", type: "bool", default: true },
  { id: "trance.tabstrip.folders.colors", type: "bool", default: true },
  { id: "trance.tabstrip.folders.arc-style", type: "bool", default: false },
  { id: "trance.tabstrip.pins.sticky", type: "bool", default: true },
  { id: "trance.tabstrip.unloaded.enabled", type: "bool", default: true },
  { id: "trance.tabstrip.unloaded.opacity", type: "int", default: 55 },
  { id: "trance.tabstrip.unloaded.saturation", type: "int", default: 0 },
  { id: "trance.tabstrip.rail.enabled", type: "bool", default: true },
  { id: "trance.tabstrip.rail.width", type: "int", default: 48 },
  { id: "trance.tabstrip.rail.tab-size", type: "int", default: 36 },
  { id: "trance.tabstrip.rail.icon-size", type: "int", default: 16 },
  { id: "trance.tabstrip.rail.margin-top", type: "int", default: 0 },
  { id: "trance.tabstrip.rail.margin-bottom", type: "int", default: 0 },
  { id: "trance.tabstrip.rail.stack-top-buttons", type: "bool", default: true },

  // Chrome furniture (TRANCE.md §13 Phase 5)
  { id: "trance.chrome.enabled", type: "bool", default: true },
  { id: "trance.chrome.icons.enabled", type: "bool", default: true },
  { id: "trance.chrome.icons.pack", type: "string", default: "fluent" },
  { id: "trance.chrome.icons.size", type: "int", default: 16 },
  {
    id: "trance.chrome.icons.macos-emulated-menus",
    type: "bool",
    default: false,
  },
  { id: "trance.chrome.panels.enabled", type: "bool", default: true },
  { id: "trance.chrome.menus.tint", type: "bool", default: true },
  { id: "trance.chrome.newtab.compact", type: "bool", default: true },
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

  // Motion and feedback (TRANCE.md §13 Phase 6)
  { id: "trance.feedback.enabled", type: "bool", default: true },
  { id: "trance.feedback.loading.enabled", type: "bool", default: true },
  { id: "trance.feedback.loading.thickness", type: "int", default: 3 },
  { id: "trance.feedback.loading.position", type: "string", default: "top" },
  { id: "trance.feedback.bubbles.enabled", type: "bool", default: true },
  { id: "trance.feedback.bubbles.count", type: "int", default: 8 },

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
 * one gets a live readout, and the readouts are the only DOM this page owns.
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
    input: "tranceContentOpacity",
    output: "tranceContentOpacityValue",
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
  { input: "tranceIconSize", output: "tranceIconSizeValue", unit: "px" },
  { input: "tranceUrlbarDim", output: "tranceUrlbarDimValue", unit: "%" },
  {
    input: "tranceLoadingThickness",
    output: "tranceLoadingThicknessValue",
    unit: "px",
  },
  { input: "tranceBubbleCount", output: "tranceBubbleCountValue", unit: "" },
];

var gTranceSettings = {
  __hasInitialized: false,

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
      const update = () => {
        outputElement.value = `${inputElement.value}${unit}`;
      };
      inputElement.addEventListener("input", update);
      update();
    }
  },
};
