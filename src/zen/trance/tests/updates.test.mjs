// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Trance: update version and release selection contracts.

import test from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  parseSha256Digest,
  selectInstallerAsset,
  selectRelease,
} from "../features/updates/TranceUpdateLogic.mjs";

const release = (tag_name, extras = {}) => ({
  tag_name,
  html_url: `https://github.com/xslvrrr/Trance/releases/tag/${tag_name}`,
  ...extras,
});

test("bare and v-prefixed versions compare equally", () => {
  assert.equal(compareVersions("0.3.0", "v0.3.0"), 0);
});

test("numeric components sort numerically rather than lexically", () => {
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
});

test("prerelease sorts below the same final version", () => {
  assert.equal(compareVersions("0.4.0-beta.1", "0.4.0"), -1);
});

test("release selection filters prereleases, drafts, skipped and non-newer versions", () => {
  const releases = [
    release("0.9.0", { prerelease: true }),
    release("0.8.0", { draft: true }),
    release("0.3.0"),
    release("0.4.0", { prerelease: true }),
    release("0.5.0"),
  ];
  assert.equal(
    selectRelease(releases, { currentVersion: "0.3.0", prereleases: false })
      .tag_name,
    "0.5.0"
  );
  assert.equal(
    selectRelease(releases, {
      currentVersion: "0.3.0",
      prereleases: true,
      skipped: "v0.9.0",
    }).tag_name,
    "0.5.0"
  );
  assert.equal(
    selectRelease([release("v0.3.0")], { currentVersion: "0.3.0" }),
    null
  );
});

test("installer selection requires exact host architecture and a digest", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const assets = [
    {
      name: "Trance-0.4.0-macos-aarch64.dmg",
      browser_download_url: "https://example.test/a.dmg",
      digest,
    },
    {
      name: "Trance-0.4.0-macos-x86_64.dmg",
      browser_download_url: "https://example.test/x.dmg",
      digest,
    },
  ];
  const update = release("0.4.0", { assets });
  assert.equal(
    selectInstallerAsset(update, { platform: "darwin", arch: "aarch64" }),
    assets[0]
  );
  assert.equal(
    selectInstallerAsset(update, { platform: "darwin", arch: "x86_64" }),
    assets[1]
  );
  assert.equal(
    selectInstallerAsset(update, { platform: "darwin", arch: "arm64" }),
    null
  );
  assert.equal(
    selectInstallerAsset(update, { platform: "linux", arch: "aarch64" }),
    null
  );
  assert.equal(
    selectInstallerAsset(release("0.4.0", { assets: [assets[1]] }), {
      platform: "darwin",
      arch: "aarch64",
    }),
    null
  );
  assert.equal(
    selectInstallerAsset(
      release("0.4.0", {
        assets: [{ ...assets[0], digest: null }],
      }),
      { platform: "darwin", arch: "aarch64" }
    ),
    null
  );
});

test("SHA-256 parser accepts GitHub digest format only", () => {
  const hex = "AB".repeat(32);
  assert.equal(parseSha256Digest(`sha256:${hex}`), hex.toLowerCase());
  assert.equal(parseSha256Digest(hex), null);
  assert.equal(parseSha256Digest(`sha256:${"a".repeat(63)}`), null);
  assert.equal(parseSha256Digest(`sha256:${"g".repeat(64)}`), null);
});
