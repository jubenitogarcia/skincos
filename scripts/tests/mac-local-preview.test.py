"""Unit checks for the native local preview custody boundaries."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("mac_local_preview", SOURCE / "scripts/mac-local-preview.py")
preview = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preview)


class MacLocalPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="skincos-mac-preview-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "worktree"
        (self.root / "website").mkdir(parents=True)

    def custody_manifest(self, pid=713):
        state = self.base / "state"
        cache_key = "a" * 64
        materialized = state / "source" / cache_key / "website"
        materialized.mkdir(parents=True, exist_ok=True)
        return state, {"pid": pid, "port": 3417, "route": "/", "url": "http://127.0.0.1:3417/",
                       "cacheKey": cache_key, "projectRoot": str(self.root), "materializedSource": str(materialized)}

    def test_private_state_cannot_be_created_inside_source_checkout(self):
        with self.assertRaisesRegex(preview.PreviewError, "outside"):
            preview.ensure_private(self.root, self.root / ".preview-private")

    def test_private_nested_paths_reject_worktree_symlinks_before_writes(self):
        state = self.base / "state"
        cache = self.base / "cache"
        preview.ensure_private(self.root, state)
        preview.ensure_private(self.root, cache)
        (state / "source").mkdir()
        (state / "source/key").symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(preview.PreviewError, "symlink"):
            preview.validate_private_descendant(state, state / "source/key")
        (cache / "dependencies").symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(preview.PreviewError, "symlink"):
            preview.validate_private_descendant(cache, cache / "dependencies/key/website")
        self.assertFalse((self.root / "node_modules").exists())

    def test_source_copy_excludes_credentials_and_generated_output(self):
        website = self.root / "website"
        (website / ".env.local").write_text("DO_NOT_COPY=secret\n")
        (website / ".npmrc").write_text("//registry.example.invalid/:_authToken=DO_NOT_COPY\n")
        (website / "src").mkdir()
        (website / "src/page.tsx").write_text("export default 1\n")
        self.assertIn(".env.local", preview.ignore_source(str(website), [".env.local", "src"]))
        self.assertIn(".npmrc", preview.ignore_source(str(website), [".npmrc"]))
        self.assertNotIn("src", preview.ignore_source(str(website), [".env.local", "src"]))
        self.assertIn(".next", preview.ignore_source(str(website), [".next"]))

    def test_refuses_real_environment_files_but_permits_documented_examples(self):
        website = self.root / "website"
        (website / ".env.local").write_text("TOKEN=do-not-run\n")
        with self.assertRaisesRegex(preview.PreviewError, "credential environment"):
            preview.validate_synthetic_environment(website)
        (website / ".env.local").unlink()
        (website / ".env.example").write_text("TOKEN=example\n")
        preview.validate_synthetic_environment(website)

    def test_dependency_key_binds_platform_architecture_node_major_and_lock(self):
        website = self.root / "website"
        (website / "package.json").write_text('{"name":"one"}\n')
        (website / "package-lock.json").write_text('{"lockfileVersion":3}\n')
        with mock.patch.object(preview, "node_major", return_value="22"), mock.patch.object(preview.platform, "machine", return_value="arm64"):
            first = preview.dependency_key(website)
            (website / "package-lock.json").write_text('{"lockfileVersion":3,"changed":true}\n')
            second = preview.dependency_key(website)
        self.assertIn("arm64-node22-", first)
        self.assertNotEqual(first, second)

    def test_npm_install_environment_does_not_repurpose_home(self):
        environment = preview.isolated_npm_environment(self.base / "private-cache")
        self.assertNotIn("HOME", environment)
        self.assertEqual(Path(environment["NPM_CONFIG_USERCONFIG"]).read_text(), "")
        self.assertEqual(Path(environment["NPM_CONFIG_USERCONFIG"]).stat().st_mode & 0o777, 0o600)

    def test_dependency_marker_recovers_from_corruption_and_missing_runtime_packages(self):
        website = self.root / "website"
        (website / "package.json").write_text('{"name":"fixture"}\n')
        (website / "package-lock.json").write_text('{"lockfileVersion":3}\n')
        (website / "npm-shrinkwrap.json").write_text('{"name":"fixture","lockfileVersion":3}\n')
        state = self.base / "private-state"
        cache = self.base / "private-cache"
        current = {"cacheKey": "fixture"}
        installs = []

        def fake_npm(command, **_kwargs):
            installs.append(command)
            dependency_root = Path(command[command.index("--prefix") + 1]) / "node_modules"
            for name in ("next/package.json", "react/package.json", "react-dom/package.json", ".bin/next"):
                target = dependency_root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("fixture\n")

        with mock.patch.object(preview, "node_major", return_value="22"), mock.patch.object(preview.subprocess, "run", side_effect=fake_npm):
            _materialized, dependencies = preview.materialize(self.root, state, cache, current, install=True)
            self.assertEqual((dependencies / "npm-shrinkwrap.json").read_text(), (website / "npm-shrinkwrap.json").read_text())
            marker = dependencies / ".preview-dependencies.json"
            marker.write_text("not-json\n")
            preview.materialize(self.root, state, cache, current, install=True)
            (dependencies / "node_modules/react-dom/package.json").unlink()
            preview.materialize(self.root, state, cache, current, install=True)
        self.assertEqual(len(installs), 3)

    def test_materialize_rejects_successful_npm_without_required_runtime_tree(self):
        website = self.root / "website"
        (website / "package.json").write_text('{"name":"fixture"}\n')
        (website / "package-lock.json").write_text('{"lockfileVersion":3}\n')
        with mock.patch.object(preview, "node_major", return_value="22"), mock.patch.object(preview.subprocess, "run"):
            with self.assertRaisesRegex(preview.PreviewError, "did not create the required"):
                preview.materialize(self.root, self.base / "state", self.base / "cache", {"cacheKey": "fixture"}, install=True)

    def test_materialize_rejects_cache_leaf_and_node_modules_symlinks_before_npm(self):
        website = self.root / "website"
        (website / "package.json").write_text('{"name":"fixture"}\n')
        (website / "package-lock.json").write_text('{"lockfileVersion":3}\n')
        for leaf in ("package.json", "node_modules"):
            with self.subTest(leaf=leaf), tempfile.TemporaryDirectory(prefix="skincos-preview-cache-link-") as separate:
                state = Path(separate) / "state"
                cache = Path(separate) / "cache"
                state.mkdir()
                cache.mkdir()
                with mock.patch.object(preview, "node_major", return_value="22"):
                    dependencies = cache / "dependencies" / preview.dependency_key(website) / "website"
                dependencies.mkdir(parents=True)
                (dependencies / leaf).symlink_to(self.root, target_is_directory=True)
                with mock.patch.object(preview.subprocess, "run", side_effect=AssertionError("npm must not run")), mock.patch.object(preview, "node_major", return_value="22"):
                    with self.assertRaisesRegex(preview.PreviewError, "symlink"):
                        preview.materialize(self.root, state, cache, {"cacheKey": "fixture"}, install=True)
                self.assertFalse((self.root / "package.json").exists())

    def test_materialize_rejects_hardlinked_cache_package_before_copy(self):
        website = self.root / "website"
        (website / "package.json").write_text('{"name":"fixture"}\n')
        (website / "package-lock.json").write_text('{"lockfileVersion":3}\n')
        state = self.base / "state"
        cache = self.base / "cache"
        state.mkdir()
        cache.mkdir()
        anchor = self.root / "unrelated-anchor"
        anchor.write_text("must stay unchanged\n")
        with mock.patch.object(preview, "node_major", return_value="22"):
            dependencies = cache / "dependencies" / preview.dependency_key(website) / "website"
        dependencies.mkdir(parents=True)
        os.link(anchor, dependencies / "package.json")
        with mock.patch.object(preview.subprocess, "run", side_effect=AssertionError("npm must not run")), mock.patch.object(preview, "node_major", return_value="22"):
            with self.assertRaisesRegex(preview.PreviewError, "hard links"):
                preview.materialize(self.root, state, cache, {"cacheKey": "fixture"}, install=True)
        self.assertEqual(anchor.read_text(), "must stay unchanged\n")

    def test_recycled_or_unrelated_pid_is_never_owned(self):
        state, manifest = self.custody_manifest()
        manifest["processStart"] = "old"
        with mock.patch.object(preview, "ps_value", return_value="new"):
            self.assertFalse(preview.owned_process(manifest, self.root, state))

    def test_manifest_for_another_next_source_is_rejected_before_process_lookup(self):
        state, manifest = self.custody_manifest()
        manifest.update({"processStart": "old", "materializedSource": str(self.base / "other-next-source")})
        with mock.patch.object(preview, "ps_value", side_effect=AssertionError("must not inspect process")):
            self.assertFalse(preview.owned_process(manifest, self.root, state))

    def test_malformed_manifest_pid_or_port_fails_closed_without_process_lookup(self):
        for manifest in (
            {"pid": "713", "port": 3417, "route": "/", "url": "http://127.0.0.1:3417/"},
            {"pid": 713, "port": "3417", "route": "/", "url": "http://127.0.0.1:3417/"},
            {"pid": 713, "port": 70000, "route": "/", "url": "http://127.0.0.1:70000/"},
        ):
            with mock.patch.object(preview, "ps_value", side_effect=AssertionError("must not inspect process")):
                self.assertFalse(preview.owned_listener(manifest, self.root, self.base / "state"))

    def test_runtime_scrubs_inherited_credentials_and_disables_telemetry(self):
        with mock.patch.dict(preview.os.environ, {"PRIVATE_TOKEN": "test-only-value", "NODE_OPTIONS": "--inspect=0.0.0.0"}):
            environment = preview.clean_environment(self.base / "runtime", "fp", "instance", "dist")
        self.assertNotIn("PRIVATE_TOKEN", environment)
        self.assertNotIn("NODE_OPTIONS", environment)
        self.assertNotIn("HOME", environment)
        self.assertEqual(environment["NEXT_TELEMETRY_DISABLED"], "1")

    def test_ownership_requires_a_dedicated_process_group(self):
        state, manifest = self.custody_manifest()
        materialized = Path(manifest["materializedSource"])
        manifest["processStart"] = "old"
        with mock.patch.object(preview, "ps_value", side_effect=["old", "next dev"]), mock.patch.object(preview, "process_cwd", return_value=materialized), mock.patch.object(preview, "process_group", return_value=99):
            self.assertFalse(preview.owned_process(manifest, self.root, state))

    def test_attestation_requires_exact_headers_and_nonempty_content(self):
        class Response:
            status = 200
            def read(self): return b"<html><body>page</body></html>"
            def getheaders(self): return [(preview.FINGERPRINT_HEADER, "a"), (preview.INSTANCE_HEADER, "b")]
        class Connection:
            def __init__(self, *a, **kw): pass
            def request(self, *a): pass
            def getresponse(self): return Response()
            def close(self): pass
        with mock.patch.object(preview.http.client, "HTTPConnection", Connection):
            self.assertTrue(preview.response_ready("http://127.0.0.1:3417/x", "a", "b"))
            self.assertFalse(preview.response_ready("http://127.0.0.1:3417/x", "wrong", "b"))

    def test_external_or_credentialed_url_is_rejected_before_http_connection(self):
        with mock.patch.object(preview.http.client, "HTTPConnection", side_effect=AssertionError("must not connect")):
            self.assertFalse(preview.response_ready("http://example.invalid/", "a", "b"))
            self.assertFalse(preview.response_ready("http://user:password@127.0.0.1:3417/", "a", "b"))
            self.assertFalse(preview.response_ready("https://127.0.0.1:3417/", "a", "b"))

    def test_manifest_url_must_exactly_match_its_loopback_port_and_route(self):
        valid = {"port": 3417, "route": "/", "url": "http://127.0.0.1:3417/"}
        self.assertEqual(preview.validated_manifest_url(valid), valid["url"])
        self.assertIsNone(preview.validated_manifest_url({**valid, "url": "http://example.invalid/"}))
        self.assertIsNone(preview.validated_manifest_url({**valid, "url": "http://127.0.0.1:3418/"}))

    def test_stop_does_not_inspect_pid_when_manifest_url_is_untrusted(self):
        manifest = {"pid": 713, "port": 3417, "route": "/", "url": "http://example.invalid/"}
        with mock.patch.object(preview, "owned_process") as owned:
            self.assertFalse(preview.stop(manifest, self.root, self.base / "state"))
        owned.assert_not_called()

    def test_next_starts_from_materialized_website_not_its_parent(self):
        materialized = self.base / "private/source/identity"
        command, cwd = preview.next_command(materialized, 3417)
        self.assertEqual(cwd, materialized / "website")
        self.assertEqual(Path(command[0]), cwd / "node_modules/.bin/next")
        self.assertEqual(command[-1], "3417")

    def test_reuse_result_keeps_reused_state_instead_of_stale_manifest_state(self):
        fingerprint = "sha256:" + "a" * 64
        state, previous = self.custody_manifest()
        previous.update({"state": "ready", "instanceFingerprint": fingerprint, "instanceId": "instance"})
        args = SimpleNamespace(route="/", port=3417, timeout=1)
        with mock.patch.object(preview, "validate_synthetic_environment"), mock.patch.object(preview, "identity", return_value={"instanceFingerprint": fingerprint}), mock.patch.object(preview, "owned_listener", return_value=True), mock.patch.object(preview, "response_ready", return_value=True):
            result = preview.start(args, self.root, state, self.base / "cache", previous)
        self.assertEqual(result["state"], "reused")


if __name__ == "__main__":
    unittest.main()
