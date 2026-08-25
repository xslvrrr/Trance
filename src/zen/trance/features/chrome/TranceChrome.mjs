// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the chrome furniture — icons, menus, panels, the new-tab button and
// the address bar.
//
// Behaviour inspired by "Context Menu Icons" by Starry
// (https://github.com/Starry-AXQG/Context-Menu-Icons, MIT), "Zen Context Menu"
// by KiKaraage (https://github.com/KiKaraage/ZenMods, MIT), "Hide Extension
// Name" by ch4og (https://github.com/ch4og/zenbrowser-themes, MIT), "Zen Custom
// URL Bar" by rasyidrafi (https://github.com/rasyidrafi/zen-custom-urlbar,
// Apache-2.0), "Better New Tab Button" by themaster5209
// (https://github.com/themaster5209/zen-better-new-tab-button), "New Icons" and
// "Nova UI" by qumeqa (https://github.com/qumeqa/zen-icons,
// https://github.com/qumeqa/nova).
//
// The icon packs and their selector mapping are adapted from Context Menu Icons
// under MIT, with attribution — see docs/trance/THIRD-PARTY.md. Everything else
// here is written for Trance: three of those seven mods carry no licence at all
// and nothing may be taken from them (TRANCE.md §7.3).
//
// Seven mods, four icon sets, and roughly fifty preferences between them, all
// arguing over `.subviewbutton`, `menuitem` and `#urlbar`. New Icons and Nova UI
// both restyle the toolbar; Context Menu Icons adds icons to menus while Zen
// Context Menu removes them, on the same selectors, with the winner decided by
// Sine's load order (TRANCE.md §3.1, §3.8).
//
// Here there is one icon set — two packs, one loaded at a time — one owner per
// element, and six preferences.
//
// Refs: TRANCE.md §3.1, §3.8, §8.1, §13 Phase 5;
// docs/trance/mods/{context-menu-icons,zen-context-menu,new-icons,nova-ui,
// better-new-tab-button,hide-extension-name,zen-custom-urlbar}.md

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "Chrome";

const ATTR_ROOT = "trance-chrome";

const PREF_ICONS = "trance.chrome.icons.enabled";
const PREF_ICON_PACK = "trance.chrome.icons.pack";
const PREF_EMULATED_MENUS = "trance.chrome.icons.macos-emulated-menus";

/** The platform pref that decides whether macOS draws context menus itself. */
const PREF_NATIVE_MENUS = "widget.macos.native-context-menus";

const ICON_PACKS = Object.freeze(["fluent", "zen"]);
const DEFAULT_ICON_PACK = "fluent";

const iconSheet = pack =>
  `chrome://browser/content/trance-styles/trance-icons-${pack}.css`;

/**
 * Sub-features. Each is one pref, one root attribute, and nothing at runtime
 * when off: the attribute is absent and the rules stop matching.
 *
 * There is deliberately no pref for the new-tab button's rotation. It is
 * motion, motion is owned by `trance.motion.level`, and at level 0 the duration
 * token is zero so the transform never runs. A second switch would be a second
 * owner (TRANCE.md §6.2).
 */
const FLAGS = Object.freeze([
  { pref: "trance.chrome.panels.enabled", attribute: "trance-chrome-panels" },
  { pref: "trance.chrome.menus.tint", attribute: "trance-chrome-menus" },
  {
    pref: "trance.chrome.newtab.compact",
    attribute: "trance-chrome-newtab",
  },
  {
    pref: "trance.chrome.urlbar.hide-extension-name",
    attribute: "trance-chrome-urlbar-noextname",
  },
  {
    pref: "trance.chrome.urlbar.focus-dim",
    attribute: "trance-chrome-urlbar-dim",
  },
]);

export class TranceChrome extends TranceFeature {
  static prefName = "trance.chrome.enabled";
  static featureName = "Chrome";
  static styles = ["chrome://browser/content/trance-styles/trance-chrome.css"];

  /** The icon-pack sheet currently loaded, or null. */
  #loadedPack = null;
  /** The user's `widget.macos.native-context-menus`, restored on disable. */
  #previousNativeMenus = null;

  onEnable() {
    this.context.document.documentElement.setAttribute(ATTR_ROOT, "true");

    this.#bindTokens();
    this.#observePrefs();
    this.#applyFlags();
    this.#applyIcons();
  }

  onDisable() {
    const root = this.context.document.documentElement;
    root.removeAttribute(ATTR_ROOT);
    root.removeAttribute("trance-chrome-icons");
    for (const { attribute } of FLAGS) {
      root.removeAttribute(attribute);
    }
    this.#unloadIconPack();
    this.#releaseNativeMenus();
  }

  // --- Tokens ----------------------------------------------------------------

  #bindTokens() {
    this.bindTokens([
      {
        pref: "trance.chrome.icons.size",
        cssVar: "--trance-menu-icon-size",
        type: "int",
        fallback: 16,
        format: value => `${Math.max(8, Math.min(32, value))}px`,
      },
      {
        // Stored as a percentage of dimming; the stylesheet consumes it as a
        // `brightness()` multiplier, so 30% dim is brightness(0.7).
        pref: "trance.chrome.urlbar.focus-dim.strength",
        cssVar: "--trance-urlbar-dim",
        type: "int",
        fallback: 30,
        format: value => `${(100 - Math.min(90, Math.max(0, value))) / 100}`,
      },
    ]);
  }

  // --- Prefs -----------------------------------------------------------------

  #observePrefs() {
    for (const flag of FLAGS) {
      const observer = { observe: () => this.#applyFlags() };
      Services.prefs.addObserver(flag.pref, observer);
      this.addDisposer(() =>
        Services.prefs.removeObserver(flag.pref, observer)
      );
    }

    for (const pref of [PREF_ICONS, PREF_ICON_PACK, PREF_EMULATED_MENUS]) {
      const observer = { observe: () => this.#applyIcons() };
      Services.prefs.addObserver(pref, observer);
      this.addDisposer(() => Services.prefs.removeObserver(pref, observer));
    }
  }

  #applyFlags() {
    const root = this.context.document.documentElement;
    for (const { pref, attribute } of FLAGS) {
      if (Services.prefs.getBoolPref(pref, true)) {
        root.setAttribute(attribute, "true");
      } else {
        root.removeAttribute(attribute);
      }
    }
  }

  // --- Icons -----------------------------------------------------------------

  /**
   * The two packs live in two stylesheets and exactly one is ever loaded.
   *
   * Gating both on a root attribute inside one sheet would mean parsing and
   * keeping ~530 rules in the style set to use half of them. `TranceStyles`
   * loads by URL and ref-counts, so switching the pack unloads one file and
   * loads the other, and the pack you are not using costs nothing at all —
   * which is the same guarantee a disabled feature gets (TRANCE.md §6.5).
   */
  #applyIcons() {
    const root = this.context.document.documentElement;

    if (!Services.prefs.getBoolPref(PREF_ICONS, true)) {
      root.removeAttribute("trance-chrome-icons");
      this.#unloadIconPack();
      this.#releaseNativeMenus();
      return;
    }

    let pack = Services.prefs.getStringPref(PREF_ICON_PACK, DEFAULT_ICON_PACK);
    if (!ICON_PACKS.includes(pack)) {
      TranceLog.warn(NS, `unknown icon pack "${pack}", falling back`);
      pack = DEFAULT_ICON_PACK;
    }

    if (this.#loadedPack !== pack) {
      this.#unloadIconPack();
      this.context.styles.load(iconSheet(pack));
      this.#loadedPack = pack;
      TranceLog.log(NS, "icon pack", pack);
    }

    root.setAttribute("trance-chrome-icons", "true");
    this.#syncNativeMenus();
  }

  #unloadIconPack() {
    if (this.#loadedPack) {
      this.context.styles.unload(iconSheet(this.#loadedPack));
      this.#loadedPack = null;
    }
  }

  // --- macOS context menus ---------------------------------------------------

  /**
   * On macOS `widget.macos.native-context-menus` defaults to true, so the page
   * and tab context menus are drawn by AppKit and no stylesheet can put an icon
   * in them. Turning it off gets the icons and gives up the platform menu — its
   * accessibility behaviour, its feel, its scrolling.
   *
   * That is a real trade with no correct answer, so Trance neither forces it nor
   * hides it. The pref is off by default; when it is on, this claims the
   * platform pref and gives the user's value back on disable, exactly as
   * `TranceSurfaces` does with `zen.theme.acrylic-elements` (ADR-011, ADR-020).
   */
  #syncNativeMenus() {
    const wanted = Services.prefs.getBoolPref(PREF_EMULATED_MENUS, false);
    if (!wanted) {
      this.#releaseNativeMenus();
      return;
    }
    if (this.#previousNativeMenus !== null) {
      return;
    }
    const current = Services.prefs.getBoolPref(PREF_NATIVE_MENUS, true);
    if (!current) {
      return;
    }
    this.#previousNativeMenus = current;
    Services.prefs.setBoolPref(PREF_NATIVE_MENUS, false);
    TranceLog.log(NS, `disabled ${PREF_NATIVE_MENUS} so menus can carry icons`);
  }

  #releaseNativeMenus() {
    if (this.#previousNativeMenus === null) {
      return;
    }
    Services.prefs.setBoolPref(PREF_NATIVE_MENUS, this.#previousNativeMenus);
    this.#previousNativeMenus = null;
  }
}
