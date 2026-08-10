#!/usr/bin/env bash
set -euo pipefail

# Lifecycle exclusive to the read-only MCP gateway. It never mutates the global
# /opt/skincos/current/source pointer used by Orb and orb-proxy.
RELEASE_BASE=${MCP_GATEWAY_RELEASE_BASE:-/opt/skincos/releases}
LINK=${MCP_GATEWAY_RELEASE_LINK:-/opt/skincos/current/mcp-readonly-source}
SERVICE=${MCP_GATEWAY_SERVICE:-skincos-orb-mcp-readonly.service}
APPLY=${MCP_GATEWAY_APPLY:-}
TEST_MODE=${MCP_GATEWAY_TEST_MODE:-}
SCRIPT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
UNIT_DEST=${MCP_GATEWAY_UNIT_DEST:-/etc/systemd/system/skincos-orb-mcp-readonly.service}
CHECKPOINT_ROOT=${MCP_GATEWAY_CHECKPOINT_ROOT:-/var/lib/skincos-runtime/orb-mcp-readonly/release-unit-checkpoints}
SYSTEMCTL_BIN=${MCP_GATEWAY_SYSTEMCTL_BIN:-/usr/bin/systemctl}
SYSTEMD_ANALYZE_BIN=${MCP_GATEWAY_SYSTEMD_ANALYZE_BIN:-/usr/bin/systemd-analyze}
readonly COORDINATION_RESOURCE='promotion:orb-mcp:local'
coordination_acquired=0

# The gateway is a native release consumer. Its pointer and unit mutations use
# the same mini-PC adapter as the rest of the immutable runtime.
NATIVE_COORDINATION_SCRIPT_ROOT="${NATIVE_COORDINATION_SCRIPT_ROOT:-$SCRIPT_ROOT}"
export NATIVE_COORDINATION_SCRIPT_ROOT
# shellcheck disable=SC1091
source "$SCRIPT_ROOT/scripts/runtime/global-coordination-native.sh"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need_apply() {
  [[ "$APPLY" == YES ]] || die 'refused: set MCP_GATEWAY_APPLY=YES'
  [[ "$TEST_MODE" == YES || "$(id -u)" == 0 ]] || die 'refused: run the applied lifecycle as root.'
}
release_root() { printf '%s/%s/source/orb/engine/mcp-readonly-gateway\n' "$RELEASE_BASE" "$1"; }
release_source_root() { printf '%s/%s/source\n' "$RELEASE_BASE" "$1"; }
systemd() { "$SYSTEMCTL_BIN" "$@"; }

coordination_cleanup() {
  if [[ "${coordination_acquired:-0}" == '1' ]]; then
    native_coordination_cleanup || printf 'WARNING: gateway coordination lease will expire fail-closed.\n' >&2
    coordination_acquired=0
  fi
}
trap coordination_cleanup EXIT INT TERM

coordination_begin() {
  local sha=$1 root
  root=$(release_source_root "$sha")
  native_coordination_init \
    "$COORDINATION_RESOURCE" orb "$sha" \
    "$root/.skincos-global-coordination-orb.json" promotion \
    "$root/.skincos-release-identity-orb.json"
  native_coordination_acquire "mini-pc:${COORDINATION_RESOURCE}:$sha:$$"
  coordination_acquired=1
  native_coordination_check
}

coordination_check() {
  [[ "${coordination_acquired:-0}" == '1' ]] || die 'gateway mutation is missing its global coordination lease.'
  native_coordination_check
}

validate_release() {
  local sha=$1 root source_root lineage realbase
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die 'release must be a full lowercase SHA.'
  root=$(release_root "$sha")
  [[ -d "$root" && -f "$root/server.mjs" ]] || die "gateway artifact missing for $sha"
  source_root=$(release_source_root "$sha")
  [[ -f "$source_root/.skincos-global-coordination-orb.json" ]] || die "gateway coordination closure missing for $sha"
  [[ -f "$source_root/.skincos-release-identity-orb.json" ]] || die "gateway release identity missing for $sha"
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
  coordination_check
  install -d -m 0750 "$(dirname "$LINK")"
  coordination_check
  tmp="${LINK}.next.$$"
  ln -s "$target" "$tmp"
  coordination_check
  mv -Tf "$tmp" "$LINK"
  printf 'selected_release=%s\n' "$sha"
}

control_source_root() {
  local source_release lineage
  [[ "$TEST_MODE" == YES ]] && { printf '%s\n' "$SCRIPT_ROOT"; return; }
  [[ "$SCRIPT_ROOT" =~ ^/opt/skincos/releases/([0-9a-f]{40})/source$ ]] || die 'provision must run from a staged immutable release, never a checkout.'
  source_release=${BASH_REMATCH[1]}
  lineage="$SCRIPT_ROOT/.skincos-release-lineage.json"
  [[ -f "$lineage" ]] || die 'control release lineage is missing.'
  node --input-type=module - "$lineage" "$source_release" <<'NODE'
import fs from 'node:fs';
const [lineage, sha] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(lineage, 'utf8'));
if (data.releaseId !== sha || data.verifiedAncestor !== true) process.exit(1);
NODE
  printf '%s\n' "$SCRIPT_ROOT"
}

unit_source() {
  local root
  root=$(control_source_root)
  if [[ "$TEST_MODE" == YES && -n "${MCP_GATEWAY_UNIT_SOURCE:-}" ]]; then
    printf '%s\n' "$MCP_GATEWAY_UNIT_SOURCE"
  else
    printf '%s/orb/engine/mcp-readonly-gateway/systemd/skincos-orb-mcp-readonly.service\n' "$root"
  fi
}

verify_unit() {
  local unit=$1
  [[ -f "$unit" ]] || die 'gateway unit source is missing.'
  grep -Fqx 'WorkingDirectory=/opt/skincos/current/mcp-readonly-source' "$unit" || die 'gateway unit does not use the exclusive source pointer.'
  grep -Fqx 'ExecStart=/usr/bin/node /opt/skincos/current/mcp-readonly-source/server.mjs' "$unit" || die 'gateway unit executable is not exclusive.'
  grep -Fqx 'ReadOnlyPaths=/opt/skincos/current/mcp-readonly-source' "$unit" || die 'gateway unit read-only path is not exclusive.'
  "$SYSTEMD_ANALYZE_BIN" verify "$unit"
}

capture_unit_checkpoint() {
  local checkpoint timestamp
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  checkpoint="$CHECKPOINT_ROOT/$timestamp-$$"
  coordination_check
  install -d -m 0700 "$checkpoint"
  if [[ -f "$UNIT_DEST" ]]; then
    coordination_check
    install -m 0600 "$UNIT_DEST" "$checkpoint/unit.previous.service"
    coordination_check
    sha256sum "$checkpoint/unit.previous.service" >"$checkpoint/unit.previous.sha256"
  else
    coordination_check
    printf 'absent\n' >"$checkpoint/unit.previous.absent"
  fi
  coordination_check
  printf 'service=%s\nunit_destination=%s\n' "$SERVICE" "$UNIT_DEST" >"$checkpoint/metadata"
  printf '%s\n' "$checkpoint"
}

restore_unit_checkpoint() {
  local checkpoint=$1 tmp
  [[ "$checkpoint" == "$CHECKPOINT_ROOT"/* && -d "$checkpoint" ]] || die 'checkpoint is outside the gateway checkpoint root.'
  coordination_check
  if [[ -f "$checkpoint/unit.previous.service" ]]; then
    tmp="${UNIT_DEST}.restore.$$"
    install -m 0644 "$checkpoint/unit.previous.service" "$tmp"
    coordination_check
    mv -Tf "$tmp" "$UNIT_DEST"
  elif [[ -f "$checkpoint/unit.previous.absent" ]]; then
    coordination_check
    rm -f -- "$UNIT_DEST"
  else
    die 'checkpoint does not contain a prior unit state.'
  fi
  coordination_check
  systemd daemon-reload
}

verify_loaded_unit() {
  local rendered
  if [[ "$TEST_MODE" == YES ]]; then
    rendered=$(<"$UNIT_DEST")
  else
    rendered=$(systemd show "$SERVICE" -p WorkingDirectory -p ExecStart)
  fi
  [[ "$rendered" == *'/opt/skincos/current/mcp-readonly-source'* ]] || return 1
  [[ "$rendered" == *'server.mjs'* ]] || return 1
}

provision() {
  local target=$1 unit checkpoint tmp
  need_apply
  validate_release "$target"
  coordination_begin "$target"
  unit=$(unit_source)
  verify_unit "$unit"
  checkpoint=$(capture_unit_checkpoint)
  coordination_check
  install -d -m 0755 "$(dirname "$UNIT_DEST")"
  tmp="${UNIT_DEST}.next.$$"
  coordination_check
  if ! install -m 0644 "$unit" "$tmp"; then
    rm -f -- "$tmp"
    restore_unit_checkpoint "$checkpoint" || true
    die 'gateway unit provisioning failed and the prior unit was restored.'
  fi
  coordination_check
  if ! mv -Tf "$tmp" "$UNIT_DEST"; then
    rm -f -- "$tmp"
    restore_unit_checkpoint "$checkpoint" || true
    die 'gateway unit provisioning failed and the prior unit was restored.'
  fi
  coordination_check
  if ! systemd daemon-reload || ! verify_loaded_unit; then
    rm -f -- "$tmp"
    restore_unit_checkpoint "$checkpoint" || true
    die 'gateway unit provisioning failed and the prior unit was restored.'
  fi
  if ! select_release "$target"; then
    restore_unit_checkpoint "$checkpoint" || true
    die 'gateway pointer selection failed and the prior unit was restored.'
  fi
  coordination_check
  printf 'control_release=%s\nunit_checkpoint=%s\n' "$(control_source_root)" "$checkpoint"
}

health_ok() {
  curl -fsS --max-time 5 "http://127.0.0.1:${MCP_GATEWAY_PORT:-8766}/.well-known/oauth-protected-resource/mcp" >/dev/null
}

restart_controlled() {
  local attempt
  need_apply
  coordination_check
  systemd restart "$SERVICE"
  for attempt in {1..10}; do
    if systemd is-active --quiet "$SERVICE" && health_ok; then return 0; fi
    sleep 1
  done
  return 1
}

promote() {
  local target=$1 incumbent=$2
  validate_release "$target"; validate_release "$incumbent"
  select_release "$target"
  if restart_controlled; then
    printf 'promoted_release=%s\n' "$target"
    return 0
  fi
  printf 'promotion_failed=1; applying_gateway_rollback=%s\n' "$incumbent" >&2
  select_release "$incumbent"
  restart_controlled || die 'gateway promotion and automatic rollback both failed.'
  die 'gateway promotion failed; rollback completed.'
}

status() {
  local configured=unconfigured pid=0 cwd=none health=unproven
  configured=$(configured_release || true); configured=${configured:-unconfigured}
  if command -v "$SYSTEMCTL_BIN" >/dev/null; then
    pid=$(systemd show "$SERVICE" -p MainPID --value 2>/dev/null || echo 0)
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] && cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || echo inaccessible)
  fi
  if command -v curl >/dev/null; then health=$(health_ok && echo ok || echo failed); fi
  printf 'configured_release=%s\npid=%s\ncwd=%s\nhealth=%s\n' "$configured" "$pid" "$cwd" "$health"
  printf 'allowed_tools=list_workflows,search_workflows,get_workflow_summary,get_workflow_graph,find_workflow_dependencies,list_recent_executions,get_execution_error,compare_workflow_with_repository,get_orb_status\n'
  printf 'forbidden_tool=execute_workflow\n'
}

usage() { echo 'usage: mcp-gateway-release.sh preflight <sha>|provision <sha>|select <sha>|restart|promote <target-sha> <incumbent-sha>|rollback <sha>|status'; }
case "${1:-}" in
  preflight) [[ $# -eq 2 ]] || { usage >&2; exit 2; }; validate_release "$2"; echo "preflight_release=$2" ;;
  provision) [[ $# -eq 2 ]] || { usage >&2; exit 2; }; provision "$2" ;;
  select)
    [[ $# -eq 2 ]] || { usage >&2; exit 2; }
    need_apply
    validate_release "$2"
    coordination_begin "$2"
    select_release "$2"
    ;;
  restart)
    [[ $# -eq 1 ]] || { usage >&2; exit 2; }
    configured=$(configured_release || true)
    [[ "$configured" =~ ^[0-9a-f]{40}$ ]] || die 'gateway restart requires a configured immutable release.'
    coordination_begin "$configured"
    restart_controlled || die 'gateway restart or health check failed.'
    ;;
  promote)
    [[ $# -eq 3 ]] || { usage >&2; exit 2; }
    need_apply
    validate_release "$2"
    validate_release "$3"
    coordination_begin "$2"
    promote "$2" "$3"
    ;;
  rollback)
    [[ $# -eq 2 ]] || { usage >&2; exit 2; }
    need_apply
    validate_release "$2"
    coordination_begin "$2"
    select_release "$2"
    restart_controlled || die 'gateway rollback restart or health check failed.'
    ;;
  status) [[ $# -eq 1 ]] || { usage >&2; exit 2; }; status ;;
  *) usage >&2; exit 2 ;;
esac
