#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
if dry_run_notice; then
  info 'status planejado: release pointer, versão n8n, migrations, quatro serviços, sockets loopback e healthchecks.'
  exit 0
fi
systemctl show orb orb-proxy messaging-whatsapp crm booking cloudflare-orb cloudflare-runtime -p ActiveState -p SubState -p UnitFileState -p MainPID
if command -v n8n >/dev/null 2>&1; then n8n --version; fi
ss -ltn
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:5678/healthz >/dev/null
info 'status somente leitura concluído.'
