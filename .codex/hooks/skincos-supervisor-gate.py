#!/usr/bin/env python3
"""Deterministic, fail-safe Stop gate for SKINCOS supervised continuity."""

from __future__ import annotations

import argparse
import ctypes
import datetime as dt
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
SNAPSHOT_SCHEMA_VERSION = 1
MARKER_BEGIN = "SKINCOS_SUPERVISOR_STATE_BEGIN"
MARKER_END = "SKINCOS_SUPERVISOR_STATE_END"
ALLOWED_STATUSES = {
    "continue",
    "complete",
    "human_blocked",
    "credential_blocked",
    "production_authorization_required",
    "cycle_budget_exhausted",
    "safety_stop",
    "error",
}
REQUIRED_FIELDS = {
    "schema_version",
    "orchestration_status",
    "objective_status",
    "session_id",
    "completed_item",
    "next_item",
    "progress_made",
    "human_blocker",
    "credential_blocker",
    "production_authorization_required",
    "evidence_refs",
}
DEFAULT_CONFIG = {
    "schema_version": 1,
    "enabled": True,
    "max_cycles": 64,
    "emergency_cycle_limit": 64,
    "cycle_limit_mode": "emergency-only",
    "cooldown_seconds": 2,
    "session_lock_ttl_seconds": 180,
    "orphan_grace_seconds": 5,
    "target_lease_ttl_seconds": 3600,
}
SNAPSHOT_INPUT_FIELDS = {
    "schema_version",
    "authorization_source",
    "issue",
    "branch",
    "worktree",
    "branch_worktree",
    "checkpoint",
    "remote_fingerprint",
    "blocker_fingerprint",
    "valid_evidence_refs",
    "resource_declaration",
    "task_slug",
}
SNAPSHOT_TOP_LEVEL_FIELDS = SNAPSHOT_INPUT_FIELDS - {"schema_version"}
SNAPSHOT_STRING_FIELDS = (
    "authorization_source",
    "checkpoint",
    "remote_fingerprint",
    "blocker_fingerprint",
    "task_slug",
)
RESOURCE_DECLARATION_SCHEMA_VERSION = 1
RESOURCE_DECLARATION_FIELDS = {
    "schema_version",
    "reads",
    "writes",
    "requires",
    "leases",
}
RESOURCE_DECLARATION_LIST_FIELDS = ("reads", "writes", "requires", "leases")
MAX_RESOURCE_DECLARATION_ITEMS = 64
MAX_RESOURCE_DECLARATION_ITEM_LENGTH = 256
GLOBAL_RESOURCE_PREFIXES = (
    "merge:",
    "release:",
    "deploy:",
    "mutate:",
    "cloudflare:",
    "promotion:",
    "global:",
)
MAX_SNAPSHOT_STRING_LENGTH = 512
MAX_EVIDENCE_REFS = 32
MAX_EVIDENCE_REF_LENGTH = 384
MAX_SNAPSHOT_ITEM_BYTES = 4096


def utc_iso(now: float | None = None) -> str:
    stamp = time.time() if now is None else now
    return dt.datetime.fromtimestamp(stamp, tz=dt.timezone.utc).isoformat().replace("+00:00", "Z")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


def safe_allow(reason: str) -> dict[str, Any]:
    return {"continue": True, "stopReason": reason[:900]}


def block(reason: str) -> dict[str, Any]:
    return {"decision": "block", "reason": reason}


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return None
    return value if isinstance(value, dict) else None


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    temp.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temp, path)


def append_event(runtime_root: Path, value: dict[str, Any]) -> None:
    path = runtime_root / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")


def parse_windows_path_for_posix(raw: str) -> Path:
    match = re.match(r"^([A-Za-z]):[\\/](.*)$", raw)
    if match and os.name != "nt":
        drive, rest = match.groups()
        return Path("/mnt") / drive.lower() / Path(rest.replace("\\", "/"))
    return Path(raw)


def discover_git_common_dir(repo_root: Path) -> Path:
    dot_git = repo_root / ".git"
    if dot_git.is_dir():
        return dot_git.resolve()
    if dot_git.is_file():
        first = dot_git.read_text(encoding="utf-8", errors="replace").strip()
        if first.lower().startswith("gitdir:"):
            raw = first.split(":", 1)[1].strip()
            git_dir = parse_windows_path_for_posix(raw)
            if not git_dir.is_absolute():
                git_dir = (repo_root / git_dir).resolve()
            if git_dir.parent.name == "worktrees":
                return git_dir.parent.parent
            return git_dir
    try:
        output = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "--git-common-dir"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
        path = parse_windows_path_for_posix(output)
        return path if path.is_absolute() else (repo_root / path).resolve()
    except (OSError, subprocess.SubprocessError):
        return repo_root / ".codex" / "runtime" / "supervisor" / "coordination"


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".codex" / "supervisor.json").is_file() and (
            candidate / "skills" / "skincos-project-orchestrator" / "SKILL.md"
        ).is_file():
            return candidate
    return Path(__file__).resolve().parents[2]


def load_config(repo_root: Path) -> tuple[dict[str, Any] | None, str | None]:
    path = repo_root / ".codex" / "supervisor.json"
    configured = read_json(path)
    if configured is None:
        return None, f"invalid or missing configuration: {path}"
    merged = dict(DEFAULT_CONFIG)
    merged.update(configured)
    try:
        if int(merged["schema_version"]) != SCHEMA_VERSION:
            raise ValueError("unsupported schema")
        for key in (
            "max_cycles",
            "emergency_cycle_limit",
            "cooldown_seconds",
            "session_lock_ttl_seconds",
            "orphan_grace_seconds",
            "target_lease_ttl_seconds",
        ):
            merged[key] = int(merged[key])
            if merged[key] < 0:
                raise ValueError(f"{key} must not be negative")
        if merged["max_cycles"] < 1:
            raise ValueError("max_cycles must be at least 1")
        if merged["emergency_cycle_limit"] < merged["max_cycles"]:
            raise ValueError("emergency_cycle_limit must be at least max_cycles")
        if merged.get("cycle_limit_mode") != "emergency-only":
            raise ValueError("cycle_limit_mode must be emergency-only")
        if not isinstance(merged["enabled"], bool):
            raise ValueError("enabled must be boolean")
    except (KeyError, TypeError, ValueError) as exc:
        return None, f"invalid supervisor configuration: {exc}"
    return merged, None


def extract_contract(message: str) -> tuple[dict[str, Any] | None, str | None]:
    starts = [match.start() for match in re.finditer(re.escape(MARKER_BEGIN), message)]
    for start in reversed(starts):
        body_start = start + len(MARKER_BEGIN)
        end = message.find(MARKER_END, body_start)
        if end < 0:
            continue
        candidate = message[body_start:end].strip()
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            return None, "structured supervisor block contains invalid JSON"
        return (value, None) if isinstance(value, dict) else (None, "supervisor state must be a JSON object")

    return None, "structured supervisor state block was not found"


def validate_contract(contract: dict[str, Any], event_session: str) -> str | None:
    missing = sorted(REQUIRED_FIELDS - set(contract))
    if missing:
        return f"supervisor state is missing fields: {', '.join(missing)}"
    if contract.get("schema_version") != SCHEMA_VERSION:
        return "supervisor state schema_version is unsupported"
    status = contract.get("orchestration_status")
    if status not in ALLOWED_STATUSES:
        return "supervisor state orchestration_status is invalid"
    declared_session = contract.get("session_id")
    if declared_session not in (None, event_session):
        return "supervisor state session_id does not match the Stop event"
    if not isinstance(contract.get("progress_made"), bool):
        return "supervisor state progress_made must be boolean"
    if not isinstance(contract.get("production_authorization_required"), bool):
        return "supervisor state production_authorization_required must be boolean"
    evidence = contract.get("evidence_refs")
    if not isinstance(evidence, list) or any(not isinstance(item, str) for item in evidence):
        return "supervisor state evidence_refs must be a list of strings"
    raw_declaration, extraction_error = contract_resource_declaration(contract)
    if extraction_error:
        return extraction_error
    declaration, declaration_error = normalize_resource_declaration(raw_declaration)
    if declaration_error:
        return declaration_error
    next_item = contract.get("next_item")
    next_item_is_global = isinstance(next_item, dict) and (
        next_item.get("mutates_global") is True
        or is_global_resource_name(next_item.get("resource"))
    )

    if status == "continue":
        if contract.get("objective_status") != "in_progress":
            return "continue requires objective_status=in_progress"
        if contract.get("next_item") in (None, "", {}):
            return "continue requires a concrete next_item"
        if contract.get("human_blocker") is not None or contract.get("credential_blocker") is not None:
            return "continue cannot carry a human or credential blocker"
        if contract.get("production_authorization_required"):
            return "continue cannot require production authorization"
        if next_item_is_global and raw_declaration is None:
            return "global next_item requires reads/writes/requires/leases resource_declaration"
        if next_item_is_global:
            resource_value = next_item.get("resource")
            if not isinstance(resource_value, str) or not resource_value.strip():
                return "global next_item requires a concrete resource"
            resource = resource_value.strip()
            if next_item.get("mutates_global") is True and not is_global_resource_name(resource):
                return "global next_item requires a canonical resource name"
            if is_global_resource_name(resource):
                resource = resource.lower()
            if resource not in declaration["writes"]:
                return f"global next_item resource {resource} must be declared in resource_declaration.writes"
            if resource not in declaration["leases"]:
                return f"global next_item resource {resource} must be declared in resource_declaration.leases"
    elif status == "complete":
        if contract.get("objective_status") != "complete":
            return "complete requires objective_status=complete"
        if not evidence:
            return "complete requires at least one evidence reference"
    elif status == "human_blocked" and not contract.get("human_blocker"):
        return "human_blocked requires a specific human_blocker"
    elif status == "credential_blocked" and not contract.get("credential_blocker"):
        return "credential_blocked requires a specific credential_blocker"
    elif status == "production_authorization_required" and not contract.get(
        "production_authorization_required"
    ):
        return "production_authorization_required requires its boolean gate"
    return None


def is_global_resource_name(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower().startswith(GLOBAL_RESOURCE_PREFIXES)


def default_resource_declaration() -> dict[str, Any]:
    return {
        "schema_version": RESOURCE_DECLARATION_SCHEMA_VERSION,
        "reads": [],
        "writes": [],
        "requires": [],
        "leases": [],
    }


def normalize_resource_declaration(
    value: Any,
    *,
    required: bool = False,
) -> tuple[dict[str, Any] | None, str | None]:
    if value is None:
        if required:
            return None, "resource_declaration is required for a global mutation"
        return default_resource_declaration(), None
    if not isinstance(value, dict):
        return None, "resource_declaration must be a JSON object"
    unknown = sorted(set(value) - RESOURCE_DECLARATION_FIELDS)
    if unknown:
        return None, f"resource_declaration contains unsupported fields: {', '.join(unknown)}"
    if value.get("schema_version", RESOURCE_DECLARATION_SCHEMA_VERSION) != RESOURCE_DECLARATION_SCHEMA_VERSION:
        return None, "resource_declaration schema_version is unsupported"

    normalized: dict[str, Any] = {"schema_version": RESOURCE_DECLARATION_SCHEMA_VERSION}
    for field in RESOURCE_DECLARATION_LIST_FIELDS:
        raw = value.get(field, [])
        if not isinstance(raw, list) or any(not isinstance(item, str) for item in raw):
            return None, f"resource_declaration {field} must be a list of strings"
        if len(raw) > MAX_RESOURCE_DECLARATION_ITEMS:
            return None, f"resource_declaration {field} exceeds the item limit"
        items: set[str] = set()
        for item in raw:
            candidate = item.strip()
            if not candidate:
                return None, f"resource_declaration {field} cannot contain empty items"
            if len(candidate) > MAX_RESOURCE_DECLARATION_ITEM_LENGTH:
                return None, f"resource_declaration {field} contains an oversized item"
            if "\n" in candidate or "\r" in candidate:
                return None, f"resource_declaration {field} cannot contain line breaks"
            if field in ("writes", "leases") and is_global_resource_name(candidate):
                candidate = candidate.lower()
            items.add(candidate)
        normalized[field] = sorted(items)

    global_writes = [item for item in normalized["writes"] if is_global_resource_name(item)]
    missing_leases = [item for item in global_writes if item not in normalized["leases"]]
    if missing_leases:
        return None, f"global writes require an explicit lease declaration for each resource: {', '.join(missing_leases)}"
    if "merge:main" in global_writes:
        if "merge:main" not in normalized["leases"]:
            return None, "merge:main writes require the merge:main lease"
        if "skincos-integration-gate" not in normalized["requires"]:
            return None, "merge:main writes require skincos-integration-gate"
    return normalized, None


def canonical_json(value: Any) -> tuple[str | None, str | None]:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")), None
    except (TypeError, ValueError) as exc:
        return None, f"is not JSON-serializable: {type(exc).__name__}"


def normalize_snapshot_string(
    value: Any,
    field: str,
    *,
    allow_integer: bool = False,
) -> tuple[str | None, str | None]:
    if value is None:
        return None, None
    if allow_integer and isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
    if not isinstance(value, str):
        return None, f"session snapshot {field} must be a string or null"
    normalized = value.strip()
    if not normalized:
        return None, f"session snapshot {field} must not be empty"
    if len(normalized) > MAX_SNAPSHOT_STRING_LENGTH:
        return None, f"session snapshot {field} exceeds the compact size limit"
    return normalized, None


def normalize_snapshot_refs(value: Any, field: str) -> tuple[list[str] | None, str | None]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        return None, f"session snapshot {field} must be a list of strings"
    if len(value) > MAX_EVIDENCE_REFS:
        return None, f"session snapshot {field} exceeds the compact item limit"
    normalized: set[str] = set()
    for item in value:
        candidate = item.strip()
        if not candidate:
            return None, f"session snapshot {field} cannot contain empty references"
        if len(candidate) > MAX_EVIDENCE_REF_LENGTH:
            return None, f"session snapshot {field} contains an oversized reference"
        normalized.add(candidate)
    return sorted(normalized), None


def extract_snapshot_declaration(contract: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    raw = contract.get("session_snapshot")
    declared: dict[str, Any] = {}
    if raw is not None:
        if not isinstance(raw, dict):
            return None, "session_snapshot must be a JSON object"
        unknown = sorted(set(raw) - SNAPSHOT_INPUT_FIELDS)
        if unknown:
            return None, f"session_snapshot contains unsupported fields: {', '.join(unknown)}"
        if raw.get("schema_version", SNAPSHOT_SCHEMA_VERSION) != SNAPSHOT_SCHEMA_VERSION:
            return None, "session_snapshot schema_version is unsupported"
        declared.update({key: value for key, value in raw.items() if key != "schema_version"})
    for field in SNAPSHOT_TOP_LEVEL_FIELDS:
        if field not in contract:
            continue
        value = contract[field]
        if field in declared and declared[field] != value:
            return None, f"session snapshot {field} conflicts between top-level and session_snapshot"
        declared[field] = value
    return declared, None


def contract_resource_declaration(contract: dict[str, Any]) -> tuple[Any, str | None]:
    declared, error = extract_snapshot_declaration(contract)
    if error or declared is None:
        return None, error
    return declared.get("resource_declaration"), None


def task_identity_component(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    segments = [segment for segment in re.split(r"[\\/]+", value.strip()) if segment]
    return segments[-1] if segments else None


def normalize_task_identity(
    branch_worktree: dict[str, str | None],
    task_slug: str | None,
) -> tuple[str | None, str | None]:
    components = {
        component
        for component in (
            task_identity_component(branch_worktree.get("branch")),
            task_identity_component(branch_worktree.get("worktree")),
        )
        if component is not None
    }
    if len(components) > 1:
        return None, "branch, worktree, and task_slug must identify the same task"
    if task_slug is not None and components and task_slug not in components:
        return None, "task_slug does not match the branch/worktree task identity"
    return task_slug or next(iter(components), None), None


def normalize_branch_worktree(
    declared: dict[str, Any],
    existing: dict[str, Any],
) -> tuple[dict[str, str | None] | None, str | None]:
    result = {
        "branch": existing.get("branch"),
        "worktree": existing.get("worktree"),
    }
    raw_pair = declared.get("branch_worktree")
    if raw_pair is not None:
        if not isinstance(raw_pair, dict):
            return None, "session snapshot branch_worktree must be an object"
        unknown = sorted(set(raw_pair) - {"branch", "worktree"})
        if unknown:
            return None, f"session snapshot branch_worktree contains unsupported fields: {', '.join(unknown)}"
        for field, value in raw_pair.items():
            if field in declared and declared[field] != value:
                return None, f"session snapshot {field} conflicts with branch_worktree"
            result[field] = value
    for field in ("branch", "worktree"):
        if field in declared:
            result[field] = declared[field]
        normalized, error = normalize_snapshot_string(result[field], f"branch_worktree.{field}")
        if error:
            return None, error
        result[field] = normalized
    return result, None


def validate_snapshot_item(value: Any, field: str) -> str | None:
    serialized, error = canonical_json(value)
    if error:
        return f"session snapshot {field} {error}"
    if serialized is None or len(serialized.encode("utf-8")) > MAX_SNAPSHOT_ITEM_BYTES:
        return f"session snapshot {field} exceeds the compact size limit"
    return None


def build_session_snapshot(
    contract: dict[str, Any],
    previous: dict[str, Any] | None,
    *,
    session_key: str,
    mission_id: str,
    root_turn_id: str,
    now: float,
    is_root: bool,
) -> tuple[dict[str, Any] | None, str | None]:
    declared, error = extract_snapshot_declaration(contract)
    if error or declared is None:
        return None, error

    context: dict[str, Any] = {
        "authorization_source": None,
        "issue": None,
        "branch_worktree": {"branch": None, "worktree": None},
        "task_slug": None,
        "checkpoint": None,
        "remote_fingerprint": None,
        "blocker_fingerprint": None,
        "valid_evidence_refs": [],
        "resource_declaration": default_resource_declaration(),
    }
    if previous and not is_root:
        for field in (
            "authorization_source",
            "issue",
            "branch_worktree",
            "task_slug",
            "checkpoint",
            "remote_fingerprint",
            "blocker_fingerprint",
            "valid_evidence_refs",
        ):
            context[field] = previous.get(field)

    raw_declaration = declared.get("resource_declaration")
    if raw_declaration is not None:
        declaration, declaration_error = normalize_resource_declaration(raw_declaration)
        if declaration_error or declaration is None:
            return None, declaration_error
        context["resource_declaration"] = declaration
    elif not isinstance(context.get("resource_declaration"), dict):
        context["resource_declaration"] = default_resource_declaration()

    for field in SNAPSHOT_STRING_FIELDS:
        if field not in declared:
            continue
        normalized, field_error = normalize_snapshot_string(declared[field], field)
        if field_error:
            return None, field_error
        context[field] = normalized
    if "issue" in declared:
        normalized, field_error = normalize_snapshot_string(declared["issue"], "issue", allow_integer=True)
        if field_error:
            return None, field_error
        context["issue"] = normalized

    branch_worktree, field_error = normalize_branch_worktree(
        declared,
        context["branch_worktree"] if isinstance(context["branch_worktree"], dict) else {},
    )
    if field_error or branch_worktree is None:
        return None, field_error
    context["branch_worktree"] = branch_worktree

    task_slug, identity_error = normalize_task_identity(branch_worktree, context["task_slug"])
    if identity_error:
        return None, identity_error
    context["task_slug"] = task_slug

    if "valid_evidence_refs" in declared:
        references, field_error = normalize_snapshot_refs(declared["valid_evidence_refs"], "valid_evidence_refs")
        if field_error or references is None:
            return None, field_error
        context["valid_evidence_refs"] = references
    elif is_root:
        references, field_error = normalize_snapshot_refs(contract["evidence_refs"], "valid_evidence_refs")
        if field_error or references is None:
            return None, field_error
        context["valid_evidence_refs"] = references

    for field in ("completed_item", "next_item"):
        field_error = validate_snapshot_item(contract.get(field), field)
        if field_error:
            return None, field_error
    evidence_refs, field_error = normalize_snapshot_refs(contract["evidence_refs"], "evidence_refs")
    if field_error or evidence_refs is None:
        return None, field_error

    progress_material = {
        "completed_item": contract.get("completed_item"),
        "next_item": contract.get("next_item"),
        "evidence_refs": evidence_refs,
        "checkpoint": context["checkpoint"],
        "remote_fingerprint": context["remote_fingerprint"],
        "valid_evidence_refs": context["valid_evidence_refs"],
        "task_slug": context["task_slug"],
        "resource_declaration": context["resource_declaration"],
    }
    serialized, field_error = canonical_json(progress_material)
    if field_error or serialized is None:
        return None, f"session snapshot progress fingerprint {field_error or 'could not be created'}"

    return {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "session_key": session_key,
        "mission_id": mission_id,
        "root_turn_id": root_turn_id,
        "updated_at": utc_iso(now),
        "authorization_source": context["authorization_source"],
        "issue": context["issue"],
        "branch_worktree": context["branch_worktree"],
        "task_slug": context["task_slug"],
        "checkpoint": context["checkpoint"],
        "remote_fingerprint": context["remote_fingerprint"],
        "blocker_fingerprint": context["blocker_fingerprint"],
        "valid_evidence_refs": context["valid_evidence_refs"],
        "resource_declaration": context["resource_declaration"],
        "completed_item": contract.get("completed_item"),
        "next_item": contract.get("next_item"),
        "progress_fingerprint": digest(serialized),
    }, None


def validate_stored_snapshot(
    snapshot: dict[str, Any],
    *,
    session_key: str,
    mission_id: str,
) -> str | None:
    if snapshot.get("schema_version") != SNAPSHOT_SCHEMA_VERSION:
        return "session snapshot schema_version is unsupported"
    if snapshot.get("session_key") != session_key:
        return "session snapshot does not belong to this session"
    if snapshot.get("mission_id") != mission_id:
        return "session snapshot does not belong to the active mission"
    for field in SNAPSHOT_STRING_FIELDS:
        _, error = normalize_snapshot_string(snapshot.get(field), field)
        if error:
            return error
    task_slug, error = normalize_snapshot_string(snapshot.get("task_slug"), "task_slug")
    if error:
        return error
    _, error = normalize_snapshot_string(snapshot.get("issue"), "issue", allow_integer=True)
    if error:
        return error
    branch_worktree = snapshot.get("branch_worktree")
    if not isinstance(branch_worktree, dict) or set(branch_worktree) != {"branch", "worktree"}:
        return "session snapshot branch_worktree is invalid"
    _, error = normalize_branch_worktree({}, branch_worktree)
    if error:
        return error
    _, error = normalize_task_identity(branch_worktree, task_slug)
    if error:
        return error
    _, error = normalize_snapshot_refs(snapshot.get("valid_evidence_refs"), "valid_evidence_refs")
    if error:
        return error
    if "resource_declaration" in snapshot:
        _, error = normalize_resource_declaration(snapshot.get("resource_declaration"))
        if error:
            return error
    for field in ("completed_item", "next_item"):
        error = validate_snapshot_item(snapshot.get(field), field)
        if error:
            return error
    fingerprint = snapshot.get("progress_fingerprint")
    if not isinstance(fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
        return "session snapshot progress_fingerprint is invalid"
    return None


def continuation_change_reason(
    contract: dict[str, Any],
    previous: dict[str, Any] | None,
    current: dict[str, Any],
    *,
    is_root: bool,
) -> tuple[str | None, str | None]:
    if is_root:
        if contract["progress_made"]:
            return "initial_measurable_progress", None
        return None, "continue without progress has no prior session snapshot to prove a changed blocker"
    if previous is None:
        return None, "continued Stop event has no recoverable session snapshot"

    progress_changed = current["progress_fingerprint"] != previous.get("progress_fingerprint")
    blocker_changed = current["blocker_fingerprint"] != previous.get("blocker_fingerprint")
    if contract["progress_made"] and progress_changed:
        return "measurable_progress", None
    if blocker_changed:
        return "blocker_changed", None
    if contract["progress_made"]:
        return None, "measurable progress fingerprint did not change; focal diagnosis or a different approach is required; unchanged work will not be repeated"
    return None, "blocker fingerprint did not change; focal diagnosis or a different approach is required; unchanged work will not be repeated"


def skill_tree_hash(root: Path) -> str | None:
    if not (root / "SKILL.md").is_file():
        return None
    files = sorted(
        (
            path
            for path in root.rglob("*")
            if path.is_file()
            and "__pycache__" not in path.parts
            and path.suffix not in {".pyc", ".pyo"}
        ),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    if not files:
        return None
    accumulator = hashlib.sha256()
    for path in files:
        relative = path.relative_to(root).as_posix()
        accumulator.update(relative.encode("utf-8"))
        accumulator.update(b"\0")
        accumulator.update(path.read_bytes())
        accumulator.update(b"\0")
    return accumulator.hexdigest()


def find_installed_skill(explicit: str | None) -> Path | None:
    candidates: list[Path] = []
    if explicit:
        selected = Path(explicit)
        return selected if (selected / "SKILL.md").is_file() else None
    if os.environ.get("SKINCOS_ORCHESTRATOR_SKILL_ROOT"):
        candidates.append(Path(os.environ["SKINCOS_ORCHESTRATOR_SKILL_ROOT"]))
    home = Path.home()
    candidates.extend(
        [
            home / ".agents" / "skills" / "skincos-project-orchestrator",
            home / ".codex" / "skills" / "skincos-project-orchestrator",
        ]
    )
    if os.environ.get("USERPROFILE"):
        profile = Path(os.environ["USERPROFILE"])
        candidates.append(profile / ".agents" / "skills" / "skincos-project-orchestrator")
    for candidate in candidates:
        if (candidate / "SKILL.md").is_file():
            return candidate
    return None


def verify_skill(repo_root: Path, explicit: str | None) -> str | None:
    expected = repo_root / "skills" / "skincos-project-orchestrator"
    installed = find_installed_skill(explicit)
    if installed is None:
        return "installed skincos-project-orchestrator Skill was not found"
    expected_hash = skill_tree_hash(expected)
    installed_hash = skill_tree_hash(installed)
    if expected_hash is None:
        return "versioned skincos-project-orchestrator Skill is incomplete"
    if installed_hash is None:
        return "installed skincos-project-orchestrator Skill is incomplete"
    if installed_hash != expected_hash:
        return "installed skincos-project-orchestrator Skill differs from the project version"
    return None


def pid_is_alive(pid: int, hostname: str, current_hostname: str) -> bool | None:
    if hostname != current_hostname:
        return None
    if pid <= 0:
        return False
    if os.name == "nt":
        # Unlike POSIX kill(pid, 0), os.kill(pid, 0) can terminate a process on
        # Windows. Query a handle without requesting mutation rights instead.
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        process_query_limited_information = 0x1000
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
        if handle:
            kernel32.CloseHandle(handle)
            return True
        # Access denied still proves that a process object exists.
        return ctypes.get_last_error() == 5
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def quarantine(path: Path, category: str, now: float) -> Path:
    destination = path.with_name(f"{path.name}.{category}.{int(now)}.{time.time_ns()}")
    os.replace(path, destination)
    return destination


def acquire_session_lock(
    shared_root: Path,
    session_key: str,
    event_key: str,
    now: float,
    config: dict[str, Any],
    current_pid: int,
    current_hostname: str,
) -> tuple[Path | None, str | None]:
    lock_dir = shared_root / "session-locks"
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / f"{session_key}.lock"
    metadata = {
        "schema_version": 1,
        "session_key": session_key,
        "event_key": event_key,
        "pid": current_pid,
        "hostname": current_hostname,
        "created_at": utc_iso(now),
        "created_at_epoch": now,
    }
    for _ in range(2):
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            existing = read_json(lock_path)
            if existing is None:
                return None, "session lock exists with unreadable metadata"
            age = max(0.0, now - float(existing.get("created_at_epoch", now)))
            alive = pid_is_alive(
                int(existing.get("pid", -1)),
                str(existing.get("hostname", "")),
                current_hostname,
            )
            same_host_dead = alive is False and age >= config["orphan_grace_seconds"]
            remote_expired = alive is None and age >= config["session_lock_ttl_seconds"]
            if same_host_dead or remote_expired:
                try:
                    quarantine(lock_path, "orphaned", now)
                except OSError:
                    return None, "validated orphan lock could not be quarantined"
                continue
            return None, "another supervisor currently controls this session"
        else:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(metadata, handle, ensure_ascii=False, sort_keys=True)
                handle.write("\n")
            return lock_path, None
    return None, "session lock could not be acquired after orphan recovery"


def mark_event(events_root: Path, event_key: str, value: dict[str, Any]) -> bool:
    events_root.mkdir(parents=True, exist_ok=True)
    path = events_root / f"{event_key}.json"
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, sort_keys=True)
        handle.write("\n")
    return True


def target_identity(next_item: Any) -> str:
    serialized = json.dumps(next_item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return digest(serialized)


def release_target_lease(shared_root: Path, target_key: str | None, session_key: str) -> None:
    if not target_key:
        return
    path = shared_root / "target-leases" / f"{target_key}.json"
    existing = read_json(path)
    if existing and existing.get("session_key") == session_key:
        try:
            quarantine(path, "released", time.time())
        except OSError:
            pass


def acquire_target_lease(
    shared_root: Path,
    target_key: str,
    session_key: str,
    mission_id: str,
    now: float,
    ttl: int,
) -> str | None:
    lease_dir = shared_root / "target-leases"
    lease_dir.mkdir(parents=True, exist_ok=True)
    path = lease_dir / f"{target_key}.json"
    existing = read_json(path)
    if path.exists() and existing is None:
        return "milestone lease exists with unreadable metadata"
    if existing and existing.get("session_key") != session_key:
        expires = float(existing.get("expires_at_epoch", now + ttl))
        if expires > now:
            return "the next milestone is leased by another supervised session"
        try:
            quarantine(path, "expired", now)
        except OSError:
            return "an expired milestone lease could not be quarantined"
    atomic_write_json(
        path,
        {
            "schema_version": 1,
            "target_key": target_key,
            "session_key": session_key,
            "mission_id": mission_id,
            "updated_at": utc_iso(now),
            "expires_at_epoch": now + ttl,
        },
    )
    return None


def continuation_prompt(
    session_id: str,
    mission_id: str,
    cycle: int,
    emergency_cycle_limit: int,
    completed_item: Any,
    next_item: Any,
    snapshot: dict[str, Any],
) -> str:
    context = {
        "session_id": session_id,
        "mission_id": mission_id,
        "cycle": cycle,
        "emergency_cycle_limit": emergency_cycle_limit,
        "completed_item": completed_item,
        "next_item": next_item,
        "session_snapshot": {
            "authorization_source": snapshot["authorization_source"],
            "issue": snapshot["issue"],
            "branch_worktree": snapshot["branch_worktree"],
            "checkpoint": snapshot["checkpoint"],
            "remote_fingerprint": snapshot["remote_fingerprint"],
            "blocker_fingerprint": snapshot["blocker_fingerprint"],
            "valid_evidence_refs": snapshot["valid_evidence_refs"],
            "task_slug": snapshot["task_slug"],
            "resource_declaration": snapshot["resource_declaration"],
        },
    }
    return (
        "$skincos-project-orchestrator supervisor-cycle\n\n"
        "Continue the same explicit SKINCOS mission in this thread. Reconstruct the original "
        "objective and added commitments from the thread and canonical project sources. "
        "Reconcile real Git, PR, CI, environment and runtime state; then execute only the next "
        "minimum safe eligible milestone within the mission's persistent authorization. Do not "
        "repeat completed work or invent scope. Never mutate production, production secrets, "
        "production migrations, real users, grants or production feature flags without the "
        "mission authorization and applicable domain gates, platform permission, rollback and "
        "evidence; a missing gate is a concrete technical blocker, not a request for duplicate "
        "authorization. End with exactly one "
        f"{MARKER_BEGIN}/{MARKER_END} structured contract. Preserve the session snapshot context "
        "and valid evidence unless the new state proves a replacement. Do not repeat unchanged "
        "work: another continuation requires a changed measurable-progress fingerprint or a changed "
        "blocker_fingerprint.\n"
        f"Supervisor gate context: {json.dumps(context, ensure_ascii=False, sort_keys=True)}"
    )


def process(
    payload: dict[str, Any],
    repo_root: Path,
    runtime_root: Path,
    shared_root: Path,
    installed_skill: str | None,
    now: float,
    current_pid: int,
    current_hostname: str,
) -> dict[str, Any]:
    config, config_error = load_config(repo_root)
    if config_error or config is None:
        return safe_allow(f"SKINCOS supervisor safety stop: {config_error}")

    control_path = runtime_root / "control.json"
    control = read_json(control_path) if control_path.exists() else None
    if control_path.exists() and control is None:
        return safe_allow("SKINCOS supervisor safety stop: runtime control state is corrupt")
    if control and not isinstance(control.get("enabled"), bool):
        return safe_allow("SKINCOS supervisor safety stop: runtime control enablement is invalid")
    if not config["enabled"] or (control and control.get("enabled") is False):
        return safe_allow("SKINCOS supervisor is locally disabled; Stop may finish normally")

    if payload.get("hook_event_name") != "Stop":
        return safe_allow("SKINCOS supervisor ignored a non-Stop event")
    session_id = str(payload.get("session_id") or "").strip()
    turn_id = str(payload.get("turn_id") or "").strip()
    message = payload.get("last_assistant_message")
    if not session_id or not turn_id or not isinstance(message, str):
        return safe_allow("SKINCOS supervisor safety stop: required Stop fields are unavailable")
    if not isinstance(payload.get("stop_hook_active"), bool):
        return safe_allow("SKINCOS supervisor safety stop: stop_hook_active is unavailable or invalid")

    message_hash = digest(message)
    event_key = digest(f"{session_id}\0{turn_id}\0{message_hash}")
    session_key = digest(session_id)
    lock_path, lock_error = acquire_session_lock(
        shared_root,
        session_key,
        event_key,
        now,
        config,
        current_pid,
        current_hostname,
    )
    if lock_error or lock_path is None:
        return safe_allow(f"SKINCOS supervisor concurrency stop: {lock_error}")

    runtime_root.mkdir(parents=True, exist_ok=True)
    event_record = {
        "schema_version": 1,
        "event_key": event_key,
        "session_key": session_key,
        "turn_id": turn_id,
        "message_hash": message_hash,
        "transcript_path_hash": (
            digest(str(payload["transcript_path"])) if payload.get("transcript_path") else None
        ),
        "permission_mode": str(payload.get("permission_mode") or "")[:80] or None,
        "model": str(payload.get("model") or "")[:120] or None,
        "received_at": utc_iso(now),
    }
    try:
        if (shared_root / "processed-events" / f"{event_key}.json").exists():
            return safe_allow("SKINCOS supervisor ignored a duplicate Stop event")

        mission_path = runtime_root / "missions" / f"{session_key}.json"
        mission = read_json(mission_path) if mission_path.exists() else None
        if mission_path.exists() and mission is None:
            mark_event(
                shared_root / "processed-events",
                event_key,
                {**event_record, "result": "corrupt_mission_state"},
            )
            return safe_allow("SKINCOS supervisor safety stop: mission state is corrupt")

        contract, extract_error = extract_contract(message)
        if extract_error or contract is None:
            if mission and mission.get("status") == "in_progress":
                mark_event(
                    shared_root / "processed-events",
                    event_key,
                    {
                        **event_record,
                        "result": "active_mission_missing_contract",
                        "mission_id": mission.get("mission_id"),
                    },
                )
                return block(
                    "SKINCOS supervisor: an active mission is incomplete; emit exactly one "
                    "supervisor-cycle state contract with a concrete next_item and progress_made=true, "
                    "or a terminal status, before ending this turn"
                )
            mark_event(shared_root / "processed-events", event_key, {**event_record, "result": "invalid_contract"})
            recursion = " during a continued turn" if payload.get("stop_hook_active") else ""
            return safe_allow(f"SKINCOS supervisor safety stop{recursion}: {extract_error}")

        contract_error = validate_contract(contract, session_id)
        if contract_error:
            mark_event(shared_root / "processed-events", event_key, {**event_record, "result": "invalid_contract"})
            return safe_allow(f"SKINCOS supervisor safety stop: {contract_error}")

        skill_error = verify_skill(repo_root, installed_skill)
        if skill_error:
            mark_event(shared_root / "processed-events", event_key, {**event_record, "result": "skill_unavailable"})
            return safe_allow(f"SKINCOS supervisor safety stop: {skill_error}")

        stop_hook_active = bool(payload.get("stop_hook_active"))
        requested_mission = contract.get("mission_id")

        if not stop_hook_active:
            if mission:
                release_target_lease(shared_root, mission.get("target_key"), session_key)
            mission_id = str(requested_mission or digest(f"{session_id}\0{turn_id}")[:24])
            mission = {
                "schema_version": 1,
                "mission_id": mission_id,
                "root_turn_id": turn_id,
                "cycles_used": 0,
                "created_at": utc_iso(now),
                "last_continuation_at_epoch": None,
                "target_key": None,
                "status": "in_progress",
            }
        else:
            if mission is None:
                mark_event(
                    shared_root / "processed-events",
                    event_key,
                    {**event_record, "result": "recursive_without_mission"},
                )
                return safe_allow(
                    "SKINCOS supervisor recursion stop: continued Stop event has no recoverable mission state"
                )
            mission_id = str(mission.get("mission_id") or "")
            if requested_mission not in (None, mission_id):
                mark_event(
                    shared_root / "processed-events",
                    event_key,
                    {**event_record, "result": "mission_mismatch"},
                )
                return safe_allow("SKINCOS supervisor safety stop: mission_id changed during automatic continuation")

        snapshot_path = runtime_root / "snapshots" / f"{session_key}.json"
        previous_snapshot: dict[str, Any] | None = None
        if stop_hook_active:
            previous_snapshot = read_json(snapshot_path) if snapshot_path.exists() else None
            if snapshot_path.exists() and previous_snapshot is None:
                mark_event(
                    shared_root / "processed-events",
                    event_key,
                    {**event_record, "result": "corrupt_session_snapshot", "mission_id": mission_id},
                )
                return safe_allow("SKINCOS supervisor safety stop: session snapshot is corrupt")
            if previous_snapshot is None:
                mark_event(
                    shared_root / "processed-events",
                    event_key,
                    {**event_record, "result": "missing_session_snapshot", "mission_id": mission_id},
                )
                return safe_allow(
                    "SKINCOS supervisor recursion stop: continued Stop event has no recoverable session snapshot"
                )
            snapshot_error = validate_stored_snapshot(
                previous_snapshot,
                session_key=session_key,
                mission_id=mission_id,
            )
            if snapshot_error:
                mark_event(
                    shared_root / "processed-events",
                    event_key,
                    {**event_record, "result": "invalid_session_snapshot", "mission_id": mission_id},
                )
                return safe_allow(f"SKINCOS supervisor safety stop: {snapshot_error}")

        snapshot, snapshot_error = build_session_snapshot(
            contract,
            previous_snapshot,
            session_key=session_key,
            mission_id=mission_id,
            root_turn_id=str(mission.get("root_turn_id") or turn_id),
            now=now,
            is_root=not stop_hook_active,
        )
        if snapshot_error or snapshot is None:
            mark_event(
                shared_root / "processed-events",
                event_key,
                {**event_record, "result": "invalid_session_snapshot", "mission_id": mission_id},
            )
            return safe_allow(f"SKINCOS supervisor safety stop: {snapshot_error}")

        mission["resource_declaration"] = snapshot["resource_declaration"]
        mission["branch_worktree"] = snapshot["branch_worktree"]
        mission["task_slug"] = snapshot["task_slug"]

        status = str(contract["orchestration_status"])
        if status != "continue":
            mission["status"] = status
            mission["completed_at"] = utc_iso(now)
            mission["terminal_contract"] = contract
            mission["snapshot_key"] = session_key
            mission["last_progress_fingerprint"] = snapshot["progress_fingerprint"]
            mission["last_blocker_fingerprint"] = snapshot["blocker_fingerprint"]
            atomic_write_json(snapshot_path, snapshot)
            atomic_write_json(mission_path, mission)
            release_target_lease(shared_root, mission.get("target_key"), session_key)
            mark_event(
                shared_root / "processed-events",
                event_key,
                {**event_record, "result": status, "mission_id": mission_id},
            )
            append_event(
                runtime_root,
                {
                    "at": utc_iso(now),
                    "event_key": event_key,
                    "mission_id": mission_id,
                    "status": status,
                    "action": "allow_terminal",
                },
            )
            return safe_allow(f"SKINCOS supervisor terminal state: {status}")

        cycles_used = int(mission.get("cycles_used", 0))
        emergency_cycle_limit = int(config.get("emergency_cycle_limit", config["max_cycles"]))
        if cycles_used >= emergency_cycle_limit:
            mission["status"] = "cycle_budget_exhausted"
            mission["budget_exhausted_at"] = utc_iso(now)
            mission["snapshot_key"] = session_key
            mission["last_progress_fingerprint"] = snapshot["progress_fingerprint"]
            mission["last_blocker_fingerprint"] = snapshot["blocker_fingerprint"]
            atomic_write_json(snapshot_path, snapshot)
            atomic_write_json(mission_path, mission)
            release_target_lease(shared_root, mission.get("target_key"), session_key)
            mark_event(
                shared_root / "processed-events",
                event_key,
                {**event_record, "result": "cycle_budget_exhausted", "mission_id": mission_id},
            )
            return safe_allow(
                "SKINCOS supervisor emergency cycle budget exhausted; issue a new explicit user request to start a fresh budget"
            )

        last_at = mission.get("last_continuation_at_epoch")
        if last_at is not None and now - float(last_at) < config["cooldown_seconds"]:
            mark_event(
                shared_root / "processed-events",
                event_key,
                {**event_record, "result": "cooldown", "mission_id": mission_id},
            )
            return safe_allow("SKINCOS supervisor cooldown prevented an overlapping continuation")

        change_reason, eligibility_error = continuation_change_reason(
            contract,
            previous_snapshot,
            snapshot,
            is_root=not stop_hook_active,
        )
        if eligibility_error:
            mark_event(
                shared_root / "processed-events",
                event_key,
                {**event_record, "result": "unchanged_work", "mission_id": mission_id},
            )
            return safe_allow(f"SKINCOS supervisor continuation stop: {eligibility_error}")

        new_target_key = target_identity(contract["next_item"])
        old_target_key = mission.get("target_key")
        if old_target_key and old_target_key != new_target_key:
            release_target_lease(shared_root, old_target_key, session_key)
        lease_error = acquire_target_lease(
            shared_root,
            new_target_key,
            session_key,
            mission_id,
            now,
            config["target_lease_ttl_seconds"],
        )
        if lease_error:
            mark_event(
                shared_root / "processed-events",
                event_key,
                {**event_record, "result": "target_lease_conflict", "mission_id": mission_id},
            )
            return safe_allow(f"SKINCOS supervisor concurrency stop: {lease_error}")

        if not mark_event(
            shared_root / "processed-events",
            event_key,
            {**event_record, "result": "continued", "mission_id": mission_id},
        ):
            return safe_allow("SKINCOS supervisor ignored a duplicate Stop event")

        cycle = cycles_used + 1
        mission.update(
            {
                "cycles_used": cycle,
                "last_continuation_at_epoch": now,
                "last_continuation_at": utc_iso(now),
                "last_turn_id": turn_id,
                "last_event_key": event_key,
                "target_key": new_target_key,
                "snapshot_key": session_key,
                "last_progress_fingerprint": snapshot["progress_fingerprint"],
                "last_blocker_fingerprint": snapshot["blocker_fingerprint"],
                "status": "in_progress",
            }
        )
        atomic_write_json(snapshot_path, snapshot)
        atomic_write_json(mission_path, mission)
        append_event(
            runtime_root,
            {
                "at": utc_iso(now),
                "event_key": event_key,
                "mission_id": mission_id,
                "status": "continue",
                "cycle": cycle,
                "target_key": new_target_key,
                "continuation_reason": change_reason,
                "progress_fingerprint": snapshot["progress_fingerprint"],
                "blocker_fingerprint": snapshot["blocker_fingerprint"],
                "action": "block_and_continue",
            },
        )
        return block(
            continuation_prompt(
                session_id,
                mission_id,
                cycle,
                emergency_cycle_limit,
                contract.get("completed_item"),
                contract.get("next_item"),
                snapshot,
            )
        )
    finally:
        try:
            lock_path.unlink()
        except OSError:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root")
    parser.add_argument("--runtime-root")
    parser.add_argument("--shared-runtime-root")
    parser.add_argument("--skill-root")
    parser.add_argument("--now", type=float)
    parser.add_argument("--pid", type=int)
    parser.add_argument("--hostname")
    return parser.parse_args()


def main() -> int:
    try:
        args = parse_args()
        if os.environ.get("SKINCOS_SUPERVISOR_TEST_FORCE_ERROR") == "1":
            raise RuntimeError("forced internal error")
        raw = sys.stdin.read().lstrip("\ufeff")
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("hook payload must be a JSON object")
        repo_root = (
            Path(args.repo_root).resolve()
            if args.repo_root
            else find_repo_root(Path(str(payload.get("cwd") or os.getcwd())))
        )
        runtime_root = (
            Path(args.runtime_root).resolve()
            if args.runtime_root
            else repo_root / ".codex" / "runtime" / "supervisor"
        )
        shared_root = (
            Path(args.shared_runtime_root).resolve()
            if args.shared_runtime_root
            else discover_git_common_dir(repo_root) / "codex-supervisor"
        )
        result = process(
            payload,
            repo_root,
            runtime_root,
            shared_root,
            args.skill_root,
            time.time() if args.now is None else args.now,
            os.getpid() if args.pid is None else args.pid,
            args.hostname or socket.gethostname(),
        )
    except json.JSONDecodeError as exc:
        result = safe_allow(
            f"SKINCOS supervisor internal error: invalid hook payload at byte {exc.pos}"
        )
    except Exception as exc:  # Hook failures must never trigger unsafe automatic work.
        result = safe_allow(f"SKINCOS supervisor internal error: {type(exc).__name__}")
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
