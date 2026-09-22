## Audit verdict

The highest-probability cause of the GPU-helper and energy regression is architectural compositing, not ordinary JavaScript overhead.

Trance currently combines:

- transparent content canvases for ordinary web tabs;
- a full-window native macOS visual-effect view;
- persistent full-window image and saturation filters;
- large content-pane blur animations;
- seven automatically installed extensions;
- six enabled Sine/Cosine mods;
- base Zen features that retain renderable tabs, observers, actors, timers, and animations.

That combination can reduce parent-process memory while increasing GPU-process `phys_footprint`, IOSurface retention, WindowServer work, and total energy.

The maximum-performance product should default to an opaque, single-compositor-owner, extension-light browser. Translucency and elaborate motion should become optional appearance modes.

No files were changed, and no builds or tests were run.

## Skills and audit coverage

I used these planning skills:

- `codebase-onboarding` to map the patch-based Zen/Firefox architecture and ownership boundaries.
- `benchmark-optimization-loop` to require controlled baselines, ablations, statistical gates, and correctness checks before promoting changes.
- `parallel-execution-optimizer` to divide the audit into six independent read-only lanes.
- `benchmark` and `latency-critical-systems` as secondary guidance for workload and hot-path decomposition.

Six subagents independently covered GPU/Gecko architecture, macOS energy, fork features, build/measurement validity, patch debt, and whole-product performance. Their conclusions strongly converged.

Searchfox’s CLI was unavailable, so engine identifiers were validated against the local Firefox 154 checkout.

## What the existing baseline says—and does not say

The stored run reports:

- Focused idle CPU: `14.888%` of one core.
- Minimized CPU: `15.764%`.
- Browser process: `360.3 MB`.
- GPU process: `285.5 MB`.
- Extension process: `200.6 MB`.
- Total: `1,152.7 MB` at one tab and `1,440.5 MB` after 20 tabs.

Evidence: [perf-baseline.json](/Users/ryan/Downloads/Code/Trance-dev/docs/trance/perf-baseline.json:31), [process breakdown](/Users/ryan/Downloads/Code/Trance-dev/docs/trance/perf-baseline.json:247).

Those figures are alarming, but the run is not a valid production energy baseline:

- It explicitly records `settled: false`.
- The profiler runs continuously at a 2 ms sampling interval.
- No watts, joules, wakeups, GPU time, or actual minimized compositor activity were captured.
- The GPU number is macOS `phys_footprint`, not GPU VRAM.
- Process footprints are summed as if they were uniquely additive physical RAM.
- The workload is predominantly `about:blank`.
- It compares no matched stock Zen build.
- The build has no PGO and is not production-representative.

See [settling failure](/Users/ryan/Downloads/Code/Trance-dev/docs/trance/perf-baseline.json:218), [process probe](/Users/ryan/Downloads/Code/Trance-dev/scripts/trance-perf.py:302), and [macOS ProcInfo implementation](/Users/ryan/Downloads/Code/Trance-dev/engine/toolkit/components/processtools/ProcInfo.mm:121).

Therefore, “GPU helper is larger” is a valid lead, but its precise physical-memory and energy contribution has not yet been measured correctly.

## Highest-impact findings

| Priority | Finding | Expected gain | Confidence |
|---|---|---:|---:|
| P0 | Ordinary web tabs are forced through transparent browser canvases | Very high GPU memory and energy | High |
| P0 | Native full-window vibrancy overlaps WebRender filtering and alpha composition | Very high GPU/WindowServer energy | High |
| P0 | Seven extensions plus six Sine mods ship enabled | Very high RAM, CPU, startup, wakeups | High |
| P0 | Current benchmark cannot measure production energy reliably | Critical decision quality | Certain |
| P1 | Full-pane loading, tab-switch, and URL-bar filters | High interaction energy and latency | High |
| P1 | Split View and Glance retain active renderable browsers | High RAM/GPU in affected sessions | High |
| P1 | Fork-wide WebRender backdrop fallback adds GPU work | Potentially high, workload-dependent | Medium-high |
| P1 | Base Zen timers, infinite animations and broad actors bypass Trance controls | High in active feature states | High |
| P2 | Observer, navigation, animation and loading ownership overlap | Medium CPU/style work | High |
| P2 | Lifecycle and multi-window bugs can retain partially active features | Medium retention and correctness | High |
| P2 | Build and patch state is not sufficiently reproducible | High development risk | High |

### 1. Transparent content canvases

Trance enables transparency and edgeless/internal-page behavior by default, claims `browser.tabs.allow_transparent_browser`, and stamps every current content browser as transparent.

See [surface defaults](/Users/ryan/Downloads/Code/Trance-dev/prefs/trance/surfaces.yaml:27) and [TranceSurfaces.mjs](/Users/ryan/Downloads/Code/Trance-dev/src/zen/trance/features/surfaces/TranceSurfaces.mjs:988).

This removes opaque rendering fast paths from ordinary websites and forces alpha-aware composition across content surfaces. It is the strongest explanation for a lower browser-process footprint but larger GPU helper.

There are also two bugs:

- Disabling transparency cannot fully revert an existing browser’s construction-time alpha state until the browser is recreated.
- Multiple windows independently claim and restore a global preference, so one window can undo another’s required state.

Maximum-gain direction: keep all remote web content opaque. Transparency should be limited to explicitly supported internal documents or a separate chrome-only layer.

### 2. Dual compositor ownership on macOS

Native vibrancy is enabled by default and wraps the entire browser content view in an `NSVisualEffectView` using behind-window blending.

See [macOS preference](/Users/ryan/Downloads/Code/Trance-dev/prefs/zen/macos.yaml:5) and [nsCocoaWindow.mm](/Users/ryan/Downloads/Code/Trance-dev/engine/widget/cocoa/nsCocoaWindow.mm:1369).

On macOS, Trance suppresses some CSS backdrop blur when native material is active, but it retains:

- alpha-composited content;
- full-window image filtering;
- full-window saturation filtering;
- Core Animation layers;
- base Zen backdrop-filter paths.

That gives the WindowServer and WebRender overlapping material responsibilities.

Maximum-gain direction: default to neither. If a translucent appearance is retained, select exactly one material owner—native material with simple opaque WebRender content, or WebRender material with native vibrancy disabled.

### 3. Persistent large filters

The default surface uses a cover-sized image with runtime blur and full-window saturation filtering. A project comment already records roughly 6 ms for one large saturation update.

See [surface filters](/Users/ryan/Downloads/Code/Trance-dev/src/zen/trance/styles/trance-surfaces.css:104), [image blur](/Users/ryan/Downloads/Code/Trance-dev/src/zen/trance/styles/trance-surfaces.css:205), and [defaults](/Users/ryan/Downloads/Code/Trance-dev/prefs/trance/surfaces.yaml:132).

At 1800×1131 and 2× scale, one RGBA intermediate surface is approximately 32 MB before buffering, retained copies, depth/stencil data, or driver overhead. Several surfaces can plausibly account for hundreds of megabytes.

The selected content pane is also blurred during loading, while tab and search transitions animate filters on large browser elements. See [trance-feedback.css](/Users/ryan/Downloads/Code/Trance-dev/src/zen/trance/styles/trance-feedback.css:193).

Maximum-gain direction:

- no runtime blur on window-sized imagery;
- saturation at the genuine no-op value of 100%;
- pre-blurred/downsampled static assets where absolutely required;
- opacity/transform-only interaction motion;
- no filtering of remote page content.

### 4. Extension and mod payload

The distribution policy automatically installs:

- uBlock Origin;
- SponsorBlock;
- Privacy Badger;
- Dark Reader;
- ClearURLs;
- Return YouTube Dislikes;
- Zen Internet.

See [policies.json](/Users/ryan/Downloads/Code/Trance-dev/src/zen/trance/distribution/policies.json:7).

The extension process alone is approximately 200.6 MB in the existing baseline, while Dark Reader also owns a separate web-isolated process.

There is overlap between uBlock, Privacy Badger, ClearURLs, and built-in tracking protection. Dark Reader is especially expensive because it can inject styles, observe mutations, and restyle every real page.

Sine additionally enables six external mods, including a Live Calendar implementation with periodic background work. See [PREINSTALLED_MODS](/Users/ryan/Downloads/Code/Trance-dev/scripts/trance-cosine.py:176).

Maximum-gain direction:

- no default extensions, or at most one carefully audited blocker;
- all convenience extensions offered during onboarding as opt-in;
- remove the runtime mod manager from the default profile;
- vendor native replacements only when their measured product value exceeds their permanent cost;
- never let remotely changing mod payloads determine release performance.

### 5. Base Zen features outside Trance’s energy model

Important base-browser costs include:

- one 1 Hz interval per active media card, stopped only when minimized or fully occluded—not when unfocused or hidden: [ZenMediaController.mjs](/Users/ryan/Downloads/Code/Trance-dev/src/zen/media/ZenMediaController.mjs:346);
- raw observers, timers and animation frames in `ZenUIManager`, Compact Mode, Spaces, Split View and Glance;
- infinite animations in media overflow, sidebar notifications, feature callouts, and the fallback loading indicator;
- Boosts actors instantiated for every iframe before rejecting irrelevant contexts;
- Split View and Glance setting browsers as active/non-discardable;
- all-tab cross-window synchronization;
- live-folder network refresh tasks;
- unconditional session auto-restore changes.

These are not necessarily active at idle, but they materially affect realistic multi-tab, media, workspace and extension workloads.

## Confirmed bugs and overlap

The implementation plan includes these correctness fixes because several can also create unnecessary
work. Status re-checked against the tree on 23/09/26; a check mark means the implementation and
its consumer are present, not that the claim was always true:

- ✅ Background-tab loads can activate loading effects on the selected tab. `TranceNavigation`
  keeps state and subscriptions keyed by browser (`src/zen/trance/core/TranceNavigation.mjs:75-85,
  120-148`); `TranceFeedback` consumes the selected-browser route
  (`src/zen/trance/features/feedback/TranceFeedback.mjs:442-475`).
- ✅ `onProgressChange` is not consistently filtered to top-level progress. The router returns
  early for non-top-level progress (`src/zen/trance/core/TranceNavigation.mjs:261-284`), and
  location/state callbacks apply the same filter (`:241-259, 286-294`).
- ✅ Three Trance progress/navigation listeners independently process overlapping events. The
  router installs one tabs-progress listener and coalesces updates through its per-frame flush
  (`src/zen/trance/core/TranceNavigation.mjs:222-296, 315-326`); `TranceSurfaces` and
  `TranceFeedback` subscribe to it (`src/zen/trance/features/surfaces/TranceSurfaces.mjs:605-611`,
  `src/zen/trance/features/feedback/TranceFeedback.mjs:442-475`).
- ✅ Base Zen and Trance both own URL-bar search animations. This was the last of these to close,
  and it closed by a different mechanism than the one first proposed: Zen binds its handler during
  startup (`src/zen/common/modules/ZenUIManager.mjs:63-67`), so replacing the method on the object
  afterwards would not replace the function already registered. `TranceFeedback` claims the event
  instead — a capture-phase listener on the window that calls `stopImmediatePropagation`, so Zen's
  bubble-phase handler never runs while Trance owns the gesture
  (`src/zen/trance/features/feedback/TranceFeedback.mjs:415-450`). The listener is registered
  through the tracked `addListener` helper, so disabling the feature hands the event straight back
  with no state to restore.
- ✅ Base Zen's loading indicator remains compiled and dynamically suppressed by Trance. The
  feedback feature claims `zen.view.enable-loading-indicator` through the tracked global-pref
  owner and releases it on teardown (`src/zen/trance/features/feedback/TranceFeedback.mjs:361-386`);
  the process-wide registry is refcounted (`src/zen/trance/core/TranceGlobalPrefs.mjs:144-161,
  198-235`).
- ✅ `TranceFeature` formerly marked features enabled before `onEnable()` succeeded and did not
  roll back partial setup. It now commits only after setup completes and rolls back acquired
  resources on failure (`src/zen/trance/core/TranceFeature.mjs:334-394`).
- ✅ `TranceSurfaces` bypassed tracked scheduler helpers for a `TabOpen` frame callback, allowing
  work after disable. The callback now goes through the feature's own `onFrame`, so the disposer
  list owns it (`src/zen/trance/features/surfaces/TranceSurfaces.mjs:736-747`). A handle taken
  straight from `context.scheduler` is not in any feature's disposer list; that is the whole
  distinction, and it is written down at the call site.
- ✅ `TranceScheduler.onIdle()` is not visibility-aware and is omitted from `timerCount`. Armed
  idle callbacks are now disarmed with the window and re-armed on resume
  (`src/zen/trance/core/TranceScheduler.mjs:240-256`), and `timerCount` counts them
  (`:180-186`). The second half is the load-bearing one: `scripts/trance-perf.py` reads that
  number as a §12.1 acceptance gate, and a gate that cannot see a whole class of scheduled work
  is the failure this project exists to prevent.
- ✅ The observer hub performed `records × subscribers` selector matching against the whole
  document. There is now one `MutationObserver` per subscribed root, rebuilt from the union of
  what its subscribers asked for (`src/zen/trance/core/TranceObserverHub.mjs:357-418`), and
  dispatch is indexed by record type and attribute name rather than offered to every subscriber
  (`:420-455`). `TranceTabCache` is the first consumer to depend on the `root` option being
  honoured (`src/zen/trance/core/TranceTabCache.mjs:205-209`).
- ✅ Mutation matching does not correctly account for inserted descendants. A childList record is
  now matched against the added and removed subtrees, not only against their roots
  (`src/zen/trance/core/TranceObserverHub.mjs:478-498`).
- ✅ IntersectionObserver sharing omits `root` from its identity. Observers are now keyed by root
  first and by the remaining options second (`src/zen/trance/core/TranceObserverHub.mjs:176-199`),
  so two subscribers wanting the same threshold against different roots no longer share one
  observer and one wrong answer.
- ✅ Claimed read/write phases are not real phases. A subscription may supply `{ read, write }`,
  and in a flush every read runs before any write, each write receiving its own read's return
  value (`src/zen/trance/core/TranceObserverHub.mjs:106-133, 503-540`). A plain callback still
  behaves exactly as before.
- ✅ `TranceMotion` can overwrite and later remove another owner's inline `will-change`. The hint
  is refcounted per element, concurrent animations get the union of what they asked for, and the
  inline value found before the first claim is restored on the last release — `removeProperty`
  when there was none, rather than an empty string
  (`src/zen/trance/core/TranceMotion.mjs:40-101, 176-194`).
- ✅ Compact acrylic can be re-enabled after Trance's one-time preference claim. Material holds
  `zen.theme.acrylic-elements=false` for the active intent through the global owner
  (`src/zen/trance/core/TranceMaterial.mjs:215-240`), whose observer reasserts the wanted value
  while claimed (`src/zen/trance/core/TranceGlobalPrefs.mjs:163-187`).
- ✅ Internal-page opacity changes no longer unregister/register an application-wide stylesheet
  directly. `TranceSurfaces` uses one global-sheet slot and coalesces updates
  (`src/zen/trance/features/surfaces/TranceSurfaces.mjs:521-595`); the process-wide registry
  registers/unregisters only at the shared hold boundary (`src/zen/trance/core/TranceGlobalSheets.mjs:43-80`).
- ✅ The onboarding fallback value differs between Zen startup and Trance core. Both call sites
  use `false` as the fallback (`src/zen/common/modules/ZenStartup.mjs:193-201`,
  `src/zen/trance/core/TranceFeature.mjs:309-316`), while the shipped pref is enabled in
  `prefs/trance/onboarding.yaml`.
- ✅ Global transparency, vibrancy, acrylic and loading-indicator preferences now have
  process-wide multi-window ownership. `TranceMaterial` uses a global-pref owner
  (`src/zen/trance/core/TranceMaterial.mjs:117-143`), and Feedback uses the same ownership path
  for the loading indicator (`src/zen/trance/features/feedback/TranceFeedback.mjs:367-386`).

## Maximum-gains execution plan

### Phase 0 — Make measurement trustworthy [✅ Completed 31/08/26]

This is the first deliverable because the existing run cannot promote or reject an optimization.

1. Split the harness into:

   - profiler-off CPU, memory and energy gates;
   - profiler-on diagnostic runs;
   - graphics-marker/WebRender runs.

2. A run must fail validity when:

   - settling fails;
   - required GPU or energy metrics are missing;
   - the process tree changes without reconciliation;
   - the binary does not match the recorded revision;
   - the production gate uses a non-PGO/debug-symbol build;
   - thermal state or power mode changes materially.

3. Record:

   - macOS `phys_footprint`, RSS and shared/purgeable memory separately;
   - IOSurface count, dimensions and bytes;
   - GPU time and energy by process type;
   - browser, GPU, extension, content and WindowServer energy;
   - wakeups, Core Animation commits and compositor frames;
   - source revision, binary hash, OS, machine, display scale and refresh rate;
   - PGO/LTO/profiler/extension/profile state.

4. Use matched builds:

   - stock Firefox;
   - stock Zen;
   - Trance binary with Trance disabled;
   - Trance enabled;
   - Trance without extensions;
   - Trance without Sine;
   - individual feature ablations.

5. Run at least:

   - 10 cold/warm startups;
   - 20 repeated interaction samples;
   - three 10–15 minute idle/energy samples;
   - median, p95 and dispersion reporting.

6. Workloads must cover focused, unfocused, fully occluded and minimized windows; 1/20/50 realistic tabs; session restore; scrolling; video; WebGL; long page loads; spaces; split view; Glance; URL bar; and multi-window use.

### Phase 1 — Remove default GPU cost [✅ Completed 31/08/26]

Ship an extreme-performance baseline:

- opaque ordinary web content;
- no native vibrancy/Mica;
- no full-window backdrop filter;
- saturation 100%;
- no default background image;
- no runtime image blur;
- no internal-page blur;
- no loading-pane blur;
- no URL-bar/page filter;
- opacity/transform-only tab and workspace motion;
- base Zen acrylic and infinite animation paths disabled.

Then run four controlled material variants:

1. Fully opaque.
2. Native material only.
3. WebRender material only.
4. Current combined material.

The fully opaque variant should become the default unless another variant can match its energy and GPU-memory results.

### Phase 2 — Suspend invisible work [✅ Core wiring completed 01/09/26; scope checked 23/09/26]

`ZenWindowActivityController` is now the window-level state owner. It publishes focused, visible,
occluded, minimised, Low Power Mode and display-refresh state (`src/zen/common/modules/
ZenWindowActivity.mjs:8-40, 42-70, 115-135`) and installs one controller on the window
(`src/zen/common/modules/ZenWindowActivity.mjs:199-201`). `TranceCore` passes that controller to
`TranceMaterial` and exposes it in the shared context (`src/zen/trance/core/TranceCore.mjs:121-140`).

The five Zen consumers now subscribe at their call sites: media
(`src/zen/media/ZenMediaController.mjs:529-533`), compact mode
(`src/zen/compact-mode/ZenCompactMode.mjs:134-138`), Split View
(`src/zen/split-view/ZenViewSplitter.mjs:142-146`), Glance
(`src/zen/glance/ZenGlanceManager.mjs:54-58`), and live folders
(`src/zen/live-folders/ZenLiveFolder.sys.mjs:31-39`). Material subscribes when an intent is
applied (`src/zen/trance/core/TranceMaterial.mjs:151-165`).

Media's per-card interval is now one controller-level ticker: it starts only for visible cards
while the window is active and stops on suspension (`src/zen/media/ZenMediaController.mjs:565-594`).
Each hidden card records monotonic elapsed time and catches up on resume
(`src/zen/media/ZenMediaController.mjs:266-312`), and the subscription is released on window
unload (`:534-546`). The Trance scheduler keeps its own visibility suspension path
(`src/zen/trance/core/TranceScheduler.mjs:238-257`), now covering idle callbacks as well as
frame callbacks; this audit does not claim that path has been replaced by `gZenWindowActivity`,
only that both answer the same question the same way.

The five new upstream consumers are worth their touchpoints because they remove independent
hidden-window timers, docshell work and deferred network fetches; the ownership and call sites are
listed in `docs/trance/UPSTREAM-TOUCHPOINTS.md:140-151`.

The controller is imported first in `src/zen/common/ZenPreloadedScripts.js:16-28`, ahead of every
consumer. That placement is the load-bearing part and it is deliberate: the module installs
`window.gZenWindowActivity` on import, so without an importer every consumer's `?.subscribe(...)`
would silently evaluate to `undefined` and the listeners those subscriptions replaced would
already be gone. It is imported there rather than from `TranceCore` because it has to survive
`trance.enabled=false` — the Zen features that depend on it are not Trance's to switch off.

### Phase 3 — Consolidate overlapping ownership [✅ Completed 23/09/26]

The owners now genuinely wired into call sites are:

- ✅ one top-level navigation/progress router — `TranceNavigation` installs one tabs-progress
  listener and coalesces delivery (`src/zen/trance/core/TranceNavigation.mjs:222-296,
  315-326`); Feedback and Surfaces subscribe through the feature helper
  (`src/zen/trance/features/feedback/TranceFeedback.mjs:442-475`,
  `src/zen/trance/features/surfaces/TranceSurfaces.mjs:605-611`);
- ✅ one loading-indicator implementation — Feedback owns the bar and claims
  `zen.view.enable-loading-indicator` through `claimGlobalPref`
  (`src/zen/trance/features/feedback/TranceFeedback.mjs:361-410`);
- ✅ one URL-bar/search animation owner — Feedback claims `Zen:UrlbarSearchModeChanged` with a
  capture-phase listener that stops immediate propagation, so Zen's bubble-phase handler
  (`src/zen/common/modules/ZenUIManager.mjs:63-67, 437-460`) never runs while Trance owns the
  gesture (`src/zen/trance/features/feedback/TranceFeedback.mjs:415-450`). The listener is
  tracked, so disabling the feature hands the event back with no state to restore. Replacing the
  method on `ZenUIManager` would not have worked: Zen binds its handler at registration, so the
  function already in the listener list is not reachable through the object;
- ✅ one window-material owner — Surfaces sends one intent to `context.material`
  (`src/zen/trance/features/surfaces/TranceSurfaces.mjs:447-469`), and Material translates it
  to global claims and activity-aware rendering (`src/zen/trance/core/TranceMaterial.mjs:151-165,
  209-240`);
- ✅ one scoped invalidation/observer service — `TranceObserverHub` is root-owned and shared
  (`src/zen/trance/core/TranceCore.mjs:121-139`), with one `MutationObserver` per subscribed root
  rebuilt from the union of its subscribers' options
  (`src/zen/trance/core/TranceObserverHub.mjs:357-418`), dispatch indexed by record type and
  attribute name (`:420-455`), inserted and removed subtrees matched rather than only their roots
  (`:478-498`), `root` in the IntersectionObserver identity (`:176-199`), and real read/write
  phases where every read in a flush precedes every write (`:106-133, 503-540`);
- ✅ one tab/group structural cache — Core constructs `TranceTabCache`
  (`src/zen/trance/core/TranceCore.mjs:121-140`) and TabStrip consumes it
  (`src/zen/trance/features/tabstrip/TranceTabStrip.mjs:809-869`);
- ✅ one process-wide global-pref and global-sheet ownership pair — Feature exposes the tracked
  helpers (`src/zen/trance/core/TranceFeature.mjs:220-250`), while the shared registries refcount
  claims (`src/zen/trance/core/TranceGlobalPrefs.mjs:144-161`,
  `src/zen/trance/core/TranceGlobalSheets.mjs:43-80`).

Navigation is keyed by browser, filters subresource progress and flushes at most once per frame
(`src/zen/trance/core/TranceNavigation.mjs:236-294, 315-326`). The per-window versus
per-process distinction is documented in the jar manifest (`src/zen/trance/jar.inc.mn:41-47`).


### Phase 4 — Optimize base Zen/Gecko integration [✅ Completed 02/09/26]

After the large product costs are removed:

- restrict Boosts and Glance actors to top-level documents — `allFrames` dropped from both in
  `ZenActorsManager.sys.mjs`. For Boosts this is free: `ZenBoostsChild` rejected non-top-level
  contexts itself. For Glance it is a behaviour change as well as an optimisation — a link click
  inside an iframe no longer opens Glance — and the AUDIT line asks for it explicitly;
- add a zero-cost Boosts fast path and color transformation cache — the accent cache is upstream's;
  the fast path is a tri-state on `nsPresContext` that rejects an unboosted page after one branch
  (ADR-064);
- allow inactive Split View/Glance browsers to suspend or use snapshots — both suspend under the
  Phase 2 window-activity controller, and Glance caches its element preview rather than
  re-rendering it;
- restore upstream session auto-restore gating — the `if (false)` overrides of
  `PrivateBrowsingUtils.permanentPrivateBrowsing` are gone from the `SessionStartup` and
  `SessionSaver` patches, and `_resumeSessionEnabled` is `!permanentPrivateBrowsing` rather than
  `true`;
- batch session/window-sync writes as versioned transactions — one write per batch, one rollback
  copy per write, and a monotonic `stateVersion` in the state (ADR-066);
- instrument the Core Animation surface pool, then A/B pool limits 4/8/16/25 — `surface_pool_stats`
  parses upstream's `SurfacePool` markers; `--surface-pool-limit` runs the matrix;
- shrink or release pooled surfaces after prolonged occlusion if safe — **deferred to Phase 6** with
  the measurement in place; the release path costs four new upstream touchpoints (ADR-067);
- A/B the fork-only opaque-backdrop fallback and gate it only while actually required — gated on the
  renderer's clear-colour alpha, so it costs nothing in the opaque default (ADR-065);
- restore the previous renderer color mask rather than assuming all channels were enabled —
  `set_color_mask` returns the mask it replaced and the fallback restores it (ADR-065);
- validate that translucency does not disqualify fullscreen video from macOS’s low-power presentation
  path — read from Gecko's own `gfx.macos_video_low_power` verdict via `--video-url` (ADR-068);
- benchmark adaptive content-process preallocation of 0/1/3 and process reuse grace periods —
  `--prealloc` and `--reuse-grace-ms`, writing only `dom.ipc.processPrelaunch.*` and
  `dom.ipc.processReuse.unusedGraceMs`, so the experiment cannot be mistaken for a change to how many
  processes the browser runs.

Do not globally disable WebRender, hardware acceleration, Fission or content isolation. Those changes can lower the GPU-process number while worsening total energy and responsiveness.

**What "completed" means here.** Every code change above has landed and every experiment has a knob
and a recorded metric. The A/B *runs* — material variants, pool limits, backdrop fallback, the
process matrix and the fullscreen-video verdict — are gate runs against a matched PGO build on the
target machine, and their results are promoted through `docs/trance/perf-baseline.json`, not through
this file. A run that has not happened yet reports `skipped` with a reason rather than a zero.

### Phase 5 — Startup and build optimisation [Implementation complete 02/09/26; heavy experiments unrun]

- [x] Replace eager feature imports with metadata registrations and lazy implementation loading —
  `TranceCore` supplies nine ordered descriptors (`src/zen/trance/core/TranceCore.mjs:150-220`);
  `TranceFeatureRegistry` installs one ordered observer per gate and loads implementations only
  when a gate permits (`src/zen/trance/core/TranceFeatureRegistry.mjs:31-77, 125-169`).
- [x] Do not parse onboarding after completion — the registry's completion gate skips the
  implementation (`src/zen/trance/core/TranceFeatureRegistry.mjs:138-153`), while
  `TranceOnboardingSettings` is a separate descriptor and feature
  (`src/zen/trance/core/TranceCore.mjs:195-208`).
- [x] Load theme customization only when opened — `ThemeState` is the startup renderer and
  `Theme` is popup-gated on `PanelUI-zen-gradient-generator`
  (`src/zen/trance/core/TranceCore.mjs:176-193`; `src/zen/trance/features/theme/TranceThemeState.mjs:15-18`).
- [x] Load feedback and advanced feature implementations only when enabled — registry descriptors
  gate Feedback, Surfaces and TabStrip before their imports (`src/zen/trance/core/TranceCore.mjs:150-175`);
  the shared navigation, material and tab-cache services are created once when Trance activates,
  not lazily per feature (`src/zen/trance/core/TranceCore.mjs:121-140`).
- [x] Make feature setup transactional with automatic rollback — stylesheet acquisition is checked
  and tracked, enabled state commits only after `onEnable()`, and failure releases resources
  (`src/zen/trance/core/TranceFeature.mjs:334-394`; teardown continues through all disposers at
  `:381-419`).
- [x] Prepare matched PGO/LTO release-build generation, provenance validation and comparison
  tooling — the matrix runner is dry by default and refuses heavy execution without its explicit
  switch (`scripts/trance-build-matrix.py:5-10, 27-43`).
- [x] Implement Trance-specific PGO startup, session restore, tab, space, media and extension
  training — the bounded trainer is present and is invoked only by the matrix runner after
  explicit heavy-execution consent (`scripts/trance-pgo-train.py:5-9`).
- [x] Expose ThinLTO/Full LTO, Rust optimisation 2/3, and Apple Silicon compiler-default/M1–M4
  target matrices; comparisons require matched builds and samples and never promote a default
  automatically (`scripts/trance-build-matrix.py:27-43` and
  `docs/trance/phase5-builds.md:34-40`).
- [ ] Produce the matched PGO/LTO builds and run training — no build or training run was taken.
- [ ] Measure ThinLTO versus Full LTO and Rust 2 versus 3 — no measurement was taken.
- [ ] Measure supported Apple Silicon target strategies and replace the `apple-m1` default only
  if results support the change — no measurement was taken.

**Execution boundary:** the startup implementation, rollback fixes, lightweight checks and UI test
build are complete. Release builds, PGO training and measured compiler/CPU decisions are
intentionally **not** claimed as completed. The build runner is dry by default; details are in
[phase5-builds.md](docs/trance/phase5-builds.md), ADR-071 and
[phase5-validation.md](docs/trance/phase5-validation.md).

### Phase 6 — Technical-debt retirement

The fork had 26 upstream touchpoints at the earlier Phase 6 snapshot, against its own target of
roughly 15. The current report is **36**, twenty-one over budget
([UPSTREAM-TOUCHPOINTS.md:10](docs/trance/UPSTREAM-TOUCHPOINTS.md:10)).

Required cleanup, with what was done (2026-09-03, ADR-076 to ADR-078):

- ✅ create one canonical ordered patch manifest with expected base revisions and target hashes — [docs/trance/patch-manifest.json](docs/trance/patch-manifest.json), generated by `scripts/trance-patches.py manifest`: 256 patches in a canonical `(owner rank, path)` order, every target's `base` and `result` blob hash, 1390 symlinked files, declared overlaps, order-sensitive files, dead paths, and a SHA-256 pin plus origin for every external patch.
- ✅ fail import when a declared patch is not reflected in the engine — `patches:verify` runs in `npm run import` and reverse-applies every patch with surfer's own flags. Blob-hash comparison is kept behind `--strict-hashes` as a provenance report: 152 of 256 patches fail it after the Firefox 155 bump and every one of them is correctly applied.
- ✅ eliminate absolute engine symlinks — `patches:relink` runs in `npm run import` and rewrites any symlink under `engine/` that resolves inside the repository to a relative target; `verify` fails on `absolute-link` and `wrong-link`.
- ✅ resolve overlapping patch owners for Cocoa, StaticPrefList, URL bar and configure files — all six are declared with a reason in `KNOWN_OVERLAPS`, an undeclared seventh fails, and the two that are genuinely order-sensitive are computed from the hunk headers and ruled on in `ORDER_RULES` (ADR-078).
- ✅ pin external patches and mods to immutable revisions — external patch bodies are pinned by content hash with their origin recorded; the Sine bootloader, the Sine store and the Zen theme store are pinned to commits; the Sine release is pinned to a tag with a recorded `engine.zip` SHA-256 verified before extraction; every preinstalled mod installs from a commit, which the inventory checker now enforces. `--unpinned` remains as an explicit, loudly announced diagnostic mode.
- ✅ remove unreachable `false &&`, `if (false)`, unconditional-return and disabled-cleanup paths — the ten dead paths the patch set introduces are enumerated in the manifest and ratcheted by `verify` (`new-dead-path`), under the rule *remove a dead path when removing it makes the patch smaller; leave it, recorded, when removing it makes the patch bigger* (ADR-076).
- ✅ restore complete drag-and-drop teardown — three teardown blocks restored; the patch is 28 lines smaller for it (ADR-076).
- ✅ make generated inventories reproducible — `mods-inventory.json` called itself generated and was not. `scripts/trance-inventory.py check` now cross-checks every mechanical field against the owner that decides it, runs in `npm run import`, and found three real drifts.
- ❌ reduce upstream touchpoints to 15 or fewer — **not met, and the number moved further away.**
  The current report is an accurate **36**, not the former understated 32. Five Zen files now
  consume the shared window-activity controller: media, compact mode, Split View, Glance and
  live folders (`src/zen/media/ZenMediaController.mjs:529-594`,
  `src/zen/compact-mode/ZenCompactMode.mjs:134-143`,
  `src/zen/split-view/ZenViewSplitter.mjs:142-160`,
  `src/zen/glance/ZenGlanceManager.mjs:54-73`,
  `src/zen/live-folders/ZenLiveFolder.sys.mjs:31-39`). Those edits are worth their cost because
  they remove five independent hidden-window activity paths in favour of one shared state owner;
  the target of 15 or fewer remains unmet.

One independent patch-integrity pass found substantial root/engine divergence, so this work preceded invasive optimization changes.

## What this pass actually was (23/09/26)

Every phase above was marked complete before today, and the code those marks referred to did
exist. It was not, however, reachable from a running browser.

Ten modules — `TranceFeatureRegistry`, `TranceGlobalPrefs`, `TranceGlobalSheets`, `TranceMaterial`,
`TranceNavigation`, `TranceTabCache`, `TranceThemeState`, `TranceOnboardingSettings`,
`TranceProvision` and `ZenWindowActivity` — were written, reviewed and unit-tested, and were
absent from every `jar.inc.mn`, imported by no code that runs, and in `TranceCore`'s case replaced
by the eager feature array they were meant to retire. Three further claims (the observer hub's
indexed per-root dispatch, the scheduler's idle accounting, and the motion layer's `will-change`
refcount) described behaviour that had never been implemented at all. The check marks were
recording intent rather than state.

The mechanism is worth naming because it is not obvious: a module can be written, imported from
disk by a Node unit test, pass that test, and still be completely absent from the browser. The
unit tests load modules by filesystem path; the browser loads them by `chrome://` URL; nothing
connected the two. Every green signal the project had was real, and none of them was looking at
the packaged product.

That is the same failure as ADR-052 (a policy file in the build and not in the package), ADR-055
(Sine provisioned into the wrong tree) and ADR-058 (a `chrome.manifest` absorbed by the packager)
— *a file being present is not the same as a file being wired* — and it belongs next to them.

The check that catches it: every `chrome://` URL referenced anywhere in `src/` must have a
matching line in a `jar.inc.mn`, and every module that is supposed to run must have an importer
that is not a test. Both are mechanical and neither existed. Until they run in CI, they are a
manual step on every release, alongside Phase 12's rule about asserting against the packaged
artefact rather than the development build.

## Release gates

A release should fail if any of these are unmet:

- Focused idle CPU below `0.5%` of one core in a profiler-off production build.
- Minimized and fully occluded browser CPU approximately zero.
- Zero compositor frames while fully occluded, absent explicit media or OS work.
- Directly measured idle energy no worse than matched stock Zen; the target should be materially better.
- GPU-helper footprint no worse than stock Zen and no unbounded growth after resize/occlusion cycles.
- Ordinary web browsers remain opaque in the performance configuration.
- No full-window filters in the default configuration.
- No default extension or mod without a measured memory, CPU, startup and energy budget.
- No recurring UI timer at idle.
- One or fewer media tickers per active window.
- Tab- and space-switch style flushes below 2 ms.
- Cold-start regression below 100 ms.
- No missing GPU, energy, build-provenance or settling data.
- No disabled feature retaining observers, styles, listeners, animations or scheduled callbacks.

## Recommended first experiments

The fastest high-signal sequence is:

1. Turn transparent content canvases off while changing nothing else.
2. Remove all bundled extensions and Sine independently.
3. Run the four-way material comparison.
4. Disable all large filters and loading/tab blur.
5. Suspend Split View, Glance, media and observers when unfocused.
6. Only then tune Core Animation pools, Gecko process counts and compiler flags.

Those experiments will establish whether Trance’s extra total is primarily alpha/compositor architecture, packaged workload, or both. The static evidence says both are substantial, with transparent content canvases and the default extension stack the two most promising levers.
