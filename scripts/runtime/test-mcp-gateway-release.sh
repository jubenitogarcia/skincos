#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPT="$ROOT/scripts/runtime/mcp-gateway-release.sh"
tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
first=1111111111111111111111111111111111111111
second=2222222222222222222222222222222222222222
for sha in "$first" "$second"; do
  mkdir -p "$tmp/releases/$sha/source/orb/engine/mcp-readonly-gateway"
  printf 'console.log("shadow")\n' >"$tmp/releases/$sha/source/orb/engine/mcp-readonly-gateway/server.mjs"
  printf '{"releaseId":"%s","verifiedAncestor":true}\n' "$sha" >"$tmp/releases/$sha/source/.skincos-release-lineage.json"
  printf '{}\n' >"$tmp/releases/$sha/source/.skincos-global-coordination-orb.json"
  printf '{}\n' >"$tmp/releases/$sha/source/.skincos-release-identity-orb.json"
done
unit="$tmp/gateway.service"
printf '%s\n' \
  '[Service]' \
  'WorkingDirectory=/opt/skincos/current/mcp-readonly-source' \
  'ExecStart=/usr/bin/node /opt/skincos/current/mcp-readonly-source/server.mjs' \
  'ReadOnlyPaths=/opt/skincos/current/mcp-readonly-source' >"$unit"
fake_systemd="$tmp/fake-systemctl"
printf '#!/usr/bin/env bash\nexit 0\n' >"$fake_systemd"; chmod +x "$fake_systemd"
fake_analyze="$tmp/fake-systemd-analyze"
printf '#!/usr/bin/env bash\nexit 0\n' >"$fake_analyze"; chmod +x "$fake_analyze"
native_root="$tmp/native/scripts/runtime"
mkdir -p "$native_root"
printf '#!/usr/bin/env bash\ncase "${1:-}" in acquire|check|renew|release) exit 0 ;; *) exit 64 ;; esac\n' >"$native_root/global-coordination-mini-pc.sh"
chmod +x "$native_root/global-coordination-mini-pc.sh"
base=(env MCP_GATEWAY_TEST_MODE=YES NATIVE_COORDINATION_SCRIPT_ROOT="$tmp/native" MCP_GATEWAY_RELEASE_BASE="$tmp/releases" MCP_GATEWAY_RELEASE_LINK="$tmp/current/mcp-readonly-source" MCP_GATEWAY_UNIT_SOURCE="$unit" MCP_GATEWAY_UNIT_DEST="$tmp/systemd/skincos-orb-mcp-readonly.service" MCP_GATEWAY_CHECKPOINT_ROOT="$tmp/checkpoints" MCP_GATEWAY_SYSTEMCTL_BIN="$fake_systemd" MCP_GATEWAY_SYSTEMD_ANALYZE_BIN="$fake_analyze")
"${base[@]}" "$SCRIPT" preflight "$first" | grep -q preflight_release
if "${base[@]}" "$SCRIPT" select "$first"; then exit 1; fi
provision_output=$("${base[@]}" MCP_GATEWAY_APPLY=YES "$SCRIPT" provision "$first")
[[ "$provision_output" == *"selected_release=$first"* ]]
[[ "$provision_output" == *'unit_checkpoint='* ]]
[[ "$(readlink -f "$tmp/current/mcp-readonly-source")" == "$tmp/releases/$first/source/orb/engine/mcp-readonly-gateway" ]]
cmp -s "$unit" "$tmp/systemd/skincos-orb-mcp-readonly.service"
"${base[@]}" MCP_GATEWAY_APPLY=YES "$SCRIPT" select "$second" | grep -q selected_release
[[ "$(readlink -f "$tmp/current/mcp-readonly-source")" == "$tmp/releases/$second/source/orb/engine/mcp-readonly-gateway" ]]
if "${base[@]}" "$SCRIPT" preflight ../etc/passwd; then exit 1; fi
echo 'mcp_gateway_release_tests=pass'
