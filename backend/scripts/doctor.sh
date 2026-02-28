#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ./backend/scripts/doctor.sh [--unit]

Runs a safe sanity-suite (no network, best-effort):
  - symlink expectations
  - deprecated names/paths audit
  - repo safety scan (secrets heuristics)
  - python compileall
  - repo health checks
Optional:
  --unit  run pytest unit tests
EOF
}

DO_UNIT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit) DO_UNIT=1; shift ;;
    -h|--help|help) usage; exit 0 ;;
    *) echo "[doctor] Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

cd "$ROOT_DIR"

echo "[doctor] symlinks..."
bash "$ROOT_DIR/backend/scripts/symlinks.sh" check || true

echo "[doctor] deprecations..."
bash "$ROOT_DIR/backend/scripts/audit-deprecations.sh" || true

echo "[doctor] safety..."
bash "$ROOT_DIR/backend/scripts/repo-safety-check.sh"

echo "[doctor] python compile..."
bash "$ROOT_DIR/backend/scripts/test.sh" compile

if [[ $DO_UNIT -eq 1 ]]; then
  echo "[doctor] unit tests..."
  bash "$ROOT_DIR/backend/scripts/test.sh" unit
fi

echo "[doctor] repo health..."
bash "$ROOT_DIR/backend/scripts/test.sh" repo-health

echo "[doctor] meta-ads health (best-effort)..."
if [[ -x "$ROOT_DIR/backend/config/templates/modules/meta-ads/healthcheck.sh" ]]; then
  "$ROOT_DIR/backend/config/templates/modules/meta-ads/healthcheck.sh" >/dev/null 2>&1 || true
fi

echo "[doctor] OK"
