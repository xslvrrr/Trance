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
 *           never build it (a DEFER verdict in the inventory), and "shipped"
 *           if Trance installs the mod itself rather than reimplementing it.
 *
 *           "shipped" is not a warning and is not coloured like one. Six mods
 *           are in that category, for four different reasons.
 *
 *           Two are a licence question, from opposite ends of the spectrum: an
 *           unlicensed icon set whose *look* Trance may not reproduce
 *           (ADR-024), and a GPL-3.0 tree-connector mod whose rules Trance may
 *           not copy (ADR-027). In both cases a clean-room reimplementation
 *           could only ever approximate someone else's drawing.
 *
 *           Two are a value question: Zen Library and Live Calendar each open a
 *           surface of their own and own no element Trance owns, so
 *           reimplementing them would remove no conflict and would arrive at
 *           the same runtime cost as the original (ADR-030).
 *
 *           One had nothing on either side of the trade: Pimp your PiP is 88
 *           lines of CSS over a window no Trance stylesheet reaches, so there
 *           was no conflict to remove and no cost to cut (ADR-039).
 *
 *           And one was a third of a mod: Trance kept Better New Tab button's
 *           unlabelled plus and refused its radius sliders, which left the
 *           button with two owners and a user with part of what they installed.
 *           Shipping the author's own distribution ends both (ADR-049).
 *
 *           In all six cases anyone — including this provisioner — may install
 *           the author's own distribution. The banner is there so that the
 *           reason it is preinstalled, and what turning it off costs, are
 *           visible where the mod is.
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
    pref: "trance.surface.enabled",
    detail:
      "Trance ships Nebula's surface treatment natively — one blurred " +
      "surface for the whole browser, one token layer, suspended when the " +
      "window loses focus. Running the mod on top adds a second blur pass " +
      "over the same elements.",
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
    pref: "trance.surface.enabled",
    detail:
      "Trance's own surface layer already frosts compact mode's overlays, " +
      "from the same single surface as everything else. Running this on top " +
      "stacks a second blur pass on the first.",
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
    status: "shipped",
    owner: "Trance tab strip",
    detail:
      "Trance provisions this mod itself, at the version its author " +
      "publishes. It used to reimplement the connectors in CSS instead, and " +
      "that could only ever be an approximation of someone else's drawing — " +
      "the mod is GPL-3.0, so its own rules may not be copied. Installing it " +
      "is not copying it, and it puts the tree lines back under one owner. " +
      "Trance now draws none of its own; uninstalling this leaves folders " +
      "with no connectors at all (ADR-027).",
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
    pref: "trance.chrome.icons.scale",
    detail:
      "This mod was the icon cluster's source. Trance no longer ships packs " +
      "of its own (ADR-039), so what is left of the cluster is the size " +
      "control — running the mod puts back the ~270 !important declarations " +
      "the mapping needed and gives every menu glyph a second owner.",
  },
  {
    keys: ["81fcd6b3-f014-4796-988f-6c3cb3874db8"],
    names: ["Zen Context Menu"],
    status: "native",
    owner: "Trance icons and menus",
    pref: "trance.chrome.menus.tint",
    detail:
      "The workspace-colour menu tint is kept; its thirty-two hide-toggles " +
      "were dropped, and so was the icon half — Trance ships no icon packs, " +
      "so there is nothing left that needed macOS's native context menus " +
      "turned off to be visible (ADR-020, ADR-039).",
  },
  {
    keys: ["new-icons"],
    names: ["New Icons", "Zen Icons"],
    status: "shipped",
    owner: "Trance icons",
    pref: "trance.chrome.icons.scale",
    detail:
      "Trance provisions this mod itself, at the version its author " +
      "publishes, so the icons are the ones the mod's author draws rather " +
      "than an approximation of them. Trance ships no packs of its own to " +
      "argue with it (ADR-039); uninstalling it here is supported, and the " +
      "browser's own glyphs are what you get back (ADR-024).",
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
    keys: ["bada16c1-3b14-483b"],
    names: ["Better New Tab button", "Better New Tab Button"],
    status: "shipped",
    owner: "Trance chrome",
    detail:
      "Trance provisions this mod itself, at the version its author " +
      "publishes. Trance used to reimplement one behaviour of it — the " +
      "unlabelled centred plus — and drop the rest; shipping the mod gives " +
      "the button one owner again, and it is the author's, radius sliders " +
      "included. Uninstalling it here is supported and leaves the browser's " +
      "own labelled button behind (ADR-049).",
  },
  {
    keys: ["betterzengradientpicker"],
    names: ["BetterZenGradientPicker", "Better Zen Gradient Picker"],
    status: "native",
    owner: "Trance theming",
    pref: "trance.theme.enabled",
    detail:
      "Trance extends Zen's own picker in place: a lightness slider, a " +
      "gradient-angle knob, eight palettes, saved themes and exact hex " +
      "entry, all in the same panel. Both this mod and Trance rebuild the " +
      "same panel's controls, so running both means two owners for one " +
      "surface and a layout that depends on which loaded last.",
  },
  {
    keys: ["zen-live-calendar"],
    names: ["Live Calendar", "Zen Live Calendar"],
    status: "shipped",
    owner: "Trance apps",
    detail:
      "Trance provisions this mod itself, at the version its author " +
      "publishes. It was scheduled for a clean-room rebuild on " +
      "TranceScheduler.onWallClock; the investigation found its one " +
      "always-armed timer is already a 60-second refresh, which is the exact " +
      "budget that rebuild was going to be held to, and it owns no element " +
      "Trance owns. Uninstalling it here is supported and leaves nothing " +
      "behind — Trance builds no calendar of its own (ADR-030).",
  },
  {
    keys: ["zen-library"],
    names: ["Zen Library"],
    status: "shipped",
    owner: "Trance apps",
    detail:
      "Trance provisions this mod itself, at the version its author " +
      "publishes. 7,500 lines with no interval, no MutationObserver and no " +
      "infinite animation, opening a surface of its own that nothing in " +
      "Trance competes for — so a reimplementation would have removed no " +
      "conflict and cost what the original costs. Uninstalling it here is " +
      "supported and leaves nothing behind (ADR-030).",
  },
  {
    keys: ["599a1599-e6ab-4749-ab22-de533860de2c"],
    names: ["Pimp your PiP"],
    status: "shipped",
    owner: "Trance picture-in-picture",
    detail:
      "Trance provisions this mod itself, at the version its author " +
      "publishes. It was scheduled for a clean-room rebuild in phase 10; the " +
      "investigation found 88 lines of CSS, no script and no timer, over a " +
      "Picture-in-Picture player that no Trance stylesheet reaches — so a " +
      "rewrite would have removed no conflict and cut no cost. Uninstalling " +
      "it here is supported and leaves nothing behind: the player goes back " +
      "to looking like Firefox's (ADR-039).",
  },
];

/* ── Everything that is not in the table above ───────────────────────────────
 *
 * The table names 23 mods exactly, and that was the whole of this feature: a mod
 * Trance had investigated got a precise banner, and every other mod in a store
 * of hundreds got nothing — including the ones that restyle the same six
 * elements from the same six selectors, which is the failure this project is
 * about. Naming the mods Trance happens to have looked at is not the same
 * promise as warning about mods that can clash.
 *
 * So the table is now the *precise* half and this is the general one. A card
 * with no entry is matched on what it says it does — its title and its own
 * description, which is the only thing about an uninstalled mod that is
 * readable from here — against the surfaces Trance owns. A hit gets a banner
 * naming the feature it will be arguing with and the setting that configures
 * it; a miss gets nothing at all, which is most of the store and is the point.
 *
 * Two things this deliberately is not:
 *
 *   - It is not a block, and it is not a claim that the mod *will* break. Two
 *     stylesheets over one element is a conflict whoever wins; two stylesheets
 *     over two different elements is a browser with a mod in it. This says which
 *     of those a mod is likely to be, from the only evidence available before
 *     installing it.
 *   - It is not a scan of the mod's CSS. Sine has not downloaded an uninstalled
 *     mod yet, so there is nothing to read; and a guard that only worked after
 *     installation would be warning about a conflict that had already happened.
 *
 * `exclude` is what keeps the small ones quiet. A mod about the
 * Picture-in-Picture window, a clock, a calendar or the profile switcher owns a
 * surface Trance has no opinion about — several are preinstalled *by* Trance for
 * exactly that reason (ADR-030, ADR-039) — and a warning on one of those trains
 * people to ignore the warnings on the rest.
 */
const TRANCE_CLASH_AREAS = [
  {
    id: "surfaces",
    owner: "Trance surfaces",
    pref: "trance.surface.enabled",
    match: [
      "transparent",
      "transparency",
      "translucent",
      "blur",
      "acrylic",
      "frost",
      "glass",
      "mica",
      "vibrancy",
      "backdrop",
      "opacity",
    ],
    detail:
      "Trance owns one frosted surface for the whole browser, with a blur " +
      "budget of one pass and blur dropped when the window is not visible. A " +
      "mod that adds transparency or blur adds a second surface over the same " +
      "elements, which is both a second owner and a second full-window pass.",
  },
  {
    id: "tabstrip",
    owner: "Trance tab strip",
    pref: "trance.tabstrip.enabled",
    match: [
      "tab strip",
      "tabstrip",
      "sidebar",
      "pinned",
      "pin ",
      "workspace",
      "folder",
      "essentials",
      "vertical tabs",
      "tab group",
    ],
    detail:
      "Trance holds a single subscription for the whole tab strip and owns " +
      "pinned tabs, folder colour, the collapsed rail, the tab fills and the " +
      "active-tab glow. A mod over the same rows means two owners for one " +
      "element, and which one wins depends on load order.",
  },
  {
    id: "chrome",
    owner: "Trance chrome",
    pref: "trance.chrome.enabled",
    match: [
      "urlbar",
      "url bar",
      "address bar",
      "toolbar",
      "context menu",
      "menu",
      "panel",
      "icon",
      "new tab button",
      "window controls",
    ],
    detail:
      "Trance owns the menus, the panels, the address bar's page-recede, the " +
      "new-tab button, the app-menu mark and the top of the sidebar. Seven " +
      "mods used to argue over those same selectors with `!important`; " +
      "installing one of them puts the argument back.",
  },
  {
    id: "motion",
    owner: "Trance motion",
    pref: "trance.motion.level",
    match: [
      "animation",
      "animate",
      "transition",
      "motion",
      "fade",
      "bounce",
      "easing",
      "keyframe",
    ],
    detail:
      "Trance owns every animation in the chrome through one motion level and " +
      "one scheduler, so that reduced motion is honoured everywhere and " +
      "nothing keeps the refresh driver awake in a hidden window. A mod's own " +
      "animations answer to neither.",
  },
  {
    id: "theme",
    owner: "Trance theming",
    pref: "trance.theme.enabled",
    match: [
      "gradient",
      "theme picker",
      "colour picker",
      "color picker",
      "accent",
      "palette",
    ],
    detail:
      "Trance extends Zen's own gradient picker in place — a lightness " +
      "slider, an angle knob, palettes, saved themes and hex entry. A mod that " +
      "rebuilds the same panel's controls means two owners for one surface.",
  },
];

/**
 * Mods whose surface Trance has no opinion about. Checked first, so a calendar
 * that mentions "animation" in its description stays quiet.
 */
const TRANCE_CLASH_EXCLUDE = [
  "picture-in-picture",
  "picture in picture",
  "pip",
  "calendar",
  "clock",
  "weather",
  "library",
  "translate",
  "reader mode",
  "screenshot",
  "bookmark",
  "download",
  "profile switcher",
  "keyboard shortcut",
];

const TRANCE_STATUS_LABEL = {
  native: "Replaced by Trance",
  partial: "Partly replaced by Trance",
  planned: "Trance will replace this",
  dropped: "Trance will not replace this",
  shipped: "Installed by Trance",
  clash: "May clash with Trance",
};

var gTranceModGuard = {
  __hasInitialized: false,

  /** @type {Map<string, object>} */
  _index: new Map(),

  /** @type {object | null} */
  _scheduler: null,

  /** @type {object | null} */
  _hub: null,

  /** Whether `_hub` is this object's to destroy. See `init`. */
  _ownsHub: false,

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

    // trance-settings.js already owns a scheduler and an observer hub for this
    // document — it needs one for the combobox — so this borrows them rather
    // than installing a second MutationObserver over the same subtree, which is
    // the exact multiplication TranceObserverHub exists to prevent (TRANCE.md
    // §3.2). The fallback is here because that file is loaded by the same
    // include and could in principle be absent from a partial build; a mod
    // guard that silently did nothing would be worse than one that costs an
    // observer.
    if (window.gTrancePage?.hub) {
      this._hub = window.gTrancePage.hub;
      this._ownsHub = false;
    } else {
      const { TranceScheduler } = ChromeUtils.importESModule(
        "chrome://browser/content/trance-components/TranceScheduler.mjs"
      );
      const { TranceObserverHub } = ChromeUtils.importESModule(
        "chrome://browser/content/trance-components/TranceObserverHub.mjs"
      );
      this._scheduler = new TranceScheduler(window);
      this._hub = new TranceObserverHub(window, this._scheduler);
      this._ownsHub = true;
    }

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
    // Only the hub this object built. A borrowed one belongs to gTrancePage,
    // which tears it down on the same `unload`.
    if (this._ownsHub) {
      this._hub?.destroy();
      this._scheduler?.destroy();
    }
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

  /**
   * What a card says about itself, as one lower-case string.
   *
   * The card's whole `textContent` rather than a description element by class
   * name: Sine renders the marketplace and the installed list from two different
   * templates, it has renamed those classes before, and a classifier that
   * silently reads nothing is worse than one that also reads the word
   * "Install". None of the keywords below is a button label.
   *
   * @param {Element} item
   * @returns {string}
   */
  _cardText(item) {
    return (item.textContent ?? "").toLowerCase();
  },

  /**
   * The general half of the guard: what is this mod likely to be arguing with?
   *
   * First match wins, and the order of `TRANCE_CLASH_AREAS` is therefore the
   * order of confidence — a mod that mentions both the sidebar and an animation
   * is a tab-strip mod that animates, not an animation mod.
   *
   * @param {string} text
   * @returns {object | null} An entry shaped like the curated ones.
   */
  _classify(text) {
    if (!text) {
      return null;
    }
    if (TRANCE_CLASH_EXCLUDE.some(word => text.includes(word))) {
      return null;
    }
    const area = TRANCE_CLASH_AREAS.find(candidate =>
      candidate.match.some(word => text.includes(word))
    );
    if (!area) {
      return null;
    }
    return {
      status: "clash",
      owner: area.owner,
      pref: area.pref,
      detail: area.detail,
    };
  },

  _apply(item, identity) {
    if (item.querySelector(":scope > .trance-mod-warning")) {
      return;
    }
    // The curated table first, always: it names the exact feature, the exact
    // pref and what was actually decided about that mod, and a general note
    // would be a worse answer to a question this file already knows.
    const entry =
      this._lookup(identity) ?? this._classify(this._cardText(item));
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
