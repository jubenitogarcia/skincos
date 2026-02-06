#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"

if [[ ! -d "${FRONTEND_DIR}" ]]; then
  echo "[no-demo-guard] frontend directory not found: ${FRONTEND_DIR}" >&2
  exit 2
fi

failures=0

fail_if_found() {
  local pattern="$1"
  local description="$2"
  local output
  output="$(grep -R --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git -n "${pattern}" "${FRONTEND_DIR}" || true)"
  if [[ -n "${output}" ]]; then
    echo "[no-demo-guard] ERROR: ${description}" >&2
    echo "${output}" >&2
    failures=$((failures + 1))
  fi
}

ensure_present() {
  local pattern="$1"
  local file="$2"
  local description="$3"
  if ! grep -q "${pattern}" "${file}"; then
    echo "[no-demo-guard] ERROR: ${description}" >&2
    failures=$((failures + 1))
  fi
}

fail_if_found "Mock WebSocket send" "Mock WebSocket log reintroduced in frontend source."
fail_if_found "demoNotifications" "Demo notification seed found in frontend source."

ensure_present "enabled = import.meta.env.DEV" "${FRONTEND_DIR}/useWebSocket.ts" "WebSocket must stay disabled by default in production."
ensure_present "const DEMO_DATA_ACTIVE = (import.meta as any)?.env?.VITE_DEMO_DATA === 'true'" "${FRONTEND_DIR}/App.tsx" "DEMO_DATA_ACTIVE must only activate via explicit env flag."

if [[ "${failures}" -gt 0 ]]; then
  echo "[no-demo-guard] FAILED with ${failures} issue(s)." >&2
  exit 1
fi

echo "[no-demo-guard] PASS"
