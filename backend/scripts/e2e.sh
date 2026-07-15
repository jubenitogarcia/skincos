#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENGINE_DIR="$ROOT_DIR/messaging/channels/whatsapp/engine"

usage() {
  cat <<'EOF'
Usage: backend/scripts/e2e.sh <health|ci-smoke|smoke>

  health    Validate repository/runtime contracts without changing services.
  ci-smoke  Run the CRM API and WhatsApp engine regression suites.
  smoke     Validate the seven native services and their public health routes.
EOF
}

case "${1:-health}" in
  health)
    node "$ROOT_DIR/.github/scripts/validate-architecture.mjs"
    test -f "$ENGINE_DIR/src/main.ts"
    test -f "$ROOT_DIR/ops/runtime/units/messaging-whatsapp.service"
    echo "Repository health checks passed."
    ;;
  ci-smoke)
    npm --prefix "$ROOT_DIR/crm/api" test
    npm --prefix "$ENGINE_DIR" test
    ;;
  smoke)
    command -v systemctl >/dev/null 2>&1 || { echo 'systemd is required for runtime smoke.' >&2; exit 2; }
    for unit in orb orb-proxy messaging-whatsapp crm booking cloudflare-orb cloudflare-runtime; do
      systemctl is-active --quiet "$unit.service" || { echo "$unit.service is not active" >&2; exit 1; }
    done
    curl --fail --silent --show-error --max-time 15 http://127.0.0.1:5678/healthz >/dev/null
    curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8788/health >/dev/null
    curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8099/health >/dev/null
    curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8765/healthz >/dev/null
    curl --fail --silent --show-error --max-time 20 https://orb.skincos.com.br/health >/dev/null
    curl --fail --silent --show-error --max-time 20 https://crm.skincos.com.br >/dev/null
    curl --fail --silent --show-error --max-time 20 https://api.skincos.com.br/health >/dev/null
    echo "Native runtime smoke passed."
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
