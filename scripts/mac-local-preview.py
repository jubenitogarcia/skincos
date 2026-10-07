#!/usr/bin/env python3
"""Private, attested local Website preview for macOS (also testable on Linux).

This runner deliberately never writes to the checkout.  It copies only the
runtime website tree to private state, installs dependencies in a separate
private cache, and starts Next with a scrubbed environment on loopback.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import http.client
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import signal
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse

try:
    import fcntl
except ImportError:  # pragma: no cover - the runner is POSIX only
    fcntl = None

ROUTE = "/beleza-em-movimento/local-preview"
PROTOCOL = "beauty-movement-local-preview-v2"
BUILD_CONTRACT = "next-dev-isolated-v1"
FINGERPRINT_HEADER = "X-Skincos-Preview-Fingerprint"
INSTANCE_HEADER = "X-Skincos-Preview-Instance"
EXCLUDED = {".git", "node_modules", ".next", ".next-codex-preview", ".open-next", ".wrangler", "docs", "logs", "reports", "tests", "tmp"}
SENSITIVE_ROOT = {".env", ".dev.vars", ".npmrc"}
SAFE_SYNTHETIC_ENV_EXAMPLES = {".env.example", ".dev.vars.example"}


class PreviewError(RuntimeError):
    pass


def is_descendant(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def private_default(root: Path) -> Path:
    key = hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:20]
    return Path.home() / "Library/Application Support/skincos/local-preview" / key


def cache_default(root: Path) -> Path:
    key = hashlib.sha256(str(root.resolve()).encode()).hexdigest()[:20]
    return Path.home() / "Library/Caches/skincos/local-preview" / key


def ensure_private(root: Path, state: Path) -> None:
    if is_descendant(state, root):
        raise PreviewError("Private preview state must be outside the source worktree.")
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state.is_symlink() or state.stat().st_mode & 0o077:
        raise PreviewError("Private preview state must be a non-symlink directory with mode 0700.")


def validate_private_descendant(root: Path, candidate: Path, *, directory: bool = True) -> None:
    """Reject pre-existing links before a private child can be created or used."""
    root = root.absolute()
    candidate = candidate.absolute()
    try:
        parts = candidate.relative_to(root).parts
    except ValueError as exc:
        raise PreviewError("Private preview path escapes its private root.") from exc
    if not parts:
        return
    current = root
    for index, part in enumerate(parts):
        current = current / part
        if current.is_symlink():
            raise PreviewError(f"Private preview path contains a symlink: {current}")
        if current.exists() and (index < len(parts) - 1 or directory) and not current.is_dir():
            raise PreviewError(f"Private preview path is not a directory: {current}")
        if current.exists() and index == len(parts) - 1 and not directory and current.is_file() and current.stat().st_nlink > 1:
            raise PreviewError(f"Private preview file has multiple hard links: {current}")


@contextlib.contextmanager
def state_lock(state: Path):
    if fcntl is None:
        raise PreviewError("macOS/POSIX file locking is required.")
    lock = state / "lock"
    validate_private_descendant(state, lock, directory=False)
    with lock.open("a+", encoding="utf-8") as handle:
        os.chmod(lock, 0o600)
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise PreviewError("Another local-preview invocation is reconciling this worktree.") from exc
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def command_json(root: Path, *arguments: str) -> dict:
    helper = root / "scripts/website-local-preview-state.mjs"
    result = subprocess.run(["node", str(helper), *arguments, "--json"], text=True, capture_output=True)
    if result.returncode != 0:
        raise PreviewError(result.stderr.strip() or "Website preview identity helper failed.")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise PreviewError("Website preview identity helper returned invalid JSON.") from exc
    if value.get("ok") is not True:
        raise PreviewError("Website preview identity helper rejected the source.")
    return value


def identity(root: Path, route: str) -> dict:
    # Include this native runner in the contract without changing the existing
    # Windows/WSL contract list.  An edited runner can never reuse old output.
    return command_json(root, "identity", "--source-root", str(root), "--route", route,
                        "--protocol", PROTOCOL, "--build-contract", BUILD_CONTRACT,
                        "--contract-file", "scripts/mac-local-preview.py")


def safe_source_tree(website: Path) -> None:
    for item in website.rglob("*"):
        relative = item.relative_to(website)
        if any(part.lower() in EXCLUDED for part in relative.parts):
            continue
        if item.is_symlink() and not is_descendant(item.resolve(), website):
            raise PreviewError(f"Preview input symlink leaves website/: {relative}")


def ignore_source(directory: str, names: list[str]):
    ignored = set()
    for name in names:
        lower = name.lower()
        is_private_environment = (lower in SENSITIVE_ROOT or lower.startswith(".env.") or lower.startswith(".dev.vars.")) and lower not in SAFE_SYNTHETIC_ENV_EXAMPLES
        if lower in EXCLUDED or is_private_environment:
            ignored.add(name)
    return ignored


def validate_synthetic_environment(website: Path) -> None:
    """Fail closed instead of copying or inheriting a local credential file."""
    prohibited = []
    for item in website.iterdir():
        lower = item.name.lower()
        if item.is_file() and (lower == ".npmrc" or lower == ".env" or lower.startswith(".env.") or lower == ".dev.vars" or lower.startswith(".dev.vars.")) and lower not in SAFE_SYNTHETIC_ENV_EXAMPLES:
            prohibited.append(item.name)
    if prohibited:
        raise PreviewError("Synthetic local preview refuses credential environment files: " + ", ".join(sorted(prohibited)))


def lock_digest(website: Path) -> str:
    digest = hashlib.sha256()
    for name in ("package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc"):
        file = website / name
        digest.update(name.encode() + b"\0")
        digest.update(file.read_bytes() if file.is_file() else b"missing")
        digest.update(b"\0")
    return digest.hexdigest()


def node_major() -> str:
    result = subprocess.run(["node", "--version"], capture_output=True, text=True, check=False)
    if result.returncode or not result.stdout.strip().startswith("v"):
        raise PreviewError("Node.js is required for the local preview.")
    return result.stdout.strip().split(".", 1)[0].lstrip("v")


def dependency_key(website: Path) -> str:
    return f"{sys.platform}-{platform.machine()}-node{node_major()}-{lock_digest(website)}"


def isolated_npm_environment(cache: Path) -> dict:
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    npm_userconfig = cache / "npm-userconfig"
    npm_cache = cache / "npm"
    validate_private_descendant(cache, npm_userconfig, directory=False)
    validate_private_descendant(cache, npm_cache)
    npm_userconfig.touch(mode=0o600, exist_ok=True)
    os.chmod(npm_userconfig, 0o600)
    environment = {key: os.environ[key] for key in ("PATH", "TMPDIR", "LANG", "LC_ALL") if key in os.environ}
    environment.update({"NPM_CONFIG_USERCONFIG": str(npm_userconfig), "NPM_CONFIG_CACHE": str(npm_cache)})
    return environment


def dependency_tree_is_healthy(dependencies: Path) -> bool:
    node_modules = dependencies / "node_modules"
    required = (
        node_modules / "next/package.json",
        node_modules / "react/package.json",
        node_modules / "react-dom/package.json",
        node_modules / ".bin/next",
    )
    return node_modules.is_dir() and all(path.is_file() for path in required)


def dependency_marker_matches(marker: Path, expected: dict) -> bool:
    try:
        return marker.is_file() and json.loads(marker.read_text(encoding="utf-8")) == expected
    except (OSError, json.JSONDecodeError, TypeError):
        return False


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    temporary.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def materialize(root: Path, state: Path, cache: Path, current: dict, install: bool) -> tuple[Path, Path]:
    website = root / "website"
    if not (website / "package.json").is_file() or not (website / "package-lock.json").is_file():
        raise PreviewError("website/package.json and website/package-lock.json are required.")
    validate_synthetic_environment(website)
    safe_source_tree(website)
    cache_key = current["cacheKey"]
    materialized = state / "source" / cache_key
    destination = materialized / "website"
    dependencies = cache / "dependencies" / dependency_key(website) / "website"
    validate_private_descendant(state, materialized)
    validate_private_descendant(state, destination)
    validate_private_descendant(cache, dependencies)
    if not destination.exists():
        materialized.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix="website-", dir=materialized.parent if materialized.parent.exists() else state))
        try:
            # Resolve permitted in-tree file links into the private snapshot so
            # no absolute link can keep reading from the source checkout.
            shutil.copytree(website, temporary / "website", ignore=ignore_source, symlinks=False)
            temporary.replace(materialized)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary, ignore_errors=True)
    if install:
        dependencies.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name in ("package.json", "package-lock.json", "npm-shrinkwrap.json"):
            source = website / name
            target = dependencies / name
            validate_private_descendant(cache, target, directory=False)
            if source.is_file():
                shutil.copy2(source, target)
            elif target.exists():
                target.unlink()
        marker = dependencies / ".preview-dependencies.json"
        validate_private_descendant(cache, marker, directory=False)
        validate_private_descendant(cache, dependencies / "node_modules")
        expected = {"version": 1, "key": dependency_key(website)}
        installed = dependency_marker_matches(marker, expected) and dependency_tree_is_healthy(dependencies)
        if not installed:
            subprocess.run(["npm", "--prefix", str(dependencies), "ci"], check=True, env=isolated_npm_environment(cache))
            if not dependency_tree_is_healthy(dependencies):
                raise PreviewError("npm ci did not create the required Next, React, React DOM, and next executable dependencies.")
            write_json(marker, expected)
        link = destination / "node_modules"
        if link.is_symlink() and link.resolve() != (dependencies / "node_modules").resolve():
            raise PreviewError("Materialized source node_modules link does not point at its private dependency cache.")
        elif link.exists() and not link.is_symlink():
            raise PreviewError("Materialized source has an unexpected node_modules directory.")
        if not link.exists():
            link.symlink_to(dependencies / "node_modules", target_is_directory=True)
    return materialized, dependencies


def ps_value(pid: int, field: str) -> str | None:
    result = subprocess.run(["ps", "-p", str(pid), "-o", f"{field}="], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else None


def process_cwd(pid: int) -> Path | None:
    result = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True)
    for line in result.stdout.splitlines():
        if line.startswith("n"):
            return Path(line[1:]).resolve()
    return None


def process_group(pid: int) -> int | None:
    value = ps_value(pid, "pgid")
    return int(value) if value and value.isdecimal() else None


def parent_pid(pid: int) -> int | None:
    value = ps_value(pid, "ppid")
    return int(value) if value and value.isdecimal() else None


def descendant_of(candidate: int, ancestor: int) -> bool:
    for _ in range(64):
        if candidate == ancestor:
            return True
        candidate = parent_pid(candidate)
        if candidate is None or candidate <= 1:
            return False
    return False


def listener_pids(port: int) -> set[int]:
    result = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], capture_output=True, text=True)
    return {int(value) for value in result.stdout.split() if value.isdecimal()}


def valid_manifest_identity(manifest: dict) -> tuple[int, int, str] | None:
    if not isinstance(manifest, dict):
        return None
    pid = manifest.get("pid")
    port = manifest.get("port")
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        return None
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        return None
    materialized_source = manifest.get("materializedSource")
    if not isinstance(materialized_source, str) or not materialized_source.strip():
        return None
    url = validated_manifest_url(manifest)
    return (pid, port, url) if url else None


def validate_manifest_custody(manifest: dict, root: Path, state: Path) -> tuple[int, int, str] | None:
    identity = valid_manifest_identity(manifest)
    if not identity:
        return False
    cache_key = manifest.get("cacheKey")
    project_root = manifest.get("projectRoot")
    materialized_source = manifest.get("materializedSource")
    if not isinstance(cache_key, str) or not re.fullmatch(r"[0-9a-f]{64}", cache_key):
        return None
    if not isinstance(project_root, str) or not isinstance(materialized_source, str):
        return None
    try:
        if Path(project_root).resolve() != root.resolve():
            return None
        expected = state.absolute() / "source" / cache_key / "website"
        if Path(materialized_source).absolute() != expected or not expected.is_dir():
            return None
        validate_private_descendant(state, expected)
    except (OSError, PreviewError):
        return None
    return identity


def owned_process(manifest: dict, root: Path, state: Path) -> bool:
    identity = validate_manifest_custody(manifest, root, state)
    if not identity:
        return False
    pid, _port, _url = identity
    actual_start = ps_value(pid, "lstart")
    if not actual_start or actual_start != manifest.get("processStart"):
        return False
    command = ps_value(pid, "command") or ""
    expected_cwd = Path(manifest["materializedSource"]).resolve()
    return "next" in command and process_cwd(pid) == expected_cwd and process_group(pid) == pid


def owned_listener(manifest: dict, root: Path, state: Path) -> bool:
    identity = validate_manifest_custody(manifest, root, state)
    if not identity or not owned_process(manifest, root, state):
        return False
    pid, port, _url = identity
    return any(descendant_of(listener, pid) for listener in listener_pids(port))


def port_is_available(port: int) -> bool:
    return not listener_pids(port)


def local_preview_url(port: int, route: str) -> str | None:
    if not isinstance(port, int) or not 1 <= port <= 65535:
        return None
    if not isinstance(route, str) or not route.startswith("/") or any(character.isspace() or ord(character) < 32 for character in route) or "?" in route or "#" in route:
        return None
    return f"http://127.0.0.1:{port}{route}"


def validated_manifest_url(manifest: dict) -> str | None:
    expected = local_preview_url(manifest.get("port"), manifest.get("route"))
    return expected if expected and manifest.get("url") == expected else None


def response_ready(url: str, fingerprint: str, instance: str) -> bool:
    try:
        if not isinstance(url, str) or any(ord(character) < 32 for character in url) or re.search(r"%(?![0-9A-Fa-f]{2})", url):
            return False
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username or parsed.password or
                parsed.fragment or parsed.query or not parsed.path or parsed.port is None or not 1 <= parsed.port <= 65535):
            return False
    except (TypeError, ValueError):
        return False
    connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=2)
    try:
        request_path = urllib.parse.quote(parsed.path or "/", safe="/%")
        connection.request("GET", request_path)
        response = connection.getresponse()
        body = response.read()
        headers = {key.lower(): value for key, value in response.getheaders()}
        expected_content = b"<html" in body.lower()
        if parsed.path == ROUTE:
            expected_content = expected_content and b"Beleza que se move com voc" in body and b"Novo Hamburgo" in body
        return (response.status == 200 and expected_content and
                headers.get(FINGERPRINT_HEADER.lower()) == fingerprint and
                headers.get(INSTANCE_HEADER.lower()) == instance)
    except OSError:
        return False
    finally:
        connection.close()


def stop(manifest: dict, root: Path, state: Path) -> bool:
    identity = validate_manifest_custody(manifest, root, state)
    if not identity or not owned_process(manifest, root, state):
        return False
    pid, _port, _url = identity
    os.killpg(pid, signal.SIGTERM)
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and ps_value(pid, "lstart"):
        time.sleep(.2)
    if ps_value(pid, "lstart"):
        os.killpg(pid, signal.SIGKILL)
    (state / "current.json").unlink(missing_ok=True)
    return True


def clean_environment(runtime_config: Path, fingerprint: str, instance: str, dist_dir: str) -> dict:
    runtime_config.mkdir(mode=0o700, parents=True, exist_ok=True)
    allowed = {key: os.environ[key] for key in ("PATH", "TMPDIR", "LANG", "LC_ALL", "TERM") if key in os.environ}
    allowed.update({
        "XDG_CONFIG_HOME": str(runtime_config),
        "NODE_ENV": "development", "NEXT_TELEMETRY_DISABLED": "1", "SKINCOS_LOCAL_PREVIEW": "true",
        "SKINCOS_LOCAL_PREVIEW_FINGERPRINT": fingerprint,
        "SKINCOS_LOCAL_PREVIEW_INSTANCE": instance,
        "SKINCOS_LOCAL_PREVIEW_DIST_DIR": dist_dir,
        "WEBSITE_INSTANCE_FINGERPRINT": fingerprint, "WEBSITE_INSTANCE_ID": instance,
        "WEBSITE_INSTANCE_EXPECTED_FINGERPRINT": fingerprint, "WEBSITE_INSTANCE_EXPECTED_ID": instance,
    })
    return allowed


def next_command(materialized: Path, port: int) -> tuple[list[str], Path]:
    """Return an app-root command; Next does not search nested website/ trees."""
    website = materialized / "website"
    return [str(website / "node_modules/.bin/next"), "dev", "-H", "127.0.0.1", "-p", str(port)], website


def start(args, root: Path, state: Path, cache: Path, previous: dict | None) -> dict:
    validate_synthetic_environment(root / "website")
    desired = identity(root, args.route)
    previous_identity = validate_manifest_custody(previous, root, state) if previous else None
    previous_url = previous_identity[2] if previous_identity else None
    if previous and previous_url and previous.get("instanceFingerprint") == desired["instanceFingerprint"] and previous.get("route") == args.route and owned_listener(previous, root, state):
        url = previous_url
        if response_ready(url, desired["instanceFingerprint"], previous.get("instanceId", "")):
            return {**previous, "state": "reused"}
    if previous:
        stop(previous, root, state)  # Unproved/recycled PIDs are never signalled.
    materialized, _dependencies = materialize(root, state, cache, desired, install=True)
    if identity(root, args.route)["instanceFingerprint"] != desired["instanceFingerprint"]:
        raise PreviewError("Website inputs changed while the private preview source was materialized; retry after edits settle.")
    if not port_is_available(args.port):
        raise PreviewError(f"Port {args.port} is already listening; it will not be reused or terminated.")
    instance = secrets.token_hex(16)
    dist_dir = f".next-codex-preview/{desired['cacheKey']}-{instance[:12]}"
    url = local_preview_url(args.port, args.route)
    if not url:
        raise PreviewError("Expected a loopback HTTP preview URL.")
    log = state / "server.log"
    validate_private_descendant(state, log, directory=False)
    validate_private_descendant(state, state / "runtime-config")
    command, materialized_website = next_command(materialized, args.port)
    with log.open("ab", buffering=0) as output:
        process = subprocess.Popen(command,
                                   cwd=materialized_website, env=clean_environment(state / "runtime-config", desired["instanceFingerprint"], instance, dist_dir),
                                   stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    process_start = None
    for _ in range(20):
        process_start = ps_value(process.pid, "lstart")
        if process_start:
            break
        time.sleep(.1)
    if not process_start:
        raise PreviewError("Preview supervisor did not start; see private server.log.")
    for _ in range(args.timeout * 5):
        manifest_probe = {"pid": process.pid, "processStart": process_start, "materializedSource": str(materialized_website),
                          "port": args.port, "route": args.route, "url": url, "cacheKey": desired["cacheKey"], "projectRoot": str(root)}
        if response_ready(url, desired["instanceFingerprint"], instance) and owned_process(manifest_probe, root, state) and any(descendant_of(listener, process.pid) for listener in listener_pids(args.port)):
            manifest = {"version": 1, "state": "ready", "protocol": PROTOCOL, "buildContract": BUILD_CONTRACT,
                        "projectRoot": str(root), "materializedSource": str(materialized_website), "instanceFingerprint": desired["instanceFingerprint"],
                        "inputFingerprint": desired["inputFingerprint"], "contractFingerprint": desired["contractFingerprint"], "cacheKey": desired["cacheKey"],
                        "route": args.route, "port": args.port, "url": url, "instanceId": instance, "distDir": dist_dir,
                        "pid": process.pid, "processStart": process_start, "startedAt": int(time.time())}
            write_json(state / "current.json", manifest)
            return {**manifest, "state": "started"}
        if process.poll() is not None:
            raise PreviewError("Preview process exited before attestation; see private server.log.")
        time.sleep(.2)
    if owned_process({"pid": process.pid, "processStart": process_start, "materializedSource": str(materialized_website),
                      "port": args.port, "route": args.route, "url": url, "cacheKey": desired["cacheKey"], "projectRoot": str(root)}, root, state):
        os.killpg(process.pid, signal.SIGTERM)
    raise PreviewError("Preview did not attest requested headers and content before timeout; see private server.log.")


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("action", choices=("prepare", "start", "status", "stop"))
    value.add_argument("--project-root", default=".")
    value.add_argument("--state-root")
    value.add_argument("--cache-root", help="Private npm cache root; defaults to ~/Library/Caches/skincos/local-preview/<worktree-key>.")
    value.add_argument("--route", default=ROUTE)
    value.add_argument("--port", type=int, default=3417)
    value.add_argument("--timeout", type=int, default=90)
    value.add_argument("--no-browser", action="store_true", help="Accepted for shortcut compatibility; browsers are never opened by this runner.")
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        root = Path(args.project_root).resolve()
        if not (root / "website").is_dir() or not local_preview_url(args.port, args.route):
            raise PreviewError("Expected a project root with website/, an absolute route, and a valid TCP port.")
        state = Path(args.state_root).expanduser().absolute() if args.state_root else private_default(root)
        ensure_private(root, state)
        cache = Path(args.cache_root).expanduser().absolute() if args.cache_root else cache_default(root)
        ensure_private(root, cache)
        with state_lock(state):
            manifest_path = state / "current.json"
            validate_private_descendant(state, manifest_path, directory=False)
            previous = json.loads(manifest_path.read_text()) if manifest_path.is_file() else None
            if previous is not None and not isinstance(previous, dict):
                raise PreviewError("Private current.json must contain an object.")
            if args.action == "prepare":
                current = identity(root, args.route)
                source, dependencies = materialize(root, state, cache, current, install=True)
                output = {"state": "prepared", "source": str(source), "dependencies": str(dependencies), "instanceFingerprint": current["instanceFingerprint"]}
            elif args.action == "start":
                output = start(args, root, state, cache, previous)
            elif args.action == "status":
                identity_matches = False
                current_identity = validate_manifest_custody(previous, root, state) if previous else None
                current_url = current_identity[2] if current_identity else None
                if previous:
                    try:
                        validate_synthetic_environment(root / "website")
                        identity_matches = identity(root, args.route)["instanceFingerprint"] == previous.get("instanceFingerprint") and previous.get("route") == args.route
                    except PreviewError:
                        identity_matches = False
                output = {"state": "missing"} if not previous else {**previous, "state": "ready" if current_url and identity_matches and owned_listener(previous, root, state) and response_ready(current_url, previous.get("instanceFingerprint", ""), previous.get("instanceId", "")) else "stale"}
            else:
                output = {"state": "stopped" if previous and stop(previous, root, state) else "not-owned-or-missing"}
        print(json.dumps(output, sort_keys=True))
        return 0
    except (PreviewError, subprocess.CalledProcessError, OSError, json.JSONDecodeError) as error:
        print(f"[mac-local-preview] {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
