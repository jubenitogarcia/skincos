#!/usr/bin/env python3
"""Record Codex lifecycle/compaction checkpoints without storing prompt content."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
from pathlib import Path


def sha(value: object) -> str | None:
    if value is None:
        return None
    return hashlib.sha256(str(value).encode("utf-8", errors="replace")).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    args = parser.parse_args()
    root = Path(args.repo_root).resolve()
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    event = str(payload.get("hook_event_name") or os.environ.get("CODEX_HOOK_EVENT") or "unknown")
    now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    record = {
        "schema_version": 1,
        "event": event,
        "at": now,
        "session_id": sha(payload.get("session_id")),
        "turn_id": sha(payload.get("turn_id")),
        "model": str(payload.get("model") or "")[:120] or None,
        "cwd": sha(payload.get("cwd") or payload.get("workspace_root")),
    }

    runtime = root / ".codex" / "runtime" / "lifecycle"
    runtime.mkdir(parents=True, exist_ok=True)
    with (runtime / "events.jsonl").open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")
    if event == "SessionStart":
        (runtime / "current.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    elif event in {"PreCompact", "PostCompact"}:
        (runtime / "last-compaction.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    elif event == "SessionEnd":
        (runtime / "last-session-end.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
