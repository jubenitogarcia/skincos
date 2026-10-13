#!/usr/bin/env python3
"""Read-only macOS SKINCOS environment diagnosis for the Codex Workspace action."""

import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
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


def nearest_existing(path: Path) -> Path:
    candidate = path.absolute()
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return candidate


def disk_status(paths: list[Path]) -> dict:
    volumes = []
    for path in paths:
        ancestor = nearest_existing(path)
        free = shutil.disk_usage(ancestor).free
        volumes.append({"path": str(path), "checkedAt": str(ancestor), "freeBytes": free})
    return {"status": "prepared" if all(entry["freeBytes"] >= MIN_FREE_BYTES for entry in volumes) else "missing", "minimumBytes": MIN_FREE_BYTES, "volumes": volumes}


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
    disk_paths = []
    if environment["status"] == "prepared":
        values = environment["value"]
        disk_paths.extend(Path(values[name]) for name in ("EF_SCRAPER_VENV_DIR", "EF_OUTPUT_DIR", "EF_DEBUG_DIR", "EF_LOG_DIR", "EF_CHROME_USER_DATA_DIR", "npm_config_cache"))
    else:
        disk_paths.append(root)

    config_path = root / ".codex/environments/environment.toml"
    try:
        actions = tomllib.loads(config_path.read_text(encoding="utf-8"))["actions"]
        platforms = {platform: sum(item.get("platform") == platform for item in actions) for platform in ("darwin", "win32")}
        platform_actions = {"status": "prepared" if platforms == {"darwin": 5, "win32": 5} else "missing", "counts": platforms}
    except (OSError, KeyError, tomllib.TOMLDecodeError) as error:
        platform_actions = {"status": "unavailable", "detail": str(error)}

    ef = ef_status(environment)

    disk = disk_status(disk_paths)

    code, hook_output = run(sys.executable, "scripts/install-local-git-hooks.py", "status", "--project-root", str(root), cwd=root)
    hooks = hook_status_from_result(code, hook_output)
    checks = {"workspace": workspace, "environment": environment, "tools": tools, "disk": disk, "platformActions": platform_actions, "efVenv": ef, "hooks": hooks}
    required = [workspace["status"], environment["status"], disk["status"], platform_actions["status"], ef["status"], hooks["status"]]
    required.extend(item["status"] for item in tools.values())
    status = "prepared" if all(item == "prepared" for item in required) else "missing"
    print(json.dumps({"status": status, "checks": checks}, indent=2))
    return 0 if status == "prepared" else 1


if __name__ == "__main__":
    raise SystemExit(main())
