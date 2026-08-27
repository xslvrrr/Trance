// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the first-run panel.
//
// Trance ships seven extensions, and it ships them the way TRANCE.md §9.1
// chose: an enterprise policy with `installation_mode: normal_installed` and an
// AMO `install_url`. Nothing is vendored, nothing is frozen at a version, and
// nothing about the arrangement is visible — which is the problem this file
// exists to solve. A policy install is a network fetch during startup with no
// UI attached. On a machine that is offline, behind a captive portal, or simply
// slow, it fails silently and the browser looks like it shipped without an ad
// blocker.
//
// So the panel reports what actually happened, once, and offers to try again.
// §13 Phase 9's acceptance criterion is that phrase exactly: "offline first run
// degrades visibly and recoverably, not silently".
//
// ── Where the list comes from ─────────────────────────────────────────────
//
// From the policy, through `Services.policies.getActivePolicies()`. Not from a
// list in this file. `distribution/policies.json` decides which extensions
// Trance installs; a second copy of that decision here would be the two-owners
// problem (TRANCE.md §3.1) applied to a JSON file, and it would go stale on the
// first change. All this module keeps is display names — a map from add-on id
// to something readable, used only until the add-on is installed and can be
// asked its own name.
//
// A build whose `distribution/` directory never got installed has no active
// policy at all, and the panel says so rather than showing seven empty rows.
// That is the single most useful thing it can say to whoever is building this.
//
// ── Retry is the policy's own code path ───────────────────────────────────
//
// `installAddonFromURL` from `PoliciesHelpers.sys.mjs` is what the policy engine
// itself calls at startup. Retry calls the same function with the same
// arguments, so a retried install is not a second implementation that might
// differ — it is the first one, run again.
//
// ── Why it waits for Zen's welcome ────────────────────────────────────────
//
// Zen's own welcome flow is a full-window takeover, and it sets
// `zen.welcome-screen.seen` when it *starts*, not when it finishes. The pref is
// therefore useless as a "welcome is over" signal on its own; the signal is the
// `zen-welcome-stage` attribute ZenWelcome puts on the document element and
// removes in `finish()`. This waits for both: the pref true, the attribute gone.
//
// Refs: TRANCE.md §9, §13 Phase 9; ADR-032

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";

const NS = "FirstRun";

const PREF_COMPLETED = "trance.firstrun.completed";

/** Zen's welcome flow. Read, never written. */
const PREF_ZEN_WELCOME_SEEN = "zen.welcome-screen.seen";
const ATTR_ZEN_WELCOME = "zen-welcome-stage";

/**
 * Trance's own onboarding flow, which since Phase 13 replaces Zen's whenever it
 * is enabled (ADR-051). Read, never written.
 *
 * Both flows publish the same two signals — a "this has been claimed" pref and
 * an attribute on the document element that exists only while the takeover is
 * on screen — so the wait below is the same wait either way. What changes is
 * which pair to read, and `ZenStartup` decides that with the same condition.
 */
const PREF_ONBOARDING_ENABLED = "trance.onboarding.enabled";
const PREF_ONBOARDING_COMPLETED = "trance.onboarding.completed";
const ATTR_TRANCE_ONBOARDING = "trance-onboarding-stage";

const PANEL_ID = "trance-firstrun-panel";

/**
 * Display names for the seven, keyed by add-on id.
 *
 * Only used for an extension that is not installed yet: once it is, the panel
 * asks the add-on for its own name, which is the localised one. An id that is
 * not in this map falls back to the id itself, so adding an eighth extension to
 * `policies.json` and forgetting this map produces an ugly row, not a missing
 * one.
 */
const EXTENSION_NAMES = Object.freeze({
  "uBlock0@raymondhill.net": "uBlock Origin",
  "sponsorBlocker@ajay.app": "SponsorBlock",
  "jid1-MnnxcxisBPnSXQ@jetpack": "Privacy Badger",
  "addon@darkreader.org": "Dark Reader",
  "{74145f27-f039-47ce-a470-a662b129930a}": "ClearURLs",
  "{762f9885-5a13-4abd-9c77-433dcd38b8fd}": "Return YouTube Dislike",
  "{91aa3897-2634-4a8a-9092-279db23a7689}": "Zen Internet",
});

/** The two installation modes that mean "the policy installs this". */
const INSTALLING_MODES = Object.freeze(["normal_installed", "force_installed"]);

const STATUS_LABEL = Object.freeze({
  installed: "Installed",
  disabled: "Turned off",
  installing: "Installing…",
  missing: "Not installed",
  failed: "Failed",
});

export class TranceFirstRun extends TranceFeature {
  static prefName = "trance.firstrun.enabled";
  static featureName = "FirstRun";
  static styles = [
    "chrome://browser/content/trance-styles/trance-firstrun.css",
  ];

  /** @type {object | null} `AddonManager`, imported only when the panel runs. */
  #addons = null;

  /** @type {Element | null} */
  #panel = null;

  /** @type {Map<string, {row: Element, status: Element, state: string}>} */
  #rows = new Map();

  /** @type {{id: string, url: string}[]} */
  #entries = [];

  /** @type {Element | null} */
  #retryButton = null;

  #prefObservers = [];
  #addonListener = null;
  #installListener = null;
  #idleHandle = 0;
  #welcomeHandle = 0;

  onEnable() {
    // Two prefs and one attribute decide whether this window shows the panel,
    // and all three can change after startup: the user can ask for the panel
    // again from the settings page, and Zen's welcome finishes whenever it
    // finishes.
    //
    // The two prefs are watched from here; the attribute is not. A subscription
    // on the observer hub is a real cost — it is a subscriber the shared
    // MutationObserver has to match every record against, for the life of the
    // window — and it is only worth anything during the seconds Zen's welcome
    // is actually on screen. So it is taken out in `#watchWelcomeEnd`, when the
    // welcome is found to be running, and given back the moment it ends. Every
    // other session pays two pref observers and nothing else.
    this.#watchPref(PREF_COMPLETED);
    this.#watchPref(PREF_ZEN_WELCOME_SEEN);
    this.#watchPref(PREF_ONBOARDING_COMPLETED);
    this.#maybeShow();
  }

  onDisable() {
    this.#close();
    this.#releaseWelcomeWatch();
    for (const [pref, observer] of this.#prefObservers.splice(0)) {
      Services.prefs.removeObserver(pref, observer);
    }
  }

  // --- Deciding whether to show ----------------------------------------------

  /**
   * @param {string} pref
   */
  #watchPref(pref) {
    const observer = { observe: () => this.#maybeShow() };
    Services.prefs.addObserver(pref, observer);
    this.#prefObservers.push([pref, observer]);
  }

  /**
   * Which of the two first-run flows this build actually runs.
   *
   * The same condition `ZenStartup` uses, and it has to be: if this reads the
   * wrong pair of signals, the panel either opens over a takeover that is still
   * running or never opens at all. Read each time rather than cached — the pref
   * is one of the ones `#watchPref` is watching, and a browser whose onboarding
   * was switched off mid-session should fall back to Zen's signals.
   */
  get #signals() {
    if (Services.prefs.getBoolPref(PREF_ONBOARDING_ENABLED, false)) {
      return {
        pref: PREF_ONBOARDING_COMPLETED,
        attribute: ATTR_TRANCE_ONBOARDING,
      };
    }
    return { pref: PREF_ZEN_WELCOME_SEEN, attribute: ATTR_ZEN_WELCOME };
  }

  /**
   * The first-run takeover is over.
   *
   * Both halves are needed. The pref alone is true from the moment the flow
   * *starts* — `ZenStartup.#checkForWelcomePage` for Zen's, `start()` for
   * Trance's, and both claim ownership on entry rather than on exit — and the
   * attribute alone is absent for the whole of startup before the flow puts it
   * there.
   */
  get #welcomeIsDone() {
    const { pref, attribute } = this.#signals;
    return (
      Services.prefs.getBoolPref(pref, false) &&
      !this.context.document.documentElement.hasAttribute(attribute)
    );
  }

  /**
   * Subscribes to the end of Zen's welcome flow, once.
   *
   * Released as soon as it fires: this is the one place in Trance where an
   * observer subscription is correct for a few seconds and wrong for the rest
   * of the session.
   */
  #watchWelcomeEnd() {
    if (this.#welcomeHandle) {
      return;
    }
    this.#welcomeHandle = this.observeMutations(
      ":root",
      () => {
        if (this.#welcomeIsDone) {
          this.#releaseWelcomeWatch();
          this.#maybeShow();
        }
      },
      {
        attributes: true,
        // Both, not `#signals.attribute`: the subscription outlives the pref
        // read that chose it, and a filter is cheaper than being wrong.
        attributeFilter: [ATTR_ZEN_WELCOME, ATTR_TRANCE_ONBOARDING],
        subtree: false,
      }
    );
  }

  #releaseWelcomeWatch() {
    if (this.#welcomeHandle) {
      this.context.observers.unobserve(this.#welcomeHandle);
      this.#welcomeHandle = 0;
    }
  }

  #maybeShow() {
    if (
      this.#panel ||
      this.#idleHandle ||
      Services.prefs.getBoolPref(PREF_COMPLETED, false)
    ) {
      return;
    }
    if (!this.#welcomeIsDone) {
      // Only while it is genuinely running. If the flow has not started yet —
      // a fresh profile, before `ZenStartup` or the onboarding's own idle
      // callback gets to it — the pref observer is what brings us back.
      if (
        this.context.document.documentElement.hasAttribute(
          this.#signals.attribute
        )
      ) {
        this.#watchWelcomeEnd();
      }
      return;
    }
    // Not in a test run. Every mochitest profile is a fresh profile, so without
    // this every suite in the tree — not only Trance's — would get a panel
    // opening over the browser five seconds in, and a first-run report is not
    // worth a class of intermittent failures nobody can place. Trance's own
    // suite calls `show()`, which is public for exactly this reason.
    if (Cu.isInAutomation) {
      return;
    }
    // Never during startup's own work. The timeout is a backstop for a window
    // that never goes idle, not a schedule.
    this.#idleHandle = this.onIdle(() => this.show(), { timeout: 5000 });
  }

  // --- The panel -------------------------------------------------------------

  /**
   * Opens the panel in this window, now.
   *
   * Public because two callers need it and neither is `#maybeShow`: the
   * mochitest, which cannot wait for an idle callback that automation
   * suppresses, and anything later that wants to show the report on demand. It
   * still refuses to open a second one, and it still claims the first run.
   */
  show() {
    // Cancelled rather than zeroed: this may have been called directly while an
    // idle callback was still queued, and a handle dropped on the floor is a
    // subscription the scheduler keeps until the window closes.
    if (this.#idleHandle) {
      this.context.scheduler.cancel(this.#idleHandle);
      this.#idleHandle = 0;
    }
    // Re-checked rather than assumed: the idle callback runs some time after
    // `#maybeShow` decided, and in that window another window may have taken
    // the first run, or Zen's welcome may have started.
    if (this.#panel || Services.prefs.getBoolPref(PREF_COMPLETED, false)) {
      return;
    }
    if (!this.#welcomeIsDone) {
      // The welcome started between the decision and this callback, which is
      // the ordering `#maybeShow` cannot rule out: `ZenStartup` sets the pref
      // and loads the welcome in one task, and the pref observer fires in
      // between. Wait for the end of it instead.
      this.#watchWelcomeEnd();
      return;
    }

    this.#entries = this.#policyEntries();

    // Claimed here, not when the panel closes. A browser killed with the panel
    // open has still had its first run; showing it again on the next start
    // would be a browser that nags. "Show it again" in the settings page is the
    // way back, and it is deliberately explicit.
    Services.prefs.setBoolPref(PREF_COMPLETED, true);

    try {
      this.#build();
      this.#open();
    } catch (error) {
      TranceLog.error(NS, "could not open the first-run panel", error);
      this.#close();
      return;
    }

    if (this.#entries.length) {
      this.#attachAddonListeners();
      this.#refresh();
    }
  }

  /**
   * The extensions the active enterprise policy installs.
   *
   * @returns {{id: string, url: string}[]}
   */
  #policyEntries() {
    let settings = null;
    try {
      settings = Services.policies?.getActivePolicies()?.ExtensionSettings;
    } catch (error) {
      TranceLog.error(NS, "could not read the extension policy", error);
    }
    if (!settings) {
      return [];
    }
    return Object.entries(settings)
      .filter(
        ([id, entry]) =>
          id !== "*" && INSTALLING_MODES.includes(entry?.installation_mode)
      )
      .map(([id, entry]) => ({ id, url: entry.install_url ?? "" }));
  }

  #build() {
    const doc = this.context.document;
    const popupSet = doc.getElementById("mainPopupSet");
    if (!popupSet) {
      throw new Error("no #mainPopupSet in this window");
    }

    const panel = doc.createXULElement("panel");
    panel.id = PANEL_ID;
    panel.setAttribute("type", "arrow");
    panel.setAttribute("orient", "vertical");
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("aria-label", "Welcome to Trance");
    this.addListener(panel, "popuphidden", () => this.#close());
    popupSet.appendChild(panel);
    this.#panel = panel;

    const heading = doc.createElement("h1");
    heading.className = "trance-firstrun-title";
    heading.textContent = "Welcome to Trance";
    panel.appendChild(heading);

    const intro = doc.createElement("p");
    intro.className = "trance-firstrun-text";
    intro.textContent =
      "Trance rebuilds the mods you would otherwise install — surfaces, the " +
      "tab strip, chrome furniture, motion and the theme picker — as browser " +
      "features, pref-gated and off when you turn them off. The Mods page " +
      "marks the ones it replaces, so installing them again is possible and " +
      "the panel tells you what it would cost.";
    panel.appendChild(intro);

    this.#buildExtensions(doc, panel);
    this.#buildFooter(doc, panel);
  }

  /**
   * @param {Document} doc
   * @param {Element} panel
   */
  #buildExtensions(doc, panel) {
    const heading = doc.createElement("h2");
    heading.className = "trance-firstrun-subtitle";
    heading.textContent = "Extensions";
    panel.appendChild(heading);

    if (!this.#entries.length) {
      const empty = doc.createElement("p");
      empty.className = "trance-firstrun-text trance-firstrun-empty";
      empty.textContent =
        "No extension policy is active in this build, so nothing was " +
        "installed. That means distribution/policies.json did not reach the " +
        "application directory — a partial build, or a copy of the app " +
        "without its distribution folder.";
      panel.appendChild(empty);
      return;
    }

    const list = doc.createElement("ul");
    list.className = "trance-firstrun-list";
    panel.appendChild(list);

    for (const { id } of this.#entries) {
      const row = doc.createElement("li");
      row.className = "trance-firstrun-row";

      const label = doc.createElement("span");
      label.className = "trance-firstrun-name";
      label.textContent = EXTENSION_NAMES[id] ?? id;
      row.appendChild(label);

      const state = doc.createElement("span");
      state.className = "trance-firstrun-status";
      state.setAttribute("state", "installing");
      state.textContent = STATUS_LABEL.installing;
      row.appendChild(state);

      list.appendChild(row);
      this.#rows.set(id, { row, status: state, state: "installing" });
    }
  }

  /**
   * @param {Document} doc
   * @param {Element} panel
   */
  #buildFooter(doc, panel) {
    const footer = doc.createElement("div");
    footer.className = "trance-firstrun-footer";
    panel.appendChild(footer);

    if (this.#entries.length) {
      const retry = doc.createXULElement("button");
      retry.className = "trance-firstrun-button";
      retry.setAttribute("label", "Try again");
      retry.setAttribute("disabled", "true");
      this.addListener(retry, "command", () => this.#retry());
      footer.appendChild(retry);
      this.#retryButton = retry;
    }

    const settings = doc.createXULElement("button");
    settings.className = "trance-firstrun-button";
    // "Settings", not "Open Trance settings". Three buttons share a 22em panel
    // and this one was half of it on its own; the panel is titled "Welcome to
    // Trance", so the word "Trance" in the button was saying it twice.
    settings.setAttribute("label", "Settings");
    this.addListener(settings, "command", () => {
      this.context.window.openTrustedLinkIn("about:preferences#trance", "tab");
      this.#panel?.hidePopup();
    });
    footer.appendChild(settings);

    const done = doc.createXULElement("button");
    done.className = "trance-firstrun-button trance-firstrun-primary";
    done.setAttribute("label", "Done");
    this.addListener(done, "command", () => this.#panel?.hidePopup());
    footer.appendChild(done);
  }

  #open() {
    const doc = this.context.document;
    const anchor =
      this.#visible(doc.getElementById("unified-extensions-button")) ??
      this.#visible(doc.getElementById("PanelUI-menu-button")) ??
      this.#visible(doc.getElementById("zen-sidebar-top-buttons"));

    if (anchor) {
      this.#panel.openPopup(anchor, "bottomright topright", 0, 6, false, false);
    } else {
      // No toolbar button to hang it on — Zen hides most of them in some
      // layouts. Overlapping the window's own top-left corner is not elegant,
      // but a panel that opens is better than a report nobody sees.
      this.#panel.openPopup(doc.documentElement, "overlap", 0, 0, false, false);
    }
  }

  /**
   * @param {Element | null} element
   * @returns {Element | null} The element, if it is actually on screen.
   */
  #visible(element) {
    if (!element?.isConnected) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return rect.width && rect.height ? element : null;
  }

  #close() {
    if (this.#idleHandle) {
      this.context.scheduler.cancel(this.#idleHandle);
      this.#idleHandle = 0;
    }
    this.#detachAddonListeners();
    this.#rows.clear();
    this.#retryButton = null;
    const panel = this.#panel;
    this.#panel = null;
    if (panel) {
      // `hidePopup` on an already-hidden panel is harmless; removing it while
      // it is still open is not, so this order matters.
      panel.hidePopup();
      panel.remove();
    }
  }

  // --- Add-on state ----------------------------------------------------------

  /**
   * The install states that mean "still happening".
   *
   * `STATE_INSTALLED` is not among them — an install that reached that state
   * has an add-on to find, and the add-on is the better answer. The failure
   * states are not among them either, for the same reason in reverse.
   */
  get #IN_FLIGHT_STATES() {
    const manager = this.#addonManager;
    return [
      manager.STATE_AVAILABLE,
      manager.STATE_DOWNLOADING,
      manager.STATE_DOWNLOADED,
      manager.STATE_INSTALLING,
      manager.STATE_POSTPONED,
    ];
  }

  get #addonManager() {
    this.#addons ??= ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs"
    ).AddonManager;
    return this.#addons;
  }

  #attachAddonListeners() {
    const manager = this.#addonManager;
    const onChange = () => this.#refresh();

    this.#addonListener = {
      onInstalled: onChange,
      onUninstalled: onChange,
      onEnabled: onChange,
      onDisabled: onChange,
    };
    manager.addAddonListener(this.#addonListener);

    // A failed install is the case this panel exists for, and it is the one
    // `getAddonsByIDs` cannot report: a download that never completed leaves no
    // add-on behind to ask. The failure arrives here, on the install object, so
    // the row is marked from the event and `#refresh` then leaves it alone.
    const onFailure = install => {
      const entry = this.#rows.get(this.#identify(install));
      if (entry) {
        this.#setState(entry, "failed");
      }
      onChange();
    };

    this.#installListener = {
      onInstallEnded: onChange,
      onInstallFailed: onFailure,
      onDownloadFailed: onFailure,
      onInstallCancelled: onFailure,
    };
    manager.addInstallListener(this.#installListener);
  }

  /**
   * Which of the seven an install object belongs to.
   *
   * `install.addon` is null for a download that never finished, which is
   * precisely the offline case, so the source URL is the fallback: it is the
   * `install_url` the policy handed to `getInstallForURL`, unchanged.
   *
   * @param {object} install
   * @returns {string} The add-on id, or "" if it is not one of ours.
   */
  #identify(install) {
    const id = install?.addon?.id ?? install?.existingAddon?.id ?? "";
    if (id && this.#rows.has(id)) {
      return id;
    }
    const source = install?.sourceURI?.spec ?? "";
    return this.#entries.find(entry => entry.url === source)?.id ?? "";
  }

  #detachAddonListeners() {
    if (!this.#addons) {
      return;
    }
    if (this.#addonListener) {
      this.#addons.removeAddonListener(this.#addonListener);
      this.#addonListener = null;
    }
    if (this.#installListener) {
      this.#addons.removeInstallListener(this.#installListener);
      this.#installListener = null;
    }
  }

  /**
   * Reads the current state of all seven and repaints the rows.
   *
   * Asynchronous, and the panel may have been closed by the time it resolves —
   * every write below is guarded by `#rows` still holding the row.
   */
  async #refresh() {
    const ids = this.#entries.map(entry => entry.id);
    let addons = [];
    let inFlight = new Set();
    try {
      // Both, and in parallel. The add-on answers "is it here"; the install
      // list answers "is it on its way", which is the difference between
      // "Installing…" and "Not installed" and is not knowable from the add-on
      // alone — at first run there is no add-on yet either way.
      const [resolved, installs] = await Promise.all([
        this.#addonManager.getAddonsByIDs(ids),
        this.#addonManager.getAllInstalls(),
      ]);
      addons = resolved;
      inFlight = new Set(
        installs
          .filter(install => this.#IN_FLIGHT_STATES.includes(install.state))
          .map(install => this.#identify(install))
      );
    } catch (error) {
      TranceLog.error(NS, "could not read add-on state", error);
      return;
    }

    let outstanding = 0;
    for (const [index, id] of ids.entries()) {
      const entry = this.#rows.get(id);
      if (!entry) {
        continue;
      }
      const addon = addons[index];
      let state;
      if (addon) {
        state = addon.isActive ? "installed" : "disabled";
      } else if (inFlight.has(id)) {
        state = "installing";
      } else if (entry.state === "failed") {
        // The install listener already said why. "Not installed" would be true
        // and less useful.
        state = "failed";
      } else {
        state = "missing";
      }

      if (addon?.name) {
        entry.row.querySelector(".trance-firstrun-name").textContent =
          addon.name;
      }
      this.#setState(entry, state);
      if (state !== "installed" && state !== "disabled") {
        outstanding++;
      }
    }

    this.#retryButton?.toggleAttribute("disabled", outstanding === 0);
  }

  /**
   * @param {{status: Element, state: string}} entry
   * @param {string} state
   */
  #setState(entry, state) {
    entry.state = state;
    entry.status.setAttribute("state", state);
    entry.status.textContent = STATUS_LABEL[state] ?? state;
  }

  /**
   * Runs the policy's own installer again for everything still missing.
   *
   * Rows go back to "Installing…" immediately, because the alternative is a
   * button that visibly does nothing for the several seconds an XPI download
   * takes.
   */
  #retry() {
    const { installAddonFromURL } = ChromeUtils.importESModule(
      "resource://gre/modules/PoliciesHelpers.sys.mjs"
    );

    let attempted = 0;
    for (const { id, url } of this.#entries) {
      const entry = this.#rows.get(id);
      if (!entry || entry.state === "installed" || entry.state === "disabled") {
        continue;
      }
      if (!url) {
        this.#setState(entry, "failed");
        continue;
      }
      this.#setState(entry, "installing");
      attempted++;
      try {
        installAddonFromURL(url, id, null);
      } catch (error) {
        TranceLog.error(NS, `retry failed for ${id}`, error);
        this.#setState(entry, "failed");
      }
    }

    if (attempted) {
      this.#retryButton?.setAttribute("disabled", "true");
      TranceLog.log(NS, `retrying ${attempted} extension install(s)`);
    }
  }
}
