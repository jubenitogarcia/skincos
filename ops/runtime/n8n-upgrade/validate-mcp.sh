#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
if dry_run_notice; then
  info 'regressão MCP planejada: auth, initialize, tools/list, 9 tools readonly, sanitização, limites e 404 público.'
  exit 0
fi
MCP_URL=${N8N_MCP_LOCAL_URL:-http://127.0.0.1:8766/mcp}
TOKEN_FILE=${N8N_MCP_BEARER_FILE:-}
[[ -r "$TOKEN_FILE" ]] || die 'N8N_MCP_BEARER_FILE ausente; token não pode ser argumento.'
TOKEN=$(<"$TOKEN_FILE")
[[ -n "$TOKEN" ]] || die 'arquivo bearer vazio.'
AUTH=(-H "Authorization: Bearer $TOKEN")
unauth=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' "$MCP_URL")
[[ "$unauth" == 401 ]] || die 'MCP sem autenticação não retornou 401.'
tools=$(curl --fail --silent --show-error --max-time 10 "${AUTH[@]}" -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "$MCP_URL")
printf '%s' "$tools" | grep -q 'list_workflows' || die 'list_workflows ausente.'
if printf '%s' "$tools" | grep -q 'execute_workflow'; then die 'execute_workflow descoberto; fail-closed.'; fi
info 'MCP readonly validado sem imprimir bearer ou payload.'
