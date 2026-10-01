#!/usr/bin/env python3
"""Local workspace metadata and opt-in POSIX directories; no network or installs."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import subprocess
import sys


def git(root, *args, optional=False):
    result = subprocess.run(
        ["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", str(root), *args],
        capture_output=True, text=True,
    )
    if result.returncode and not optional:
        raise ValueError("Git metadata unavailable; check the checkout and Git access.")
    return result.stdout.strip() if result.returncode == 0 else None


def inside(path, root):
    return path == root or root in path.parents


def worktrees(root):
    result = []
    for block in git(root, "worktree", "list", "--porcelain").split("\n\n"):
        fields = dict(line.split(" ", 1) for line in block.splitlines() if " " in line)
        if "worktree" in fields:
            result.append({"path": fields["worktree"], "head": fields.get("HEAD"),
                           "branch": fields.get("branch", "detached").removeprefix("refs/heads/")})
    return result


def local_paths(args):
    home = Path.home()
    if sys.platform == "darwin":
        defaults = (home / "Automation/.worktrees/skincos",
                    home / "Library/Application Support/skincos", home / "Library/Caches/skincos")
    elif os.name == "nt":
        state = Path(os.environ.get("LOCALAPPDATA", home / "AppData/Local")) / "Codex/skincos"
        defaults = (Path("C:/CodexShared/Worktrees/skincos"), state, state / "cache")
    else:
        state = Path(os.environ.get("XDG_STATE_HOME", home / ".local/state")) / "skincos"
        defaults = (state / "worktrees", state, Path(os.environ.get("XDG_CACHE_HOME", home / ".cache")) / "skincos")
    names = ("worktree_root", "state_root", "cache_root")
    envs = ("SKINCOS_WORKTREE_ROOT", "SKINCOS_LOCAL_STATE_ROOT", "SKINCOS_LOCAL_CACHE_ROOT")
    return {name: Path(getattr(args, name) or os.environ.get(env) or default).expanduser().resolve()
            for name, env, default in zip(names, envs, defaults)}


def guard_private_paths(paths, trees):
    candidates = [paths["state_root"], paths["cache_root"], paths["cache_root"] / "ef"]
    candidates += [paths["state_root"] / p for p in ("env-overrides", "profiles", "profiles/ef-app", "scraper", "scraper/report", "scraper/debug", "scraper/logs")]
    for candidate in candidates:
        if any(inside(candidate.resolve(), Path(tree["path"]).resolve()) for tree in trees):
            raise ValueError("Private state/cache paths must stay outside every Git worktree, including symlink targets.")


def environment(root, paths):
    if os.name == "nt":
        raise ValueError("Windows EF execution stays behind invoke-skincos-wsl.ps1; use its existing private runtime setup.")
    lock = root / "integration/ef/requirements.lock"
    if not lock.is_file():
        raise ValueError("EF requirements.lock is needed to select the local environment.")
    digest = hashlib.sha256(lock.read_bytes()).hexdigest()[:16]
    interpreter = f"python{sys.version_info.major}.{sys.version_info.minor}"
    return {
        "npm_config_cache": str(paths["cache_root"] / "npm"),
        "EF_SCRAPER_VENV_DIR": str(paths["cache_root"] / "ef" / f"{sys.platform}-{platform.machine()}-{interpreter}" / digest / "venv"),
        "EF_OUTPUT_DIR": str(paths["state_root"] / "scraper/report"),
        "EF_DEBUG_DIR": str(paths["state_root"] / "scraper/debug"),
        "EF_LOG_DIR": str(paths["state_root"] / "scraper/logs"),
        "EF_CHROME_USER_DATA_DIR": str(paths["state_root"] / "profiles/ef-app"),
    }


def validate_worktree(root, paths, args):
    if not args.task_slug or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,95}", args.task_slug):
        raise ValueError("A valid --task-slug is required.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,95}", args.actor):
        raise ValueError("A valid --actor is required.")
    common = Path(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve()
    own = Path(git(root, "rev-parse", "--path-format=absolute", "--git-dir")).resolve()
    if common == own:
        raise ValueError("Edit in a dedicated linked worktree, not the shared checkout.")
    expected = paths["worktree_root"] / args.actor / args.task_slug
    branch = git(root, "symbolic-ref", "--quiet", "--short", "HEAD", optional=True)
    if root != expected or branch != f"codex/{args.actor}/{args.task_slug}":
        raise ValueError("Worktree path, actor, task slug and branch must have the same identity.")
    return {"verified": True, "projectRoot": str(root), "branch": branch, "taskSlug": args.task_slug}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("status", "setup", "environment", "validate-worktree"))
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--worktree-root")
    parser.add_argument("--state-root")
    parser.add_argument("--cache-root")
    parser.add_argument("--task-slug")
    parser.add_argument("--actor", default="admin")
    parser.add_argument("--apply", action="store_true", help="Create empty private directories (POSIX setup only).")
    args = parser.parse_args()
    try:
        if args.apply and args.action != "setup":
            raise ValueError("--apply is valid only with setup.")
        root = Path(git(Path(args.project_root).expanduser(), "rev-parse", "--show-toplevel")).resolve()
        paths = local_paths(args)
        trees = worktrees(root)
        if args.action == "validate-worktree":
            result = validate_worktree(root, paths, args)
        else:
            guard_private_paths(paths, trees)
            if args.action == "environment":
                exports = environment(root, paths)
                if any(inside(Path(value).resolve(), Path(tree["path"]).resolve()) for value in exports.values() for tree in trees):
                    raise ValueError("An environment path resolves inside a Git worktree; no exports were emitted.")
                for key, value in exports.items():
                    print(f"export {key}={shlex.quote(value)}")
                return 0
            if args.action == "setup":
                directories = [paths["state_root"], paths["cache_root"]]
                directories += [paths["state_root"] / p for p in ("env-overrides", "profiles", "scraper/report", "scraper/debug", "scraper/logs")]
                if args.apply:
                    if os.name == "nt":
                        raise ValueError("Use setup-shared-codex-workspace.ps1 on Windows to preserve its ACL policy.")
                    if any(p.is_symlink() or (p.exists() and (p.stat().st_mode & 0o077)) for p in directories):
                        raise ValueError("An existing directory is not private; no permissions or data were changed.")
                    old_umask = os.umask(0o077)
                    try:
                        for path in directories:
                            path.mkdir(mode=0o700, parents=True, exist_ok=True)
                    finally:
                        os.umask(old_umask)
                result = {"applied": args.apply, "directories": list(map(str, directories)),
                          "note": "Empty directories only. No dependencies, secrets, services or Git settings are installed."}
            else:
                upstream = git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}", optional=True)
                main_counts = git(root, "rev-list", "--left-right", "--count", "HEAD...origin/main", optional=True)
                tracking_counts = git(root, "rev-list", "--left-right", "--count", f"HEAD...{upstream}", optional=True) if upstream else None
                origin = git(root, "remote", "get-url", "origin", optional=True) or ""
                expected = origin in ("https://github.com/jubenitogarcia/skincos.git", "https://github.com/jubenitogarcia/skincos", "git@github.com:jubenitogarcia/skincos.git")
                dirty = bool(git(root, "status", "--porcelain=v1", "--untracked-files=normal"))
                result = {"projectRoot": str(root), "head": git(root, "rev-parse", "HEAD"),
                          "branch": git(root, "symbolic-ref", "--quiet", "--short", "HEAD", optional=True),
                          "upstream": upstream, "dirty": dirty, "originMatchesSkincos": expected,
                          "vsOriginMain": list(map(int, main_counts.split())) if main_counts else None,
                          "vsUpstream": list(map(int, tracking_counts.split())) if tracking_counts else None,
                          "remoteContacted": False, "countsOrder": ["ahead", "behind"],
                          "worktrees": trees, "paths": {k: str(v) for k, v in paths.items()},
                          "note": "Counts use local fetched refs. Ignored files and private data are not inspected."}
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
