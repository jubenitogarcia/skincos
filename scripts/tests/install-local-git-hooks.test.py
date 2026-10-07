"""Synthetic tests for the private macOS Git-hook installer."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import importlib.util
from unittest import mock


SOURCE = Path(__file__).resolve().parents[2]
INSTALLER = SOURCE / "scripts/install-local-git-hooks.py"
SPEC = importlib.util.spec_from_file_location("install_local_git_hooks", INSTALLER)
assert SPEC and SPEC.loader
installer_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer_module)


class LocalGitHooksTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="skincos-local-hooks-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.parent_git_environment = {key: value for key, value in os.environ.items() if key.startswith("GIT_")}
        self.git_env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        self.git_env.update(
            {
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_SYSTEM": str(self.base / "no-system-gitconfig"),
                "GIT_CONFIG_GLOBAL": str(self.base / "synthetic-global-gitconfig"),
            }
        )
        self.module_git_patcher = mock.patch.object(installer_module, "git", side_effect=self.safe_module_git)
        self.module_git_patcher.start()
        self.addCleanup(self.module_git_patcher.stop)
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Synthetic hook test")
        self.git("config", "user.email", "hooks@example.invalid")
        hooks = self.repo / ".githooks"
        hooks.mkdir()
        (hooks / "pre-commit").write_text("#!/bin/sh\n[ \"${FAIL_CHECK:-0}\" = 1 ] && exit 23\nexit 0\n")
        (hooks / "pre-push").write_text(
            "#!/bin/sh\n"
            "if [ \"${SKINCOS_SKIP_DEPLOY:-}\" != 1 ] && [ \"${SKINCOS_AUTO_DEPLOY:-0}\" = 1 ]; then touch \"$DEPLOY_MARKER\"; fi\n"
            "[ \"${FAIL_CHECK:-0}\" = 1 ] && exit 19\n"
            "exit 0\n"
        )
        for hook in hooks.iterdir():
            hook.chmod(0o755)
        (self.repo / "README.md").write_text("fixture\n")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.state = self.base / "private-state"

    def git(self, *args: str, check: bool = True, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        command_env = dict(self.git_env)
        if env:
            command_env.update(env)
        return subprocess.run(["git", "-C", str(self.repo), *args], text=True, capture_output=True, check=check, env=command_env)

    def safe_module_git(self, project_root: Path, *args: str, check: bool = True) -> str:
        result = subprocess.run(["git", "-C", str(project_root), *args], text=True, capture_output=True, env=self.git_env)
        if check and result.returncode:
            raise installer_module.HookInstallError(result.stderr.strip() or "git command failed")
        return result.stdout

    def invoke_installer(self, action: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "-B", str(INSTALLER), action, "--project-root", str(self.repo), "--state-root", str(self.state)],
            text=True,
            capture_output=True,
            env=self.git_env,
        )

    def test_install_wrappers_propagate_failures_and_force_deploy_skip(self) -> None:
        before = self.invoke_installer("status")
        self.assertEqual(before.returncode, 0, before.stderr)
        self.assertFalse(json.loads(before.stdout)["installed"])
        installed = self.invoke_installer("install")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        state = json.loads((self.state / "installation.json").read_text())
        wrappers = Path(state["wrappersPath"])
        after = self.invoke_installer("status")
        self.assertEqual(after.returncode, 0, after.stderr)
        self.assertTrue(json.loads(after.stdout)["installed"])
        self.assertEqual(self.git("config", "--local", "--get", "core.hooksPath").stdout.strip(), str(wrappers))
        self.assertEqual((self.state.stat().st_mode & 0o777), 0o700)
        self.assertEqual(((self.state / "installation.json").stat().st_mode & 0o777), 0o600)
        hook_env = dict(self.git_env, GIT_DIR=str(self.repo / ".git"), GIT_INDEX_FILE=str(self.base / "synthetic-index"))
        failed_commit = subprocess.run([str(wrappers / "pre-commit")], cwd=self.repo, text=True, capture_output=True, env=dict(hook_env, FAIL_CHECK="1"))
        self.assertEqual(failed_commit.returncode, 23)
        marker = self.base / "would-deploy"
        failed_push = subprocess.run([str(wrappers / "pre-push")], cwd=self.repo, text=True, capture_output=True, env=dict(hook_env, FAIL_CHECK="1", SKINCOS_AUTO_DEPLOY="1", DEPLOY_MARKER=str(marker)))
        self.assertEqual(failed_push.returncode, 19, failed_push.stderr)
        self.assertFalse(marker.exists())
        self.assertFalse((wrappers / "post-merge").exists())
        self.assertFalse((wrappers / "post-rewrite").exists())
        (wrappers / "pre-push").write_text("#!/bin/sh\nexit 0\n")
        corrupted = self.invoke_installer("status")
        self.assertEqual(corrupted.returncode, 2)
        self.assertIn("unsafe private wrapper", corrupted.stderr)

    def test_duplicate_install_is_idempotent_and_restore_only_owns_its_config(self) -> None:
        first = self.invoke_installer("install")
        self.assertEqual(first.returncode, 0, first.stderr)
        before = (self.state / "installation.json").read_text()
        duplicate = self.invoke_installer("install")
        self.assertEqual(duplicate.returncode, 0, duplicate.stderr)
        self.assertEqual((self.state / "installation.json").read_text(), before)
        restored = self.invoke_installer("restore")
        self.assertEqual(restored.returncode, 0, restored.stderr)
        self.assertEqual(self.git("config", "--local", "--get", "core.hooksPath", check=False).returncode, 1)
        self.assertEqual(self.invoke_installer("install").returncode, 0)
        self.git("config", "--local", "core.hooksPath", str(self.base / "another-hooks"))
        refused = self.invoke_installer("restore")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("no longer owns", refused.stderr)

    def test_refuses_existing_hook_path_and_active_default_hook(self) -> None:
        external = self.base / "external-hooks"
        external.mkdir()
        self.git("config", "--local", "core.hooksPath", str(external))
        conflict = self.invoke_installer("install")
        self.assertEqual(conflict.returncode, 2)
        self.assertEqual(self.git("config", "--local", "--get", "core.hooksPath").stdout.strip(), str(external))
        self.git("config", "--local", "--unset-all", "core.hooksPath")
        common = Path(self.git("rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip())
        active = common / "hooks/pre-commit"
        active.write_text("#!/bin/sh\nexit 0\n")
        active.chmod(0o755)
        refused = self.invoke_installer("install")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("active default", refused.stderr)

    def test_refuses_effective_worktree_override(self) -> None:
        external = self.base / "worktree-hooks"
        external.mkdir()
        self.git("config", "extensions.worktreeConfig", "true")
        configured = self.git("config", "--worktree", "core.hooksPath", str(external))
        self.assertEqual(configured.returncode, 0, configured.stderr)
        refused = self.invoke_installer("install")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("effective", refused.stderr)
        self.assertEqual(self.git("config", "--worktree", "--get", "core.hooksPath").stdout.strip(), str(external))

    def test_refuses_effective_global_override_without_touching_parent_context(self) -> None:
        external = self.base / "global-hooks"
        external.mkdir()
        self.git("config", "--global", "core.hooksPath", str(external))
        refused = self.invoke_installer("install")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("effective", refused.stderr)
        self.assertEqual(self.git("config", "--global", "--get", "core.hooksPath").stdout.strip(), str(external))
        self.assertEqual({key: value for key, value in os.environ.items() if key.startswith("GIT_")}, self.parent_git_environment)

    def test_rejects_private_state_inside_repo_or_symlink(self) -> None:
        inside = subprocess.run([sys.executable, "-B", str(INSTALLER), "status", "--project-root", str(self.repo), "--state-root", str(self.repo / "private")], text=True, capture_output=True, env=self.git_env)
        self.assertEqual(inside.returncode, 2)
        target = self.base / "target"
        target.mkdir()
        self.state.symlink_to(target, target_is_directory=True)
        unsafe = self.invoke_installer("status")
        self.assertEqual(unsafe.returncode, 2)
        self.assertIn("symlink", unsafe.stderr)

    def module_context(self):
        root, common, worktrees = installer_module.project_context(self.repo)
        return root, common, worktrees, installer_module.validate_state_root(self.state, worktrees)

    def test_recovers_after_injected_git_config_failure(self) -> None:
        root, common, worktrees, state_root = self.module_context()
        original_git = self.safe_module_git

        def fail_config(project_root, *args, **kwargs):
            if args == ("config", "--local", "core.hooksPath", str(state_root / "wrappers")):
                raise installer_module.HookInstallError("injected config failure")
            return original_git(project_root, *args, **kwargs)

        with mock.patch.object(installer_module, "git", side_effect=fail_config):
            with self.assertRaisesRegex(installer_module.HookInstallError, "injected config failure"):
                installer_module.install(root, common, worktrees, state_root)
        state = json.loads((state_root / "installation.json").read_text())
        self.assertEqual(state["phase"], "installing")
        self.assertEqual(self.git("config", "--local", "--get", "core.hooksPath", check=False).returncode, 1)
        recovered = installer_module.install(root, common, worktrees, state_root)
        self.assertTrue(recovered["installed"])

    def test_recovers_after_injected_state_write_failures(self) -> None:
        root, common, worktrees, state_root = self.module_context()
        original_write = installer_module.write_state
        calls = 0

        def fail_final_install(path, data):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise installer_module.HookInstallError("injected state-write failure")
            return original_write(path, data)

        with mock.patch.object(installer_module, "write_state", side_effect=fail_final_install):
            with self.assertRaisesRegex(installer_module.HookInstallError, "injected state-write failure"):
                installer_module.install(root, common, worktrees, state_root)
        self.assertEqual(json.loads((state_root / "installation.json").read_text())["phase"], "installing")
        self.assertEqual(self.git("config", "--local", "--get", "core.hooksPath").stdout.strip(), str(state_root / "wrappers"))
        self.assertTrue(installer_module.install(root, common, worktrees, state_root)["installed"])

        calls = 0

        def fail_final_restore(path, data):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise installer_module.HookInstallError("injected restore-state failure")
            return original_write(path, data)

        with mock.patch.object(installer_module, "write_state", side_effect=fail_final_restore):
            with self.assertRaisesRegex(installer_module.HookInstallError, "injected restore-state failure"):
                installer_module.restore(root, common, state_root)
        self.assertEqual(json.loads((state_root / "installation.json").read_text())["phase"], "restoring")
        self.assertEqual(self.git("config", "--local", "--get", "core.hooksPath", check=False).returncode, 1)
        restored = installer_module.restore(root, common, state_root)
        self.assertFalse(restored["installed"])

    def test_recovers_after_injected_restore_config_failure(self) -> None:
        root, common, worktrees, state_root = self.module_context()
        self.assertTrue(installer_module.install(root, common, worktrees, state_root)["installed"])
        original_git = self.safe_module_git

        def fail_unset(project_root, *args, **kwargs):
            if args == ("config", "--local", "--unset-all", "core.hooksPath"):
                raise installer_module.HookInstallError("injected restore-config failure")
            return original_git(project_root, *args, **kwargs)

        with mock.patch.object(installer_module, "git", side_effect=fail_unset):
            with self.assertRaisesRegex(installer_module.HookInstallError, "injected restore-config failure"):
                installer_module.restore(root, common, state_root)
        self.assertEqual(json.loads((state_root / "installation.json").read_text())["phase"], "restoring")
        self.assertEqual(self.git("config", "--local", "--get", "core.hooksPath").stdout.strip(), str(state_root / "wrappers"))
        self.assertFalse(installer_module.restore(root, common, state_root)["installed"])


if __name__ == "__main__":
    unittest.main()
