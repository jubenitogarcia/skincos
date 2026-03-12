#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LEGACY_SCRIPT="${LEGACY_WHATSAPP_STACK_SCRIPT:-$HOME/Automation/n8n/scripts/ensure-whatsapp-stack.sh}"
if [[ -x "$LEGACY_SCRIPT" && "$LEGACY_SCRIPT" != "$SCRIPT_DIR/ensure-whatsapp-stack.sh" ]]; then
  exec "$LEGACY_SCRIPT" "$@"
fi

UID_VALUE="$(id -u)"
KICKSTART_LABELS=(
  "com.skincos.evolution-api"
  "com.skincos.crm-api"
  "com.jubenito.n8n-evolution"
  "com.skincos.cloudflared.cs"
  "com.skincos.cloudflared.orb"
)

for label in "${KICKSTART_LABELS[@]}"; do
  if launchctl print "gui/$UID_VALUE/$label" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$UID_VALUE/$label" >/dev/null 2>&1 || true
  fi
done

if command -v curl >/dev/null 2>&1; then
  curl -fsS -m 6 "http://127.0.0.1:${CRM_API_PORT:-8099}/health" >/dev/null 2>&1 || true
  curl -fsS -m 6 "http://127.0.0.1:${EVOLUTION_PORT:-8080}/" >/dev/null 2>&1 || true
  curl -fsS -m 6 "http://127.0.0.1:${N8N_PORT:-5678}/healthz" >/dev/null 2>&1 || true
  curl -fsS -m 8 "https://orb.skincos.com.br/healthz" >/dev/null 2>&1 || true
fi

echo "[ensure-whatsapp-stack] recovery checks completed (${REPO_ROOT})."
