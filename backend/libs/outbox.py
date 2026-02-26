from __future__ import annotations

"""
Local audit/outbox helpers.

Goal: provide a minimal, append-only log for "side-effect" operations (e.g. sending
messages) so the platform can be used locally with traceability and optional
idempotency without forcing global dry-run.

Data lives under `backend/var/outbox/` (ignored by git).
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


def backend_dir() -> Path:
    """
    Return the `backend/` directory of the workspace.

    Detects by searching for `pyproject.toml` within `backend/`.
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "pyproject.toml").exists():
            return parent
    return here.parents[1]


def var_dir() -> Path:
    env = os.environ.get("VAR_DIR")
    if env:
        return Path(env)
    return backend_dir() / "var"


def outbox_dir() -> Path:
    return var_dir() / "outbox"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def outbox_path(stream: str) -> Path:
    stream = (stream or "").strip()
    if not stream:
        raise ValueError("stream vazio")
    safe = "".join(ch for ch in stream if ch.isalnum() or ch in ("-", "_", "."))
    if not safe:
        raise ValueError(f"stream inválido: {stream!r}")
    return outbox_dir() / f"{safe}.jsonl"


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    return str(value)


def append_event(stream: str, event: Dict[str, Any]) -> Path:
    path = outbox_path(stream)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _json_safe(dict(event or {}))
    payload.setdefault("ts", now_iso())
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return path


def iter_events(stream: str) -> Iterable[Dict[str, Any]]:
    path = outbox_path(stream)
    if not path.exists():
        return []

    def _iter() -> Iterable[Dict[str, Any]]:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if isinstance(obj, dict):
                        yield obj
                except json.JSONDecodeError:
                    continue

    return _iter()


def idempotency_key_sent(stream: str, idempotency_key: str) -> bool:
    """Return True if a SUCCESS event exists for the idempotency key."""
    key = (idempotency_key or "").strip()
    if not key:
        return False
    for ev in iter_events(stream):
        if ev.get("idempotency_key") != key:
            continue
        status = str(ev.get("status") or "").lower()
        if status in ("sent", "success"):
            return True
    return False


def last_event_for_key(stream: str, idempotency_key: str) -> Optional[Dict[str, Any]]:
    key = (idempotency_key or "").strip()
    if not key:
        return None
    last: Optional[Dict[str, Any]] = None
    for ev in iter_events(stream):
        if ev.get("idempotency_key") == key:
            last = ev
    return last


__all__ = [
    "backend_dir",
    "var_dir",
    "outbox_dir",
    "now_iso",
    "outbox_path",
    "append_event",
    "iter_events",
    "idempotency_key_sent",
    "last_event_for_key",
]
