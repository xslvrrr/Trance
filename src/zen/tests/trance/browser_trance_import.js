/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: Zen/Twilight import acceptance tests (TRANCE.md §13 Phase 13).
 *
 * The import has two halves and they fail in different ways, so they are tested
 * separately:
 *
 *   - *detection* walks somebody else's disk. It has to survive a vendor
 *     directory that is not there, a `profiles.ini` that is malformed, a
 *     profile that was created and never opened, and a session file written by
 *     a crash halfway through. Every one of those is "this profile is not
 *     offered", never "the first-run flow threw";
 *   - *staging* writes a file the next startup will adopt. What matters is that
 *     what comes out the other side is the spaces and folders that went in, that
 *     unpinned tabs are dropped unless they were asked for, and that the pref
 *     and the file agree — a pref set with no file behind it is a startup that
 *     silently loses the import.
 *
 * The channel test is the one that earns its place twice over: telling Zen from
 * Twilight is the thing the user asked for by name, and `profiles.ini` does not
 * record it. It comes out of `compatibility.ini`, and this asserts against the
 * three shapes that file actually takes.
 */

"use strict";

const { TranceZenImport, STAGED_FILE, PREF_STAGED, PREF_SOURCE } =
  ChromeUtils.importESModule(
    "chrome://browser/content/trance-components/TranceZenImport.mjs"
  );

const STAGED_PATH = PathUtils.join(PathUtils.profileDir, STAGED_FILE);

/** A minimal but real sidebar object, in the shape Zen 1.18+ writes. */
function sidebar({ spaces = 2, folders = 1, pinned = 2, open = 3 } = {}) {
  const tabs = [];
  for (let i = 0; i < pinned; i++) {
    tabs.push({ pinned: true, zenEssential: i === 0, entries: [], index: 1 });
  }
  for (let i = 0; i < open; i++) {
    tabs.push({ pinned: false, entries: [], index: 1 });
  }
  return {
    lastCollected: 1787871919487,
    spaces: Array.from({ length: spaces }, (_, i) => ({
      uuid: `space-${i}`,
      name: `Space ${i}`,
      icon: "",
      containerTabId: 0,
    })),
    folders: Array.from({ length: folders }, (_, i) => ({
      id: `folder-${i}`,
      name: `Folder ${i}`,
      pinned: true,
    })),
    groups: [],
    splitViewData: [],
    tabs,
  };
}

/**
 * Builds a throwaway Zen vendor directory and returns its path.
 *
 * Written under the test profile rather than next to the real one. Detection
 * derives its search root from `PathUtils.profileDir`, so `#detectIn` is called
 * directly with this path — the alternative is a test that only passes on a
 * machine with Zen installed, which is a test of the machine.
 *
 * @param {object[]} profiles - `{name, dirName, compatibility, session}`
 */
async function makeZenRoot(profiles) {
  const root = PathUtils.join(
    PathUtils.profileDir,
    `zen-fixture-${Services.uuid.generateUUID().toString().slice(1, 9)}`
  );
  await IOUtils.makeDirectory(PathUtils.join(root, "Profiles"), {
    createAncestors: true,
  });

  let ini = "[General]\nStartWithLastProfile=1\nVersion=2\n";
  for (const [index, profile] of profiles.entries()) {
    const dir = PathUtils.join(root, "Profiles", profile.dirName);
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    ini +=
      `\n[Profile${index}]\nName=${profile.name}\nIsRelative=1\n` +
      `Path=Profiles/${profile.dirName}\n`;
    if (profile.compatibility) {
      await IOUtils.writeUTF8(
        PathUtils.join(dir, "compatibility.ini"),
        `[Compatibility]\n${profile.compatibility}\n`
      );
    }
    if (profile.session !== undefined) {
      if (typeof profile.session === "string") {
        await IOUtils.writeUTF8(
          PathUtils.join(dir, "zen-sessions.jsonlz4"),
          profile.session
        );
      } else {
        await IOUtils.writeJSON(
          PathUtils.join(dir, "zen-sessions.jsonlz4"),
          profile.session,
          { compress: true }
        );
      }
    }
  }
  await IOUtils.writeUTF8(PathUtils.join(root, "profiles.ini"), ini);
  registerCleanupFunction(() =>
    IOUtils.remove(root, { recursive: true, ignoreAbsent: true })
  );
  return root;
}

/** `detect()` walks fixed roots; `detectIn` is the half a fixture can reach. */
const detectIn = root => TranceZenImport.detectIn(root);

registerCleanupFunction(async () => {
  Services.prefs.clearUserPref(PREF_STAGED);
  Services.prefs.clearUserPref(PREF_SOURCE);
  await IOUtils.remove(STAGED_PATH, { ignoreAbsent: true });
});

add_task(async function detection_survives_a_missing_zen() {
  const found = await detectIn(
    PathUtils.join(PathUtils.profileDir, "no-zen-here")
  );
  Assert.deepEqual(
    found,
    [],
    "a vendor directory that is not there finds none"
  );
});

add_task(async function detection_reads_channels_from_compatibility_ini() {
  const root = await makeZenRoot([
    {
      name: "Default (release)",
      dirName: "aaaaaaaa.Default (release)",
      compatibility:
        "LastVersion=1.18.10b_20260220112217/20260220112217\n" +
        "LastPlatformDir=/Applications/Zen.app/Contents/Resources",
      session: sidebar(),
    },
    {
      name: "Default (twilight)",
      dirName: "bbbbbbbb.Default (twilight)",
      compatibility:
        "LastVersion=1.22t_20260826111626/20260826111626\n" +
        "LastPlatformDir=/Applications/Twilight.app/Contents/Resources",
      session: sidebar({ spaces: 5, folders: 8 }),
    },
    {
      name: "Untouched",
      dirName: "cccccccc.Untouched",
      // No compatibility.ini: a profile the user never opened.
      session: sidebar({ spaces: 1, folders: 0, pinned: 0, open: 0 }),
    },
  ]);

  const found = await detectIn(root);
  Assert.equal(found.length, 3, "all three profiles with spaces are offered");

  const byName = Object.fromEntries(found.map(p => [p.name, p]));
  Assert.equal(
    byName["Default (release)"].channel,
    "stable",
    "Zen.app is the stable channel"
  );
  Assert.equal(
    byName["Default (twilight)"].channel,
    "twilight",
    "Twilight.app is the twilight channel"
  );
  Assert.equal(
    byName.Untouched.channel,
    "unknown",
    "no compatibility.ini means no claim about the channel"
  );
  Assert.equal(
    byName["Default (twilight)"].counts.spaces,
    5,
    "the space count is read from the session file"
  );
  Assert.equal(
    byName["Default (twilight)"].counts.folders,
    8,
    "the folder count is read from the session file"
  );
  Assert.equal(
    byName["Default (release)"].version,
    "1.18.10b",
    "the version is the part before the build id"
  );
});

add_task(async function detection_skips_profiles_with_nothing_in_them() {
  const root = await makeZenRoot([
    {
      name: "Never opened",
      dirName: "dddddddd.Never opened",
      // No session file at all: a profile created and never run.
    },
    {
      name: "No spaces",
      dirName: "eeeeeeee.No spaces",
      session: { tabs: [], spaces: [] },
    },
    {
      name: "Truncated",
      dirName: "ffffffff.Truncated",
      // A session file that is not lz4 at all, as a crash mid-write leaves it.
      session: "not a session file",
    },
  ]);

  const found = await detectIn(root);
  Assert.deepEqual(found, [], "none of the three is offered, and none throws");
});

add_task(async function staging_carries_the_sidebar_and_drops_open_tabs() {
  const root = await makeZenRoot([
    {
      name: "Default (release)",
      dirName: "11111111.Default (release)",
      compatibility: "LastPlatformDir=/Applications/Zen.app/Contents/Resources",
      session: sidebar({ spaces: 3, folders: 2, pinned: 4, open: 6 }),
    },
  ]);
  const [candidate] = await detectIn(root);

  Assert.ok(
    await TranceZenImport.stage(candidate),
    "staging a real profile succeeds"
  );
  Assert.ok(
    Services.prefs.getBoolPref(PREF_STAGED, false),
    "the staged pref is set"
  );
  Assert.ok(await IOUtils.exists(STAGED_PATH), "the staged file is written");
  Assert.equal(
    Services.prefs.getStringPref(PREF_SOURCE, ""),
    "Zen — Default (release)",
    "the source is recorded in the form the finish page shows"
  );

  const staged = await IOUtils.readJSON(STAGED_PATH, { decompress: true });
  Assert.equal(staged.spaces.length, 3, "every space comes across");
  Assert.equal(staged.folders.length, 2, "every folder comes across");
  Assert.equal(
    staged.tabs.length,
    4,
    "the four pinned tabs come across and the six open ones do not"
  );
  Assert.ok(
    staged.tabs.every(tab => tab.pinned),
    "nothing unpinned is carried by default"
  );

  await TranceZenImport.unstage();
  Assert.ok(
    !Services.prefs.getBoolPref(PREF_STAGED, false),
    "unstaging clears the pref"
  );
  Assert.ok(
    !(await IOUtils.exists(STAGED_PATH)),
    "unstaging removes the staged file"
  );
});

add_task(async function staging_can_be_asked_for_the_open_tabs_too() {
  const root = await makeZenRoot([
    {
      name: "Default (twilight)",
      dirName: "22222222.Default (twilight)",
      compatibility: "LastVersion=1.22t_20260826111626/20260826111626",
      session: sidebar({ spaces: 1, folders: 0, pinned: 2, open: 5 }),
    },
  ]);
  const [candidate] = await detectIn(root);
  Assert.equal(candidate.channel, "twilight", "the version string is enough");

  Assert.ok(
    await TranceZenImport.stage(candidate, { includeOpenTabs: true }),
    "staging with open tabs succeeds"
  );
  const staged = await IOUtils.readJSON(STAGED_PATH, { decompress: true });
  Assert.equal(staged.tabs.length, 7, "all seven tabs come across");

  await TranceZenImport.unstage();
});

add_task(async function a_profile_that_cannot_be_read_stages_nothing() {
  // The candidate is built from a profile that exists and is then removed, which
  // is what a Zen uninstalled between the page rendering and the page being left
  // looks like.
  const root = await makeZenRoot([
    {
      name: "Default (release)",
      dirName: "33333333.Default (release)",
      session: sidebar(),
    },
  ]);
  const [candidate] = await detectIn(root);
  await IOUtils.remove(PathUtils.join(root, "Profiles"), { recursive: true });

  Assert.ok(
    !(await TranceZenImport.stage(candidate)),
    "staging reports failure rather than throwing"
  );
  Assert.ok(
    !Services.prefs.getBoolPref(PREF_STAGED, false),
    "and leaves no pref behind for a startup to act on"
  );
  Assert.ok(
    !(await IOUtils.exists(STAGED_PATH)),
    "and leaves no file behind either"
  );
});
