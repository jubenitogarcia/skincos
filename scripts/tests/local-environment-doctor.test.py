import json
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import os
import unittest


ROOT = Path(__file__).resolve().parents[2]
DOCTOR = ROOT / "scripts/local-environment-doctor.py"
SPEC = importlib.util.spec_from_file_location("local_environment_doctor", DOCTOR)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LocalEnvironmentDoctorTests(unittest.TestCase):
    def test_reports_read_only_environment_sections(self):
        result = subprocess.run(["python3", str(DOCTOR), "--project-root", str(ROOT)], text=True, capture_output=True)
        self.assertIn(result.returncode, (0, 1))
        report = json.loads(result.stdout)
        self.assertIn(report["status"], ("prepared", "missing"))
        checks = report["checks"]
        self.assertEqual(set(checks["tools"]), {"git", "node", "npm", "python3", "codex"})
        self.assertEqual(checks["platformActions"]["counts"], {"darwin": 6, "win32": 6})
        self.assertNotIn("environmentVariables", report)

    def test_preview_rejects_a_stale_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            preview = MODULE.preview_dependency_status(ROOT, cache)
            marker = Path(preview["dependencyMarker"])
            marker.parent.mkdir(parents=True)
            marker.write_text(json.dumps({"version": 1, "key": "stale"}), encoding="utf-8")
            for name in ("next", "react", "react-dom"):
                package = marker.parent / "node_modules" / name / "package.json"
                package.parent.mkdir(parents=True)
                package.write_text("{}", encoding="utf-8")
            next_bin = marker.parent / "node_modules/.bin/next"
            next_bin.parent.mkdir(parents=True)
            next_bin.write_text("", encoding="utf-8")
            self.assertEqual(MODULE.preview_dependency_status(ROOT, cache)["status"], "missing")

    def test_preview_requires_next_binary_even_with_matching_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            preview = MODULE.preview_dependency_status(ROOT, cache)
            marker = Path(preview["dependencyMarker"])
            marker.parent.mkdir(parents=True)
            marker.write_text(json.dumps({"version": 1, "key": marker.parent.parent.name}), encoding="utf-8")
            for name in ("next", "react", "react-dom"):
                package = marker.parent / "node_modules" / name / "package.json"
                package.parent.mkdir(parents=True)
                package.write_text("{}", encoding="utf-8")
            self.assertEqual(MODULE.preview_dependency_status(ROOT, cache)["status"], "missing")

    def test_preview_accepts_complete_private_fixture(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            preview = MODULE.preview_dependency_status(ROOT, cache)
            marker = Path(preview["dependencyMarker"])
            marker.parent.mkdir(parents=True)
            marker.write_text(json.dumps({"version": 1, "key": marker.parent.parent.name}), encoding="utf-8")
            for name in ("next", "react", "react-dom"):
                package = marker.parent / "node_modules" / name / "package.json"
                package.parent.mkdir(parents=True)
                package.write_text("{}", encoding="utf-8")
            next_bin = marker.parent / "node_modules/.bin/next"
            next_bin.parent.mkdir(parents=True)
            next_bin.write_text("", encoding="utf-8")
            self.assertEqual(MODULE.preview_dependency_status(ROOT, cache)["status"], "prepared")

    def test_private_directory_requires_existing_mode_0700(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "private"
            self.assertFalse(MODULE.private_directory_status(directory))
            directory.mkdir(mode=0o700)
            self.assertTrue(MODULE.private_directory_status(directory))
            os.chmod(directory, 0o755)
            self.assertFalse(MODULE.private_directory_status(directory))

    def test_preview_rejects_world_readable_cache_even_when_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary) / "cache"
            cache.mkdir(mode=0o700)
            preview = MODULE.preview_dependency_status(ROOT, cache)
            marker = Path(preview["dependencyMarker"])
            marker.parent.mkdir(parents=True)
            marker.write_text(json.dumps({"version": 1, "key": marker.parent.parent.name}), encoding="utf-8")
            for name in ("next", "react", "react-dom"):
                package = marker.parent / "node_modules" / name / "package.json"
                package.parent.mkdir(parents=True)
                package.write_text("{}", encoding="utf-8")
            next_bin = marker.parent / "node_modules/.bin/next"
            next_bin.parent.mkdir(parents=True)
            next_bin.write_text("", encoding="utf-8")
            os.chmod(cache, 0o755)
            self.assertEqual(MODULE.preview_dependency_status(ROOT, cache)["status"], "missing")

    def test_hook_status_requires_installer_ownership(self):
        absent = MODULE.hook_status_from_result(0, json.dumps({"installed": False, "configuredHooksPath": []}))
        self.assertEqual(absent["status"], "missing")


if __name__ == "__main__":
    unittest.main()
