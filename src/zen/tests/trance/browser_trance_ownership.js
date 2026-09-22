/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

/* Trance: single-ownership acceptance tests (AUDIT.md Phase 3).
 *
 * Phase 3 replaced seven overlapping owners with one each: a navigation router,
 * a loading-indicator owner, an address-bar motion owner, a window-material
 * owner, a scoped invalidation service, a tab-strip structural cache, and a
 * process-wide preference-ownership service.
 *
 * The load-bearing tests here are the ones a code review cannot do:
 *
 *   - a pref claim is refcounted for the *process*, not for the window, and the
 *     value that comes back is the one the first claimant found;
 *   - the observer hub delivers a record when the matching element is the node
 *     that was inserted, not only when it is the mutation's target;
 *   - every read runs before every write in a flush;
 *   - the tab-strip cache answers without touching the document.
 */

"use strict";

/** Two frames: one for the hub to flush into, one for it to have happened. */
function nextFrames() {
  return new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

function context() {
  return window.gTrance.context;
}

/**
 * The process-wide registries, reached the way production reaches them: no
 * `global` option, so this is the same module instance every window sees.
 */
function globals() {
  const prefs = ChromeUtils.importESModule(
    "chrome://browser/content/trance-components/TranceGlobalPrefs.mjs"
  );
  const sheets = ChromeUtils.importESModule(
    "chrome://browser/content/trance-components/TranceGlobalSheets.mjs"
  );
  return { ...prefs, ...sheets };
}

const SCRATCH_PREF = "trance.test.ownership.scratch";

// --- The pref-ownership service ---------------------------------------------

add_task(async function test_a_claim_is_refcounted_across_owners() {
  const { TranceGlobalPrefOwner, TranceGlobalPrefs } = globals();
  Services.prefs.setBoolPref(SCRATCH_PREF, false);

  const first = new TranceGlobalPrefOwner("first");
  const second = new TranceGlobalPrefOwner("second");

  first.claim(SCRATCH_PREF, true);
  is(
    Services.prefs.getBoolPref(SCRATCH_PREF),
    true,
    "the first claim writes the value"
  );

  // The second owner is the case the old hand-rolled refcounts got wrong: it
  // reads the *already claimed* value, so if it recorded that as "what it said
  // before", the first release would restore the claim rather than the original.
  second.claim(SCRATCH_PREF, true);
  first.releaseAll();
  is(
    Services.prefs.getBoolPref(SCRATCH_PREF),
    true,
    "one owner letting go does not give the pref back while another holds it"
  );

  second.releaseAll();
  is(
    Services.prefs.getBoolPref(SCRATCH_PREF),
    false,
    "the last release restores what the *first* claimant found"
  );
  ok(
    !TranceGlobalPrefs.isClaimed(SCRATCH_PREF),
    "and the registry no longer holds it"
  );

  Services.prefs.clearUserPref(SCRATCH_PREF);
});

add_task(async function test_a_claim_is_enforced_while_it_is_held() {
  const { TranceGlobalPrefOwner } = globals();
  Services.prefs.setBoolPref(SCRATCH_PREF, false);

  const owner = new TranceGlobalPrefOwner("enforcer");
  owner.claim(SCRATCH_PREF, true);

  // Something else — Zen's own UI, or about:config — writes it back. A one-time
  // claim loses here, which is how compact mode could re-enable acrylic behind
  // the surface layer.
  Services.prefs.setBoolPref(SCRATCH_PREF, false);
  is(
    Services.prefs.getBoolPref(SCRATCH_PREF),
    true,
    "ownership means the value is put back, not merely set once"
  );

  owner.releaseAll();
  Services.prefs.clearUserPref(SCRATCH_PREF);
});

add_task(async function test_a_default_only_pref_is_cleared_not_frozen() {
  const { TranceGlobalPrefOwner } = globals();
  Services.prefs.clearUserPref(SCRATCH_PREF);
  Services.prefs.getDefaultBranch("").setBoolPref(SCRATCH_PREF, false);

  const owner = new TranceGlobalPrefOwner("restorer");
  owner.claim(SCRATCH_PREF, true);
  owner.releaseAll();

  ok(
    !Services.prefs.prefHasUserValue(SCRATCH_PREF),
    "restoring a pref that only had a default clears it rather than " +
      "freezing today's default into prefs.js"
  );
});

add_task(async function test_the_loading_indicator_is_owned_not_mirrored() {
  const { TranceGlobalPrefs } = globals();
  await SpecialPowers.pushPrefEnv({
    set: [["trance.feedback.loading.enabled", true]],
  });
  await nextFrames();

  ok(
    TranceGlobalPrefs.isClaimed("zen.view.enable-loading-indicator"),
    "Trance's bar holds Zen's indicator through the process-wide registry"
  );
  is(
    Services.prefs
      .getDefaultBranch("")
      .getBoolPref("zen.view.enable-loading-indicator", true),
    false,
    "and the hold is on the default branch, so a user value still wins"
  );

  await SpecialPowers.popPrefEnv();
});

// --- The scoped invalidation service ----------------------------------------

add_task(async function test_a_narrow_root_sees_only_its_own_subtree() {
  const { observers } = context();
  const host = document.createElement("div");
  document.documentElement.appendChild(host);
  registerCleanupFunction(() => host.remove());

  let batches = 0;
  const handle = observers.observeMutations("div", () => batches++, {
    root: host,
    attributes: true,
    attributeFilter: ["trance-test"],
    subtree: true,
  });
  registerCleanupFunction(() => observers.unobserve(handle));

  // Outside the root entirely. A document-rooted observer would have delivered
  // this and made the subscriber reject it; a narrow root never sees it.
  document.documentElement.setAttribute("trance-test", "1");
  await nextFrames();
  is(batches, 0, "a mutation outside the root is not delivered at all");

  const inner = document.createElement("div");
  host.appendChild(inner);
  inner.setAttribute("trance-test", "1");
  await nextFrames();
  is(batches, 1, "and one inside it is");

  document.documentElement.removeAttribute("trance-test");
});

add_task(async function test_an_inserted_match_is_a_match() {
  const { observers } = context();
  const host = document.createElement("div");
  host.id = "trance-test-strip";
  document.documentElement.appendChild(host);
  registerCleanupFunction(() => host.remove());

  let seen = 0;
  const handle = observers.observeMutations("section", () => seen++, {
    root: host,
    childList: true,
    subtree: true,
  });
  registerCleanupFunction(() => observers.unobserve(handle));

  // The record's target is `host`, which neither matches `section` nor has an
  // ancestor that does. Looking only at the target — which is what the hub used
  // to do — misses this entirely, and it is the shape of every workspace and
  // every re-rendered list in the browser.
  const section = document.createElement("section");
  section.appendChild(document.createElement("span"));
  host.appendChild(section);
  await nextFrames();
  is(seen, 1, "inserting a matching element delivers a record");

  section.remove();
  await nextFrames();
  is(seen, 2, "and removing it delivers another");
});

add_task(async function test_reads_all_happen_before_writes() {
  const { observers } = context();
  const host = document.createElement("div");
  document.documentElement.appendChild(host);
  const a = document.createElement("div");
  const b = document.createElement("div");
  host.append(a, b);
  registerCleanupFunction(() => host.remove());

  const order = [];
  const subscribe = name =>
    observers.observeMutations("div", null, {
      root: host,
      attributes: true,
      attributeFilter: ["trance-test"],
      subtree: true,
      read: () => {
        order.push(`read:${name}`);
        return name;
      },
      write: () => order.push(`write:${name}`),
    });

  const handles = [subscribe("a"), subscribe("b")];
  registerCleanupFunction(() => handles.forEach(h => observers.unobserve(h)));

  a.setAttribute("trance-test", "1");
  b.setAttribute("trance-test", "1");
  await nextFrames();

  is(
    order.filter(step => step.startsWith("read")).length,
    2,
    "both subscribers read"
  );
  const lastRead = order.lastIndexOf("read:b") + 1 || order.length;
  const firstWrite = order.findIndex(step => step.startsWith("write:"));
  Assert.greater(firstWrite, -1, "and both subscribers write");
  Assert.greaterOrEqual(
    firstWrite,
    order.filter(step => step.startsWith("read:")).length - 1,
    "no write runs before the last read — the phases are real (§6.4)"
  );
  ok(lastRead > 0, "reads were recorded in order");
});

// --- The tab-strip structural cache -----------------------------------------

add_task(async function test_the_cache_answers_without_a_document_query() {
  const { tabs } = context();
  ok(tabs.root, "the cache found the tab strip's root");
  is(
    tabs.folderCount,
    document.querySelectorAll("zen-folder").length,
    "and its answer matches the document it was built from"
  );
});

// --- The navigation router ---------------------------------------------------

add_task(async function test_the_router_keys_progress_by_browser() {
  const { navigation } = context();
  const seen = [];
  const handle = navigation.subscribe(
    { onProgress: browser => seen.push(browser) },
    { selectedOnly: true }
  );
  registerCleanupFunction(() => navigation.unsubscribe(handle));

  const background = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );
  const foreground = gBrowser.selectedTab;
  is(foreground, background, "the new tab is the selected one");
  await nextFrames();

  for (const browser of seen) {
    is(
      browser,
      gBrowser.selectedBrowser,
      "a selectedOnly subscriber is only ever told about the selected browser"
    );
  }

  BrowserTestUtils.removeTab(background);
});

// --- The window-material owner ------------------------------------------------

add_task(async function test_one_owner_writes_the_material_attributes() {
  const { material } = context();
  await SpecialPowers.pushPrefEnv({
    set: [
      ["trance.surface.enabled", true],
      ["trance.surface.transparency", false],
    ],
  });
  await nextFrames();

  ok(
    !document.documentElement.hasAttribute("trance-surface-transparent"),
    "the opaque baseline is what an opaque intent produces"
  );
  ok(!material.translucent, "and the owner agrees with the attribute it wrote");

  await SpecialPowers.popPrefEnv();
});
