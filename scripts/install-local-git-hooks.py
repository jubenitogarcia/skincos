#!/usr/bin/env python3
"""Install reversible, per-machine SKINCOS Git-hook wrappers.

The Git config that holds ``core.hooksPath`` lives in the shared common Git
directory, so an installation applies to every worktree of this local clone.
The wrappers themselves and their rollback checkpoint remain private to the
current macOS account.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from typing import Any


class HookInstallError(RuntimeError):
    pass


HOOKS = ("pre-commit", "pre-push")
STATE_FILE = "installation.json"
MARKER = "skincos-local-git-hooks-v1"


def git(project_root: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(project_root), *args],
        text=True,
        capture_output=True,
    )
    if check and result.returncode:
        raise HookInstallError(result.stderr.strip() or "git command failed")
    return result.stdout


def existing_path(path: Path) -> Path | None:
    """Return a lexical absolute path, rejecting a symlink at the target."""
    path = path.expanduser().absolute()
    if path.is_symlink():
        raise HookInstallError(f"refusing symlinked private path: {path}")
    return path if path.exists() else None


def ensure_private_directory(path: Path) -> None:
    if path.exists():
        if path.is_symlink() or not path.is_dir():
            raise HookInstallError(f"private state path must be a directory, not a symlink: {path}")
        if stat.S_IMODE(path.stat().st_mode) & 0o077:
            raise HookInstallError(f"private state path has group or world permissions: {path}")
        return
    path.mkdir(parents=True, mode=0o700)
    path.chmod(0o700)


def is_within(path: Path, ancestor: Path) -> bool:
    try:
        path.resolve().relative_to(ancestor.resolve())
        return True
    except ValueError:
        return False


def project_context(project_root: Path) -> tuple[Path, Path, list[Path]]:
    root = project_root.expanduser().resolve()
    if not root.is_dir():
        raise HookInstallError(f"project root is not a directory: {root}")
    actual_root = Path(git(root, "rev-parse", "--show-toplevel").strip()).resolve()
    if actual_root != root:
        raise HookInstallError(f"project root must be the Git worktree root: {actual_root}")
    common = Path(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").strip()).resolve()
    worktrees: list[Path] = []
    for line in git(root, "worktree", "list", "--porcelain").splitlines():
        if line.startswith("worktree "):
            worktrees.append(Path(line.removeprefix("worktree ")).resolve())
    if not worktrees:
        raise HookInstallError("could not determine linked Git worktrees")
    for hook in HOOKS:
        canonical = root / ".githooks" / hook
        if canonical.is_symlink() or not canonical.is_file() or not os.access(canonical, os.X_OK):
            raise HookInstallError(f"canonical hook is missing, unsafe, or not executable: {canonical}")
    return root, common, worktrees


def default_state_root(common: Path) -> Path:
    digest = hashlib.sha256(str(common).encode("utf-8")).hexdigest()[:16]
    return Path.home() / "Library/Application Support/skincos/git-hooks" / digest


def validate_state_root(state_root: Path, worktrees: list[Path]) -> Path:
    state_root = state_root.expanduser().absolute()
    if any(is_within(state_root, worktree) for worktree in worktrees):
        raise HookInstallError("private hook state must be outside every Git worktree")
    if state_root.exists():
        if state_root.is_symlink() or not state_root.is_dir():
            raise HookInstallError(f"private state path must be a directory, not a symlink: {state_root}")
        if stat.S_IMODE(state_root.stat().st_mode) & 0o077:
            raise HookInstallError(f"private state path has group or world permissions: {state_root}")
    return state_root


def local_hooks_values(project_root: Path) -> list[str]:
    return [value for value in git(project_root, "config", "--local", "--get-all", "core.hooksPath", check=False).splitlines() if value]


def effective_hooks_values(project_root: Path) -> list[str]:
    """Read the value Git will actually use, including worktree/global scope."""
    return [value for value in git(project_root, "config", "--get-all", "core.hooksPath", check=False).splitlines() if value]


def set_local_hooks_values(project_root: Path, values: list[str]) -> None:
    """Replace only the local checkpointed value; never touch other scopes."""
    git(project_root, "config", "--local", "--unset-all", "core.hooksPath", check=False)
    for value in values:
        git(project_root, "config", "--local", "--add", "core.hooksPath", value)
    if local_hooks_values(project_root) != values:
        raise HookInstallError("could not restore the checkpointed local core.hooksPath")


def active_default_hooks(common: Path) -> list[Path]:
    hooks_dir = common / "hooks"
    if not hooks_dir.exists():
        return []
    if hooks_dir.is_symlink() or not hooks_dir.is_dir():
        raise HookInstallError(f"unsafe default Git hooks path: {hooks_dir}")
    active = []
    for entry in hooks_dir.iterdir():
        if entry.name.endswith(".sample"):
            continue
        if entry.is_symlink() or entry.is_file():
            active.append(entry)
    return active


def state_path(state_root: Path) -> Path:
    return state_root / STATE_FILE


def load_state(state_root: Path) -> dict[str, Any] | None:
    path = state_path(state_root)
    if not path.exists():
        return None
    if path.is_symlink() or not path.is_file():
        raise HookInstallError(f"unsafe installer state: {path}")
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise HookInstallError(f"installer state has group or world permissions: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HookInstallError(f"invalid installer state: {path}") from exc
    required = {"marker", "commonDir", "wrappersPath", "previousHooksPath"}
    if not isinstance(data, dict) or not required.issubset(data) or data["marker"] != MARKER:
        raise HookInstallError(f"unrecognized or partial installer state: {path}")
    if not isinstance(data["previousHooksPath"], list) or not all(isinstance(x, str) for x in data["previousHooksPath"]):
        raise HookInstallError(f"invalid previous hooks-path checkpoint: {path}")
    if "active" in data and not isinstance(data["active"], bool):
        raise HookInstallError(f"invalid installer activation state: {path}")
    if "phase" in data and data["phase"] not in {"installing", "active", "restoring", "restored"}:
        raise HookInstallError(f"invalid installer transaction phase: {path}")
    return data


def phase(state: dict[str, Any]) -> str:
    """Interpret pre-transaction state files made by an earlier installer."""
    if "phase" in state:
        return state["phase"]
    return "active" if state.get("active", True) else "restored"


def wrapper_text(hook: str) -> str:
    return f'''#!/bin/sh
# {MARKER}; generated in private local state.
set -eu
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ] || [ ! -d "$repo_root/.git" ] && ! git -C "$repo_root" rev-parse --git-dir >/dev/null 2>&1; then
  echo "[skincos] refusing to run {hook}: current directory is not a Git worktree" >&2
  exit 2
fi
canonical="$repo_root/.githooks/{hook}"
if [ -L "$canonical" ] || [ ! -f "$canonical" ] || [ ! -x "$canonical" ]; then
  echo "[skincos] refusing to run {hook}: canonical hook is missing or unsafe" >&2
  exit 2
fi
export SKINCOS_SKIP_DEPLOY=1
exec "$canonical" "$@"
'''


def write_private_file(path: Path, contents: str) -> None:
    if path.exists() or path.is_symlink():
        raise HookInstallError(f"refusing to overwrite existing private file: {path}")
    path.write_text(contents, encoding="utf-8")
    path.chmod(0o700)


def wrapper_is_safe(path: Path, hook: str) -> bool:
    if path.is_symlink() or not path.is_file() or not os.access(path, os.X_OK):
        return False
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        return False
    try:
        return path.read_text(encoding="utf-8") == wrapper_text(hook)
    except OSError:
        return False


def write_state(state_root: Path, data: dict[str, Any]) -> None:
    path = state_path(state_root)
    temporary = state_root / f".{STATE_FILE}.tmp-{os.getpid()}"
    if temporary.exists() or temporary.is_symlink():
        raise HookInstallError(f"unexpected private temporary state: {temporary}")
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, path)


def describe(project_root: Path, common: Path, state_root: Path) -> dict[str, Any]:
    configured = local_hooks_values(project_root)
    effective = effective_hooks_values(project_root)
    state = load_state(state_root)
    wrapper_path = state_root / "wrappers"
    if state:
        if state["wrappersPath"] != str(wrapper_path):
            raise HookInstallError("private installer state has an unexpected wrappers path")
        if wrapper_path.is_symlink() or not wrapper_path.is_dir() or stat.S_IMODE(wrapper_path.stat().st_mode) & 0o077:
            raise HookInstallError(f"unsafe private wrappers path: {wrapper_path}")
        for hook in HOOKS:
            wrapper = wrapper_path / hook
            if not wrapper_is_safe(wrapper, hook):
                raise HookInstallError(f"partial or unsafe private wrapper: {wrapper}")
    owned = bool(state and phase(state) == "active" and state["commonDir"] == str(common) and state["wrappersPath"] == str(wrapper_path) and configured == [str(wrapper_path)] and effective == [str(wrapper_path)])
    return {
        "projectRoot": str(project_root),
        "commonGitDir": str(common),
        "stateRoot": str(state_root),
        "configuredHooksPath": configured,
        "effectiveHooksPath": effective,
        "installed": owned,
        "scope": "core.hooksPath is stored in this clone's local common Git config and therefore applies to all of its worktrees on this machine.",
    }


def install(project_root: Path, common: Path, worktrees: list[Path], state_root: Path) -> dict[str, Any]:
    state = load_state(state_root)
    wrappers = state_root / "wrappers"
    configured = local_hooks_values(project_root)
    effective = effective_hooks_values(project_root)
    expected = str(wrappers)
    if state:
        if state["commonDir"] != str(common) or state["wrappersPath"] != expected:
            raise HookInstallError("private installer state belongs to another repository or path")
        wrappers_safe = all(wrapper_is_safe(wrappers / hook, hook) for hook in HOOKS)
        current_phase = phase(state)
        if current_phase == "active":
            if configured == [expected] and effective == [expected] and wrappers_safe:
                return describe(project_root, common, state_root)
            raise HookInstallError("partial or conflicting existing installer state; restore or inspect it before reinstalling")
        if current_phase == "restoring":
            raise HookInstallError("restore is in progress; run restore again before installing")
        if current_phase == "installing":
            if configured == [expected] and effective == [expected] and wrappers_safe:
                state["active"] = True
                state["phase"] = "active"
                write_state(state_root, state)
                return describe(project_root, common, state_root)
            if configured or effective:
                raise HookInstallError("interrupted installation conflicts with the current effective hooks path")
            ensure_private_directory(state_root)
            if wrappers.exists() and (wrappers.is_symlink() or not wrappers.is_dir()):
                raise HookInstallError(f"unsafe private wrappers path: {wrappers}")
            if not wrappers.exists():
                wrappers.mkdir(mode=0o700)
                wrappers.chmod(0o700)
            for hook in HOOKS:
                wrapper = wrappers / hook
                if wrapper.exists() or wrapper.is_symlink():
                    if not wrapper_is_safe(wrapper, hook):
                        raise HookInstallError(f"partial or unsafe private wrapper: {wrapper}")
                else:
                    write_private_file(wrapper, wrapper_text(hook))
            git(project_root, "config", "--local", "core.hooksPath", expected)
            state["active"] = True
            state["phase"] = "active"
            write_state(state_root, state)
            return describe(project_root, common, state_root)
        if configured or effective or not wrappers_safe:
            raise HookInstallError("restored installer state conflicts with the current local hook configuration")
        state["previousHooksPath"] = []
        state["active"] = False
        state["phase"] = "installing"
        write_state(state_root, state)
        git(project_root, "config", "--local", "core.hooksPath", expected)
        state["active"] = True
        state["phase"] = "active"
        write_state(state_root, state)
        return describe(project_root, common, state_root)
    if configured or effective:
        raise HookInstallError("refusing to replace an existing local or effective core.hooksPath")
    active = active_default_hooks(common)
    if active:
        names = ", ".join(str(path) for path in active)
        raise HookInstallError(f"refusing to bypass active default Git hooks: {names}")
    ensure_private_directory(state_root)
    checkpoint = {
        "marker": MARKER,
        "commonDir": str(common),
        "wrappersPath": expected,
        "previousHooksPath": configured,
        "active": False,
        "phase": "installing",
    }
    write_state(state_root, checkpoint)
    return install(project_root, common, worktrees, state_root)


def restore(project_root: Path, common: Path, state_root: Path) -> dict[str, Any]:
    state = load_state(state_root)
    if not state:
        raise HookInstallError("no private local hook-installation state exists")
    wrappers = state_root / "wrappers"
    expected = str(wrappers)
    configured = local_hooks_values(project_root)
    effective = effective_hooks_values(project_root)
    if state["commonDir"] != str(common) or state["wrappersPath"] != expected:
        raise HookInstallError("private installer state does not match this repository")
    current_phase = phase(state)
    if current_phase == "restored":
        raise HookInstallError("local hooks were already restored")
    if current_phase == "installing":
        raise HookInstallError("installation is in progress; run install again before restoring")
    if current_phase == "active" and (configured != [expected] or effective != [expected]):
        raise HookInstallError("refusing restore because this installer no longer owns core.hooksPath")
    if current_phase == "restoring" and configured not in ([expected], state["previousHooksPath"]):
        raise HookInstallError("interrupted restore conflicts with the current local hooks path")
    if current_phase == "restoring" and effective not in ([expected], state["previousHooksPath"]):
        raise HookInstallError("interrupted restore conflicts with the current effective hooks path")
    if current_phase == "active":
        state["active"] = True
        state["phase"] = "restoring"
        write_state(state_root, state)
    set_local_hooks_values(project_root, state["previousHooksPath"])
    state["active"] = False
    state["phase"] = "restored"
    write_state(state_root, state)
    return describe(project_root, common, state_root)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("status", "install", "restore"))
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--state-root", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        root, common, worktrees = project_context(args.project_root)
        state_root = validate_state_root(args.state_root or default_state_root(common), worktrees)
        if args.action == "status":
            result = describe(root, common, state_root)
        elif args.action == "install":
            result = install(root, common, worktrees, state_root)
        else:
            result = restore(root, common, state_root)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except HookInstallError as exc:
        print(f"[skincos] {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
