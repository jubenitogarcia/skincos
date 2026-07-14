#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT_DIR/tmp/vscode-diagnostics"
OUT_FILE="$OUT_DIR/diag-$TS.txt"

mkdir -p "$OUT_DIR"

{
  echo "=== VS Code Freeze Diagnostics ==="
  echo "timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "workspace: $ROOT_DIR"
  echo

  echo "--- System ---"
  sw_vers || true
  echo "uptime: $(uptime)"
  echo

  echo "--- Top CPU (sample) ---"
  ps -Ao pid,ppid,%cpu,%mem,rss,comm | sort -k3 -nr | head -n 20
  echo

  echo "--- VS Code processes ---"
  ps -Ao pid,ppid,%cpu,%mem,rss,comm | egrep "Code|Electron|node" | head -n 50 || true
  echo

  echo "--- Workspace sizes ---"
  du -sh "$ROOT_DIR"/tmp "$ROOT_DIR"/workflows "$ROOT_DIR"/node_modules "$ROOT_DIR"/log-archive "$ROOT_DIR"/evolution-api 2>/dev/null || true
  echo

  echo "--- File counts (tmp/workflows) ---"
  find "$ROOT_DIR/tmp" "$ROOT_DIR/workflows" -type f 2>/dev/null | wc -l || true
  echo

  echo "--- Largest files (>50MB, top 30) ---"
  find "$ROOT_DIR" -type f -size +50M 2>/dev/null | head -n 30 || true
  echo

  echo "--- Recent oversized logs (top 20) ---"
  find "$ROOT_DIR" -type f \( -name "*.log" -o -name "*.out" -o -name "*.err" \) -print0 2>/dev/null \
    | xargs -0 ls -lh 2>/dev/null \
    | sort -k5 -hr \
    | head -n 20 || true
  echo

  echo "--- Open files by Code processes (sample) ---"
  CODE_PIDS="$(pgrep -f "Visual Studio Code|Code Helper|Code")"
  if [[ -n "$CODE_PIDS" ]]; then
    for pid in $CODE_PIDS; do
      echo "PID $pid"
      lsof -p "$pid" 2>/dev/null | head -n 30 || true
      echo
    done
  else
    echo "No Code processes found"
  fi

  echo "=== End ==="
} > "$OUT_FILE"

echo "Diagnostic report saved: $OUT_FILE"
