#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Plan/validation tests only. Never configure, build, train or benchmark."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


matrix = module("matrix", "trance-build-matrix.py")
training = module("training", "trance-pgo-train.py")


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="trance-plan-test-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name).resolve() / "out"
        self.plan = matrix.make_plan(matrix.ROOT, self.work, ["apple-m1", "default"],
                                    [2, 3], ["thin", "full"],
                                    Path("/toolchain/clang"), Path("/toolchain/llvm-profdata"), None, None)
        self.row = self.plan["rows"][0]

    def test_plan_reads_local_apis_without_writing_output(self):
        self.assertFalse(self.work.exists())
        self.assertEqual(len(self.plan["rows"]), 8)
        self.assertEqual(len(self.plan["configs"]), 12)
        matrix.verify_plan(self.plan)

    def test_plan_is_deterministic(self):
        plan = matrix.make_plan(matrix.ROOT, self.work, ["apple-m1", "default"], [2, 3],
                                ["thin", "full"], Path("/toolchain/clang"),
                                Path("/toolchain/llvm-profdata"), None, None)
        self.assertEqual(plan, self.plan)

    def test_no_implicit_heavy_execution(self):
        with patch.object(matrix, "source_snapshot", side_effect=AssertionError("heavy")), \
             patch.object(matrix, "toolchain", side_effect=AssertionError("heavy")):
            for stage in ("generate", "train", "use"):
                result = matrix.run_stage(self.plan, self.row, stage)
                self.assertFalse(result["executes"])
                self.assertIn("--execute-heavy", result["execute_command"])
                self.assertFalse(self.work.exists())

    def test_tampered_plan_is_rejected(self):
        self.plan["rows"][0]["rust"] = 1
        with self.assertRaisesRegex(ValueError, "Plan changed"):
            matrix.verify_plan(self.plan)

    def test_api_drift_is_rejected(self):
        with patch.object(matrix, "api_evidence", return_value={}):
            with self.assertRaisesRegex(ValueError, "API"):
                matrix.verify_plan(self.plan)

    def test_invalid_axes(self):
        for cpus, rust, lto in [(["native"], [2], ["thin"]), (["apple-m9"], [2], ["thin"]),
                                (["default"], [0], ["full"]), (["default"], [2], ["none"]),
                                (["default", "default"], [2], ["thin"]),
                                (["default"], [2, 2], ["thin"])]:
            with self.subTest(cpus=cpus, rust=rust, lto=lto), self.assertRaises(ValueError):
                matrix.variants(cpus, rust, lto)

    def test_objdir_cannot_be_in_checkout(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            matrix.make_plan(matrix.ROOT, matrix.ROOT / "obj-test", ["default"], [2], ["thin"],
                             Path("/clang"), Path("/llvm-profdata"), None, None)

    def test_shell_and_make_path_characters_rejected(self):
        for path in ("/tmp/a b", "/tmp/$HOME", "/tmp/$(id)", "/tmp/a\nb", "/tmp/a#b"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                matrix.safe_path(path)

    def evaluate_mozconfig(self, text):
        # Source ONLY shell mozconfig with inert ac/mk handlers. No mach call,
        # compiler, bootstrap, subprocess build wrapper or browser is involved.
        script = "ac_add_options() { printf 'AC %s\\n' \"$*\"; }\nmk_add_options() { :; }\n"
        script += text + '\nprintf "FLAGS %s|%s|%s\\n" "$CFLAGS" "$CXXFLAGS" "$RUSTC_OPT_LEVEL"\n'
        return subprocess.check_output(["/bin/sh", "-s"], input=script.encode(),
                                       env={"PATH": "/usr/bin:/bin", "HOME": self.temp.name}).decode()

    def test_rendered_instrumentation_uses_no_release_pgo_path_or_lto(self):
        output = self.evaluate_mozconfig(matrix.render_config(matrix.ROOT, self.plan, self.row, "generate"))
        self.assertIn("AC --enable-profile-generate=cross", output)
        self.assertIn("AC --disable-lto", output)
        self.assertNotIn("AC --enable-lto", output)
        self.assertNotIn("AC --enable-profile-use", output)
        self.assertNotIn("artifact/merged.profdata", output)
        self.assertIn("FLAGS -mcpu=apple-m1|-mcpu=apple-m1|2", output)

    def test_lto_modes_share_one_profile_but_not_objdirs(self):
        a, b = self.plan["rows"][:2]
        self.assertEqual(a["group"], b["group"])
        configs = [matrix.render_config(matrix.ROOT, self.plan, row, "use") for row in (a, b)]
        for row, config in zip((a, b), configs):
            output = self.evaluate_mozconfig(config)
            self.assertIn(f"AC --enable-lto=cross,{row['lto']}", output)
            self.assertIn(f"AC --with-pgo-profile-path={self.work}/{a['group']}/train/merged.profdata", output)
            self.assertNotIn("AC --enable-profile-generate", output)
            self.assertIn(f"MOZ_OBJDIR={self.work}/{row['id']}/use/obj", config)

    def test_default_strategy_removes_m1_and_preserves_rust_default_cpu(self):
        row = next(r for r in self.plan["rows"] if r["cpu"] == "default")
        text = matrix.render_config(matrix.ROOT, self.plan, row, "use")
        self.assertIn("FLAGS ||2", self.evaluate_mozconfig(text))
        self.assertNotIn("target-cpu", text)

    def test_no_ambient_configuration_leaks(self):
        with patch.dict(os.environ, {"MOZ_PGO": "1", "CFLAGS": "-mcpu=native",
                                    "RUSTFLAGS": "-C opt-level=0", "MOZ_PROFILER_STARTUP": "1"}):
            env = matrix.clean_environment()
            for key in ("MOZ_PGO", "CFLAGS", "RUSTFLAGS", "MOZ_PROFILER_STARTUP"):
                self.assertNotIn(key, env)


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.row = matrix.variants(["apple-m1"], [2], ["thin"])[0]
        self.config = {"target": matrix.TARGET, "MOZ_OPTIMIZE": "1", "MOZILLA_OFFICIAL": "1",
                       "MOZ_APP_NAME": "trance", "MOZ_UPDATE_CHANNEL": "trance",
                       "CARGO_PROFILE_RELEASE_OPT_LEVEL": "2", "MOZ_PGO_RUST": "1",
                       "MOZ_PROFILE_USE": "1", "MOZ_LTO": "1", "MOZ_LTO_RUST_CROSS": "thin",
                       "PGO_PROFILE_PATH": "/tmp/merged.profdata", "OS_CFLAGS": "-mcpu=apple-m1",
                       "OS_CXXFLAGS": "-mcpu=apple-m1"}

    def test_correct_use_configuration(self):
        matrix.validate_config(self.config, self.row, "use", "/tmp/merged.profdata")

    def test_rejects_debug_nonpgo_wrong_cpu_rust_lto_and_profile(self):
        for key, value in {"target": "x86_64-apple-darwin", "MOZ_DEBUG": "1", "MOZ_DEBUG_SYMBOLS": "1",
                           "MOZILLA_OFFICIAL": "", "CARGO_PROFILE_RELEASE_OPT_LEVEL": "3",
                           "MOZ_PGO_RUST": "", "MOZ_PROFILE_USE": "", "MOZ_PROFILE_GENERATE": "1",
                           "MOZ_LTO_RUST_CROSS": "full", "PGO_PROFILE_PATH": "/stale.profdata",
                           "OS_CFLAGS": "-mcpu=apple-m2", "MOZ_UPDATE_CHANNEL": "twilight"}.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                matrix.validate_config(dict(self.config, **{key: value}), self.row, "use", "/tmp/merged.profdata")

    def test_instrumented_lto_is_rejected(self):
        config = dict(self.config, MOZ_PROFILE_GENERATE="1", MOZ_PROFILE_USE="")
        with self.assertRaisesRegex(ValueError, "without LTO"):
            matrix.validate_config(config, self.row, "generate")
        config["MOZ_LTO"] = ""
        matrix.validate_config(config, self.row, "generate")

    def test_seed_requires_disposable_versioned_matching_extensions(self):
        with tempfile.TemporaryDirectory() as directory:
            seed = Path(directory)
            metadata = {"disposable": True, "extensions": {"test@trance": "1.0"}}
            policy = {"policies": {"ExtensionSettings": {"test@trance": {"installation_mode": "normal_installed"}}}}
            (seed / "trance-pgo-seed.json").write_text(json.dumps(metadata))
            self.assertEqual(training.validate_seed(seed, policy), metadata["extensions"])
            (seed / ".parentlock").touch()
            with self.assertRaisesRegex(ValueError, "locked"):
                training.validate_seed(seed, policy)
            (seed / ".parentlock").unlink()
            metadata["extensions"] = {"other": "2"}
            (seed / "trance-pgo-seed.json").write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, "IDs"):
                training.validate_seed(seed, policy)

    def test_imported_absolute_source_symlinks_are_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "src/zen/trance/core.mjs"
            source.parent.mkdir(parents=True)
            source.write_text("// Trance source fixture\n")
            imported = root / "engine/zen/trance/core.mjs"
            imported.parent.mkdir(parents=True)
            imported.symlink_to(source.resolve())
            prefs = root / "engine/browser/app/profile/zen.js"
            prefs.parent.mkdir(parents=True)
            prefs.write_text("// Generated prefs fixture\n")
            with patch.object(matrix, "git_snapshot", return_value="fixture"):
                snapshot = matrix.source_snapshot(root)
                self.assertEqual(snapshot["imported_zen"], matrix.tree_hash(root / "src/zen"))
                imported.unlink()
                imported.write_text("// stale imported copy\n")
                with self.assertRaisesRegex(ValueError, "Stale import"):
                    matrix.source_snapshot(root)


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        rows = matrix.variants(["apple-m1", "default"], [2, 3], ["thin", "full"])
        self.plan = {"rows": rows}
        self.a, self.b = rows[0]["id"], rows[1]["id"]
        self.receipts = {name: {"frozen": {"source": "same"}, "row": name} for name in (self.a, self.b)}
        self.samples = []
        for trial in range(1, 4):
            for name, value in ((self.a, 100), (self.b, 90)):
                self.samples.append({"row": name, "trial": trial, "valid": True, "profiler": False,
                    "receipt_sha256": matrix.digest(matrix.canonical(self.receipts[name])),
                    "context": {"host_id": "fixture", "generation": "M1", "os": "fixture",
                                "power_mode": "AC", "thermal_state": "nominal",
                                "workload_sha256": "fixture", "payload_sha256": "fixture"},
                    "metrics": {metric: value for metric in matrix.METRICS}})
        self.mock = patch.object(matrix, "load_receipt", side_effect=lambda p, r, s: self.receipts[r["id"]])
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def compare(self, samples=None):
        return matrix.compare(self.plan, self.samples if samples is None else samples, self.a, self.b)

    def test_paired_comparison_does_not_promote(self):
        result = self.compare()
        self.assertFalse(result["promoted"])
        self.assertEqual(result["missing_generations"], ["M2", "M3", "M4"])
        self.assertAlmostEqual(result["hosts"][0]["metrics"]["startup_ms"]["paired_delta_percent_median"], -10)

    def test_invalid_samples_fail_closed(self):
        changes = [{"valid": False}, {"profiler": True}, {"receipt_sha256": "stale"},
                   {"trial": 0}, {"metrics": {key: float("nan") for key in matrix.METRICS}}]
        for change in changes:
            samples = copy.deepcopy(self.samples)
            samples[0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.compare(samples)

    def test_unmatched_or_duplicate_trials_rejected(self):
        for samples in (self.samples[:-1], self.samples + [self.samples[0]], []):
            with self.assertRaises(ValueError):
                self.compare(samples)

    def test_hardware_or_payload_drift_is_not_pooled(self):
        for key in ("host_id", "power_mode", "thermal_state", "payload_sha256"):
            samples = copy.deepcopy(self.samples)
            samples[0]["context"][key] = "different"
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.compare(samples)

    def test_multiple_axis_comparison_rejected(self):
        with self.assertRaisesRegex(ValueError, "one varying axis"):
            matrix.compare(self.plan, self.samples, self.a, self.plan["rows"][-1]["id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
