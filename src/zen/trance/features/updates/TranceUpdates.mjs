// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: per-window lifecycle for process-wide update notifications.
//
// The check itself is process-wide (TranceUpdateChecker.mjs, loaded without a
// `global` option) and rate-limits itself to one request per six hours. This
// module only decides *when to ask* and *where to show the answer*.
//
// When to ask: once, when the window first goes idle after startup, and then
// whenever the window comes back to the front. No timer — TRANCE.md §12.1
// budgets zero Trance timers at idle, and an hourly wake-up to find out that
// six hours have not passed is exactly the kind of timer that budget exists to
// refuse. Coming back to the window is the moment an answer is worth having
// anyway; a window that is never left is a window whose next launch checks.
//
// Where to show it: the window-wide notification bar (`gNotificationBox`),
// not a tab's, so switching tabs does not hide it.
//
// Refs: TRANCE.md §6, §12.1, §13 Phase 12; ADR-098

import { TranceFeature } from "chrome://browser/content/trance-components/TranceFeature.mjs";

const NOTIFICATION_ID = "trance-update-available";
const CHECKER_URL =
  "chrome://browser/content/trance-components/TranceUpdateChecker.mjs";

/**
 * Mochitest and Marionette kill the browser on its first non-local
 * connection, so an automated window never asks on its own. The checker's
 * injection seam still works there; only the scheduled asks are skipped.
 */
const automated = () =>
  Cu.isInAutomation ||
  !!Services.env.get("MOZ_AUTOMATION") ||
  Services.prefs.getBoolPref("marionette.enabled", false);

export class TranceUpdates extends TranceFeature {
  static prefName = "trance.updates.enabled";
  static featureName = "Updates";

  #shownVersions = new Set();

  onEnable() {
    if (automated()) {
      return;
    }
    this.onIdle(() => this.#check(), { timeout: 5000 });

    const activity = this.context.activity;
    if (activity) {
      let wasFocused = activity.focused;
      const unsubscribe = activity.subscribe(() => {
        if (activity.focused && !wasFocused) {
          this.#check();
        }
        wasFocused = activity.focused;
      });
      this.addDisposer(unsubscribe);
    }
  }

  onDisable() {
    const box = this.context.window.gNotificationBox;
    const notification = box?.getNotificationWithValue(NOTIFICATION_ID);
    if (notification) {
      box.removeNotification(notification);
    }
  }

  #check() {
    const { TranceUpdateChecker } = ChromeUtils.importESModule(CHECKER_URL);
    TranceUpdateChecker.check().catch(error =>
      console.error("[Trance/Updates] check failed", error)
    );
  }

  /**
   * Called by the checker on the most recent browser window.
   *
   * @param {{status: string, version: string, prerelease: boolean, url: string}} result
   * @returns {boolean} Whether a notification was shown.
   */
  showUpdate(result) {
    if (
      !this.enabled ||
      result.status !== "available" ||
      this.#shownVersions.has(result.version)
    ) {
      return false;
    }
    const win = this.context.window;
    if (Services.wm.getMostRecentWindow("navigator:browser") !== win) {
      return false;
    }
    const box = win.gNotificationBox;
    if (!box || box.getNotificationWithValue(NOTIFICATION_ID)) {
      return false;
    }
    this.#shownVersions.add(result.version);
    let label = `Trance ${result.version} is available${
      result.prerelease ? " (pre-release)" : ""
    }`;
    const buttons = [];
    const downloadPage = {
      label: "Open release page",
      accessKey: "O",
      callback: () => win.openTrustedLinkIn(result.url, "tab"),
    };
    let installer = null;
    if (result.asset) {
      installer = ChromeUtils.importESModule(
        "chrome://browser/content/trance-components/TranceUpdateInstaller.mjs"
      ).TranceUpdateInstaller;
    }
    const eligibility = installer?.canInstall();
    // `appendNotification` is async: the bar exists once this resolves, and
    // every later label change goes through it.
    let notification = null;
    const setLabel = text => {
      if (notification) {
        notification.label = text;
      }
    };
    if (eligibility?.ok) {
      let installing = false;
      const install = async restart => {
        if (installing) {
          return true;
        }
        installing = true;
        setLabel(`Downloading Trance ${result.version}…`);
        try {
          await installer.stage(result.asset, result.version, progress => {
            const percent = Math.floor(
              (progress.received / progress.total) * 100
            );
            setLabel(`Downloading Trance ${result.version} — ${percent}%`);
          });
          installer.installOnQuit({ restart });
          setLabel(
            restart
              ? `Trance ${result.version} will install as the browser restarts.`
              : `Trance ${result.version} is staged and will install when you quit.`
          );
          if (restart) {
            // Not `eRestart`: Gecko would relaunch this bundle the moment the
            // process exits, while the helper is replacing it. The helper
            // relaunches the new bundle itself once the swap is done.
            Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
            if (!Services.startup.shuttingDown) {
              // Something cancelled the quit; the update stays staged for the
              // next ordinary quit, which should not relaunch.
              installer.installOnQuit({ restart: false });
              setLabel(
                `Trance ${result.version} is staged and will install when you quit.`
              );
            }
          }
        } catch (error) {
          installing = false;
          setLabel(
            `Could not install Trance ${result.version}: ${error.message}`
          );
          win.openTrustedLinkIn(result.url, "tab");
        }
        // Keep the bar open: it is where progress and the outcome are shown.
        return true;
      };
      buttons.push({
        label: "Install and restart",
        accessKey: "I",
        callback: () => install(true),
      });
      buttons.push({
        label: "Install on quit",
        accessKey: "Q",
        callback: () => install(false),
      });
    } else {
      label += result.asset
        ? ` — ${eligibility?.reason || "Automatic installation is unavailable."}`
        : " — no verified installer for this platform; use the release page.";
      buttons.push(downloadPage);
    }
    buttons.push({
      label: "Skip this version",
      accessKey: "S",
      callback: () => {
        Services.prefs.setStringPref("trance.updates.skipped", result.version);
      },
    });
    box
      .appendNotification(
        NOTIFICATION_ID,
        { label, priority: box.PRIORITY_INFO_MEDIUM },
        buttons
      )
      .then(bar => {
        notification = bar;
      });
    return true;
  }
}
