// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: verified macOS release staging and shutdown-time bundle swap.
//
// Refs: TRANCE.md §13 Phase 12; ADR-104

import { parseSha256Digest } from "./TranceUpdateLogic.mjs";

// A lazy getter, not a bare global: this module is imported without a
// `global` option, into the shared system global, where `AppConstants` is not
// defined the way it is in a browser window.
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
});

const PREF_STAGED = "trance.updates.staged";
const PREF_RESTART = "trance.updates.restart-after-install";
const MAX_WAIT_SECONDS = 120;
let active = false;
/** The staging run in progress, so a second click cannot start a second one. */
let staging = null;

function bundlePaths() {
  const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
  const app = executable.parent.parent.parent;
  return { app, parent: app.parent };
}

function hostSupported() {
  return (
    lazy.AppConstants.platform === "macosx" &&
    (Services.appinfo.XPCOMABI.includes("aarch64") ||
      Services.appinfo.XPCOMABI.includes("x86_64"))
  );
}

export function canInstall(targetBundlePath = "") {
  if (!hostSupported()) {
    return {
      ok: false,
      reason: "Automatic installation is available only on macOS.",
    };
  }
  const { app } = bundlePaths();
  const target = targetBundlePath
    ? Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile)
    : app;
  if (targetBundlePath) {
    target.initWithPath(targetBundlePath);
  }
  const path = target.path;
  if (path.includes("AppTranslocation")) {
    return {
      ok: false,
      reason: "This app is running from a translocated location.",
    };
  }
  const targetParent = target.parent;
  try {
    if (targetParent.diskSpaceAvailable === 0) {
      return { ok: false, reason: "The app is on a read-only volume." };
    }
  } catch {
    return { ok: false, reason: "The app volume is not writable." };
  }
  return { ok: true, appPath: path, parentPath: targetParent.path };
}

function runProcess(path, args) {
  return new Promise((resolve, reject) => {
    try {
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      const process = Cc["@mozilla.org/process/util;1"].createInstance(
        Ci.nsIProcess
      );
      process.init(file);
      process.runAsync(
        args,
        args.length,
        {
          observe(_subject, topic) {
            if (topic === "process-finished" && process.exitValue === 0) {
              resolve();
            } else {
              reject(new Error(`${path} failed (${process.exitValue})`));
            }
          },
        },
        false
      );
    } catch (error) {
      reject(error);
    }
  });
}

function hashService() {
  return Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
}

async function download(asset, directory, onProgress) {
  if (
    Cu.isInAutomation ||
    Services.env.get("MOZ_AUTOMATION") ||
    Services.prefs.getBoolPref("marionette.enabled", false)
  ) {
    throw new Error("Update downloads are disabled in automation.");
  }
  if (!asset.size || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error("The release asset has no valid expected size.");
  }
  const expectedDigest = parseSha256Digest(asset.digest);
  if (!expectedDigest) {
    throw new Error("GitHub did not provide a valid SHA-256 digest.");
  }
  const response = await fetch(asset.browser_download_url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status}).`);
  }
  const dmgPath = PathUtils.join(directory, "release.dmg");
  const hash = hashService();
  hash.init(hash.SHA256);
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > asset.size) {
        throw new Error("The downloaded file is larger than expected.");
      }
      hash.update(value, value.length);
      // `appendOrCreate`: plain `append` refuses a file that does not exist
      // yet, which is every download's first chunk.
      await IOUtils.write(dmgPath, value, { mode: "appendOrCreate" });
      onProgress?.({ received, total: asset.size });
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== asset.size) {
    throw new Error("The downloaded file size does not match GitHub.");
  }
  // `finish(false)` returns the digest as a binary string, one char per byte.
  const digest = Array.from(hash.finish(false), char =>
    char.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("");
  if (digest !== expectedDigest) {
    throw new Error("The downloaded file failed SHA-256 verification.");
  }
  return dmgPath;
}

function plistString(xml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    xml.match(
      new RegExp(`<key>${escaped}<\\/key>\\s*<string>([^<]*)<\\/string>`)
    )?.[1] ?? ""
  );
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function makeSwapHelper({ stagedApp, targetApp, relaunch }) {
  return (
    `#!/bin/sh\n` +
    `pid="$1"\n` +
    `i=0\n` +
    `while /bin/kill -0 "$pid" 2>/dev/null; do\n` +
    `  i=$((i + 1)); [ "$i" -lt ${MAX_WAIT_SECONDS} ] || exit 1\n` +
    `  /bin/sleep 1\n` +
    `done\n` +
    `target=${shellQuote(targetApp)}\n` +
    `old="$target.trance-old-$pid"\n` +
    `staged=${shellQuote(stagedApp)}\n` +
    `/bin/mv "$target" "$old" || exit 1\n` +
    `if ! /bin/mv "$staged" "$target"; then /bin/mv "$old" "$target"; exit 1; fi\n` +
    (relaunch
      ? `if ! /usr/bin/open ${shellQuote(targetApp)}; then /bin/rm -rf "$target"; /bin/mv "$old" "$target"; exit 1; fi\n`
      : "") +
    `/bin/rm -rf "$old"\n` +
    `/bin/rm -rf ${shellQuote(PathUtils.parent(stagedApp))}\n`
  );
}

function startSwap(record, relaunch) {
  const pid = String(Services.appinfo.processID);
  const helperPath = relaunch ? record.restartHelperPath : record.helperPath;
  const installDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  installDir.initWithPath(PathUtils.parent(record.targetApp));
  if (installDir.isWritable()) {
    const process = Cc["@mozilla.org/process/util;1"].createInstance(
      Ci.nsIProcess
    );
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath("/bin/sh");
    process.init(file);
    process.runAsync([helperPath, pid], 2, null, false);
  } else {
    const command = `/bin/sh ${shellQuote(helperPath)} ${shellQuote(pid)}`;
    const script = `do shell script ${JSON.stringify(command)} with administrator privileges`;
    const process = Cc["@mozilla.org/process/util;1"].createInstance(
      Ci.nsIProcess
    );
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath("/usr/bin/osascript");
    process.init(file);
    process.runAsync(["-e", script], 2, null, false);
  }
}

function armObserver() {
  if (active) {
    return;
  }
  active = true;
  Services.obs.addObserver(onQuit, "quit-application-granted");
}

function onQuit() {
  Services.obs.removeObserver(onQuit, "quit-application-granted");
  active = false;
  const staged = Services.prefs.getStringPref(PREF_STAGED, "");
  if (!staged) {
    return;
  }
  let record;
  try {
    record = JSON.parse(staged);
  } catch {
    return;
  }
  const relaunch = Services.prefs.getBoolPref(PREF_RESTART, false);
  try {
    startSwap(record, relaunch);
  } catch (error) {
    console.error(error);
  }
}

const stored = Services.prefs.getStringPref(PREF_STAGED, "");
if (stored) {
  try {
    const record = JSON.parse(stored);
    Promise.all([
      IOUtils.exists(record.stagedApp),
      IOUtils.exists(record.helperPath),
      IOUtils.exists(record.restartHelperPath),
    ]).then(async pathsExist => {
      if (pathsExist.every(Boolean)) {
        armObserver();
      } else {
        Services.prefs.clearUserPref(PREF_STAGED);
        Services.prefs.clearUserPref(PREF_RESTART);
        await IOUtils.remove(PathUtils.parent(record.stagedApp), {
          recursive: true,
          ignoreAbsent: true,
        });
      }
    });
  } catch {
    Services.prefs.clearUserPref(PREF_STAGED);
    Services.prefs.clearUserPref(PREF_RESTART);
  }
}

async function stageRelease(asset, version, onProgress, eligibility) {
  const directory = PathUtils.join(
    PathUtils.tempDir,
    `trance-update-${Services.appinfo.processID}`
  );
  const mount = PathUtils.join(directory, "mount");
  await IOUtils.remove(directory, { recursive: true, ignoreAbsent: true });
  await IOUtils.makeDirectory(mount, { createAncestors: true });
  try {
    const dmg = await download(asset, directory, onProgress);
    await runProcess("/usr/bin/hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-noautoopen",
      "-mountpoint",
      mount,
      dmg,
    ]);
    const sourceApp = PathUtils.join(mount, "Trance.app");
    const info = PathUtils.join(sourceApp, "Contents", "Info.plist");
    const plist = new TextDecoder().decode(await IOUtils.read(info));
    if (
      plistString(plist, "CFBundleIdentifier") !== "app.trance-browser.trance"
    ) {
      throw new Error(
        "The downloaded disk image does not contain the Trance app."
      );
    }
    if (plistString(plist, "CFBundleShortVersionString") !== version) {
      throw new Error("The downloaded app version does not match the release.");
    }
    const stagedApp = PathUtils.join(directory, "Trance.app");
    await runProcess("/usr/bin/ditto", [sourceApp, stagedApp]);
    await runProcess("/usr/bin/hdiutil", ["detach", mount]);
    // No `codesign --verify`: release builds are ad-hoc/linker-signed, and a
    // strict verification of one fails ("code has no resources but
    // signature indicates they must be present") while proving nothing a
    // self-signature could. The integrity check is the SHA-256 above,
    // against the digest GitHub's API reports for the asset over HTTPS.
    await runProcess("/usr/bin/xattr", [
      "-dr",
      "com.apple.quarantine",
      stagedApp,
    ]);
    const helperPath = PathUtils.join(directory, "swap.sh");
    const restartHelperPath = PathUtils.join(directory, "swap-restart.sh");
    await IOUtils.writeUTF8(
      helperPath,
      makeSwapHelper({
        stagedApp,
        targetApp: eligibility.appPath,
        relaunch: false,
      })
    );
    await IOUtils.writeUTF8(
      restartHelperPath,
      makeSwapHelper({
        stagedApp,
        targetApp: eligibility.appPath,
        relaunch: true,
      })
    );
    await IOUtils.setPermissions(helperPath, 0o700);
    await IOUtils.setPermissions(restartHelperPath, 0o700);
    const record = {
      version,
      stagedApp,
      targetApp: eligibility.appPath,
      helperPath,
      restartHelperPath,
    };
    Services.prefs.setStringPref(PREF_STAGED, JSON.stringify(record));
    Services.prefs.setBoolPref(PREF_RESTART, false);
    armObserver();
    return { status: "staged", version };
  } catch (error) {
    try {
      await runProcess("/usr/bin/hdiutil", ["detach", mount]);
    } catch {}
    await IOUtils.remove(directory, { recursive: true, ignoreAbsent: true });
    throw error;
  }
}

export const TranceUpdateInstaller = Object.freeze({
  get staged() {
    return Services.prefs.getStringPref(PREF_STAGED, "") !== "";
  },
  canInstall,
  async stage(asset, version, onProgress, { targetBundlePath = "" } = {}) {
    if (active) {
      throw new Error("An update is already staged.");
    }
    if (staging) {
      throw new Error("An update is already downloading.");
    }
    const eligibility = canInstall(targetBundlePath);
    if (!eligibility.ok) {
      throw new Error(eligibility.reason);
    }
    const expectedDigest = parseSha256Digest(asset?.digest);
    if (!expectedDigest) {
      throw new Error("GitHub did not provide a valid SHA-256 digest.");
    }
    staging = stageRelease(asset, version, onProgress, eligibility);
    try {
      return await staging;
    } finally {
      staging = null;
    }
  },
  installOnQuit({ restart = false } = {}) {
    if (!this.staged) {
      throw new Error("No update is staged.");
    }
    Services.prefs.setBoolPref(PREF_RESTART, restart);
  },
});
