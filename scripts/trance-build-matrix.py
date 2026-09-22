#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Trance AUDIT phase 5: native Apple Silicon build experiments, dry by default.

No import, bootstrap, build, browser or benchmark is launched by `plan`.
`run` also only describes work unless --execute-heavy is supplied.
See docs/trance/phase5-builds.md for the intentionally bounded validity contract.
"""

import argparse
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import platform
import re
import shlex
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
TARGET = "aarch64-apple-darwin"
SCHEMA = 1
API_FILES = {
    "engine/build/moz.configure/lto-pgo.configure": [
        '"--enable-profile-generate"', '"--enable-profile-use"',
        '"--with-pgo-profile-path"', '"--with-pgo-jarlog"',
        'choices=("full", "thin", "cross")',
        'log.warning("Disabling LTO because --enable-profile-generate is specified")',
    ],
    "engine/build/moz.configure/rust.configure": [
        'env="RUSTC_OPT_LEVEL"', 'set_config("CARGO_PROFILE_RELEASE_OPT_LEVEL"',
    ],
    "engine/build/moz.configure/toolchain.configure": ['"--enable-linker"'],
    "engine/build/pgo/profileserver.py": [
        'env["LLVM_PROFILE_FILE"]', 'env["MOZ_JAR_LOG_FILE"]', '"merge"',
    ],
    "engine/python/mozbuild/mozbuild/base.py": ['where == "staged-package"'],
    "engine/python/mozbuild/mozbuild/build_commands.py": ['"configure"', '"package"'],
    "engine/python/mozbuild/mozbuild/mozconfig.py": ['"MOZ_OBJDIR"'],
    "engine/remote/marionette/driver.sys.mjs": [
        '"WebDriver:NewSession"', '"WebDriver:ExecuteAsyncScript"',
        '"WebDriver:Navigate"', '"Marionette:Quit"', '"Marionette:SetContext"',
    ],
    "engine/browser/base/content/browser-init.js": ["var delayedStartupPromise"],
    "engine/browser/components/sessionstore/SessionStore.sys.mjs": ["getBrowserState"],
    "engine/browser/components/sessionstore/SessionSaver.sys.mjs": ["SessionSaver"],
    "src/zen/spaces/ZenSpaceManager.mjs": [
        "createAndSaveWorkspace(", "async changeWorkspace(", "getWorkspaces(",
    ],
    "node_modules/@zen-browser/surfer/dist/commands/build.js": [
        "commonConfig +", "osConfig +", "customConfig +", "SURFER_MOZCONFIG_ONLY",
    ],
    "node_modules/@zen-browser/surfer/dist/constants/mozconfig.js": [
        "--with-branding=browser/branding/", "--enable-update-channel=",
    ],
    "node_modules/@zen-browser/surfer/dist/utils/string-template.js": ["stringTemplate"],
    "configs/common/mozconfig": ['if ! test "$ZEN_DISABLE_LTO"'],
    "configs/macos/mozconfig": ['if ! test "$ZEN_GA_DISABLE_PGO"', '-mcpu=apple-m1'],
    "scripts/trance-build-matrix.py": [],
    "scripts/trance-pgo-train.py": [],
    "surfer.json": [], ".rust-toolchain": [], ".python-version": [],
}
METRICS = ("startup_ms", "restore_ms", "tabs_ms", "spaces_ms", "media_joules",
           "idle_joules", "phys_footprint_mb", "package_bytes")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def tree_hash(path):
    """Content, relative paths, symlink destinations and executable bits."""
    root = Path(path)
    require(root.is_dir(), f"Missing directory: {root}")
    items = []
    for item in sorted(root.rglob("*")):
        rel = item.relative_to(root).as_posix()
        if item.is_symlink():
            require(item.resolve().is_relative_to(root.resolve()),
                    f"External symlink in payload: {item}")
            items.append((rel, "link", os.readlink(item)))
        elif item.is_file():
            items.append((rel, item.stat().st_mode & 0o111, file_hash(item)))
    require(items, f"Empty directory: {root}")
    return digest(canonical(items))


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    # Exclusive creation: an interrupted experiment is never silently resumed.
    with Path(path).open("x") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")


def capture(argv, cwd=ROOT):
    return subprocess.check_output(argv, cwd=cwd, stderr=subprocess.STDOUT).decode().strip()


def api_evidence(root):
    result = {}
    for name, tokens in API_FILES.items():
        path = root / name
        content = path.read_text()
        require(all(token in content for token in tokens),
                f"Local API changed; inspect before regenerating plan: {name}")
        result[name] = file_hash(path)
    return result


def safe_path(value):
    path = Path(value).expanduser().resolve()
    # Paths enter both shell mozconfigs and make variables. Spaces/dollar signs
    # have different semantics there; refuse rather than imperfectly escape.
    require(re.fullmatch(r"[/A-Za-z0-9_.+-]+", str(path)),
            f"Use a path without whitespace or shell/make metacharacters: {path}")
    return path


def variants(cpus, rust_levels, ltos):
    require(cpus and len(cpus) == len(set(cpus)), "Duplicate/empty CPU list")
    require(all(x == "default" or re.fullmatch(r"apple-m[1-4]", x) for x in cpus),
            "Supported strategies: default, apple-m1 through apple-m4; no native target")
    require(rust_levels and len(rust_levels) == len(set(rust_levels))
            and set(rust_levels) <= {2, 3}, "Rust optimization must be 2 or 3, without duplicates")
    require(ltos and len(ltos) == len(set(ltos)) and set(ltos) <= {"thin", "full"},
            "LTO must be thin or full, without duplicates")
    return [{"id": f"{cpu}-r{rust}-{lto}", "group": f"{cpu}-r{rust}",
             "cpu": cpu, "rust": rust, "lto": lto}
            for cpu, rust, lto in itertools.product(cpus, rust_levels, ltos)]


def render_config(root, plan, row, stage):
    identity = read_json(root / "surfer.json")
    require(identity["binaryName"] == "trance" and "trance" in identity["brands"],
            "This renderer requires the Trance brand")
    variables = {"name": identity["name"], "vendor": identity["name"],
                 "appId": identity["appId"], "binName": identity["binaryName"],
                 "brandingDir": "browser/branding/trance", "changeset": plan["revision"]}
    text = "\n".join((root / f"configs/{part}/mozconfig").read_text()
                     for part in ("common", "macos"))
    for key, value in variables.items():
        require(re.fullmatch(r"[A-Za-z0-9_./+-]+", value), f"Unsafe template value: {key}")
        text = text.replace("${" + key + "}", value)
    base = Path(plan["work_dir"])
    unit = row["group"] if stage == "generate" else row["id"]
    obj = base / unit / stage / "obj"
    training = base / row["group"] / "train"
    flags = "" if row["cpu"] == "default" else f"-mcpu={row['cpu']}"
    # Prefix selects the existing release semantics, excluding its fixed-path
    # PGO and LTO selection. Suffix owns the experiment's only varying flags.
    prefix = """# Generated by Trance build matrix; do not hand-edit.
export ZEN_RELEASE=1
export ZEN_DISABLE_LTO=1
export ZEN_GA_DISABLE_PGO=1
unset ZEN_CROSS_COMPILING SURFER_COMPAT ZEN_GA_GENERATE_PROFILE
"""
    suffix = [
        f"mk_add_options MOZ_OBJDIR={obj}",
        f"export CC={plan['clang']}",
        f"export CXX={Path(plan['clang']).with_name('clang++')}",
        f"export LLVM_PROFDATA={plan['profdata']}",
        f"export RUSTUP_TOOLCHAIN={plan['rust_pin']}",
        f"export RUSTC_OPT_LEVEL={row['rust']}",
        f'export CFLAGS="{flags}"', f'export CXXFLAGS="{flags}"',
        "ac_add_options --enable-linker=lld",
        "ac_add_options --with-branding=browser/branding/trance",
        "ac_add_options --enable-update-channel=trance",
        "export ACCEPTED_MAR_CHANNEL_IDS=trance", "export MAR_CHANNEL_ID=trance",
        "mk_add_options ACCEPTED_MAR_CHANNEL_IDS=trance",
        f"export ZEN_FIREFOX_VERSION={identity['version'].get('candidate') or identity['version']['version']}",
        f"export MOZ_APPUPDATE_HOST={shlex.quote(identity['updateHostname'])}",
        'export MOZ_MACBUNDLE_NAME="Trance.app"',
    ]
    if stage == "generate":
        suffix += ["ac_add_options --disable-lto", "ac_add_options --enable-profile-generate=cross"]
    else:
        suffix += [f"ac_add_options --enable-lto=cross,{row['lto']}",
                   "ac_add_options --enable-profile-use=cross",
                   f"ac_add_options --with-pgo-profile-path={training / 'merged.profdata'}",
                   f"ac_add_options --with-pgo-jarlog={training / 'en-US.log'}"]
    return prefix + text + "\n\n# Trance experiment overrides\n" + "\n".join(suffix) + "\n"


def make_plan(root, work, cpus, rust_levels, ltos, clang, profdata, seed, media):
    require(not work.is_relative_to(root) and not root.is_relative_to(work),
            "Object/output directory must be outside the checkout")
    plan = {"schema": SCHEMA, "root": str(root), "work_dir": str(work),
            "revision": capture(["git", "rev-parse", "HEAD"], root),
            "target": TARGET, "rust_pin": (root / ".rust-toolchain").read_text().strip(),
            "python_pin": (root / ".python-version").read_text().strip(),
            "clang": str(clang), "profdata": str(profdata),
            "seed": str(seed) if seed else None, "media": str(media) if media else None,
            "apis": api_evidence(root), "rows": variants(cpus, rust_levels, ltos),
            "status": "unmeasured", "rust_cpu": "Gecko default (held constant)"}
    plan["configs"] = {}
    for row in plan["rows"]:
        for stage in ("generate", "use"):
            unit = row["group"] if stage == "generate" else row["id"]
            key = f"{unit}/{stage}.mozconfig"
            plan["configs"][key] = render_config(root, plan, row, stage)
    plan["id"] = digest(canonical(plan))
    return plan


def verify_plan(plan):
    require(plan["schema"] == SCHEMA, "Unsupported plan schema")
    require(plan["id"] == digest(canonical({k: v for k, v in plan.items() if k != "id"})),
            "Plan changed; regenerate instead of editing it")
    root = Path(plan["root"])
    require(api_evidence(root) == plan["apis"], "Source/API/config/tooling changed since plan")
    require(capture(["git", "rev-parse", "HEAD"], root) == plan["revision"], "Revision changed")


def stage_paths(plan, row, stage):
    unit = row["id"] if stage == "use" else row["group"]
    return Path(plan["work_dir"]) / unit / stage


def describe(plan, row, stage):
    path = stage_paths(plan, row, stage)
    config = path.parent / f"{stage}.mozconfig"
    execution = [sys.executable, str(Path(plan["root"]) / "scripts/trance-build-matrix.py"),
                 "run", "--plan", str(Path(plan["work_dir"]) / "plan.json"),
                 "--row", row["id"], "--stage", stage, "--execute-heavy"]
    if stage == "train":
        commands = [execution]
    else:
        commands = [[sys.executable, str(Path(plan["root"]) / "engine/mach"), command]
                    for command in ("configure", "build", "package")]
    return {"stage": stage, "directory": str(path), "cwd": str(Path(plan["root"]) / "engine"),
            "mozconfig": str(config) if stage != "train" else None,
            "commands": commands, "execute_command": execution, "executes": False,
            "requires": "--execute-heavy; see runbook for prerequisites"}


def git_snapshot(root):
    """Heavy opt-in provenance. Git tracked content + nonignored untracked files.

    Git's clean tracked files are covered by HEAD. Ignored imported Zen/prefs
    are explicitly added by source_snapshot below. No objdir is traversed.
    """
    h = hashlib.sha256()
    h.update(capture(["git", "rev-parse", "HEAD"], root).encode())
    with subprocess.Popen(["git", "diff", "--no-ext-diff", "--binary", "HEAD"],
                          cwd=root, stdout=subprocess.PIPE) as proc:
        for block in iter(lambda: proc.stdout.read(1024 * 1024), b""):
            h.update(block)
        require(proc.wait() == 0, "git diff failed")
    names = subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=root)
    for name in sorted(filter(None, names.split(b"\0"))):
        path = root / os.fsdecode(name)
        h.update(name)
        h.update((os.readlink(path) if path.is_symlink() else file_hash(path)).encode())
    return h.hexdigest()


def source_snapshot(root):
    # Imported Trance/Zen source must match what was reviewed. Patch application
    # is not reproduced here; the separate engine fingerprint is authoritative.
    for src in (root / "src/zen").rglob("*"):
        if src.is_file() and src.suffix != ".patch":
            dst = root / "engine/zen" / src.relative_to(root / "src/zen")
            require(dst.is_file() and file_hash(src) == file_hash(dst), f"Stale import: {dst}")
    return {"repo": git_snapshot(root), "engine": git_snapshot(root / "engine"),
            # Surfer intentionally imports absolute symlinks into src/zen.
            # Bytes were verified above; hash the canonical source tree rather
            # than treating the importer's links as an escaping build payload.
            "imported_zen": tree_hash(root / "src/zen"),
            "generated_prefs": file_hash(root / "engine/browser/app/profile/zen.js")}


def clean_environment():
    # Keep host/toolchain discovery, remove ambient build/profile configuration.
    keep = ("PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SHELL", "LANG", "LC_ALL",
            "TERM", "DEVELOPER_DIR", "SSH_AUTH_SOCK")
    return {key: os.environ[key] for key in keep if key in os.environ}


def toolchain(plan):
    require(platform.system() == "Darwin" and platform.machine() == "arm64",
            "Execution supports native Apple Silicon only")
    require(f"{sys.version_info.major}.{sys.version_info.minor}" == plan["python_pin"],
            f"Run with Python {plan['python_pin']}")
    result = {}
    for name, args in {
        "clang": [plan["clang"], "--version"],
        "profdata": [plan["profdata"], "--version"],
        "rust": ["rustup", "run", plan["rust_pin"], "rustc", "-vV"],
        "cargo": ["rustup", "run", plan["rust_pin"], "cargo", "--version"],
        "linker": [str(Path(plan["clang"]).with_name("ld64.lld")), "--version"],
        "sdk": ["xcrun", "--show-sdk-path"],
    }.items():
        result[name] = capture(args)
    clang_major = re.search(r"clang version (\d+)", result["clang"])
    require(clang_major is not None, "Cannot identify Clang version")
    major = clang_major[1]
    require(f"LLVM version {major}." in result["profdata"]
            and f"LLVM version: {major}." in result["rust"],
            "Cross-language PGO/LTO requires matching LLVM majors in this experiment")
    require(f"release: {plan['rust_pin']}" in result["rust"], "Wrong Rust toolchain")
    cpus = capture([plan["clang"], f"--target={TARGET}", "-mcpu=help"])
    for row in plan["rows"]:
        require(row["cpu"] == "default" or re.search(r"\b" + row["cpu"] + r"\b", cpus),
                f"CPU unsupported by actual Clang: {row['cpu']}")
    result["cpu_support"] = digest(cpus.encode())
    result["clang_sha256"] = file_hash(plan["clang"])
    result["profdata_sha256"] = file_hash(plan["profdata"])
    return result


def parse_autoconf(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        match = re.fullmatch(r"([A-Za-z_][A-Za-z_0-9]*) = (.*)", line)
        if match:
            values[match[1]] = match[2]
    require(values.get("MOZ_BUILD_APP") == "browser", "Missing browser configure output")
    return values


def validate_config(values, row, stage, profile=None):
    require(values.get("target") == TARGET, "Wrong configured target")
    require(values.get("MOZ_OPTIMIZE") == "1" and not values.get("MOZ_DEBUG")
            and not values.get("MOZ_DEBUG_SYMBOLS"), "Not an optimized, symbol-free release config")
    require(values.get("MOZILLA_OFFICIAL") == "1", "MOZILLA_OFFICIAL missing")
    require(values.get("CARGO_PROFILE_RELEASE_OPT_LEVEL") == str(row["rust"]), "Rust opt level mismatch")
    require(values.get("MOZ_APP_NAME") == "trance"
            and values.get("MOZ_UPDATE_CHANNEL") == "trance", "Wrong brand/channel")
    require(values.get("MOZ_PGO_RUST") == "1", "Cross-language PGO missing")
    for name in ("OS_CFLAGS", "OS_CXXFLAGS"):
        cpus = re.findall(r"-mcpu=([^\s]+)", values.get(name, ""))
        require(cpus == ([] if row["cpu"] == "default" else [row["cpu"]]),
                f"Configured CPU strategy mismatch in {name}")
    if stage == "generate":
        require(values.get("MOZ_PROFILE_GENERATE") == "1" and not values.get("MOZ_PROFILE_USE")
                and not values.get("MOZ_LTO"), "Expected instrumented build without LTO")
    else:
        require(values.get("MOZ_PROFILE_USE") == "1" and not values.get("MOZ_PROFILE_GENERATE"),
                "Expected PGO-use build")
        require(values.get("MOZ_LTO") == "1" and values.get("MOZ_LTO_RUST_CROSS") == row["lto"],
                "Configured LTO differs from matrix")
        require(values.get("PGO_PROFILE_PATH") == str(profile), "Unexpected PGO profile")


def load_receipt(plan, row, stage):
    path = stage_paths(plan, row, stage) / "receipt.json"
    receipt = read_json(path)
    require(receipt.get("plan_id") == plan["id"] and receipt.get("stage") == stage,
            f"Receipt belongs to another experiment: {path}")
    require(receipt.get("row") == (row["id"] if stage == "use" else row["group"]),
            "Receipt belongs to another row/group")
    if stage != "train":
        require(tree_hash(receipt["bundle"]) == receipt["bundle_sha256"], "Build artifact changed")
    else:
        for name in ("merged.profdata", "en-US.log"):
            require(file_hash(path.parent / name) == receipt["artifacts"][name], "Training artifact changed")
    return receipt


def run_stage(plan, row, stage, execute=False):
    verify_plan(plan)
    if not execute:
        return describe(plan, row, stage)
    root = Path(plan["root"])
    work = Path(plan["work_dir"])
    require(read_json(work / "plan.json") == plan, "Plan must be materialized first")
    with (work / ".running").open("x") as lock:
        lock.write(str(os.getpid()))
    try:
        environment = clean_environment()
        environment["RUSTUP_TOOLCHAIN"] = plan["rust_pin"]
        # Explicit paths prevent rustup's unrelated default from winning.
        environment["RUSTC"] = capture(["rustup", "which", "--toolchain", plan["rust_pin"], "rustc"])
        environment["CARGO"] = capture(["rustup", "which", "--toolchain", plan["rust_pin"], "cargo"])
        frozen = {"source": source_snapshot(root), "toolchain": toolchain(plan)}
        freeze_file = work / "frozen.json"
        if freeze_file.exists():
            require(read_json(freeze_file) == frozen, "Source/toolchain changed; start a new matrix")
        else:
            write_json(freeze_file, frozen)
        path = stage_paths(plan, row, stage)
        require(not path.exists(), f"Stage already attempted; create a new matrix: {path}")
        dependencies = {}
        if stage in ("train", "use"):
            dependencies["generate"] = load_receipt(plan, row, "generate")
        if stage == "use":
            dependencies["train"] = load_receipt(plan, row, "train")
            require(dependencies["train"]["dependencies"]["generate"] ==
                    digest(canonical(dependencies["generate"])), "Training/build dependency mismatch")
        if stage == "train":
            # Training code returns only after clean shutdowns, workload
            # assertions, raw-profile merge and jarlog validation.
            import importlib.util
            spec = importlib.util.spec_from_file_location("trance_pgo_train", root / "scripts/trance-pgo-train.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            receipt = module.train(plan, row, dependencies["generate"], path, environment)
        else:
            path.mkdir(parents=True)
            config_key = f"{path.parent.name}/{stage}.mozconfig"
            config = path.parent / f"{stage}.mozconfig"
            require(config.read_text() == plan["configs"][config_key], "Generated mozconfig changed")
            environment["MOZCONFIG"] = str(config)
            start = time.monotonic()
            for command in ("configure", "build", "package"):
                with (path / f"{command}.log").open("xb") as log:
                    subprocess.run([sys.executable, str(root / "engine/mach"), command],
                                   cwd=root / "engine", env=environment,
                                   stdout=log, stderr=subprocess.STDOUT, check=True)
                if command == "configure":
                    values = parse_autoconf(path / "obj/config/autoconf.mk")
                    validate_config(values, row, stage,
                                    stage_paths(plan, row, "train") / "merged.profdata")
                    require(values.get("RUSTC_VERSION") == plan["rust_pin"], "Configured Rust version changed")
                    require(Path(shlex.split(values["CC"])[0]).resolve() == Path(plan["clang"]).resolve(),
                            "Configure selected a different Clang")
                if stage == "use":
                    with (path / f"{command}.log").open(errors="replace") as log:
                        for line in log:
                            require(not re.search(r"(?i)(profile.*(?:mismatch|out.of.date|missing|malformed)|"
                                                  r"(?:mismatch|malformed).*profile|LLVM Profile Error)", line),
                                    "PGO-use log reports invalid profile data; inspect log")
            # MozbuildObject.get_binary_path(where="staged-package").
            bundle = path / "obj/dist/trance/Trance.app"
            require((bundle / "Contents/MacOS/trance").is_file(), "Missing staged Trance executable")
            policy = bundle / "Contents/Resources/distribution/policies.json"
            require(policy.is_file() and file_hash(policy) ==
                    file_hash(root / "src/zen/trance/distribution/policies.json"),
                    "Packaged extension policy missing or different from reviewed source")
            # Reject provisioned mutable remote bootloaders in this controlled matrix.
            require(not (bundle / "Contents/Resources/config.js").exists(),
                    "Unexpected Cosine provisioning; controlled matrix excludes remote mods")
            receipt = {"bundle": str(bundle), "bundle_sha256": tree_hash(bundle),
                       "configure": values, "build_seconds": time.monotonic() - start,
                       "config_sha256": file_hash(config)}
        require(source_snapshot(root) == frozen["source"], "Source changed during stage; result invalid")
        receipt.update({"plan_id": plan["id"], "row": row["id"] if stage == "use" else row["group"],
                        "stage": stage, "frozen": frozen,
                        "dependencies": {key: digest(canonical(value)) for key, value in dependencies.items()},
                        "performance_validated": False})
        write_json(path / "receipt.json", receipt)
        return {"receipt": str(path / "receipt.json"), "performance_validated": False}
    finally:
        (work / ".running").unlink()


def compare(plan, measurements, baseline, candidate):
    """Summarize externally measured paired samples; never promote a default."""
    rows = {row["id"]: row for row in plan["rows"]}
    require(baseline in rows and candidate in rows, "Unknown comparison row")
    axes = [key for key in ("cpu", "rust", "lto") if rows[baseline][key] != rows[candidate][key]]
    require(len(axes) == 1, "Compare exactly one varying axis")
    receipts = {name: load_receipt(plan, rows[name], "use") for name in (baseline, candidate)}
    require(receipts[baseline]["frozen"] == receipts[candidate]["frozen"], "Unmatched builds")
    # Paths may differ by row, but compiler and SDK selections must not.
    common = ("CC", "CXX", "CC_VERSION", "RUSTC_VERSION", "RUSTC_LLVM_VERSION",
              "MACOS_SDK_DIR", "MACOS_SDK_VERSION", "MOZ_OPTIMIZE_FLAGS")
    require(all(receipts[baseline].get("configure", {}).get(key) ==
                receipts[candidate].get("configure", {}).get(key) for key in common),
            "Configured compiler/SDK/optimization settings differ")
    groups = {}
    for sample in measurements:
        require(sample["row"] in receipts, "Unexpected measurement row")
        require(sample.get("valid") is True and sample.get("profiler") is False,
                "Reject invalid or profiler-on measurement")
        require(sample["receipt_sha256"] == digest(canonical(receipts[sample["row"]])),
                "Measurement does not identify this build receipt")
        context = sample["context"]
        keys = ("host_id", "generation", "os", "power_mode", "thermal_state", "workload_sha256", "payload_sha256")
        require(all(isinstance(context.get(k), str) and context[k] for k in keys), "Missing measurement context")
        require(context["generation"] in ("M1", "M2", "M3", "M4"), "Unknown hardware generation")
        require(type(sample["trial"]) is int and sample["trial"] >= 1, "Invalid trial number")
        require(set(sample["metrics"]) == set(METRICS), "Missing or unexpected metrics")
        require(all(type(v) in (int, float) and math.isfinite(v) and v > 0
                    for v in sample["metrics"].values()), "Metrics must be finite positive numbers")
        key = tuple(context[k] for k in keys)
        samples = groups.setdefault(key, {baseline: {}, candidate: {}})[sample["row"]]
        require(sample["trial"] not in samples, "Duplicate trial")
        samples[sample["trial"]] = sample["metrics"]
    require(groups, "No measurements")
    results = []
    for key, data in groups.items():
        a, b = data[baseline], data[candidate]
        require(set(a) == set(b) and len(a) >= 3, "Need at least three matched trials per host/context")
        metrics = {}
        for metric in METRICS:
            ratios = [(b[t][metric] / a[t][metric] - 1) * 100 for t in sorted(a)]
            metrics[metric] = {"baseline_median": statistics.median(x[metric] for x in a.values()),
                               "candidate_median": statistics.median(x[metric] for x in b.values()),
                               "paired_delta_percent_median": statistics.median(ratios),
                               "paired_delta_percent_range": [min(ratios), max(ratios)]}
        results.append({"context": dict(zip(keys, key)), "trials": len(a), "metrics": metrics})
    return {"axis": axes[0], "baseline": baseline, "candidate": candidate,
            "hosts": results, "promoted": False,
            "missing_generations": sorted({"M1", "M2", "M3", "M4"} - {k[1] for k in groups})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan", help="Read local APIs and emit a plan; never build")
    p.add_argument("--work-dir", required=True, type=safe_path)
    p.add_argument("--cpus", nargs="+", default=["apple-m1", "default"])
    p.add_argument("--rust", nargs="+", type=int, default=[2, 3])
    p.add_argument("--lto", nargs="+", default=["thin", "full"])
    p.add_argument("--clang", type=safe_path, default=Path.home() / ".mozbuild/clang/bin/clang")
    p.add_argument("--profdata", type=safe_path, default=Path.home() / ".mozbuild/clang/bin/llvm-profdata")
    p.add_argument("--seed", type=safe_path)
    p.add_argument("--media", type=safe_path)
    p.add_argument("--write", action="store_true", help="Create a new external directory with plan/configs only")
    p = sub.add_parser("run", help="Describe one stage; execution requires --execute-heavy")
    p.add_argument("--plan", required=True, type=Path)
    p.add_argument("--row", required=True)
    p.add_argument("--stage", required=True, choices=["generate", "train", "use"])
    p.add_argument("--execute-heavy", action="store_true")
    p = sub.add_parser("compare", help="Validate and summarize existing measurements; no benchmarks")
    p.add_argument("--plan", required=True, type=Path)
    p.add_argument("--measurements", required=True, type=Path)
    p.add_argument("--baseline", required=True)
    p.add_argument("--candidate", required=True)
    args = parser.parse_args()
    if args.command == "plan":
        plan = make_plan(ROOT, args.work_dir, args.cpus, args.rust, args.lto,
                         args.clang, args.profdata, args.seed, args.media)
        if args.write:
            args.work_dir.mkdir(parents=True, exist_ok=False)
            for name, content in plan["configs"].items():
                path = args.work_dir / name
                path.parent.mkdir(exist_ok=True)
                path.write_text(content)
            write_json(args.work_dir / "plan.json", plan)
        result = plan
    else:
        plan = read_json(args.plan)
        verify_plan(plan)
        if args.command == "compare":
            result = compare(plan, read_json(args.measurements), args.baseline, args.candidate)
        else:
            row = next((r for r in plan["rows"] if r["id"] == args.row), None)
            require(row is not None, "Unknown row")
            result = run_stage(plan, row, args.stage, args.execute_heavy)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
        print(f"trance-build-matrix: {exc}", file=sys.stderr)
        sys.exit(1)
