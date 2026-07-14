#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/crm/console"

if [[ ! -d "${FRONTEND_DIR}" ]]; then
  echo "[no-demo-guard] frontend directory not found: ${FRONTEND_DIR}" >&2
  exit 2
fi

failures=0

fail_if_found() {
  local pattern="$1"
  local description="$2"
  local output
  output="$(grep -R --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=e2e --exclude-dir=test-results --exclude-dir=.playwright-output --exclude=.dev.vars --exclude=.dev.vars.* -n "${pattern}" "${FRONTEND_DIR}" || true)"
  if [[ -n "${output}" ]]; then
    echo "[no-demo-guard] ERROR: ${description}" >&2
    echo "${output}" >&2
    failures=$((failures + 1))
  fi
}

fail_if_found "Mock WebSocket send" "Mock WebSocket log reintroduced in frontend source."
fail_if_found "demoNotifications" "Demo notification seed found in frontend source."
fail_if_found "VITE_DEMO_DATA" "Demo-data env flag must not be referenced in frontend source."
fail_if_found "DEMO_DATA_ACTIVE" "Demo-data toggle must not exist in frontend source."
fail_if_found "VITE_NO_AUTH" "NO_AUTH mode must not be wired into production frontend."
fail_if_found "LOCAL_AUTH_BYPASS=true" "Local auth bypass must never be hardcoded in frontend source."
fail_if_found "VITE_LOCAL_AUTH_BYPASS=true" "Vite local auth bypass must never be hardcoded in frontend source."

# Keep WebSocket disabled by default in production.
if ! grep -q "enabled = import.meta.env.DEV" "${FRONTEND_DIR}/useWebSocket.ts"; then
  echo "[no-demo-guard] ERROR: WebSocket must stay disabled by default in production." >&2
  failures=$((failures + 1))
fi

if [[ "${failures}" -gt 0 ]]; then
  echo "[no-demo-guard] FAILED with ${failures} issue(s)." >&2
  exit 1
fi

echo "[no-demo-guard] PASS"
