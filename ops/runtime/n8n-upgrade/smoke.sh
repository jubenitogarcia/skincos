#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
if dry_run_notice; then
  info 'smoke planejado: Orb, CRM, Booking, WhatsApp, quatro serviços, MCP local e rotas MCP públicas 404; nenhum workflow será executado.'
  exit 0
fi
ORB_HEALTH_URL=${N8N_ORB_HEALTH_URL:-}
CRM_HEALTH_URL=${N8N_CRM_HEALTH_URL:-}
BOOKING_HEALTH_URL=${N8N_BOOKING_HEALTH_URL:-}
PUBLIC_ORB_BASE_URL=${N8N_PUBLIC_ORB_BASE_URL:-}
[[ -n "$ORB_HEALTH_URL" && -n "$CRM_HEALTH_URL" && -n "$BOOKING_HEALTH_URL" && -n "$PUBLIC_ORB_BASE_URL" ]] || die 'health URLs explícitas são obrigatórias; default live é recusado.'
for url in "$ORB_HEALTH_URL" "$CRM_HEALTH_URL" "$BOOKING_HEALTH_URL"; do
  curl --fail --silent --show-error --max-time 10 "$url" >/dev/null || die "healthcheck falhou: $url"
done
for path in /mcp-server /mcp-server/http /mcp-server/sse; do
  code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "$PUBLIC_ORB_BASE_URL$path")
  [[ "$code" == 404 ]] || die "rota pública MCP não retornou 404: $path"
done
info 'smokes de reachability concluídos; jornadas de negócio exigem fixture/cliente autorizado separado.'
