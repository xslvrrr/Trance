// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the tab strip — one owner for the sidebar's pinned tabs, folders,
// collapsed rail and unloaded-tab state.
//
// Behaviour inspired by "SuperPins" by CosmoCreeper
// (https://github.com/CosmoCreeper/Zen-Themes), "Advanced Tab Groups" by
// Vertex-Mods (https://github.com/Vertex-Mods/Advanced-Tab-Groups), "Zen Folder
// Tree Connectors" by JustAdumbPrsn
// (https://github.com/JustAdumbPrsn/ZenFolderTreeConnectors), "Customize
// Collapsed Sidebar" by Ciuriya (https://github.com/Ciuriya/zen-themes) and
// "Unloaded Tabs" by qumeqa (https://github.com/qumeqa/unloaded-tabs).
// Implemented independently for Trance; no code copied. Folder Tree Connectors
// is GPL-3.0 and three of the others are unlicensed, so this is a clean-room
// reimplementation by requirement, not by preference (TRANCE.md §7.2, §7.3).
//
// Those five mods install five stylesheets and three scripts over
// `#tabbrowser-tabs`, and between them they hold at least three
// `MutationObserver`s on the same subtree — every chrome mutation fans out to
// all of them, each doing its own `querySelectorAll` and its own style write, so
// one tab opening costs several forced reflows (TRANCE.md §3.2).
//
// This module holds **one** subscription for the whole tab strip, and it is used
// for exactly one thing: keeping the `trance-folder-color` attribute in step
// with folders appearing and disappearing. Connectors, the unloaded state, the
// collapsed rail and sticky pins are attribute- and CSS-driven and add nothing.
//
// Refs: TRANCE.md §3.1, §3.2, §8.1, §13 Phase 4;
// docs/trance/mods/{superpins,advanced-tab-groups,zen-folder-tree-connectors,
// customize-collapsed-sidebar,unloaded-tabs}.md

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "TabStrip";

const ATTR_ROOT = "trance-tabstrip";
const ATTR_FOLDER_COLOR = "trance-folder-color";

const COLOR_MENU_ID = "trance-folder-color-menu";
const FOLDER_ACTIONS_ID = "zenFolderActions";
const FOLDER_ICON_ITEM_ID = "context_zenFolderChangeIcon";

/**
 * Firefox's own tab-group palette, in the platform's order
 * (`MozTabbrowserTabGroupMenu.COLORS`). Trance does not define a second one:
 * the codes resolve against `--tab-group-*` in
 * `browser/themes/shared/tabbrowser/tab.tokens.css` and are persisted by
 * `TabGroupState.sys.mjs`, so a folder's colour survives a restart without
 * Trance owning any storage at all
 * (docs/trance/mods/advanced-tab-groups.md §6).
 */
const FOLDER_COLORS = Object.freeze([
  { code: "blue", label: "Blue" },
  { code: "purple", label: "Purple" },
  { code: "cyan", label: "Cyan" },
  { code: "orange", label: "Orange" },
  { code: "yellow", label: "Yellow" },
  { code: "pink", label: "Pink" },
  { code: "green", label: "Green" },
  { code: "gray", label: "Grey" },
  { code: "red", label: "Red" },
]);

/**
 * What `ZenFolders.createFolder` assigns on creation
 * (`src/zen/folders/ZenFolders.mjs:700`). There is no `--tab-group-zen-workspace-color`
 * anywhere in the tree, so this is "no colour" in practice — which is exactly
 * what Trance uses it as when the user clears one.
 */
const ZEN_DEFAULT_COLOR = "zen-workspace-color";

/**
 * Sub-features. Each is one pref, one root attribute, and no runtime cost when
 * off — the attribute is simply absent and the rules stop matching.
 */
const FLAGS = Object.freeze([
  {
    pref: "trance.tabstrip.connectors",
    attribute: "trance-tabstrip-connectors",
  },
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
]);

const PREF_FOLDER_COLORS = "trance.tabstrip.folders.colors";

export class TranceTabStrip extends TranceFeature {
  static prefName = "trance.tabstrip.enabled";
  static featureName = "TabStrip";
  static styles = [
    "chrome://browser/content/trance-styles/trance-tabstrip.css",
  ];

  /** The submenu appended to Zen's folder context menu, while enabled. */
  #colorMenu = null;
  /** The folder the context menu was last opened on. */
  #contextFolder = null;

  onEnable() {
    this.context.document.documentElement.setAttribute(ATTR_ROOT, "true");

    this.#bindTokens();
    this.#observeFlags();
    this.#applyFlags();
    this.#setUpFolderColors();
  }

  onDisable() {
    const root = this.context.document.documentElement;
    root.removeAttribute(ATTR_ROOT);
    for (const { attribute } of FLAGS) {
      root.removeAttribute(attribute);
    }
    this.#tearDownFolderColors();
  }

  // --- Tokens ----------------------------------------------------------------

  /**
   * The rail's geometry and the unloaded-tab treatment follow their prefs
   * directly. A slider costs one `setProperty`; no rule is re-matched and no
   * stylesheet is rebuilt, which is the difference between this and five mods
   * regenerating `zen-themes.css` between them (TRANCE.md §3.1).
   */
  #bindTokens() {
    const px = value => `${Math.max(0, value)}px`;
    const percent = value => `${Math.min(100, Math.max(0, value))}%`;

    this.bindTokens([
      {
        pref: "trance.tabstrip.rail.width",
        cssVar: "--trance-rail-width",
        type: "int",
        fallback: 48,
        format: px,
      },
      {
        pref: "trance.tabstrip.rail.tab-size",
        cssVar: "--trance-rail-tab-size",
        type: "int",
        fallback: 36,
        format: px,
      },
      {
        pref: "trance.tabstrip.rail.icon-size",
        cssVar: "--trance-rail-icon-size",
        type: "int",
        fallback: 16,
        format: px,
      },
      {
        pref: "trance.tabstrip.rail.margin-top",
        cssVar: "--trance-rail-margin-top",
        type: "int",
        fallback: 0,
        format: px,
      },
      {
        pref: "trance.tabstrip.rail.margin-bottom",
        cssVar: "--trance-rail-margin-bottom",
        type: "int",
        fallback: 0,
        format: px,
      },
      {
        pref: "trance.tabstrip.unloaded.opacity",
        cssVar: "--trance-tab-unloaded-opacity",
        type: "int",
        fallback: 55,
        format: percent,
      },
      {
        pref: "trance.tabstrip.unloaded.saturation",
        cssVar: "--trance-tab-unloaded-saturation",
        type: "int",
        fallback: 0,
        format: percent,
      },
    ]);
  }

  // --- Sub-feature flags -----------------------------------------------------

  #observeFlags() {
    for (const flag of FLAGS) {
      const observer = { observe: () => this.#applyFlags() };
      Services.prefs.addObserver(flag.pref, observer);
      this.addDisposer(() =>
        Services.prefs.removeObserver(flag.pref, observer)
      );
    }

    const colorsObserver = { observe: () => this.#syncFolderColorFeature() };
    Services.prefs.addObserver(PREF_FOLDER_COLORS, colorsObserver);
    this.addDisposer(() =>
      Services.prefs.removeObserver(PREF_FOLDER_COLORS, colorsObserver)
    );
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

  // --- Folder colour ---------------------------------------------------------

  #setUpFolderColors() {
    // One subscription, for the whole tab strip. `zen-workspace` rather than
    // `zen-folder` because a folder added at the top level of a space has no
    // `zen-folder` ancestor for the hub to match on.
    this.observeMutations(
      "zen-workspace",
      records => this.#onStripMutated(records),
      { childList: true, subtree: true }
    );

    const popup = this.context.document.getElementById(FOLDER_ACTIONS_ID);
    if (popup) {
      const onPopupShowing = event => this.#onFolderMenuShowing(event);
      this.addListener(popup, "popupshowing", onPopupShowing);
    }

    this.#syncFolderColorFeature();
  }

  #tearDownFolderColors() {
    this.#removeColorMenu();
    this.#contextFolder = null;
    for (const folder of this.#folders()) {
      folder.removeAttribute(ATTR_FOLDER_COLOR);
    }
  }

  /**
   * The colour sub-feature can be turned off without turning the tab strip off.
   * Doing so removes the menu and every attribute, but deliberately leaves
   * `folder.color` alone: that is Firefox's state, not Trance's, and discarding
   * the user's choices on a pref flip would be the opposite of reversible.
   */
  #syncFolderColorFeature() {
    if (Services.prefs.getBoolPref(PREF_FOLDER_COLORS, true)) {
      this.#ensureColorMenu();
      this.#stampFolders();
      return;
    }
    this.#removeColorMenu();
    for (const folder of this.#folders()) {
      folder.removeAttribute(ATTR_FOLDER_COLOR);
    }
  }

  #folders() {
    return this.context.document.querySelectorAll("zen-folder");
  }

  /**
   * Rescans only when the mutation actually involved a folder. A tab opening
   * mutates this subtree too, and rescanning the folder tree for every tab is
   * the kind of work the mods this replaces did unconditionally.
   *
   * @param {MutationRecord[]} records - The batch the hub flushed.
   */
  #onStripMutated(records) {
    const touchedAFolder = records.some(record =>
      [...record.addedNodes, ...record.removedNodes].some(
        node =>
          node.nodeType === node.ELEMENT_NODE &&
          (node.localName === "zen-folder" ||
            node.querySelector?.("zen-folder"))
      )
    );
    if (!touchedAFolder) {
      return;
    }
    this.#stampFolders();
  }

  /**
   * Marks folders that carry a real platform colour. Without the attribute the
   * stylesheet cannot tell one from a folder still holding Zen's
   * `zen-workspace-color` sentinel, whose token does not exist — tinting those
   * would resolve every folder variable to nothing.
   */
  #stampFolders() {
    if (!Services.prefs.getBoolPref(PREF_FOLDER_COLORS, true)) {
      return;
    }
    for (const folder of this.#folders()) {
      const code = folder.color;
      if (FOLDER_COLORS.some(color => color.code === code)) {
        folder.setAttribute(ATTR_FOLDER_COLOR, code);
      } else {
        folder.removeAttribute(ATTR_FOLDER_COLOR);
      }
    }
  }

  // --- The context-menu submenu ----------------------------------------------

  /**
   * Appended to Zen's own `#zenFolderActions` at runtime rather than added to
   * `popups.inc`. Two reasons: it costs no upstream touchpoint, and a disabled
   * feature leaves no dead menu item behind (TRANCE.md §6.5).
   */
  #ensureColorMenu() {
    if (this.#colorMenu?.isConnected) {
      return;
    }
    const doc = this.context.document;
    const popup = doc.getElementById(FOLDER_ACTIONS_ID);
    if (!popup) {
      TranceLog.warn(NS, `#${FOLDER_ACTIONS_ID} is missing; no colour menu`);
      return;
    }

    const menu = doc.createXULElement("menu");
    menu.id = COLOR_MENU_ID;
    menu.setAttribute("label", "Folder colour");

    const menupopup = doc.createXULElement("menupopup");
    for (const { code, label } of FOLDER_COLORS) {
      menupopup.appendChild(this.#createColorItem(code, label));
    }
    menupopup.appendChild(doc.createXULElement("menuseparator"));
    menupopup.appendChild(this.#createColorItem(ZEN_DEFAULT_COLOR, "Default"));

    menu.appendChild(menupopup);

    const iconItem = doc.getElementById(FOLDER_ICON_ITEM_ID);
    if (iconItem?.parentElement === popup) {
      iconItem.after(menu);
    } else {
      popup.appendChild(menu);
    }
    this.#colorMenu = menu;
  }

  #createColorItem(code, label) {
    const item = this.context.document.createXULElement("menuitem");
    item.setAttribute("type", "radio");
    item.setAttribute("name", COLOR_MENU_ID);
    item.setAttribute("value", code);
    item.setAttribute("label", label);
    item.addEventListener("command", () => this.#applyColor(code));
    return item;
  }

  #removeColorMenu() {
    this.#colorMenu?.remove();
    this.#colorMenu = null;
  }

  /**
   * Zen keeps its own private handle on the folder the menu was opened for, so
   * this repeats the derivation rather than reaching into it. Same three cases
   * Zen handles in `ZenFolders`: the label, a child of the label, and the label
   * container itself.
   *
   * @param {Event} event - Zen's `#zenFolderActions` popupshowing.
   */
  #onFolderMenuShowing(event) {
    const target = event.explicitOriginalTarget;
    let folder = null;
    if (target?.parentElement?.isZenFolder) {
      folder = target.parentElement;
    } else if (target?.closest) {
      folder = target.closest("zen-folder");
    }
    this.#contextFolder = folder?.isZenFolder ? folder : null;

    if (this.#colorMenu) {
      this.#colorMenu.hidden = !this.#contextFolder;
      const current = this.#contextFolder?.color ?? ZEN_DEFAULT_COLOR;
      for (const item of this.#colorMenu.querySelectorAll("menuitem")) {
        item.setAttribute(
          "checked",
          String(item.getAttribute("value") === current)
        );
      }
    }
  }

  #applyColor(code) {
    const folder = this.#contextFolder;
    if (!folder?.isZenFolder) {
      return;
    }
    // The platform setter writes the inline custom properties and
    // `TabGroupState` persists the code. Trance's attribute only says "this one
    // has a real colour".
    folder.color = code;
    if (code === ZEN_DEFAULT_COLOR) {
      folder.removeAttribute(ATTR_FOLDER_COLOR);
    } else {
      folder.setAttribute(ATTR_FOLDER_COLOR, code);
    }
    TranceLog.log(NS, `folder colour set to ${code}`);
  }
}
