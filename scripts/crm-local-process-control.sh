#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_HELPER="$ROOT_DIR/scripts/crm-local-persona-runtime.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  crm-local-process-control.sh pid-alive PID
  crm-local-process-control.sh pid-start-ticks PID
  crm-local-process-control.sh launcher-matches PID EXPECTED_CWD
  crm-local-process-control.sh source-in-use EXPECTED_SOURCE
  crm-local-process-control.sh signal PID TERM|KILL
EOF
  exit 2
}

require_pid() {
  local value="${1:-}"
  [[ "$value" =~ ^[0-9]+$ ]] || usage
}

command="${1:-}"
shift || true

case "$command" in
  pid-alive)
    [[ "$#" -eq 1 ]] || usage
    require_pid "$1"
    kill -0 "$1" 2>/dev/null
    ;;
  pid-start-ticks)
    [[ "$#" -eq 1 ]] || usage
    require_pid "$1"
    # shellcheck source=crm-local-persona-runtime.sh
    source "$RUNTIME_HELPER"
    crm_runtime_pid_start_ticks "$1"
    ;;
  launcher-matches)
    [[ "$#" -eq 2 ]] || usage
    require_pid "$1"
    pid="$1"
    expected="$2"
    [[ -r "/proc/$pid/cmdline" ]]
    actual="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [[ "$actual" == "$expected" ]]
    process_command="$(tr '\0' ' ' < "/proc/$pid/cmdline")"
    [[ "$process_command" == *scripts/run-local-crm.sh* ]]
    ;;
  source-in-use)
    [[ "$#" -eq 1 ]] || usage
    expected="$1"
    for link in /proc/[0-9]*/cwd; do
      actual="$(readlink -f "$link" 2>/dev/null || true)"
      case "$actual" in
        "$expected"|"$expected"/*) exit 0 ;;
      esac
    done
    exit 1
    ;;
  signal)
    [[ "$#" -eq 2 ]] || usage
    require_pid "$1"
    case "$2" in
      TERM|KILL) kill "-$2" "$1" 2>/dev/null || true ;;
      *) usage ;;
    esac
    ;;
  *)
    usage
    ;;
esac
