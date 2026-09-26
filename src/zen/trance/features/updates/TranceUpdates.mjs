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
    const label = `Trance ${result.version} is available${
      result.prerelease ? " (pre-release)" : ""
    }`;
    const buttons = [
      {
        label: "Download",
        accessKey: "D",
        callback: () => {
          win.openTrustedLinkIn(result.url, "tab");
        },
      },
      {
        label: "Skip this version",
        accessKey: "S",
        callback: () => {
          Services.prefs.setStringPref(
            "trance.updates.skipped",
            result.version
          );
        },
      },
    ];
    box.appendNotification(
      NOTIFICATION_ID,
      { label, priority: box.PRIORITY_INFO_MEDIUM },
      buttons
    );
    return true;
  }
}
