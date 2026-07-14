"""Regression tests for the post-deploy API and Inventory smoke helper."""

from __future__ import annotations

import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("workers_smoke.py")
SPEC = importlib.util.spec_from_file_location("workers_smoke", MODULE_PATH)
assert SPEC and SPEC.loader
workers_smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(workers_smoke)


class WorkersSmokeTests(unittest.TestCase):
    def test_normalize_base_url_accepts_https_origin(self) -> None:
        self.assertEqual(workers_smoke.normalize_base_url("https://api.skincos.com.br/"), "https://api.skincos.com.br")

    def test_normalize_base_url_rejects_non_origin_inputs(self) -> None:
        for value in (
            "http://api.skincos.com.br",
            "https://api.skincos.com.br/insumos",
            "https://user@example.com",
            "https://api.skincos.com.br/?next=x",
            "https://api.skincos.com.br/#fragment",
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    workers_smoke.normalize_base_url(value)

    def test_require_worker_health_checks_expected_identity_and_readiness(self) -> None:
        workers_smoke.require_worker_health({"ok": True, "service": "api"}, service="api")
        workers_smoke.require_worker_health({"ok": True, "ready": True, "service": "insumos"}, service="insumos", require_ready=True)
        with self.assertRaises(RuntimeError):
            workers_smoke.require_worker_health({"ok": True, "service": "api"}, service="insumos", require_ready=True)


if __name__ == "__main__":
    unittest.main()
