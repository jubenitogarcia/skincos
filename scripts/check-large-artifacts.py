#!/usr/bin/env python3
"""Fail CI when new tracked files exceed a size limit (unless allowlisted)."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def load_allowlist(path: Path) -> set[str]:
    if not path.exists():
        return set()
    out: set[str] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        out.add(line)
    return out


def iter_tracked_files() -> list[str]:
    return subprocess.check_output(["git", "ls-files"], text=True).splitlines()


def human_bytes(size: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{size}B"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-bytes", type=int, default=5 * 1024 * 1024)
    parser.add_argument("--allowlist", default=".github/allowlists/large-artifacts.txt")
    args = parser.parse_args()

    allowlist_path = Path(args.allowlist)
    allowlist = load_allowlist(allowlist_path)

    oversized: list[tuple[int, str, bool]] = []
    tracked = iter_tracked_files()
    for rel in tracked:
        try:
            size = os.path.getsize(rel)
        except OSError:
            continue
        if size <= args.max_bytes:
            continue
        oversized.append((size, rel, rel in allowlist))

    oversized.sort(reverse=True)

    stale_allowlist = sorted(p for p in allowlist if p not in {rel for _, rel, _ in oversized})

    violations = [(size, rel) for size, rel, is_allowed in oversized if not is_allowed]

    if oversized:
        print(f"Oversized tracked files (> {args.max_bytes} bytes):")
        for size, rel, is_allowed in oversized:
            tag = "ALLOWLISTED" if is_allowed else "VIOLATION"
            print(f"- [{tag}] {rel} ({human_bytes(size)})")

    if stale_allowlist:
        print("\nStale allowlist entries (no longer oversized):")
        for rel in stale_allowlist:
            print(f"- {rel}")

    if violations:
        print("\nLarge artifact policy violation: add to allowlist only with justification.")
        return 1

    print("Large artifact policy check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
