/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Trance: conflict warnings on Sine/Cosine mods that Trance reimplements.
 *
 * Trance ships the Sine mod manager (Cosine channel) so that mods outside the
 * curated set stay reachable. The 23 mods in docs/trance/mods-inventory.json
 * are a different case: Trance already owns their behaviour natively, so
 * installing the mod means two owners for one surface — the exact failure this
 * project exists to remove (TRANCE.md §3.1).
 *
 * This file does not block anything. It annotates Sine's marketplace cards and
 * its installed-mods list with a banner saying which Trance feature owns that
 * behaviour and which pref configures it.
 *
 * It runs in the preferences document, not a browser window, so TranceCore is
 * not around. It builds its own scheduler + observer hub for this page rather
 * than adding a private MutationObserver (CLAUDE.md rule 4).
 *
 * Refs: TRANCE.md §3.1, §4.3, §6.5, docs/trance/mods-inventory.json
 */

/* eslint-env mozilla/browser-window */
/* global Services */

const TRANCE_MOD_GUARD_PREF = "trance.modguard.enabled";
const TRANCE_XHTML_NS = "http://www.w3.org/1999/xhtml";

/* Every entry mirrors one record in docs/trance/mods-inventory.json.
 *
 * `keys`  — Sine marketplace ids. Zen-store mods keep their GUID, Sine-store
 *           mods keep their slug, and a mod listed in both stores can arrive
 *           under either, so both go in the list.
 * `names` — display names, matched case- and punctuation-insensitively as a
 *           fallback for mods installed from a raw repo URL, where the id is
 *           whatever the mod's own JSON says.
 * `status`— "native" if Trance already ships the behaviour, "partial" if only
 *           some of it has landed, "planned" if the phase that owns it has
 *           not landed yet, "dropped" if investigation decided Trance will
 *           never build it (a DEFER verdict in the inventory).
 *
 * This table has to be updated when a phase lands. Nothing joins it to
 * mods-inventory.json at build time, so the inventory's `implemented` field is
 * the thing to check it against.
 */
const TRANCE_REPLACED_MODS = [
  {
    keys: ["nebula"],
    names: ["Nebula", "Zen Nebula"],
    status: "native",
    owner: "Trance surfaces",
    pref: "trance.surface.preset",
    detail:
      "Trance ships Nebula's surface treatment natively as the default " +
      "'nebula' surface preset — one blur stack, one token layer, suspended " +
      "when the window loses focus. Running the mod on top adds a second " +
      "blur pass over the same elements.",
  },
  {
    keys: ["642854b5-88b4-4c40-b256-e035532109df"],
    names: ["Transparent Zen", "TransparentZen"],
    status: "native",
    owner: "Trance surfaces",
    pref: "trance.surface.enabled",
    detail:
      "Chrome transparency is part of the Trance surface layer. The mod " +
      "targets the same toolbars and sidebar, so the two fight over opacity " +
      "and the result depends on stylesheet order.",
  },
  {
    keys: ["42b8c4ac-76d5-4521-9917-2e478931ee53"],
    names: ["Zen Compact Transparent Mode"],
    status: "native",
    owner: "Trance surfaces",
    pref: "trance.surface.preset",
    detail:
      "This is the 'compact' surface preset in Trance. Pick it in Trance " +
      "settings instead of stacking a second blur stack on the first.",
  },
  {
    keys: ["nova"],
    names: ["Nova", "Nova UI"],
    status: "native",
    owner: "Trance surfaces and chrome",
    pref: "trance.chrome.enabled",
    detail:
      "Phase 3 landed the flat preset's geometry; phase 5 landed the panel and " +
      "menu spacing, radius, edges and scrollbars, all from existing tokens. " +
      "Its mute-button visualiser (an infinite animation), custom font and " +
      "essentials flattening were dropped deliberately.",
  },
  {
    keys: ["advanced-tab-groups"],
    names: ["Advanced Tab Groups"],
    status: "native",
    owner: "Trance tab strip",
    pref: "trance.tabstrip.folders.colors",
    detail:
      "Grouping, subfolders, the icon picker and collapsed-with-active-tab " +
      "are stock Zen folders. Trance adds the colour submenu and the " +
      "section-style header on top of Zen's own folder actions.",
  },
  {
    keys: ["customize-collapsed-sidebar"],
    names: ["Customize Collapsed Sidebar"],
    status: "native",
    owner: "Trance tab strip",
    pref: "trance.tabstrip.rail.enabled",
    detail:
      "The collapsed rail — width, tab size, icon size, margins and stacked " +
      "top buttons — is native. The mod writes the same variables on :root, " +
      "which Trance deliberately does not do (ADR-015).",
  },
  {
    keys: ["ad97bb70-0066-4e42-9b5f-173a5e42c6fc"],
    names: ["SuperPins", "Super Pins"],
    status: "native",
    owner: "Trance tab strip",
    pref: "trance.tabstrip.pins.sticky",
    detail:
      "Sticky pinned tabs are native, and lazy pinned tabs are surfaced as " +
      "the platform pref rather than reimplemented. The mod also patches " +
      "ZenPinnedTabManager, which Trance does not — running both leaves the " +
      "pin behaviour ambiguous.",
  },
  {
    keys: ["unloaded-tabs"],
    names: ["Unloaded Tabs"],
    status: "native",
    owner: "Trance tab strip",
    pref: "trance.tabstrip.unloaded.enabled",
    detail:
      "Trance is the sole owner of unloaded-tab appearance, with its own " +
      "opacity and saturation controls. The mod dims the same tabs again.",
  },
  {
    keys: ["zenfoldertreeconnectors"],
    names: ["Zen Folder Tree Connectors", "ZenFolderTreeConnectors"],
    status: "native",
    owner: "Trance tab strip",
    pref: "trance.tabstrip.connectors",
    detail:
      "Trance draws the trunk and elbows in CSS alone. The mod ships a " +
      ".uc.js that walks the tab strip on every mutation to do the same job.",
  },
  {
    keys: ["c9ee0d97-d2d6-40fd-8f85-549fe000b868"],
    names: ["Deta Loading Bar"],
    status: "native",
    owner: "Trance feedback",
    pref: "trance.feedback.loading.enabled",
    detail:
      "Trance rebuilt this on nsIWebProgressListener rather than adapting it. " +
      "The original shows four failure modes at once: an infinite animation, " +
      "an animated width, a per-frame filter: blur() and a permanently " +
      "promoted .browserStack. Fourteen prefs became three.",
  },
  {
    keys: ["906c6915-5677-48ff-9bfc-096a02a72379"],
    names: ["Floating Status Bar", "Zen Floating Statusbar"],
    status: "native",
    owner: "Zen, surfaced on the Trance settings page",
    pref: "zen.theme.styled-status-panel",
    detail:
      "Investigation changed this one's verdict to ZEN: " +
      "zen.theme.styled-status-panel already floats the status panel and is " +
      "on by default on macOS. Trance writes no code for it, it just puts the " +
      "Zen pref on its own page. The mod adds a second owner for nothing.",
  },
  {
    keys: ["renderjs"],
    names: ["Render.js", "RenderJS"],
    status: "dropped",
    owner: "deliberately not reimplemented",
    detail:
      "Each of its five behaviours duplicates an owner Trance has already " +
      "assigned — Zen's space animation, the calendar, the new-tab button, " +
      'the tab strip — and "ambient motion" cannot be specified, built or ' +
      "accepted. Installing it puts a second frame loop next to " +
      "TranceScheduler, which is the drain this fork exists to fix.",
  },
  {
    keys: ["bubble-pop-deleting"],
    names: ["Tab Closing Bubble Animation", "Bubble Pop Deleting"],
    status: "native",
    owner: "Trance feedback",
    pref: "trance.feedback.bubbles.enabled",
    detail:
      "Clean-room: TabClose rather than a MutationObserver, Web Animations " +
      "through TranceMotion rather than keyframes plus a timer, and one " +
      "getBoundingClientRect per burst rather than one per bubble.",
  },
  {
    keys: ["context-menu-icons"],
    names: ["Context Menu Icons"],
    status: "native",
    owner: "Trance icons",
    pref: "trance.chrome.icons.enabled",
    detail:
      "This mod is the icon cluster's source. Its MIT packs are copied " +
      "verbatim and its ~270-selector mapping is adapted with every " +
      "!important stripped. Running it as a mod puts those !importants back.",
  },
  {
    keys: ["81fcd6b3-f014-4796-988f-6c3cb3874db8"],
    names: ["Zen Context Menu"],
    status: "native",
    owner: "Trance icons and menus",
    pref: "trance.chrome.menus.tint",
    detail:
      "Merged with Context Menu Icons into one canonical Trance icon set. " +
      "The workspace-colour menu tint is kept; its thirty-two hide-toggles " +
      "were dropped. Turning off macOS native context menus is an opt-in " +
      "pref here, off by default (ADR-020).",
  },
  {
    keys: ["new-icons"],
    names: ["New Icons", "Zen Icons"],
    status: "native",
    owner: "Trance icons",
    pref: "trance.chrome.icons.pack",
    detail:
      "Trance ships two icon packs and loads exactly one at a time. This " +
      "mod contributed the coverage requirement — toolbar, panels and the " +
      "site-information panel — and no assets.",
  },
  {
    keys: ["cb15abdb-0514-4e09-8ce5-722cf1f4a20f"],
    names: ["Hide Extension Name"],
    status: "native",
    owner: "Trance chrome",
    pref: "trance.chrome.urlbar.hide-extension-name",
    detail:
      "Three lines of CSS. Trance writes the same rule without the " +
      "!important a userChrome sheet needs.",
  },
  {
    keys: ["e9dae25b-2ddd-4245-8581-a6dcf6d35b82"],
    names: ["Zen Custom URL Bar", "Zen Custom Urlbar"],
    status: "native",
    owner: "Trance chrome",
    pref: "trance.chrome.urlbar.focus-dim",
    detail:
      "Eight prefs became two. Only the page-recede effect survived: the " +
      "colour and radius work belongs to the Trance surface layer's overlay " +
      "region, so the mod and Trance would fight over the same urlbar.",
  },
  {
    keys: [],
    names: ["Better New Tab Button", "Zen Better New Tab Button"],
    status: "native",
    owner: "Trance chrome",
    pref: "trance.chrome.newtab.compact",
    detail:
      "Unlabelled centred plus, with its press rotation owned by " +
      "trance.motion.level rather than a pref of its own. Its per-component " +
      "radius sliders were dropped: Trance has one radius scale, and one " +
      "owner per value is the whole anti-conflict design.",
  },
  {
    keys: ["betterzengradientpicker"],
    names: ["BetterZenGradientPicker", "Better Zen Gradient Picker"],
    status: "planned",
    owner: "Trance theming (phase 8)",
    detail:
      "Trance builds on Zen's own gradient engine in phase 8, wired to " +
      "--trance-accent.",
  },
  {
    keys: ["zen-live-calendar"],
    names: ["Live Calendar", "Zen Live Calendar"],
    status: "planned",
    owner: "Trance apps (phase 7)",
    detail:
      "Known offender: a setInterval clock. Trance rebuilds it on " +
      "TranceScheduler.onWallClock in phase 7.",
  },
  {
    keys: ["zen-library"],
    names: ["Zen Library"],
    status: "planned",
    owner: "Trance apps (phase 7)",
    detail: "Reimplemented natively in phase 7.",
  },
  {
    keys: ["599a1599-e6ab-4749-ab22-de533860de2c"],
    names: ["Pimp your PiP"],
    status: "planned",
    owner: "Trance picture-in-picture (phase 10)",
    detail: "Reimplemented clean-room in phase 10.",
  },
];

const TRANCE_STATUS_LABEL = {
  native: "Replaced by Trance",
  partial: "Partly replaced by Trance",
  planned: "Trance will replace this",
  dropped: "Trance will not replace this",
};

var gTranceModGuard = {
  __hasInitialized: false,

  /** @type {Map<string, object>} */
  _index: new Map(),

  /** @type {object | null} */
  _scheduler: null,

  /** @type {object | null} */
  _hub: null,

  _stylesheetAdded: false,

  /**
   * Sine renders its panes long after this script parses, and re-renders them
   * on search, pagination, install and uninstall. Rather than racing it, the
   * guard subscribes to the two lists it cares about and decorates whatever is
   * in them each time they change.
   */
  init() {
    if (this.__hasInitialized) {
      return;
    }
    if (!Services.prefs.getBoolPref(TRANCE_MOD_GUARD_PREF, true)) {
      return;
    }
    this.__hasInitialized = true;

    for (const entry of TRANCE_REPLACED_MODS) {
      for (const key of entry.keys) {
        this._index.set(this._normalize(key), entry);
      }
      for (const name of entry.names) {
        this._index.set(this._normalize(name), entry);
      }
    }

    const { TranceScheduler } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceScheduler.mjs"
    );
    const { TranceObserverHub } = ChromeUtils.importESModule(
      "chrome://browser/content/trance-components/TranceObserverHub.mjs"
    );

    this._scheduler = new TranceScheduler(window);
    this._hub = new TranceObserverHub(window, this._scheduler);
    this._hub.observeMutations(
      "#sineModsList, #sineInstallationList",
      () => this.decorate(),
      { childList: true, subtree: true }
    );

    window.addEventListener("unload", () => this.destroy(), { once: true });

    // Sine may already have rendered if this page was opened at #sineMods.
    this.decorate();
  },

  destroy() {
    this._hub?.destroy();
    this._scheduler?.destroy();
    this._hub = null;
    this._scheduler = null;
  },

  /**
   * Strips case and punctuation so "Render.js" and "renderjs" agree.
   *
   * @param {string} value
   * @returns {string}
   */
  _normalize(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  },

  /**
   * Marketplace titles read "Name (v1.2.3)".
   *
   * @param {string} title
   * @returns {string}
   */
  _titleToName(title) {
    return title.replace(/\s*\(v[^)]*\)\s*$/, "");
  },

  _lookup({ id, name }) {
    if (id) {
      const byId = this._index.get(this._normalize(id));
      if (byId) {
        return byId;
      }
    }
    if (name) {
      return this._index.get(this._normalize(name)) ?? null;
    }
    return null;
  },

  /**
   * Sine's stylesheet is not ours, so the banner brings its own — but only
   * once a mod actually needs one. A profile with no Sine and no matching mod
   * loads no extra CSS.
   */
  _ensureStylesheet() {
    if (this._stylesheetAdded) {
      return;
    }
    this._stylesheetAdded = true;
    const link = document.createElementNS(TRANCE_XHTML_NS, "link");
    link.rel = "stylesheet";
    link.href = "chrome://browser/content/trance-styles/trance-mod-guard.css";
    document.head.append(link);
  },

  decorate() {
    for (const item of document.querySelectorAll(".sineItem[mod-id]")) {
      const title = item.querySelector(".sineItemTitle")?.textContent ?? "";
      this._apply(item, {
        id: item.getAttribute("mod-id"),
        name: title.trim(),
      });
    }

    for (const item of document.querySelectorAll(".sineInstallationItem")) {
      const title =
        item.querySelector(".sineMarketplaceItemTitle")?.textContent ?? "";
      this._apply(item, {
        id: null,
        name: this._titleToName(title).trim(),
      });
    }
  },

  _apply(item, identity) {
    if (item.querySelector(":scope > .trance-mod-warning")) {
      return;
    }
    const entry = this._lookup(identity);
    if (!entry) {
      return;
    }

    this._ensureStylesheet();
    item.setAttribute("trance-replaced", entry.status);

    const banner = document.createElementNS(TRANCE_XHTML_NS, "div");
    banner.className = "trance-mod-warning";
    banner.setAttribute("data-trance-status", entry.status);

    const heading = document.createElementNS(TRANCE_XHTML_NS, "div");
    heading.className = "trance-mod-warning-title";
    heading.textContent = `${TRANCE_STATUS_LABEL[entry.status]} — ${entry.owner}`;
    banner.append(heading);

    const body = document.createElementNS(TRANCE_XHTML_NS, "div");
    body.className = "trance-mod-warning-body";
    body.textContent = entry.detail;
    banner.append(body);

    const actions = document.createElementNS(TRANCE_XHTML_NS, "div");
    actions.className = "trance-mod-warning-actions";

    const goto = document.createElementNS(TRANCE_XHTML_NS, "button");
    goto.className = "trance-mod-warning-button";
    goto.textContent = "Open Trance settings";
    goto.addEventListener("click", () => {
      // preferences.js exposes gotoPref as a window global; fall back to the
      // hash if that ever stops being true.
      if (typeof window.gotoPref === "function") {
        window.gotoPref("paneTrance");
      } else {
        window.location.hash = "trance";
      }
    });
    actions.append(goto);

    if (entry.pref) {
      const prefName = document.createElementNS(TRANCE_XHTML_NS, "code");
      prefName.className = "trance-mod-warning-pref";
      prefName.textContent = entry.pref;
      actions.append(prefName);
    }

    banner.append(actions);

    // Both card layouts are column flexboxes whose action row is pinned to the
    // bottom with `margin-top: auto`, so the banner goes above that row rather
    // than after it.
    const anchor = item.querySelector(
      ":scope > .sineItemActions, :scope > .sineMarketplaceButtonContainer"
    );
    if (anchor) {
      anchor.before(banner);
    } else {
      item.append(banner);
    }
  },
};

window.addEventListener("DOMContentLoaded", () => gTranceModGuard.init(), {
  once: true,
});
