#!/usr/bin/env bash
set -euo pipefail

# Lifecycle exclusive to the read-only MCP gateway. It never mutates the global
# /opt/skincos/current/source pointer used by Orb and orb-proxy.
RELEASE_BASE=${MCP_GATEWAY_RELEASE_BASE:-/opt/skincos/releases}
LINK=${MCP_GATEWAY_RELEASE_LINK:-/opt/skincos/current/mcp-readonly-source}
SERVICE=${MCP_GATEWAY_SERVICE:-skincos-orb-mcp-readonly.service}
APPLY=${MCP_GATEWAY_APPLY:-}

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need_apply() { [[ "$APPLY" == YES ]] || die 'refused: set MCP_GATEWAY_APPLY=YES'; }
release_root() { printf '%s/%s/source/orb/engine/mcp-readonly-gateway\n' "$RELEASE_BASE" "$1"; }

validate_release() {
  local sha=$1 root lineage realbase
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die 'release must be a full lowercase SHA.'
  root=$(release_root "$sha")
  [[ -d "$root" && -f "$root/server.mjs" ]] || die "gateway artifact missing for $sha"
  lineage="$RELEASE_BASE/$sha/source/.skincos-release-lineage.json"
  [[ -f "$lineage" ]] || die "release lineage missing for $sha"
  node --input-type=module - "$lineage" "$sha" <<'NODE'
import fs from 'node:fs';
const [lineage, sha] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(lineage, 'utf8'));
if (data.releaseId !== sha || data.verifiedAncestor !== true) process.exit(1);
NODE
  realbase=$(realpath -e "$RELEASE_BASE")
  [[ "$(realpath -e "$root")" == "$realbase"/* ]] || die 'release escaped immutable release tree.'
  [[ ! "$root" =~ /mnt/ && ! "$root" =~ /worktree ]] || die 'development checkout refused.'
}

configured_release() {
  local target prefix rest
  [[ -L "$LINK" ]] || return 1
  target=$(realpath -e "$LINK")
  prefix="$(realpath -e "$RELEASE_BASE")/"
  [[ "$target" == "$prefix"* ]] || return 1
  rest=${target#"$prefix"}
  printf '%s\n' "${rest%%/*}"
}

select_release() {
  local sha=$1 target tmp
  validate_release "$sha"; target=$(release_root "$sha")
  need_apply
  install -d -m 0750 "$(dirname "$LINK")"
  tmp="${LINK}.next.$$"
  ln -s "$target" "$tmp"
  mv -Tf "$tmp" "$LINK"
  printf 'selected_release=%s\n' "$sha"
}

status() {
  local configured=unconfigured pid=0 cwd=none health=unproven
  configured=$(configured_release || true); configured=${configured:-unconfigured}
  if command -v systemctl >/dev/null; then
    pid=$(systemctl show "$SERVICE" -p MainPID --value 2>/dev/null || echo 0)
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] && cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || echo inaccessible)
  fi
  if command -v curl >/dev/null; then health=$(curl -fsS --max-time 5 http://127.0.0.1:${MCP_GATEWAY_PORT:-8766}/.well-known/oauth-protected-resource/mcp >/dev/null && echo ok || echo failed); fi
  printf 'configured_release=%s\npid=%s\ncwd=%s\nhealth=%s\n' "$configured" "$pid" "$cwd" "$health"
  printf 'allowed_tools=list_workflows,search_workflows,get_workflow_summary,get_workflow_graph,find_workflow_dependencies,list_recent_executions,get_execution_error,compare_workflow_with_repository,get_orb_status\n'
  printf 'forbidden_tool=execute_workflow\n'
}

restart_controlled() { need_apply; systemctl restart "$SERVICE"; systemctl is-active --quiet "$SERVICE" || die 'gateway restart failed'; }

usage() { echo 'usage: mcp-gateway-release.sh preflight <sha>|select <sha>|restart|rollback <sha>|status'; }
case "${1:-}" in
  preflight) [[ $# -eq 2 ]] || { usage >&2; exit 2; }; validate_release "$2"; echo "preflight_release=$2" ;;
  select) [[ $# -eq 2 ]] || { usage >&2; exit 2; }; select_release "$2" ;;
  restart) [[ $# -eq 1 ]] || { usage >&2; exit 2; }; restart_controlled ;;
  rollback) [[ $# -eq 2 ]] || { usage >&2; exit 2; }; select_release "$2"; restart_controlled ;;
  status) [[ $# -eq 1 ]] || { usage >&2; exit 2; }; status ;;
  *) usage >&2; exit 2 ;;
esac
