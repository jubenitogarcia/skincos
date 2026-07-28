#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
if dry_run_notice; then
  info 'status planejado: release pointer, versão n8n, migrations, quatro serviços, sockets loopback e healthchecks.'
  exit 0
fi
required_units=(orb.service orb-proxy.service cloudflare-orb.service skincos-orb-mcp-readonly.service)
for unit in "${required_units[@]}"; do
  state=$(systemctl is-active "$unit")
  enabled=$(systemctl is-enabled "$unit")
  [[ "$state" == active && "$enabled" == enabled ]] || die "unidade obrigatória não está active/enabled: $unit"
  printf 'unit=%s state=%s enabled=%s\n' "$unit" "$state" "$enabled"
done
readlink -f /opt/skincos/current/source
if command -v n8n >/dev/null 2>&1; then n8n --version; fi
ss -ltn
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:5678/healthz >/dev/null
info 'status somente leitura concluído.'
