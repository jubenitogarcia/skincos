import json
import importlib.util
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
from unittest import mock
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
        self.assertEqual(checks["platformActions"]["counts"], {"darwin": 5, "win32": 5})
        self.assertNotIn("environmentVariables", report)

    def test_disk_uses_nearest_configured_cache_ancestor_without_creating_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            state = base / "state"
            cache = base / "cache"
            state.mkdir()
            cache.mkdir()
            proposed_cache = cache / "deep" / "future" / "venv"
            checked = []

            def disk_usage(path):
                checked.append(Path(path))
                free = 6 * 1024 ** 3 if Path(path) == state else 4 * 1024 ** 3
                return SimpleNamespace(free=free)

            with mock.patch.object(MODULE.shutil, "disk_usage", side_effect=disk_usage):
                report = MODULE.disk_status([state, proposed_cache])
            self.assertEqual(report["status"], "missing")
            self.assertEqual(checked, [state, cache])
            self.assertFalse(proposed_cache.exists())

    def test_hook_status_requires_installer_ownership(self):
        absent = MODULE.hook_status_from_result(0, json.dumps({"installed": False, "configuredHooksPath": []}))
        self.assertEqual(absent["status"], "missing")


if __name__ == "__main__":
    unittest.main()
