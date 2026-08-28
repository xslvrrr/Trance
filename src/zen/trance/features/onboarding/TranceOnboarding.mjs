// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: the first-run onboarding flow.
//
// Ten pages: five that are Trance's, then Zen's five rebuilt. It replaces Zen's
// welcome rather than running before or after it, because two full-window
// takeovers cannot share a window — `ZenWelcome` hides every child of
// `#browser` on entry and restores them in `finish()`, so whichever one runs
// second inherits a window the first has already torn down and rebuilt.
//
// ── Why five pages before Zen's ───────────────────────────────────────────
//
// Zen's welcome asks about data, search and appearance. All five of Trance's
// questions come before those because four of them change what the browser
// *is* rather than what it looks like, and the fifth is the one extension that
// does nothing until it has been opened:
//
//   1. Zen feature set   Upstream resolves `@IS_TWILIGHT@` at build time and
//                        ships two brands. ADR-006 left Trance with one, and
//                        therefore with every twilight-gated pref pinned to its
//                        stable value. This page is the way back.
//   2. Mod manager       Cosine is Sine's pre-release channel and is what a
//                        Trance build is provisioned with (ADR-018). Someone
//                        who wants stable Sine should not have to re-run a
//                        Python script to get it.
//   3. Architecture      Blur is the one Trance effect whose cost is not the
//                        same on an Intel Mac as on an Apple Silicon one
//                        (TRANCE.md §3.3), and it is also the effect Trance
//                        leans on hardest.
//   4. Edgeless          The largest single change Trance makes to the shape of
//                        the window (ADR-025, ADR-040), and the one most worth
//                        seeing before it happens rather than after.
//   5. Zen Internet      Ships with Trance, and does nothing at all until its
//                        panel has been opened once. A bundled extension that
//                        silently does nothing is worse than one that is not
//                        bundled.
//
// ── Localisation ──────────────────────────────────────────────────────────
//
// The five Zen-derived pages use Zen's own `browser/zen-welcome.ftl` strings,
// so they stay translated in every locale Zen ships. The five Trance pages are
// English in this file. That is a real gap and it is recorded as one: Trance
// has no locale pipeline of its own yet, and inventing one for ten strings
// would be a Phase 12 decision taken here by accident. Using Zen's strings for
// the half that maps one-to-one costs nothing and loses nothing.
//
// ── Why every allocation goes through the base class ──────────────────────
//
// This is the largest thing Trance builds, and it is the only feature that can
// be running while the user has no browser UI to escape to. `TranceFeature`'s
// contract — no listener, node, observer or scheduler subscription that is not
// registered — is what guarantees that flipping `trance.onboarding.enabled` off
// mid-flow returns the window rather than stranding it.
//
// Refs: TRANCE.md §3.3, §6.5, §9, §13 Phase 13; ADR-018, ADR-025, ADR-051

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";
import { TranceLog } from "chrome://browser/content/trance-components/TranceLog.mjs";
import { TranceZenImport } from "chrome://browser/content/trance-components/TranceZenImport.mjs";

const NS = "Onboarding";

const PREF_COMPLETED = "trance.onboarding.completed";
const PREF_CHANNEL = "trance.onboarding.channel";
const PREF_MODS_CHANNEL = "trance.mods.channel";
const PREF_ARCH = "trance.perf.arch";
const PREF_EDGELESS = "trance.surface.edgeless";

/** Set on the document element for as long as the flow owns the window. */
const ATTR_STAGE = "trance-onboarding-stage";

const ROOT_ID = "trance-onboarding";

/** The import page's confirm button, which is the one button with a state. */
const BUTTON_IMPORT_ID = "trance-onboarding-import-confirm";

const ZEN_INTERNET_ID = "{91aa3897-2634-4a8a-9092-279db23a7689}";

/**
 * Zen's own strings, reused by the five pages that map onto its own.
 *
 * Two files, not one. `zen-welcome.ftl` has the page copy; `zen-generic-next`
 * — the label on six of the ten buttons — lives in `zen-general.ftl`, which a
 * browser window has usually loaded already. "Usually" is not a contract, and
 * `insertFTLIfNeeded` is a no-op when it is already there.
 */
const ZEN_FTL = Object.freeze([
  "browser/zen-welcome.ftl",
  "browser/zen-general.ftl",
]);

/**
 * The `zen.*` prefs upstream gates on the build-time `@IS_TWILIGHT@` constant,
 * and the value each takes on the twilight side of it.
 *
 * Read out of `prefs/zen/{view,theme,sync}.yaml` rather than guessed. The
 * stable side is not listed because it is "whatever the pref file already set",
 * which is what a Trance build boots with — so choosing "stable" clears the
 * user branch instead of writing the same value back, and a later upstream
 * change to a default is inherited rather than frozen.
 *
 * `zen.theme.styled-status-panel` is deliberately absent. Its yaml has a second
 * entry, `value: true` under `defined(XP_MACOSX)`, so on macOS it is already
 * true on both channels and writing it here would be a no-op that looks like a
 * decision. On other platforms it follows the constant, which is what
 * `TWILIGHT_ONLY_PREFS` below covers.
 */
const TWILIGHT_PREFS = Object.freeze([
  { name: "zen.view.context-menu.refresh", twilight: true },
  { name: "zen.theme.acrylic-elements", twilight: true },
  // `prefs/zen/sync.yaml` writes this one twice: `true` on the twilight side,
  // and `false` *locked* on the other. A locked pref cannot be set from the
  // user branch at all — `setBoolPref` throws — so this is the one entry where
  // "write the twilight value" means unlock first, and where going back to
  // stable means clearing *and* putting the lock back. Without the flag the
  // page would silently fail on a third of what its copy promises.
  { name: "services.sync.engine.spaces", twilight: true, locked: true },
]);

/** Same list, minus the ones another yaml entry already decides on this OS. */
const TWILIGHT_ONLY_PREFS = Object.freeze([
  { name: "zen.theme.styled-status-panel", twilight: true },
]);

/**
 * The surface prefs an Intel GPU wants different values for, and those values.
 *
 * Blur, and only blur. `backdrop-filter` over a full window is the effect that
 * separates the two classes of machine (TRANCE.md §3.3); everything else Trance
 * draws is a colour, a radius or a transform, and those cost the same
 * everywhere. A tuning pass that touched motion or transparency as well would
 * be making the Intel browser *worse looking* for no measured reason.
 *
 * The arm64 column is the shipped default from `prefs/trance/`, restated so
 * that switching back is a write rather than a clear — a user who edited the
 * radius by hand and then re-ran the flow should get the tuning they picked,
 * not their own old value silently kept.
 */
const ARCH_TUNING = Object.freeze({
  arm64: Object.freeze([
    { name: "trance.surface.blur.radius", type: "int", value: 24 },
    { name: "trance.surface.internal.blur", type: "bool", value: true },
    { name: "trance.chrome.urlbar.focus-blur", type: "bool", value: true },
    {
      name: "trance.surface.suspend-when-unfocused",
      type: "bool",
      value: true,
    },
  ]),
  x86_64: Object.freeze([
    // 24 → 10. Not off: the frost is what the surface layer *is* (ADR-025), and
    // a browser with no blur at all is a different browser rather than a
    // cheaper one. Ten pixels is the radius at which the sample count stops
    // being the dominant cost on integrated graphics and the surface still
    // reads as frosted.
    { name: "trance.surface.blur.radius", type: "int", value: 10 },
    // The `about:` pages' own blur is a second full-viewport pass over content
    // that is already opaque behind it. It is the cheapest thing to give up.
    { name: "trance.surface.internal.blur", type: "bool", value: false },
    { name: "trance.chrome.urlbar.focus-blur", type: "bool", value: false },
    {
      name: "trance.surface.suspend-when-unfocused",
      type: "bool",
      value: true,
    },
  ]),
});

const ARCH_LABEL = Object.freeze({
  arm64: { mac: "Apple Silicon", generic: "ARM64" },
  x86_64: { mac: "Intel", generic: "x86-64" },
});

/** The essentials Zen offers, and the favicons it already ships for them. */
const ESSENTIALS = Object.freeze([
  { url: "https://github.com", icon: "github.svg", label: "GitHub" },
  { url: "https://obsidian.md", icon: "obsidian.svg", label: "Obsidian" },
  { url: "https://discord.com", icon: "discord.svg", label: "Discord" },
  { url: "https://notion.com", icon: "notion.svg", label: "Notion" },
  { url: "https://figma.com", icon: "figma.svg", label: "Figma" },
  { url: "https://slack.com", icon: "slack.svg", label: "Slack" },
  { url: "https://trello.com", icon: "trello.svg", label: "Trello" },
  {
    url: "https://calendar.google.com",
    icon: "calendar.svg",
    label: "Calendar",
  },
  { url: "https://app.tuta.com/", icon: "tuta.svg", label: "Tuta" },
]);

const FAVICON_ROOT = "chrome://browser/content/zen-images/favicons/";

export class TranceOnboarding extends TranceFeature {
  static prefName = "trance.onboarding.enabled";
  static featureName = "Onboarding";
  static styles = [
    "chrome://browser/content/trance-styles/trance-onboarding.css",
  ];

  /** @type {Element | null} */
  #root = null;
  /** @type {object[]} */
  #pages = [];
  #index = -1;
  #idleHandle = 0;
  #running = false;
  /**
   * True while a page change is in flight.
   *
   * `#next` is async — it commits, fades out, builds, fades in — and the buttons
   * that call it stay in the document for the length of the fade-out. Two clicks
   * inside that window would run two page changes over the same three
   * containers, and the second one's `replaceChildren` would delete the first
   * one's freshly-built page.
   */
  #advancing = false;

  /** Answers, collected page by page and applied as each page is left. */
  #answers = {
    channel: "stable",
    modsChannel: "cosine",
    arch: "arm64",
    edgeless: true,
    setDefaultBrowser: false,
    essentials: [],
    /** The `id` of the chosen Zen profile, or `""` for "don't import". */
    importFrom: "",
    importOpenTabs: false,
  };

  /** Tabs created for the chosen essentials, pinned once the flow is over. */
  #pendingEssentials = [];

  /**
   * Zen profiles found on this machine, or `null` before the import page has
   * looked. Cached on the instance so that going back to the page does not walk
   * the disk a second time.
   *
   * @type {object[]|null}
   */
  #zenProfiles = null;

  onEnable() {
    // Three of the flow's five answers are prefs that nothing else applies:
    // the settings page can write `trance.onboarding.channel` but it cannot
    // reach into a browser window to act on it, and duplicating the list of
    // twilight-gated prefs into `trance-settings.js` would be two owners for
    // one decision — the exact failure this project exists to remove
    // (TRANCE.md §3.1).
    //
    // So this feature owns them for the whole session, not only during the
    // flow. The cost when the flow is over is three pref observers, which is
    // the same order as `TranceFirstRun`'s two, and nothing else at all.
    this.#watchPref(PREF_CHANNEL, value => this.#applyChannel(value));
    this.#watchPref(PREF_ARCH, value => this.#applyArch(value));
    this.#watchPref(PREF_MODS_CHANNEL, value => this.#applyModChannel(value));

    if (Services.prefs.getBoolPref(PREF_COMPLETED, false)) {
      return;
    }
    // Every mochitest profile is a fresh profile. Without this, every suite in
    // the tree would get a full-window takeover a moment after startup, which
    // is not a class of intermittent failure worth having for a first run
    // nobody is watching. Trance's own suite calls `start()`.
    if (Cu.isInAutomation) {
      return;
    }
    if (Services.env.get("MOZ_HEADLESS")) {
      Services.prefs.setBoolPref(PREF_COMPLETED, true);
      return;
    }
    // Never during startup's own work. The timeout is a backstop for a window
    // that never goes idle, not a schedule.
    this.#idleHandle = this.onIdle(() => this.start(), { timeout: 3000 });
  }

  onDisable() {
    this.#dismantle();
  }

  /**
   * Watches a string pref and hands the observer its new value.
   *
   * Registered through `addDisposer` rather than kept in a field, so the base
   * class returns it on disable along with everything else — the whole point of
   * `TranceFeature` is that a subclass does not have to remember (§6.5).
   *
   * @param {string} pref
   * @param {(value: string) => void} apply
   */
  #watchPref(pref, apply) {
    const observer = {
      observe: () => {
        try {
          apply(Services.prefs.getStringPref(pref, ""));
        } catch (error) {
          TranceLog.error(NS, `could not apply ${pref}`, error);
        }
      },
    };
    Services.prefs.addObserver(pref, observer);
    this.addDisposer(() => Services.prefs.removeObserver(pref, observer));
  }

  // --- Entry -----------------------------------------------------------------

  /**
   * Runs the flow in this window, now.
   *
   * Public because two callers need it and neither is `onEnable`: the
   * mochitest, which cannot wait for an idle callback automation suppresses,
   * and the settings page's "Run it again".
   */
  start() {
    if (this.#idleHandle) {
      this.context.scheduler.cancel(this.#idleHandle);
      this.#idleHandle = 0;
    }
    if (this.#running) {
      return;
    }
    // Re-checked rather than assumed: the idle callback runs some time after
    // `onEnable` decided, and another window may have taken the first run in
    // between.
    if (Services.prefs.getBoolPref(PREF_COMPLETED, false)) {
      return;
    }

    // Claimed here, not at the end. A browser killed halfway through has still
    // had its first run; coming back for a second attempt on the next start is
    // a browser that nags, and "Run it again" in the settings page is the way
    // back.
    Services.prefs.setBoolPref(PREF_COMPLETED, true);

    this.#answers.channel = Services.prefs.getStringPref(
      PREF_CHANNEL,
      "stable"
    );
    this.#answers.modsChannel = Services.prefs.getStringPref(
      PREF_MODS_CHANNEL,
      "cosine"
    );
    this.#answers.arch = this.#detectArch();
    this.#answers.edgeless = Services.prefs.getBoolPref(PREF_EDGELESS, true);
    // Re-read, and the two lists reset. "Run it again" from the settings page
    // runs this a second time in the same window, and a second run that
    // remembered the first one's essentials would silently open them twice.
    this.#answers.setDefaultBrowser = false;
    this.#answers.essentials = [];
    this.#pendingEssentials = [];

    try {
      this.#build();
    } catch (error) {
      TranceLog.error(NS, "could not build the onboarding flow", error);
      this.#dismantle();
      return;
    }

    this.#running = true;
    this.#pages = this.#buildPages();
    this.#showSplash();
  }

  get running() {
    return this.#running;
  }

  // --- Window takeover -------------------------------------------------------

  /**
   * The children of `#browser` that must stay visible during the takeover.
   *
   * The same two Zen's own flow keeps: the background element paints the
   * workspace gradient the flow sits on, and the toast container is where the
   * "welcome finished" toast arrives.
   */
  static KEEP_VISIBLE = Object.freeze([
    "zen-browser-background",
    "zen-toast-container",
  ]);

  #browserChildren() {
    const browser = this.context.document.getElementById("browser");
    if (!browser) {
      return [];
    }
    return [...browser.children].filter(
      element => !TranceOnboarding.KEEP_VISIBLE.includes(element.id)
    );
  }

  #build() {
    const doc = this.context.document;
    const browser = doc.getElementById("browser");
    if (!browser) {
      throw new Error("no #browser in this window");
    }

    doc.documentElement.setAttribute(ATTR_STAGE, "true");
    for (const element of this.#browserChildren()) {
      element.style.display = "none";
    }
    // One restoration, reached two ways. The flow ending normally and the
    // feature being switched off mid-flow have to leave the window in the same
    // state, and the way to guarantee that is for both to run the same code
    // rather than for `#finish` to remember what `#build` did.
    this.addDisposer(() => this.#restore());

    for (const ftl of ZEN_FTL) {
      this.context.window.MozXULElement.insertFTLIfNeeded(ftl);
    }

    const root = doc.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Welcome to Trance");
    browser.appendChild(root);
    this.#root = root;

    root.appendChild(this.#buildSplash(doc));
    root.appendChild(this.#buildStage(doc));

    this.#centreWindow();
  }

  /**
   * @param {Document} doc
   */
  #buildSplash(doc) {
    const splash = doc.createElement("div");
    splash.id = "trance-onboarding-splash";

    const mark = doc.createElement("div");
    mark.id = "trance-onboarding-mark";
    splash.appendChild(mark);

    const title = doc.createElement("h1");
    title.id = "trance-onboarding-splash-title";
    // Two lines rather than one string with a break in it: the entrance
    // staggers them, and a stagger needs two elements.
    for (const line of ["Welcome to", "Trance"]) {
      const span = doc.createElement("span");
      span.textContent = line;
      title.appendChild(span);
    }
    splash.appendChild(title);

    const button = doc.createElement("button");
    button.id = "trance-onboarding-start";
    button.className = "trance-onboarding-button primary";
    button.textContent = "Get started";
    this.addListener(button, "click", () => this.#leaveSplash());
    splash.appendChild(button);

    return splash;
  }

  /**
   * @param {Document} doc
   */
  #buildStage(doc) {
    const stage = doc.createElement("div");
    stage.id = "trance-onboarding-pages";

    const sidebar = doc.createElement("div");
    sidebar.id = "trance-onboarding-sidebar";

    const copy = doc.createElement("div");
    copy.id = "trance-onboarding-copy";
    sidebar.appendChild(copy);

    const buttons = doc.createElement("div");
    buttons.id = "trance-onboarding-buttons";
    sidebar.appendChild(buttons);

    const progress = doc.createElement("div");
    progress.id = "trance-onboarding-progress";
    sidebar.appendChild(progress);

    stage.appendChild(sidebar);

    const content = doc.createElement("div");
    content.id = "trance-onboarding-content";
    stage.appendChild(content);

    return stage;
  }

  /**
   * Zen's welcome resizes and centres before maximising, and this does the same
   * for the same reason: the flow is laid out for a window it chose, and a
   * browser restored from a session can be any shape at all.
   */
  #centreWindow() {
    // Not under automation. `start()` is public so the mochitest can drive the
    // flow, and a test that resizes and moves the browser window out from under
    // the harness is a test that breaks every suite that runs after it.
    if (Cu.isInAutomation) {
      return;
    }
    const win = this.context.window;
    this.addListener(
      win,
      "MozAfterPaint",
      () => {
        try {
          win.resizeTo(920, 600);
          win.moveTo(
            win.screen.availLeft + (win.screen.availWidth - win.outerWidth) / 2,
            win.screen.availTop + (win.screen.availHeight - win.outerHeight) / 2
          );
          win.focus();
        } catch (error) {
          TranceLog.error(NS, "could not centre the window", error);
        }
      },
      { once: true }
    );
  }

  // --- Motion ----------------------------------------------------------------

  /**
   * Animates and resolves when it is done — or resolves immediately when motion
   * is off, having applied nothing.
   *
   * `TranceMotion.animate` returns null at motion level 0, which is the signal
   * to jump to the end state rather than to animate to it. Every caller here
   * only animates entrances and exits, so "the end state" is whatever the
   * stylesheet already says and there is nothing to jump to.
   *
   * @param {Element[]} elements
   * @param {Keyframe[]} keyframes
   * @param {object} [options]
   */
  async #animate(elements, keyframes, options = {}) {
    const { stagger = 0, ...rest } = options;
    const animations = elements
      .map((element, index) =>
        this.context.motion.animate(element, keyframes, {
          duration: 320,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
          delay: index * stagger,
          willChange: "transform, opacity",
          ...rest,
        })
      )
      .filter(Boolean);
    if (!animations.length) {
      return;
    }
    await Promise.all(
      animations.map(animation => animation.finished.catch(() => {}))
    );
    for (const animation of animations) {
      // The keyframes are entrances and exits, and an exit's end state is a
      // node about to be removed. Committing would leave a filled animation
      // holding the element's style after the element is gone.
      animation.cancel();
    }
  }

  // --- Page machinery --------------------------------------------------------

  /**
   * Brings the splash in.
   *
   * Not awaited by `start()`: the flow is on screen the moment `#build` returns
   * — the CSS puts it there — and this is the entrance over the top of it. A
   * caller that waited would be waiting for an animation that does not exist at
   * motion level 0, and `start()` is called from an idle callback that should
   * not hold a promise open for a third of a second either way.
   */
  #showSplash() {
    const splash = this.#root?.querySelector("#trance-onboarding-splash");
    if (!splash) {
      return;
    }
    this.#animate(
      [...splash.children],
      {
        opacity: [0, 1],
        transform: ["translateY(16px)", "translateY(0)"],
        filter: ["blur(2px)", "blur(0px)"],
      },
      { stagger: 120, duration: 420 }
    ).catch(() => {});
  }

  async #leaveSplash() {
    const splash = this.#root?.querySelector("#trance-onboarding-splash");
    if (!splash) {
      return;
    }
    await this.#animate(
      [...splash.children],
      { opacity: [1, 0], transform: ["translateY(0)", "translateY(-12px)"] },
      { stagger: 60 }
    );
    splash.remove();
    // The gate is on the staged pages themselves rather than on an attribute of
    // the root they hang off: `#root[stage] #pages` would be two IDs in one
    // selector, which is over the §6.2 rule 7 budget for no gain.
    this.#element("trance-onboarding-pages")?.toggleAttribute("shown", true);
    await this.#next();
  }

  /** Advances to the next page, committing the current one first. */
  async #next() {
    if (this.#advancing) {
      return;
    }
    this.#advancing = true;
    try {
      await this.#advance();
    } finally {
      this.#advancing = false;
    }
  }

  async #advance() {
    if (!this.#live) {
      return;
    }
    const current = this.#pages[this.#index];
    if (current) {
      try {
        await current.commit?.();
      } catch (error) {
        TranceLog.error(NS, `page ${current.id} failed to commit`, error);
      }
      await this.#fadeOutPage();
    }

    if (!this.#live) {
      return;
    }
    this.#index++;
    const page = this.#pages[this.#index];
    if (!page) {
      await this.#finish();
      return;
    }
    await this.#fadeInPage(page);
  }

  async #fadeOutPage() {
    const copy = this.#element("trance-onboarding-copy");
    const buttons = this.#element("trance-onboarding-buttons");
    const content = this.#element("trance-onboarding-content");
    if (!copy || !buttons || !content) {
      return;
    }
    await this.#animate(
      [...copy.children, ...buttons.children, ...content.children],
      { opacity: [1, 0], transform: ["translateX(0)", "translateX(-24px)"] },
      { stagger: 30, duration: 200 }
    );
    copy.replaceChildren();
    buttons.replaceChildren();
    content.replaceChildren();
    // The pane's layout belongs to the page that asked for it. Two of the ten
    // want a grid of tiles; without this the page after one of them inherits it
    // and lays a single diagram out in a nine-column track.
    content.removeAttribute("layout");
  }

  /**
   * @param {object} page
   */
  async #fadeInPage(page) {
    const doc = this.context.document;
    const copy = this.#element("trance-onboarding-copy");
    const buttons = this.#element("trance-onboarding-buttons");
    const content = this.#element("trance-onboarding-content");
    if (!copy || !buttons || !content) {
      return;
    }

    const labelled = [];

    const heading = doc.createElement("h1");
    labelled.push(this.#label(heading, page.title));
    copy.appendChild(heading);
    for (const line of page.description ?? []) {
      const paragraph = doc.createElement("p");
      labelled.push(this.#label(paragraph, line));
      copy.appendChild(paragraph);
    }

    for (const [index, spec] of page.buttons.entries()) {
      const button = doc.createElement("button");
      button.className = "trance-onboarding-button";
      if (index === 0) {
        button.classList.add("primary");
      }
      // Only the import page uses this, and only because its primary button is
      // the one control on the flow whose enabled state depends on something
      // the page's own `render` discovers.
      if (spec.id) {
        button.id = spec.id;
      }
      labelled.push(this.#label(button, spec.label));
      this.addListener(button, "click", async () => {
        // Every click either advances or does not, and the handler says which.
        // A page that opens a wizard returns false and stays put.
        const advance = (await spec.onClick?.()) ?? true;
        if (advance) {
          await this.#next();
        }
      });
      buttons.appendChild(button);
    }

    this.#paintProgress();

    try {
      // Both, together: the copy is a Fluent round-trip and the content pane is
      // usually an `AddonManager` or `SearchService` read, and neither waits on
      // the other. The entrance below animates what is actually there, so it
      // has to be after both rather than after either.
      await Promise.all([...labelled, page.render?.(content)]);
    } catch (error) {
      TranceLog.error(NS, `page ${page.id} failed to render`, error);
    }

    await this.#animate(
      [...copy.children, ...buttons.children, ...content.children],
      { opacity: [0, 1], transform: ["translateX(28px)", "translateX(0)"] },
      { stagger: 40 }
    );
  }

  #paintProgress() {
    const progress = this.#element("trance-onboarding-progress");
    if (!progress) {
      return;
    }
    const doc = this.context.document;
    progress.replaceChildren();
    for (let step = 0; step < this.#pages.length; step++) {
      const dot = doc.createElement("span");
      dot.className = "trance-onboarding-dot";
      dot.toggleAttribute("done", step < this.#index);
      dot.toggleAttribute("current", step === this.#index);
      progress.appendChild(dot);
    }
  }

  /**
   * Sets a label from either a Fluent id or a literal string.
   *
   * Formatted and assigned as text rather than bound with `setAttributes`, for
   * one reason: `zen-welcome-start-browsing-title` contains a literal `<br/>`.
   * Zen's own flow writes that string into `innerHTML`, which is how the break
   * renders there and also why that file carries an
   * `eslint-disable no-unsanitized/property`. Trance does not write markup from
   * a string, so the break becomes a newline and the stylesheet honours it with
   * `white-space: pre-line` — same result, no HTML parser, nothing disabled.
   *
   * @param {Element} element
   * @param {{l10n?: string, text?: string}} label
   */
  async #label(element, label) {
    if (!label.l10n) {
      element.textContent = label.text ?? "";
      return;
    }
    try {
      const value = await this.context.document.l10n.formatValue(label.l10n);
      element.textContent = (value ?? label.l10n).replace(/<br\s*\/?>/gi, "\n");
    } catch (error) {
      TranceLog.error(NS, `could not format ${label.l10n}`, error);
      element.textContent = "";
    }
  }

  /**
   * @param {string} id
   * @returns {Element | null}
   */
  #element(id) {
    return this.#root?.querySelector(`#${id}`) ?? null;
  }

  /**
   * Whether the flow still owns the window.
   *
   * Every page change is a chain of awaits — commit, fade out, build, fade in —
   * and the feature can be switched off at any point in it. `#restore` drops the
   * root, so the next step in a chain that started before the teardown would be
   * reaching into a detached tree. Each step checks this instead of assuming the
   * one before it left something behind.
   */
  get #live() {
    return this.#running && !!this.#root?.isConnected;
  }

  async #finish() {
    await this.#pinEssentials();
    const root = this.#root;
    if (root) {
      await this.#animate([root], { opacity: [1, 0] }, { duration: 240 });
    }
    // Captured before the restore, because `#browserChildren` reads the live
    // DOM and every one of these is about to have `display: none` taken off it.
    // The flow's own root is a child of `#browser` too and is filtered out — it
    // is the thing being removed, not revealed.
    const revealed = this.#browserChildren().filter(
      element => element !== this.#root
    );
    this.#dismantle();

    this.context.window.gZenUIManager?.updateTabsToolbar?.();
    // The browser comes back rather than appearing. Everything in `revealed`
    // has just had `display: none` taken off it, and without this the whole
    // window snaps in one frame after ten screens that did not.
    await this.#animate(revealed, { opacity: [0, 1] }, { duration: 260 });

    this.context.window.gZenUIManager?.showToast?.("zen-welcome-finished");
    TranceLog.log(NS, "finished");

    // The staged import can only be adopted by a startup, so this is the
    // startup. It happens after the window has been given back rather than
    // instead of it, so that a restart that is refused — by a beforeunload, by
    // a download in flight — leaves a working browser rather than a torn-down
    // one, and the import is still waiting the next time Trance is opened.
    if (TranceZenImport.isStaged) {
      this.#restartForImport();
    }
  }

  #restartForImport() {
    // Never from a test. `eRestart` takes the whole application down, and a
    // mochitest that reached the end of the flow would take the harness with
    // it.
    if (Cu.isInAutomation) {
      TranceLog.log(NS, "import staged; not restarting under automation");
      return;
    }
    TranceLog.log(NS, "restarting to adopt the staged Zen import");
    Services.startup.quit(
      Ci.nsIAppStartup.eRestart | Ci.nsIAppStartup.eAttemptQuit
    );
  }

  #dismantle() {
    if (this.#idleHandle) {
      this.context.scheduler.cancel(this.#idleHandle);
      this.#idleHandle = 0;
    }
    this.#restore();
    this.#running = false;
    this.#pages = [];
    this.#index = -1;
  }

  /**
   * Gives the window back.
   *
   * Idempotent, and it has to be: it is registered as a disposer *and* called
   * from `#dismantle`, so a flow that finished normally runs it once here and
   * once more when the feature is eventually torn down. Everything it does is a
   * removal, so the second run is a no-op rather than a second undo.
   */
  #restore() {
    const root = this.#root;
    this.#root = null;
    root?.remove();
    for (const element of this.#browserChildren()) {
      element.style.removeProperty("display");
    }
    this.context.document.documentElement.removeAttribute(ATTR_STAGE);
  }

  async #pinEssentials() {
    const win = this.context.window;
    for (const tab of this.#pendingEssentials.splice(0)) {
      try {
        tab.removeAttribute("pending");
        win.gZenPinnedTabManager?.addToEssentials?.(tab);
      } catch (error) {
        TranceLog.error(NS, "could not pin an essential", error);
      }
    }
    try {
      win.gZenWorkspaces?.reorganizeTabsAfterWelcome?.();
    } catch (error) {
      TranceLog.error(NS, "could not reorganise tabs", error);
    }
  }

  // --- Shared controls -------------------------------------------------------

  /**
   * A row of exclusive cards. The one control four of the five Trance pages use.
   *
   * Radio inputs rather than buttons with an attribute, because a radio group is
   * what this is: arrow keys move between the options, the group is one tab
   * stop, and a screen reader says "2 of 2" without being told to.
   *
   * @param {Element} container
   * @param {object[]} options - `{value, title, detail, note}`
   * @param {string} selected
   * @param {(value: string) => void} onChange
   */
  #choiceGroup(container, options, selected, onChange) {
    const doc = this.context.document;
    const group = doc.createElement("div");
    group.className = "trance-onboarding-choices";
    group.setAttribute("role", "radiogroup");

    for (const option of options) {
      const label = doc.createElement("label");
      label.className = "trance-onboarding-choice";

      const input = doc.createElement("input");
      input.type = "radio";
      input.name = `trance-onboarding-${container.id}`;
      input.value = option.value;
      input.checked = option.value === selected;
      this.addListener(input, "change", () => onChange(option.value));
      label.appendChild(input);

      const body = doc.createElement("span");
      body.className = "trance-onboarding-choice-body";

      const title = doc.createElement("span");
      title.className = "trance-onboarding-choice-title";
      title.textContent = option.title;
      body.appendChild(title);

      const detail = doc.createElement("span");
      detail.className = "trance-onboarding-choice-detail";
      detail.textContent = option.detail;
      body.appendChild(detail);

      if (option.note) {
        const note = doc.createElement("span");
        note.className = "trance-onboarding-choice-note";
        note.textContent = option.note;
        body.appendChild(note);
      }

      label.appendChild(body);
      group.appendChild(label);
    }

    container.appendChild(group);
    return group;
  }

  /**
   * A one-line status strip under a page's controls.
   *
   * @param {Element} container
   * @param {string} text
   * @param {string} [state] - "ok" | "warn" | "error" | "busy"
   */
  #status(container, text, state = "busy") {
    const doc = this.context.document;
    let strip = container.querySelector(".trance-onboarding-status");
    if (!strip) {
      strip = doc.createElement("p");
      strip.className = "trance-onboarding-status";
      container.appendChild(strip);
    }
    strip.setAttribute("state", state);
    strip.textContent = text;
    return strip;
  }

  // --- Pages -----------------------------------------------------------------

  #buildPages() {
    return [
      this.#pageChannel(),
      this.#pageMods(),
      this.#pageArchitecture(),
      this.#pageEdgeless(),
      this.#pageZenInternet(),
      this.#pageImport(),
      this.#pageSearch(),
      this.#pageEssentials(),
      this.#pageColours(),
      this.#pageFinish(),
    ];
  }

  // 1 ── Zen feature set ------------------------------------------------------

  #pageChannel() {
    return {
      id: "channel",
      title: { text: "Stable or Twilight" },
      description: [
        {
          text:
            "Zen ships two builds. Twilight is where its unfinished features " +
            "live: the refreshed context menus, acrylic panel materials, and " +
            "syncing your spaces between devices.",
        },
        {
          text:
            "Trance is one build, so this is a setting rather than a " +
            "download. You can change it later in Settings.",
        },
      ],
      buttons: [{ label: { l10n: "zen-generic-next" } }],
      render: container => {
        this.#choiceGroup(
          container,
          [
            {
              value: "stable",
              title: "Stable",
              detail:
                "Only the features Zen considers finished. The default, and " +
                "the one to pick if you want a browser rather than a preview.",
            },
            {
              value: "twilight",
              title: "Twilight",
              detail:
                "Everything above, plus refreshed context menus, acrylic " +
                "panels and space syncing.",
              note: "Unfinished by definition — expect rough edges.",
            },
          ],
          this.#answers.channel,
          value => {
            this.#answers.channel = value;
          }
        );
      },
      commit: () => this.#applyChannel(this.#answers.channel),
    };
  }

  /**
   * Writes the twilight-gated prefs, or clears them.
   *
   * Clearing rather than writing the stable value is deliberate: the stable
   * value *is* the default the pref file set, so clearing the user branch means
   * a later change to that default is inherited. Writing it would freeze
   * today's answer into the profile forever.
   *
   * @param {string} channel
   */
  #applyChannel(channel) {
    const twilight = channel === "twilight";
    Services.prefs.setStringPref(PREF_CHANNEL, channel);

    const entries = [
      ...TWILIGHT_PREFS,
      ...(AppConstants.platform === "macosx" ? [] : TWILIGHT_ONLY_PREFS),
    ];
    for (const entry of entries) {
      try {
        if (Services.prefs.prefIsLocked(entry.name)) {
          Services.prefs.unlockPref(entry.name);
        }
        if (twilight) {
          Services.prefs.setBoolPref(entry.name, entry.twilight);
        } else {
          Services.prefs.clearUserPref(entry.name);
          if (entry.locked) {
            // Put upstream's lock back rather than leaving a pref that Zen
            // means to be immovable on this channel merely *set* to the right
            // value. The difference shows up in about:config and in anything
            // that asks whether the user may change it.
            Services.prefs.lockPref(entry.name);
          }
        }
      } catch (error) {
        TranceLog.error(NS, `could not set ${entry.name}`, error);
      }
    }
    TranceLog.log(NS, "channel", channel);
  }

  // 2 ── Mod manager ----------------------------------------------------------

  #pageMods() {
    return {
      id: "mods",
      title: { text: "Cosine or Sine" },
      description: [
        {
          text:
            "Trance reimplements the mods it needs as browser features, but " +
            "it does not replace the mod manager — everything it has not " +
            "rebuilt is still one install away.",
        },
        {
          text:
            "Cosine is Sine's pre-release channel and is what Trance ships. " +
            "Stable Sine moves more slowly.",
        },
      ],
      buttons: [{ label: { l10n: "zen-generic-next" } }],
      render: async container => {
        this.#choiceGroup(
          container,
          [
            {
              value: "cosine",
              title: "Cosine",
              detail:
                "Sine's pre-release channel. New store features arrive here " +
                "first. What Trance is built and tested against.",
            },
            {
              value: "sine",
              title: "Sine",
              detail:
                "The stable channel. Fewer updates, and mods published to " +
                "the pre-release channel may not be installable yet.",
            },
          ],
          this.#answers.modsChannel,
          value => {
            this.#answers.modsChannel = value;
          }
        );
        const version = await this.#modEngineVersion();
        if (version) {
          this.#status(container, `Engine ${version} is installed.`, "ok");
        } else {
          this.#status(
            container,
            "No mod manager found in this profile. Nothing to switch — the " +
              "choice is recorded for the next time one is provisioned.",
            "warn"
          );
        }
      },
      commit: () => this.#applyModChannel(this.#answers.modsChannel),
    };
  }

  /** `{profile}/chrome/JS/engine.json`, which Sine writes and owns. */
  get #engineFile() {
    return PathUtils.join(
      Services.dirsvc.get("ProfD", Ci.nsIFile).path,
      "chrome",
      "JS",
      "engine.json"
    );
  }

  async #modEngineVersion() {
    try {
      const engine = await IOUtils.readJSON(this.#engineFile);
      return engine?.version ?? null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Switches the installed engine's channel by rewriting its own version.
   *
   * This is Sine's mechanism, not a workaround for it: the engine compares the
   * version in `engine.json` against its releases to decide what to update to,
   * and a Cosine release is one whose tag ends in `c`. Adding or removing that
   * suffix is therefore the supported way to move an installed engine between
   * channels, and it is exactly what `scripts/trance-cosine.py` relies on when
   * it says a Cosine engine keeps updating along Cosine.
   *
   * Nothing here installs, downloads or restarts. The engine picks the change
   * up on its next update check.
   *
   * @param {string} channel
   */
  async #applyModChannel(channel) {
    Services.prefs.setStringPref(PREF_MODS_CHANNEL, channel);

    let engine;
    try {
      engine = await IOUtils.readJSON(this.#engineFile);
    } catch (error) {
      // No engine in this profile. The pref is the whole answer.
      return;
    }
    const current = String(engine?.version ?? "");
    if (!current) {
      return;
    }
    const base = current.replace(/c$/, "");
    const wanted = channel === "cosine" ? `${base}c` : base;
    if (wanted === current) {
      return;
    }
    try {
      await IOUtils.writeJSON(this.#engineFile, { ...engine, version: wanted });
      TranceLog.log(NS, `mod engine ${current} → ${wanted}`);
    } catch (error) {
      TranceLog.error(NS, "could not rewrite the mod engine version", error);
    }
  }

  // 3 ── Architecture ---------------------------------------------------------

  /**
   * What this build was compiled for.
   *
   * `XPCOMABI` and not `Services.sysinfo` "arch": the question this page asks is
   * which set of blur numbers to use, and that follows the GPU the *build* is
   * driving. A universal answer would also hide the case worth surfacing — an
   * x86_64 build running under Rosetta on an Apple Silicon machine, which is
   * both slower than it needs to be and invisible from inside the browser
   * except through this mismatch.
   */
  #detectArch() {
    const abi = Services.appinfo.XPCOMABI ?? "";
    if (abi.startsWith("aarch64") || abi.startsWith("arm64")) {
      return "arm64";
    }
    if (abi.startsWith("x86_64") || abi.startsWith("x86-64")) {
      return "x86_64";
    }
    return Services.prefs.getStringPref(PREF_ARCH, "arm64");
  }

  /**
   * What the *machine* is, as opposed to what the build is.
   *
   * Only used to spot the Rosetta case. `getProperty` throws rather than
   * returning undefined for a key the platform does not publish, and this is a
   * warning line — it is not worth an exception reaching the page builder.
   */
  #machineArch() {
    try {
      return Services.sysinfo.getProperty("arch");
    } catch (error) {
      return "";
    }
  }

  #archLabel(arch) {
    const labels = ARCH_LABEL[arch];
    return AppConstants.platform === "macosx" ? labels.mac : labels.generic;
  }

  #pageArchitecture() {
    const detected = this.#answers.arch;
    return {
      id: "architecture",
      title: { text: "Which processor" },
      description: [
        {
          text:
            "Trance frosts the whole window, and that frost is the one thing " +
            "it draws whose cost is not the same on every machine. This picks " +
            "the blur settings to start from.",
        },
        {
          text: `Detected: ${this.#archLabel(detected)}. Change it only if that is wrong.`,
        },
      ],
      buttons: [{ label: { l10n: "zen-generic-next" } }],
      render: container => {
        this.#choiceGroup(
          container,
          [
            {
              value: "arm64",
              title: this.#archLabel("arm64"),
              detail:
                "Full frost: a 24px blur across the window, blurred internal " +
                "pages, and a blurred address bar on focus.",
              note: detected === "arm64" ? "Detected" : undefined,
            },
            {
              value: "x86_64",
              title: this.#archLabel("x86_64"),
              detail:
                "A 10px blur, no blur behind internal pages, and no address " +
                "bar blur. Still frosted; far fewer samples per frame.",
              note: detected === "x86_64" ? "Detected" : undefined,
            },
          ],
          this.#answers.arch,
          value => {
            this.#answers.arch = value;
          }
        );
        if (
          AppConstants.platform === "macosx" &&
          detected === "x86_64" &&
          this.#machineArch() === "aarch64"
        ) {
          this.#status(
            container,
            "This is an Intel build running under Rosetta on an Apple " +
              "Silicon Mac. A native build will be considerably faster.",
            "warn"
          );
        }
      },
      commit: () => this.#applyArch(this.#answers.arch),
    };
  }

  /**
   * Writes the arch-tuned blur prefs.
   *
   * Both columns are written, always. Clearing the user branch would be the
   * `#applyChannel` treatment, and it is wrong here: a user who moved the blur
   * radius by hand and then answered this question has asked for the tuning,
   * and inheriting their own old value instead would look like the question did
   * nothing.
   *
   * @param {string} arch
   */
  #applyArch(arch) {
    Services.prefs.setStringPref(PREF_ARCH, arch);
    for (const entry of ARCH_TUNING[arch] ?? []) {
      try {
        if (entry.type === "int") {
          Services.prefs.setIntPref(entry.name, entry.value);
        } else {
          Services.prefs.setBoolPref(entry.name, entry.value);
        }
      } catch (error) {
        TranceLog.error(NS, `could not set ${entry.name}`, error);
      }
    }
    TranceLog.log(NS, "arch", arch);
  }

  // 4 ── Edgeless -------------------------------------------------------------

  #pageEdgeless() {
    return {
      id: "edgeless",
      title: { text: "Edgeless" },
      description: [
        {
          text:
            "Edgeless makes the web page part of the window rather than a " +
            "card floating on it: no border, no shadow, one rounded corner, " +
            "and the frost running edge to edge behind everything.",
        },
        {
          text: "It is the biggest change Trance makes to the shape of a window.",
        },
      ],
      buttons: [{ label: { l10n: "zen-generic-next" } }],
      render: container => {
        this.#choiceGroup(
          container,
          [
            {
              value: "on",
              title: "Edgeless",
              detail:
                "The page runs to the window edge. One rounded corner, beside " +
                "the sidebar, so the two still read as separate things.",
            },
            {
              value: "off",
              title: "Framed",
              detail:
                "The page keeps its own card: rounded on all four corners, " +
                "its own backdrop, and a gutter of frost around it.",
            },
          ],
          this.#answers.edgeless ? "on" : "off",
          value => {
            this.#answers.edgeless = value === "on";
            this.#paintEdgelessPreview(container);
          }
        );
        this.#paintEdgelessPreview(container);
      },
      commit: () => {
        Services.prefs.setBoolPref(PREF_EDGELESS, this.#answers.edgeless);
      },
    };
  }

  /**
   * A two-rectangle diagram of the choice.
   *
   * Not a live preview. Turning the real pref on and off behind a flow that has
   * already hidden the browser would restyle a window nobody can see, and the
   * difference between the two arrangements is entirely a matter of edges —
   * which is exactly what a diagram can show and a screenshot of a hidden
   * window cannot.
   *
   * @param {Element} container
   */
  #paintEdgelessPreview(container) {
    const doc = this.context.document;
    let preview = container.querySelector("#trance-onboarding-edgeless");
    if (!preview) {
      preview = doc.createElement("div");
      preview.id = "trance-onboarding-edgeless";
      const rail = doc.createElement("div");
      rail.className = "trance-onboarding-preview-rail";
      const page = doc.createElement("div");
      page.className = "trance-onboarding-preview-page";
      preview.append(rail, page);
      container.appendChild(preview);
    }
    preview.toggleAttribute("edgeless", this.#answers.edgeless);
  }

  // 5 ── Zen Internet ---------------------------------------------------------

  #pageZenInternet() {
    return {
      id: "zen-internet",
      title: { text: "Set up Zen Internet" },
      description: [
        {
          text:
            "Zen Internet restyles the sites you visit to match your browser " +
            "theme. Trance installs it, but it ships switched off and stays " +
            "that way until you open it once and choose what it should do.",
        },
        {
          text: "This is the one bundled extension that does nothing on its own.",
        },
      ],
      buttons: [
        // The primary action is opening it, and it deliberately does not
        // advance — the point of the page is that this extension needs a visit,
        // so sending the user onwards the moment they click would undo it. The
        // second button is "Next" rather than "Skip": someone who has just
        // opened the thing has not skipped anything.
        {
          label: { text: "Open Zen Internet" },
          onClick: () => this.#openZenInternet(),
        },
        { label: { l10n: "zen-generic-next" } },
      ],
      render: container => this.#renderZenInternet(container),
    };
  }

  /**
   * @param {Element} container
   */
  async #renderZenInternet(container) {
    const doc = this.context.document;
    const list = doc.createElement("ul");
    list.className = "trance-onboarding-list";
    container.appendChild(list);

    for (const step of [
      "Open it from the toolbar or from the button here.",
      "Pick a mode — match the browser theme, or a fixed palette.",
      "Turn it on for the sites you want it on.",
    ]) {
      const item = doc.createElement("li");
      item.textContent = step;
      list.appendChild(item);
    }

    const addon = await this.#zenInternet();
    if (!addon) {
      this.#status(
        container,
        "Not installed yet. It arrives over the network on first run; the " +
          "first-run panel after this flow can retry it.",
        "warn"
      );
      return;
    }
    this.#status(
      container,
      addon.isActive
        ? `${addon.name} is installed and switched on.`
        : `${addon.name} is installed but turned off.`,
      addon.isActive ? "ok" : "warn"
    );
  }

  async #zenInternet() {
    try {
      const addons = ChromeUtils.importESModule(
        "resource://gre/modules/AddonManager.sys.mjs"
      ).AddonManager;
      return await addons.getAddonByID(ZEN_INTERNET_ID);
    } catch (error) {
      TranceLog.error(NS, "could not read the Zen Internet add-on", error);
      return null;
    }
  }

  /**
   * Opens the extension, and stays on the page.
   *
   * `optionsURL` first, because an extension that declares one is saying where
   * its own settings live. Zen Internet's UI is a browser-action popup, and a
   * popup cannot be opened while the toolbar is hidden behind this flow — so the
   * fallback is its own page in `about:addons`, which is reachable, permanent,
   * and has the enable switch on it.
   *
   * Returns false either way: the button opens something, it does not advance.
   */
  async #openZenInternet() {
    const addon = await this.#zenInternet();
    const target = addon?.optionsURL
      ? addon.optionsURL
      : `about:addons#detail/${encodeURIComponent(ZEN_INTERNET_ID)}`;
    try {
      this.context.window.openTrustedLinkIn(target, "tab");
    } catch (error) {
      TranceLog.error(NS, "could not open Zen Internet", error);
    }
    return false;
  }

  // 6 ── Import and default browser -------------------------------------------

  #pageImport() {
    return {
      id: "import",
      title: { l10n: "zen-welcome-import-title" },
      description: [
        { l10n: "zen-welcome-import-description-1" },
        { l10n: "zen-welcome-import-description-2" },
      ],
      buttons: [
        // The confirm. Before this existed the page had two buttons — "import
        // from another browser", which opens a wizard and stays put, and
        // "skip" — so the only way to leave was the one labelled *skip*, and
        // leaving is what committed the Zen import. Choosing a profile and
        // pressing "skip" imported it; that is not a confirmation, it is a
        // trapdoor.
        //
        // Hidden when there is no Zen to import from, because a disabled
        // button explains nothing to somebody who has never run Zen.
        {
          id: BUTTON_IMPORT_ID,
          label: { text: "Import" },
        },
        {
          label: { l10n: "zen-welcome-import-button" },
          onClick: () => {
            this.context.window.MigrationUtils.showMigrationWizard(
              this.context.window,
              { isStartupMigration: true }
            );
            return false;
          },
        },
        {
          label: { l10n: "zen-welcome-skip-button" },
          onClick: () => {
            // Skip means skip. Whatever is selected above, leaving by this
            // button imports nothing.
            this.#answers.importFrom = "";
            return true;
          },
        },
      ],
      render: container => this.#renderImport(container),
      commit: async () => {
        await this.#commitImport();
        await this.#commitDefaultBrowser();
      },
    };
  }

  /**
   * Enables the confirm button, or takes it off the page entirely.
   *
   * Called once when the page renders and again on every change of the choice
   * group, because "is there something to import" is not known until the disk
   * walk finishes and "has one been chosen" changes under the pointer.
   */
  #syncImportButton() {
    const button = this.#element(BUTTON_IMPORT_ID);
    if (!button) {
      return;
    }
    const offered = !!this.#zenProfiles?.length;
    button.hidden = !offered;
    button.disabled = !this.#answers.importFrom;
    // `.primary` is the first button's by position, and the first button is
    // this one. With nothing to import it is not on the page at all, so the
    // emphasis has to move to whatever is now first.
    const wizard = button.nextElementSibling;
    wizard?.classList.toggle("primary", !offered);
    button.classList.toggle("primary", offered);
  }

  /**
   * The import page: Zen's own data first, then Firefox's wizard, then the
   * default-browser question.
   *
   * The order is the argument. `MigrationUtils` covers bookmarks, history,
   * passwords and cookies for every browser it knows, and it knows Zen only as
   * "a Firefox" — which means it imports everything about a Zen profile except
   * the spaces, folders, essentials and pinned tabs that are the reason the
   * profile looks like anything. Those come first because they are the ones
   * nothing else can do.
   *
   * @param {Element} container
   */
  async #renderImport(container) {
    const doc = this.context.document;

    if (this.#zenProfiles === null) {
      this.#status(container, "Looking for an installed Zen…", "busy");
      try {
        this.#zenProfiles = await TranceZenImport.detect();
      } catch (error) {
        TranceLog.error(NS, "could not look for Zen profiles", error);
        this.#zenProfiles = [];
      }
      // The page can be left while the disk walk is still running. Everything
      // below writes into `container`, which by then is detached and about to
      // be collected, so the work would be invisible rather than wrong — but a
      // status strip that says "Looking for" forever is worse than nothing.
      if (!this.#running) {
        return;
      }
      container.querySelector(".trance-onboarding-status")?.remove();
    }

    if (this.#zenProfiles.length) {
      this.#renderZenProfiles(container);
    }
    this.#syncImportButton();

    const group = doc.createElement("div");
    group.className = "trance-onboarding-choices";
    group.setAttribute("role", "radiogroup");

    for (const [value, l10n] of [
      ["yes", "zen-welcome-set-default-browser"],
      ["no", "zen-welcome-dont-set-default-browser"],
    ]) {
      const label = doc.createElement("label");
      label.className = "trance-onboarding-choice";
      const input = doc.createElement("input");
      input.type = "radio";
      input.name = "trance-onboarding-default-browser";
      input.checked =
        value === (this.#answers.setDefaultBrowser ? "yes" : "no");
      this.addListener(input, "change", () => {
        this.#answers.setDefaultBrowser = value === "yes";
      });
      const body = doc.createElement("span");
      body.className = "trance-onboarding-choice-body";
      const title = doc.createElement("span");
      title.className = "trance-onboarding-choice-title";
      doc.l10n.setAttributes(title, l10n);
      body.appendChild(title);
      label.append(input, body);
      group.appendChild(label);
    }
    container.appendChild(group);
  }

  /**
   * The detected-Zen list, and the one option it needs beyond "which".
   *
   * @param {Element} container
   */
  #renderZenProfiles(container) {
    const doc = this.context.document;

    const heading = doc.createElement("p");
    heading.className = "trance-onboarding-subheading";
    heading.textContent =
      this.#zenProfiles.length === 1
        ? "Trance found an installed Zen. Bring its sidebar across?"
        : "Trance found more than one installed Zen. Bring one across?";
    container.appendChild(heading);

    const options = this.#zenProfiles.map(profile => ({
      value: profile.id,
      title: `${profile.label} — ${profile.name}`,
      detail: this.#zenProfileDetail(profile),
      note: profile.version ? `Last run by ${profile.version}` : undefined,
    }));
    options.push({
      value: "",
      title: "Start clean",
      detail:
        "Trance sets up its own spaces and leaves your Zen profile alone.",
    });

    const tabsToggle = doc.createElement("label");
    tabsToggle.className = "trance-onboarding-toggle";
    tabsToggle.hidden = !this.#answers.importFrom;
    const tabsInput = doc.createElement("input");
    tabsInput.type = "checkbox";
    tabsInput.checked = this.#answers.importOpenTabs;
    this.addListener(tabsInput, "change", () => {
      this.#answers.importOpenTabs = tabsInput.checked;
    });
    const tabsText = doc.createElement("span");
    tabsText.textContent =
      "Also reopen the tabs that were open, not just the pinned ones";
    tabsToggle.append(tabsInput, tabsText);

    this.#choiceGroup(container, options, this.#answers.importFrom, value => {
      this.#answers.importFrom = value;
      tabsToggle.hidden = !value;
      this.#syncImportButton();
    });
    container.appendChild(tabsToggle);
  }

  /**
   * "4 spaces · 4 folders · 3 essentials · 12 pinned tabs".
   *
   * Every count is dropped when it is zero rather than shown as "0", because
   * the line is there to say what is in the profile and a list of zeroes says
   * the opposite of what it looks like.
   *
   * @param {object} profile
   * @returns {string}
   */
  #zenProfileDetail(profile) {
    const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
    const parts = [plural(profile.counts.spaces, "space")];
    if (profile.counts.folders) {
      parts.push(plural(profile.counts.folders, "folder"));
    }
    if (profile.counts.essentials) {
      parts.push(plural(profile.counts.essentials, "essential"));
    }
    if (profile.counts.pinned) {
      parts.push(plural(profile.counts.pinned, "pinned tab"));
    }
    if (profile.counts.open) {
      parts.push(plural(profile.counts.open, "open tab"));
    }
    return parts.join(" · ");
  }

  /**
   * Stages the chosen Zen profile, or clears a choice that was made and undone.
   *
   * Staging rather than applying: the session manager reads its file once, at
   * startup, long before this page exists. `#finish` restarts the browser when
   * something is staged, and one `if` in `ZenSessionManager.readFile` adopts it
   * on the way back up (ADR-053).
   */
  async #commitImport() {
    const chosen = this.#zenProfiles?.find(
      profile => profile.id === this.#answers.importFrom
    );
    if (!chosen) {
      if (TranceZenImport.isStaged) {
        await TranceZenImport.unstage();
      }
      return;
    }
    await TranceZenImport.stage(chosen, {
      includeOpenTabs: this.#answers.importOpenTabs,
    });
  }

  async #commitDefaultBrowser() {
    if (!this.#answers.setDefaultBrowser || !AppConstants.HAVE_SHELL_SERVICE) {
      return;
    }
    try {
      await this.context.window.getShellService()?.setDefaultBrowser(false);
    } catch (error) {
      TranceLog.error(NS, "could not set the default browser", error);
    }
  }

  // 7 ── Search engine --------------------------------------------------------

  #pageSearch() {
    return {
      id: "search",
      title: { l10n: "zen-welcome-default-search-title" },
      description: [{ l10n: "zen-welcome-default-search-description" }],
      buttons: [{ label: { l10n: "zen-generic-next" } }],
      render: container => this.#renderSearch(container),
    };
  }

  /**
   * @param {Element} container
   */
  async #renderSearch(container) {
    const { SearchService } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/search/SearchService.sys.mjs"
    );
    const doc = this.context.document;
    container.setAttribute("layout", "grid");

    let engines = [];
    let current = null;
    try {
      engines = await SearchService.getVisibleEngines();
      current = await SearchService.getDefault();
    } catch (error) {
      TranceLog.error(NS, "could not read the search engines", error);
      return;
    }

    // The two Zen hides, hidden here for the same reason: they are not general
    // web search, and a first-run list of six is a choice while a list of nine
    // is a form.
    const offered = engines.filter(
      engine => !/wikipedia|ebay/i.test(engine.name) && !engine.hidden
    );

    for (const engine of offered) {
      const label = doc.createElement("label");
      label.className = "trance-onboarding-engine";

      const input = doc.createElement("input");
      input.type = "radio";
      input.name = "trance-onboarding-engine";
      input.checked = engine.name === current?.name;
      this.addListener(input, "change", async () => {
        try {
          await SearchService.setDefault(
            engine,
            SearchService.CHANGE_REASON.USER
          );
        } catch (error) {
          TranceLog.error(NS, "could not set the search engine", error);
        }
      });
      label.appendChild(input);

      const icon = doc.createElement("img");
      icon.width = 28;
      icon.height = 28;
      icon.alt = "";
      try {
        icon.src = await engine.getIconURL();
      } catch (error) {
        // An engine with no icon still gets a row; a missing picture is a
        // smaller problem than a missing engine.
      }
      label.appendChild(icon);

      const caption = doc.createElement("span");
      caption.textContent = engine.name;
      label.appendChild(caption);

      container.appendChild(label);
    }
  }

  // 8 ── Essentials -----------------------------------------------------------

  #pageEssentials() {
    return {
      id: "essentials",
      title: { l10n: "zen-welcome-initial-essentials-title" },
      description: [
        { l10n: "zen-welcome-initial-essentials-description-1" },
        { l10n: "zen-welcome-initial-essentials-description-2" },
      ],
      buttons: [{ label: { l10n: "zen-generic-next" } }],
      render: container => {
        const doc = this.context.document;
        container.setAttribute("layout", "grid");
        for (const essential of ESSENTIALS) {
          const label = doc.createElement("label");
          label.className = "trance-onboarding-essential";

          const input = doc.createElement("input");
          input.type = "checkbox";
          this.addListener(input, "change", () => {
            this.#answers.essentials = input.checked
              ? [...this.#answers.essentials, essential]
              : this.#answers.essentials.filter(item => item !== essential);
            label.toggleAttribute("checked", input.checked);
          });
          label.appendChild(input);

          const icon = doc.createElement("img");
          icon.src = FAVICON_ROOT + essential.icon;
          icon.width = 28;
          icon.height = 28;
          icon.alt = "";
          label.appendChild(icon);

          const caption = doc.createElement("span");
          caption.textContent = essential.label;
          label.appendChild(caption);

          container.appendChild(label);
        }
      },
      commit: () => this.#createEssentials(),
    };
  }

  /**
   * Opens the chosen sites as lazy background tabs and remembers them.
   *
   * Lazy, and with the icon written straight into the session store's cache,
   * because the alternative is nine real page loads during a first run that has
   * not finished — and because a tab that has never loaded has no favicon, so
   * the sidebar would show nine blank squares until each one is visited. This is
   * the same arrangement Zen's own welcome uses.
   */
  async #createEssentials() {
    if (!this.#answers.essentials.length) {
      return;
    }
    const win = this.context.window;

    try {
      const places = win.PlacesUtils.history;
      await places.insertMany(
        this.#answers.essentials.map(essential => ({
          url: essential.url,
          visits: [{ transition: places.TRANSITIONS.TYPED }],
        }))
      );
    } catch (error) {
      TranceLog.error(NS, "could not record the essentials in history", error);
    }

    const { TabStateCache } = ChromeUtils.importESModule(
      "resource:///modules/sessionstore/TabStateCache.sys.mjs"
    );

    for (const essential of this.#answers.essentials) {
      try {
        const tab = win.gBrowser.addTrustedTab(essential.url, {
          inBackground: true,
          createLazyBrowser: true,
        });
        const icon = await this.#iconData(FAVICON_ROOT + essential.icon);
        TabStateCache.update(tab.linkedBrowser.permanentKey, {
          history: { entries: [{ url: essential.url }], index: 0 },
          image: icon,
        });
        if (icon) {
          win.gBrowser.setIcon(tab, icon);
        }
        this.#pendingEssentials.push(tab);
      } catch (error) {
        TranceLog.error(NS, `could not add ${essential.url}`, error);
      }
    }
  }

  /**
   * A chrome icon URL as a data URI.
   *
   * The session store persists whatever is in `image`, and a `chrome://` URL in
   * a restored session is a URL the restoring build has to still have. A data
   * URI is the tab's own copy.
   *
   * @param {string} url
   * @returns {Promise<string | null>}
   */
  async #iconData(url) {
    try {
      const response = await this.context.window.fetch(url);
      if (!response.ok) {
        return null;
      }
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return `data:${blob.type};base64,${this.context.window.btoa(binary)}`;
    } catch (error) {
      return null;
    }
  }

  // 9 ── Workspace colours ----------------------------------------------------

  #pageColours() {
    return {
      id: "colours",
      title: { l10n: "zen-welcome-workspace-colors-title" },
      description: [{ l10n: "zen-welcome-workspace-colors-description" }],
      buttons: [{ label: { l10n: "zen-generic-next" } }],
      render: container => {
        const picker = this.context.window.gZenThemePicker;
        if (!picker?.panel) {
          return;
        }
        const doc = this.context.document;
        const anchor = doc.createElement("div");
        anchor.id = "trance-onboarding-theme-anchor";
        container.appendChild(anchor);

        // The panel is Zen's, and it is borrowed rather than reimplemented:
        // three attributes stop it closing when the pointer leaves it, and all
        // three are given back in `commit`. Trance already extends this picker
        // (ADR-031); opening a second one here would be the two-owners problem
        // in the one place the project is most careful about it.
        for (const attribute of [
          "noautohide",
          "consumeoutsideclicks",
          "nonnative",
        ]) {
          picker.panel.setAttribute(
            attribute,
            attribute === "consumeoutsideclicks" ? "false" : "true"
          );
        }
        this.context.window.PanelMultiView.openPopup(picker.panel, anchor, {
          position: "overlap",
        });
      },
      commit: () => {
        const picker = this.context.window.gZenThemePicker;
        if (!picker?.panel) {
          return;
        }
        for (const attribute of [
          "noautohide",
          "consumeoutsideclicks",
          "nonnative",
        ]) {
          picker.panel.removeAttribute(attribute);
        }
        picker.panel.hidePopup();
        picker.panel.removeAttribute("style");
      },
    };
  }

  // 10 ── Finish --------------------------------------------------------------

  #pageFinish() {
    return {
      id: "finish",
      title: { l10n: "zen-welcome-start-browsing-title" },
      description: [{ l10n: "zen-welcome-start-browsing-description-1" }],
      buttons: [{ label: { l10n: "zen-welcome-start-browsing" } }],
      render: container => {
        const doc = this.context.document;
        const summary = doc.createElement("dl");
        summary.id = "trance-onboarding-summary";
        for (const [term, value] of [
          [
            "Feature set",
            this.#answers.channel === "twilight" ? "Twilight" : "Stable",
          ],
          [
            "Mod manager",
            this.#answers.modsChannel === "sine" ? "Sine" : "Cosine",
          ],
          ["Tuned for", this.#archLabel(this.#answers.arch)],
          ["Window", this.#answers.edgeless ? "Edgeless" : "Framed"],
          [
            "Essentials",
            this.#answers.essentials.length
              ? `${this.#answers.essentials.length} added`
              : "None",
          ],
          ["Imported", this.#importSummary()],
        ]) {
          const dt = doc.createElement("dt");
          dt.textContent = term;
          const dd = doc.createElement("dd");
          dd.textContent = value;
          summary.append(dt, dd);
        }
        container.appendChild(summary);

        if (TranceZenImport.isStaged) {
          this.#status(
            container,
            "Trance will restart once to bring your spaces across.",
            "ok"
          );
        }
      },
    };
  }

  /**
   * The finish page's one-line account of the import, read from the staged
   * state rather than from `#answers`.
   *
   * They can disagree, and when they do the staged state is the true one: a
   * profile whose session file could not be read is a choice that was made and
   * did not take, and the summary should say so rather than repeat the answer
   * back.
   *
   * @returns {string}
   */
  #importSummary() {
    if (!TranceZenImport.isStaged) {
      return this.#answers.importFrom ? "Nothing (import failed)" : "Nothing";
    }
    const source = Services.prefs.getStringPref("trance.import.source", "");
    return source || "Zen";
  }
}
