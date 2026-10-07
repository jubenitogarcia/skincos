#!/usr/bin/env python3
"""Read-only macOS SKINCOS environment diagnosis for the Codex Workspace action."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import subprocess
import sys
import tomllib


REQUIRED_TOOLS = ("git", "node", "npm", "python3", "codex")
MIN_FREE_BYTES = 5 * 1024 ** 3


def run(*command: str, cwd: Path) -> tuple[int, str]:
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    return result.returncode, (result.stdout.strip() or result.stderr.strip())


def version(command: str, root: Path) -> dict:
    path = shutil.which(command)
    if not path:
        return {"status": "missing"}
    flag = "--version"
    code, output = run(command, flag, cwd=root)
    return {"status": "prepared" if code == 0 else "unavailable", "path": path, "version": output if code == 0 else None}


def current_python_version(root: Path) -> dict:
    code, output = run(sys.executable, "--version", cwd=root)
    return {"status": "prepared" if code == 0 else "unavailable", "path": sys.executable, "version": output if code == 0 else None}


def helper_json(root: Path, action: str) -> dict:
    code, output = run(sys.executable, "scripts/shared-workspace.py", action, "--project-root", str(root), cwd=root)
    if code:
        return {"status": "unavailable", "detail": output}
    try:
        return {"status": "prepared", "value": json.loads(output)}
    except json.JSONDecodeError:
        return {"status": "unavailable", "detail": "shared-workspace.py returned invalid JSON"}


def helper_environment(root: Path) -> dict:
    code, output = run(sys.executable, "scripts/shared-workspace.py", "environment", "--project-root", str(root), cwd=root)
    if code:
        return {"status": "unavailable", "detail": output}
    values = {}
    for line in output.splitlines():
        if not line.startswith("export ") or "=" not in line:
            return {"status": "unavailable", "detail": "shared-workspace.py returned invalid shell exports"}
        key, value = line.removeprefix("export ").split("=", 1)
        parsed = shlex.split(value)
        if len(parsed) != 1:
            return {"status": "unavailable", "detail": "shared-workspace.py returned unsafe shell exports"}
        values[key] = parsed[0]
    return {"status": "prepared", "value": values}


def preview_paths(root: Path) -> tuple[Path, Path]:
    spec = importlib.util.spec_from_file_location("mac_local_preview", root / "scripts/mac-local-preview.py")
    if not spec or not spec.loader:
        raise RuntimeError("mac-local-preview.py cannot be imported")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.private_default(root), module.cache_default(root)


def private_directory_status(path: Path) -> bool:
    """Read-only check for an existing private directory; never creates or chmods it."""
    try:
        mode = path.lstat().st_mode
    except OSError:
        return False
    return path.is_dir() and not path.is_symlink() and stat.S_IMODE(mode) & 0o077 == 0


def preview_dependency_status(root: Path, cache: Path) -> dict:
    spec = importlib.util.spec_from_file_location("mac_local_preview_doctor", root / "scripts/mac-local-preview.py")
    if not spec or not spec.loader:
        raise RuntimeError("mac-local-preview.py cannot be imported")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    dependencies = cache / "dependencies" / module.dependency_key(root / "website") / "website"
    marker = dependencies / ".preview-dependencies.json"
    expected = {"version": 1, "key": module.dependency_key(root / "website")}
    if not private_directory_status(cache):
        return {"status": "missing", "cacheRoot": str(cache), "dependencyMarker": str(marker), "requiredModules": ["next/package.json", "react/package.json", "react-dom/package.json", ".bin/next"]}
    try:
        if cache.is_symlink():
            raise module.PreviewError("Private preview cache root is a symlink")
        module.validate_private_descendant(cache, dependencies)
        module.validate_private_descendant(cache, marker, directory=False)
        module.validate_private_descendant(cache, dependencies / "node_modules")
        healthy = module.dependency_marker_matches(marker, expected) and module.dependency_tree_is_healthy(dependencies)
        status = "prepared" if healthy else "missing"
    except (OSError, module.PreviewError):
        status = "unavailable"
    return {"status": status, "cacheRoot": str(cache), "dependencyMarker": str(marker), "requiredModules": ["next/package.json", "react/package.json", "react-dom/package.json", ".bin/next"]}


def ef_status(environment: dict) -> dict:
    if environment["status"] != "prepared":
        return {"status": "unavailable", "venv": None}
    venv = Path(environment["value"]["EF_SCRAPER_VENV_DIR"])
    interpreter = venv / "bin/python"
    if not interpreter.is_file():
        return {"status": "missing", "venv": str(venv)}
    code, output = run(str(interpreter), "-c", "import openpyxl, requests, selenium; print('imports-ok')", cwd=venv)
    return {"status": "prepared" if code == 0 and output == "imports-ok" else "missing", "venv": str(venv), "imports": "openpyxl, requests, selenium"}


def hook_status_from_result(code: int, output: str) -> dict:
    try:
        value = json.loads(output)
        return {"status": "prepared" if code == 0 and value.get("installed") is True else "missing", "value": value}
    except json.JSONDecodeError:
        return {"status": "unavailable", "detail": output}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=".")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    if not (root / "AGENTS.md").is_file() or not (root / ".git").exists():
        print(json.dumps({"status": "unavailable", "detail": "Expected a SKINCOS Git worktree."}))
        return 2

    workspace = helper_json(root, "status")
    environment = helper_environment(root)
    tools = {name: (current_python_version(root) if name == "python3" else version(name, root)) for name in REQUIRED_TOOLS}
    free = shutil.disk_usage(root).free
    disk = {"status": "prepared" if free >= MIN_FREE_BYTES else "missing", "freeBytes": free, "minimumBytes": MIN_FREE_BYTES}

    config_path = root / ".codex/environments/environment.toml"
    try:
        actions = tomllib.loads(config_path.read_text(encoding="utf-8"))["actions"]
        platforms = {platform: sum(item.get("platform") == platform for item in actions) for platform in ("darwin", "win32")}
        platform_actions = {"status": "prepared" if platforms == {"darwin": 6, "win32": 6} else "missing", "counts": platforms}
    except (OSError, KeyError, tomllib.TOMLDecodeError) as error:
        platform_actions = {"status": "unavailable", "detail": str(error)}

    ef = ef_status(environment)

    try:
        preview_state, preview_cache = preview_paths(root)
        preview = {"stateRoot": str(preview_state), **preview_dependency_status(root, preview_cache)}
        if not private_directory_status(preview_state):
            preview["status"] = "missing"
    except (OSError, RuntimeError) as error:
        preview = {"status": "unavailable", "detail": str(error)}

    code, hook_output = run(sys.executable, "scripts/install-local-git-hooks.py", "status", "--project-root", str(root), cwd=root)
    hooks = hook_status_from_result(code, hook_output)
    checks = {"workspace": workspace, "environment": environment, "tools": tools, "disk": disk, "platformActions": platform_actions, "efVenv": ef, "previewDependencies": preview, "hooks": hooks}
    required = [workspace["status"], environment["status"], disk["status"], platform_actions["status"], ef["status"], preview["status"], hooks["status"]]
    required.extend(item["status"] for item in tools.values())
    status = "prepared" if all(item == "prepared" for item in required) else "missing"
    print(json.dumps({"status": status, "checks": checks}, indent=2))
    return 0 if status == "prepared" else 1


if __name__ == "__main__":
    raise SystemExit(main())
