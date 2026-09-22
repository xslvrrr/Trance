# AUDIT phase 5 — build experiment tooling

Implemented planning, staged execution and validation tooling. **No configure,
build, PGO training or benchmark was run for this change. No target, LTO or Rust
default is promoted.** Production experiments remain open in AUDIT.md.

This is the build portion of AUDIT phase 5, separate from TRANCE.md's original
Phase 5 chrome work. Lazy imports and transactional feature setup belong to the
other phase-5 work and are not changed here.

## Files and ownership

- `scripts/trance-build-matrix.py`: stdlib-only planner, explicit stage runner,
  provenance checks and comparison of externally collected samples.
- `scripts/trance-pgo-train.py`: disposable-profile training workload, called only
  by the stage runner. Independent of `trance-perf.py`.
- `scripts/trance-build-matrix-test.py`: plan and validation unit tests only.
- This runbook.

**Upstream touchpoints: zero for build tooling.** Neither existing mozconfig is
edited. The planner renders external configurations; execution uses separate
object directories. ADR-071 records the decision and pending measurements.

## Local API evidence

Inspected the actual imported Gecko tree and installed surfer, not flags inferred
from another Firefox version. The planner records hashes of these API sources and
rejects a changed plan; regenerate after reviewing upstream changes.

| Local source | Contract used |
| --- | --- |
| `node_modules/@zen-browser/surfer/dist/commands/build.js` | Template substitution, common/macOS/custom/internal config order; surfer normally writes `engine/mozconfig` and version files even with `SURFER_MOZCONFIG_ONLY`. This tool does not call surfer. |
| `node_modules/@zen-browser/surfer/dist/constants/mozconfig.js` | Trance branding, update channel, MAR channels, Firefox base version, bundle name. Release options already come from the common template. |
| `engine/build/moz.configure/lto-pgo.configure` | `--enable-profile-generate=cross`, `--enable-profile-use=cross`, absolute existing `--with-pgo-profile-path`, `--with-pgo-jarlog`, `--enable-lto=cross,thin` / `cross,full`. Gecko disables LTO during instrumentation. |
| `engine/build/moz.configure/rust.configure` | `RUSTC_OPT_LEVEL` produces `CARGO_PROFILE_RELEASE_OPT_LEVEL`; cross-language PGO generates and consumes Rust profiles too. Rust's default optimization level is 2. |
| `engine/build/moz.configure/toolchain.configure` | `--enable-linker=lld`. Avoid asserting that Apple's ld64 is bug-free via `MOZ_LD64_KNOWN_GOOD`. Configure still validates linker compatibility. |
| `engine/python/mozbuild/mozbuild/build_commands.py` | Separate `mach configure`, `mach build`, `mach package`; do not pass `MOZ_PGO=1`, which invokes Gecko's automatic training loop. |
| `engine/python/mozbuild/mozbuild/mozconfig.py` | External `MOZCONFIG` and `mk_add_options MOZ_OBJDIR=...`. |
| `engine/python/mozbuild/mozbuild/base.py` | Staged macOS binary is `obj/dist/<app>/<bundle>/Contents/MacOS/<app>`. |
| `engine/build/pgo/profileserver.py` | Absolute `LLVM_PROFILE_FILE` with `%p` and `%m`, `MOZ_JAR_LOG_FILE`, `llvm-profdata merge -o`, and nonempty-output checks. |
| `engine/remote/marionette/driver.sys.mjs` | NewSession, SetContext, ExecuteAsyncScript, Navigate and Quit with `eAttemptQuit`. |
| `src/zen/spaces/ZenSpaceManager.mjs` | `getWorkspaces()`, `createAndSaveWorkspace(name, icon, dontChange)`, `changeWorkspace(workspace)`. |
| SessionStore/SessionSaver and `browser-init.js` | Startup promise, saved tab state, explicit session save, fresh-process restore. |

Read-only compiler discovery on this machine returned Clang **21.1.8** and
llvm-profdata **21.1.8**. `clang --target=aarch64-apple-darwin -mcpu=help` listed
`apple-m1` through `apple-m4`. This confirms accepted CPU names, not performance or
compatibility on older generations. No compiler invocation compiled source.

## Plan and dry-run

Use Python 3.11. Paths used in mozconfigs must be absolute and contain no spaces
or shell/make metacharacters. Run from the repo root:

```sh
python3 scripts/trance-build-matrix.py plan \
  --work-dir /tmp/trance-phase5
```

Default output is JSON on stdout, with **no filesystem changes**. It contains eight
final rows: Thin/Full cross-language LTO × Rust 2/3 × C/C++ CPU `apple-m1`/compiler
default. Four instrumented groups supply those eight rows. Rust target CPU remains
Gecko's default in every row, explicitly recorded. `default` removes the macOS
template's C/C++ `-mcpu=apple-m1` assignment; it does not assume what Clang's
effective default CPU is, or change the target triple. Never use `-mcpu=native`.

To materialize only the plan and configs into a **new external directory**:

```sh
python3 scripts/trance-build-matrix.py plan \
  --work-dir /tmp/trance-phase5 \
  --seed /tmp/trance-pgo-seed --media /tmp/trance-training.mp4 --write

python3 scripts/trance-build-matrix.py run \
  --plan /tmp/trance-phase5/plan.json \
  --row apple-m1-r2-thin --stage generate
```

`run` without `--execute-heavy` only prints the stage, underlying commands and the
explicit opt-in command. No PGO artifacts or built binary need exist to inspect
these commands. `--cpus apple-m1 default apple-m2 apple-m3 apple-m4`, `--rust 2 3`
and `--lto thin full` select additional rows; avoid the expanded matrix until a
smaller experiment earns its cost.

## Heavy execution — intentionally not performed

Preconditions: native macOS arm64; imported source already prepared; repo-pinned
Python and Rust installed; compatible Clang/llvm-profdata/Rust LLVM majors;
`ld64.lld` beside Clang; release dependencies and SDK available; sufficient disk;
closed disposable seed; local MP4/WebM clip with at least five seconds of video.
Source preparation, downloading dependencies and provisioning the seed are manual
prerequisites. Existing `engine/` source links are supported, not removed.

The opt-in runner uses the existing common and macOS release templates. It disables
their automatic LTO and fixed `$HOME/artifact` PGO selection, then supplies the
experiment's flags. An isolated environment removes ambient PGO, optimization,
target and profiler overrides. Existing root `mozconfig` and surfer dynamic mode
are deliberately not inherited. This produces controlled experiments, not a claim
of byte-for-byte equivalence to arbitrary local release builds.

Run each stage explicitly, only after authorizing heavy work:

```sh
python3 scripts/trance-build-matrix.py run --plan /tmp/trance-phase5/plan.json \
  --row apple-m1-r2-thin --stage generate --execute-heavy
python3 scripts/trance-build-matrix.py run --plan /tmp/trance-phase5/plan.json \
  --row apple-m1-r2-thin --stage train --execute-heavy
python3 scripts/trance-build-matrix.py run --plan /tmp/trance-phase5/plan.json \
  --row apple-m1-r2-thin --stage use --execute-heavy
python3 scripts/trance-build-matrix.py run --plan /tmp/trance-phase5/plan.json \
  --row apple-m1-r2-full --stage use --execute-heavy
```

`generate` and `use` each configure, validate `config/autoconf.mk`, build, and package
in a fresh external objdir. `use` requires the exact generated bundle, successful
training receipt, profile and jarlog. Configure, build and package logs are kept
separately. The staged `.app` is hashed, including resources; hashing only the small
launcher would miss Gecko and the chrome payload. Packaging can require additional
tools and release configuration can bootstrap dependencies: both are heavy actions.

No resume, clobber, cleanup or concurrent execution is implicit. A failed stage
retains its logs but receives no successful receipt. Start another external matrix
directory after correcting the cause. An interrupted runner may leave `.running`;
inspect the PID and processes before any manual cleanup. Each row can consume tens
of GB. Nothing deletes old object directories for you.

## Training contract

Create a **dedicated disposable** browser profile with the seven policy extensions
installed and initialized, no browsing data and no extra active extensions. Close
it before using it as a seed; never pass a personal profile. Add
`trance-pgo-seed.json` containing:

```json
{
  "disposable": true,
  "extensions": {
    "uBlock0@raymondhill.net": "ACTUAL_INSTALLED_VERSION"
  }
}
```

The example is abbreviated: include all seven actual IDs from
`src/zen/trance/distribution/policies.json`, each with its installed version. Missing
IDs, extra IDs, missing versions, symlinks and profile locks are rejected. The source
seed is hashed and copied, never launched or edited. Its copied `user.js` is retained
with explicit training overrides appended. All groups require identical seed/media
hashes. Extension versions and active states are checked before and after workloads;
the check also rejects additional active non-system extensions.

Training exercises two fresh browser processes against the same copied profile:

1. Wait for browser/space startup with Trance enabled and onboarding completed.
2. Open, select, load, scroll and interact with twelve distinct local article tabs.
3. Ensure two spaces, switch eight times and record their identities.
4. Play supplied local video for five seconds, asserting advancing time and decoded
   frames; pause it.
5. Save twelve distinct article URLs, shut down cleanly, restart and assert restored
   tab URLs and workspace identities. Check extension state again and shut down.
6. Require raw profiles from both launches, no LLVM profile errors or crash dumps,
   warning-free merge, nonempty merged profile and both jar access logs.

The local HTTP server remains alive across restore. It serves only the generated
articles and supplied media, bound to loopback. Server ports vary and are not target
strategies. Assertions never turn missing work into a “skipped” success.

This is initialized-profile startup and restore training, not first-run extension
installation or cold-filesystem-cache measurement. Site-specific extension paths
(e.g. YouTube) and the general Speedometer/JetStream corpus are not covered. Browser
background services can still use the network; the runner does not claim a hermetic
network sandbox. Extension version drift invalidates training. Cosine remote mod
provisioning is excluded and a staged autoconfig bootloader is rejected. A complete
shipped-product experiment must separately cover the chosen mod payload and broader
web workloads. No third-party XPI or media is vendored.

## Provenance and validity boundaries

Before heavy execution the runner freezes repo and engine Git revisions/diffs,
nonignored untracked files, verified imported Zen source and generated prefs, plus
toolchain discovery. Surfer's absolute import symlinks are byte-checked against
`src/zen`, then the canonical source tree is hashed. Patches are not reapplied by this
tool; the separately fingerprinted imported engine is the actual build input. The
runner does not certify arbitrary ignored files or external dependency contents.

Any source/toolchain change between stages invalidates the matrix; a source change
during a stage prevents its receipt. Dirty source is allowed only as one frozen
experiment. This is unsuitable while another task is still editing the tree. No
claim is made that the clean revision alone represents a dirty build. Config and
training receipts bind the instrumented bundle, input hashes and generated profile;
build receipts explicitly say `performance_validated: false`.

Native execution, generation-specific compatibility, configure/link success,
cross-language profile coverage, UI workload execution, signing/notarization and
the final packaged application have **not** been runtime-validated in this change.
The runner is experimental infrastructure whose first heavy use must inspect logs
and receipts. It does not implement matched stock-Zen builds or production CI.

## Comparing existing measurements

`compare` consumes externally collected samples; it launches no benchmark and does
not change defaults. Compare exactly one axis at a time. Each sample is an object
in a JSON array with:

- `row`, `trial` (positive integer), `valid: true`, `profiler: false`;
- `receipt_sha256`: SHA-256 of canonical JSON of that row's use receipt (sorted keys,
  compact separators, as `digest(canonical(receipt))` in the tool);
- `context`: nonempty strings `host_id`, `generation` (`M1`–`M4`), `os`, `power_mode`,
  `thermal_state`, `workload_sha256`, `payload_sha256`;
- `metrics`: finite positive values for `startup_ms`, `restore_ms`, `tabs_ms`,
  `spaces_ms`, `media_joules`, `idle_joules`, `phys_footprint_mb`, `package_bytes`.

```sh
python3 scripts/trance-build-matrix.py compare \
  --plan /tmp/trance-phase5/plan.json --measurements /tmp/samples.json \
  --baseline apple-m1-r2-thin --candidate apple-m1-r2-full
```

The summary requires at least three paired trials **per identical host/context**,
rejects duplicates, unmatched builds, missing metrics and drift, and reports medians,
paired percentage changes and their observed range. It lists untested generations
and always reports `promoted: false`. It does not infer statistical significance.

**Three trials is an exploratory summary floor, not AUDIT Phase 0 production
acceptance.** Use Phase 0's required repetition count, randomized ordering, settling,
energy/GPU completeness, process reconciliation, thermal/power controls and
statistical gates before any production decision. These records are caller-supplied
measurement attestations, not proof the metrics were collected correctly. Preserve
raw samples and instrument output. For CPU strategy decisions run comparable pairs
on every supported generation; a successful M4 run cannot establish M1 compatibility.

## Lightweight verification

```sh
python3 -B scripts/trance-build-matrix-test.py
```

The suite checks local API discovery, deterministic plans, external output paths,
effective shell mozconfigs with inert option handlers, stage sharing/isolation,
explicit execution gating, imported source symlinks, seed validation, configure
rejection and paired-comparison validity. It invokes no mach command, compiler
build, browser, training loop or benchmark. Browser/core smoke tests from the other
phase-5 work do not validate this runner's heavy paths.

Verified 2026-09-02 with Python 3.11: **22 tests pass**. CLI materialization and all
three stage dry-runs pass: eight final rows, four instrumented groups, twelve
mozconfigs, no objdirs or receipts created. Python syntax checks pass. No heavy
execution was performed.
