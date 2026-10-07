"""Synthetic Git and filesystem checks; never run the EF integration."""

import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SOURCE = Path(__file__).resolve().parents[2]
HELPER = SOURCE / "scripts/shared-workspace.py"


class SharedWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="skincos-workspace-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        # Git hooks export repository-local variables. A fixture must never
        # let those select the caller's real Git directory or index.
        self.git_env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        self.git_env.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": str(self.base / "global-git-config"), "GIT_CONFIG_SYSTEM": str(self.base / "system-git-config")})
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.git("init", "-q", "-b", "main")
        self.git("config", "core.hooksPath", str(self.base / "no-hooks"))
        self.git("config", "user.name", "Synthetic workspace test")
        self.git("config", "user.email", "workspace-test@example.invalid")
        lock = self.repo / "integration/ef/requirements.lock"
        lock.parent.mkdir(parents=True)
        lock.write_text("# synthetic lock; no dependencies\n")
        self.git("add", ".")
        self.git("commit", "-qm", "synthetic fixture")
        self.git("remote", "add", "origin", "https://github.com/jubenitogarcia/skincos.git")
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True, text=True, env=self.git_env)

    def run_helper(self, action, *args, root=None):
        return subprocess.run(
            [sys.executable, "-B", str(HELPER), action, "--project-root", str(root or self.repo),
             "--state-root", str(self.base / "private"), "--cache-root", str(self.base / "cache"), *args],
            capture_output=True, text=True, env=self.git_env,
        )

    def test_hook_context_cannot_redirect_fixture_operations_to_the_caller(self):
        before_config = (self.repo / ".git/config").read_bytes()
        before_index = (self.repo / ".git/index").read_bytes()
        with mock.patch.dict(os.environ, {"GIT_DIR": str(self.base / "unrelated.git"), "GIT_INDEX_FILE": str(self.base / "unrelated-index"), "GIT_WORK_TREE": str(self.base / "unrelated-worktree")}):
            self.git("status", "--porcelain=v1")
            result = self.run_helper("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.base / "unrelated.git").exists())
        self.assertFalse((self.base / "unrelated-index").exists())
        self.assertEqual((self.repo / ".git/config").read_bytes(), before_config)
        self.assertEqual((self.repo / ".git/index").read_bytes(), before_index)

    def test_status_uses_cached_refs_and_preserves_checkout(self):
        (self.repo / "unique-local.txt").write_text("synthetic local work\n")
        before = self.git("status", "--porcelain=v1").stdout
        result = self.run_helper("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        metadata = json.loads(result.stdout)
        self.assertTrue(metadata["dirty"])
        self.assertTrue(metadata["originMatchesSkincos"])
        self.assertFalse(metadata["remoteContacted"])
        self.assertEqual(metadata["vsOriginMain"], [0, 0])
        self.assertEqual(before, self.git("status", "--porcelain=v1").stdout)
        self.assertFalse((self.base / "private").exists())
        self.assertNotIn("unique-local.txt", result.stdout)

    def test_setup_requires_apply_and_does_not_chmod_existing_paths(self):
        result = self.run_helper("setup")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.base / "private").exists())
        result = self.run_helper("setup", "--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.base / "private").stat().st_mode & 0o777, 0o700)
        self.assertFalse((self.base / "cache/ef").exists())
        (self.base / "private").chmod(0o755)
        result = self.run_helper("setup", "--apply")
        self.assertEqual(result.returncode, 2)
        self.assertEqual((self.base / "private").stat().st_mode & 0o777, 0o755)

    def test_rejects_private_data_inside_any_linked_worktree(self):
        linked = self.base / "worktrees/admin/another-task"
        self.git("worktree", "add", "--no-track", "-b", "codex/admin/another-task", str(linked), "HEAD")
        result = self.run_helper("setup", "--apply", "--state-root", str(linked / "private"))
        self.assertEqual(result.returncode, 2)
        self.assertFalse((linked / "private").exists())

    def test_worktree_identity_rejects_shared_checkout_and_wrong_task(self):
        result = self.run_helper("validate-worktree", "--task-slug", "helper-check")
        self.assertEqual(result.returncode, 2)
        linked = self.base / "worktrees/admin/helper-check"
        self.git("worktree", "add", "--no-track", "-b", "codex/admin/helper-check", str(linked), "HEAD")
        result = self.run_helper("validate-worktree", "--task-slug", "helper-check", "--worktree-root", str(self.base / "worktrees"), root=linked)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.run_helper("validate-worktree", "--task-slug", "wrong-task", "--worktree-root", str(self.base / "worktrees"), root=linked)
        self.assertEqual(result.returncode, 2)

    def test_rejects_symlinked_output_into_code_without_touching_it(self):
        private = self.base / "private"
        private.mkdir(mode=0o700)
        (private / "scraper").symlink_to(self.repo, target_is_directory=True)
        result = self.run_helper("environment")
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.repo / "report").exists())

    def test_environment_changes_with_lockfile_without_creating_venv(self):
        before = self.run_helper("environment")
        self.assertEqual(before.returncode, 0, before.stderr)
        self.assertIn("export EF_SCRAPER_VENV_DIR=", before.stdout)
        self.assertFalse((self.base / "cache").exists())
        (self.repo / "integration/ef/requirements.lock").write_text("# different synthetic lock\n")
        after = self.run_helper("environment")
        first_venv = next(line for line in before.stdout.splitlines() if "EF_SCRAPER_VENV_DIR=" in line)
        second_venv = next(line for line in after.stdout.splitlines() if "EF_SCRAPER_VENV_DIR=" in line)
        self.assertNotEqual(first_venv, second_venv)

    def test_rejects_symlink_in_lock_specific_cache_before_emitting_exports(self):
        proposed = self.run_helper("environment")
        assignment = next(line for line in proposed.stdout.splitlines() if "EF_SCRAPER_VENV_DIR=" in line)
        venv = Path(shlex.split(assignment)[1].partition("=")[2])
        venv.parent.parent.mkdir(parents=True)
        venv.parent.symlink_to(self.repo, target_is_directory=True)
        result = self.run_helper("environment")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")

    def test_status_never_prints_origin_auth_material(self):
        self.git("remote", "set-url", "origin", "https://synthetic-auth-material@github.com/jubenitogarcia/skincos.git")
        result = self.run_helper("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("synthetic-auth-material", result.stdout + result.stderr)

    def test_ef_launcher_uses_override_or_original_default_with_stub_interpreter(self):
        ef = self.repo / "integration/ef"
        scripts = ef / "scripts"
        scripts.mkdir()
        launcher = scripts / "run-local-python.sh"
        shutil.copyfile(SOURCE / "integration/ef/scripts/run-local-python.sh", launcher)
        (ef / "run_scraper.py").write_text("raise AssertionError('must never execute')\n")
        for venv, override in [(ef / ".venv", False), (self.base / "external cache/venv", True)]:
            interpreter = venv / "bin/python"
            interpreter.parent.mkdir(parents=True)
            interpreter.write_text('#!/bin/sh\nprintf "stub-interpreter:%s\\n" "$1"\n')
            interpreter.chmod(0o700)
            env = dict(self.git_env)
            env.pop("EF_SCRAPER_VENV_DIR", None)
            if override:
                env["EF_SCRAPER_VENV_DIR"] = str(venv)
            result = subprocess.run(["bash", str(launcher), "run_scraper.py"], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "stub-interpreter:run_scraper.py")
        result = subprocess.run(["bash", str(launcher), "run_scraper.py"], env=dict(self.git_env, EF_SCRAPER_VENV_DIR="relative"), capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
