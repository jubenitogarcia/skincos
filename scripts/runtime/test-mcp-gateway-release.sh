#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPT="$ROOT/scripts/runtime/mcp-gateway-release.sh"
tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
for sha in 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222; do
  mkdir -p "$tmp/releases/$sha/source/orb/engine/mcp-readonly-gateway"
  printf 'console.log("shadow")\n' >"$tmp/releases/$sha/source/orb/engine/mcp-readonly-gateway/server.mjs"
  printf '{"releaseId":"%s","verifiedAncestor":true}\n' "$sha" >"$tmp/releases/$sha/source/.skincos-release-lineage.json"
done
env MCP_GATEWAY_RELEASE_BASE="$tmp/releases" MCP_GATEWAY_RELEASE_LINK="$tmp/current/mcp-readonly-source" "$SCRIPT" preflight 1111111111111111111111111111111111111111 | grep -q preflight_release
if env MCP_GATEWAY_RELEASE_BASE="$tmp/releases" MCP_GATEWAY_RELEASE_LINK="$tmp/current/mcp-readonly-source" "$SCRIPT" select 1111111111111111111111111111111111111111; then exit 1; fi
env MCP_GATEWAY_APPLY=YES MCP_GATEWAY_RELEASE_BASE="$tmp/releases" MCP_GATEWAY_RELEASE_LINK="$tmp/current/mcp-readonly-source" "$SCRIPT" select 1111111111111111111111111111111111111111 | grep -q selected_release
[[ "$(readlink -f "$tmp/current/mcp-readonly-source")" == "$tmp/releases/1111111111111111111111111111111111111111/source/orb/engine/mcp-readonly-gateway" ]]
env MCP_GATEWAY_APPLY=YES MCP_GATEWAY_RELEASE_BASE="$tmp/releases" MCP_GATEWAY_RELEASE_LINK="$tmp/current/mcp-readonly-source" "$SCRIPT" select 2222222222222222222222222222222222222222 | grep -q selected_release
[[ "$(readlink -f "$tmp/current/mcp-readonly-source")" == "$tmp/releases/2222222222222222222222222222222222222222/source/orb/engine/mcp-readonly-gateway" ]]
if env MCP_GATEWAY_RELEASE_BASE="$tmp/releases" "$SCRIPT" preflight ../etc/passwd; then exit 1; fi
echo 'mcp_gateway_release_tests=pass'
