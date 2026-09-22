# AUDIT.md Phase 5 validation — 2026-09-02

Startup and rollback implementation is complete. Production PGO/LTO builds,
training and compiler/CPU comparisons remain unrun because this session explicitly
prohibited heavy tasks and full builds. No compiler default or performance result
was promoted.

## Checks performed

| Check | Result |
| --- | --- |
| Actual startup/lifecycle/settings/theme source tests | 16 passing Node test entries; theme entry contains 32 assertions |
| Build-plan/configuration/provenance/seed/comparison tests | 22 passing |
| Browser smoke against UI build | 18 passing checks |
| Targeted ESLint on changed runtime modules | Clean |
| Matrix plan only | 8 final rows, 4 instrumentation groups, 12 mozconfigs; no builds |
| `bun run build:ui` | Successful, approximately 40 seconds; existing Gecko objdir |

The browser smoke starts with completed onboarding and disabled feedback/surfaces.
It verifies those implementations and first-run/theme UI are absent, then enables
feedback/surfaces live, opens the real theme popup with controls ready immediately,
toggles theme off/on, reruns onboarding, disables it mid-flow, and disables and
reenables the entire Trance layer. No profiler, energy workload, release build or
full mochitest suite runs.

The lightweight lifecycle tests additionally inject setup/cleanup failures, check
partial stylesheet/token acquisition, constructor failure, reentrant disable,
shared-pref dependency ordering, and navigation/cache listener release. The theme
checks preserve saved rendering and opacity bounds independently of the UI. Settings
checks exercise process-wide ownership, channel/architecture changes and serialized
mod-engine writes without loading onboarding UI.

## Reproduce lightweight checks

```sh
source scripts/trance-env.sh
node --experimental-vm-modules --test src/zen/trance/tests/*.test.mjs
python3 -B scripts/trance-build-matrix-test.py
python3 scripts/trance-build-matrix.py plan --work-dir /tmp/trance-phase5-build-plan
```

With an existing macOS arm64 UI build, before provisioning Sine:

```sh
python3 scripts/trance-startup-smoke.py
```

The smoke creates and closes its own isolated profile. Its output is
`/tmp/trance-phase5-smoke-result.json`; browser output is
`/tmp/trance-phase5-smoke-browser.log`. It imports the existing Marionette wire
client, not the performance harness's workloads. This is a correctness smoke, not
a performance scorecard.

## Existing build limitations

`bun run import` copied the source files, including every new phase-5 module,
then failed applying the already-modified Phase 4
`src/browser/components/sessionstore/SessionStartup-sys-mjs.patch` against the
existing engine. The failure is retained in `/tmp/trance-phase5-import.log`.
The subsequent UI build succeeded and the phase-5 modules were exercised from it.
No manual edits were made to generated engine sources.

The quick build retains the existing compiled Gecko implementation. It cannot
validate pending native Phase 4 changes or the release experiment runner's heavy
paths. Browser logs also contain existing missing Boosts/Glance actor resources and
Remote Settings/shutdown messages; the Trance startup checks pass. The source/engine
patch divergence belongs to AUDIT Phase 6 and was not silently marked repaired.

`git diff --check` reports a pre-existing trailing space in `CLAUDE.md`, which this
session leaves untouched. Validation is scoped to the phase-5 files. Existing
uncommitted changes from earlier phases remain in the workspace.

See [build experiments](phase5-builds.md) for the unrun production matrix and
[ADR-069–071](DECISIONS.md) for startup, rollback and build decisions.
