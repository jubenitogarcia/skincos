#!/usr/bin/env bash
set -u

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
gate="$script_dir/skincos-supervisor-gate.py"

if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' '{"continue":true,"stopReason":"SKINCOS supervisor: python3 is unavailable; automatic continuation is safely disabled"}'
  exit 0
fi

exec python3 "$gate"
