#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

# The isolated staging runtime intentionally has no public route. This native
# verifier proves liveness only over its fixed loopback listener and never
# loads an env file, invokes a shared tunnel, or contacts the shared CRM.
readonly PORT='8111'
readonly SERVICE='crm-atendimento-staging.service'
readonly CONTROL_FILE='/etc/skincos/atendimento-staging/module-control.json'
readonly RELEASE_BASE='/opt/skincos/releases'
readonly UNIT_FILE='/etc/systemd/system/crm-atendimento-staging.service'
readonly PROTECTED_SERVICES=(
  'crm.service'
  'crm-atendimento-production.service'
  'crm-jobs.service'
  'cloudflare-runtime.service'
  'cloudflare-orb.service'
  'orb.service'
  'orb-proxy.service'
)

RELEASE_SHA=''
usage() { echo "Usage: $0 --expected-release-sha <full-sha>"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-release-sha) shift; RELEASE_SHA="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--expected-release-sha must be a full lowercase SHA.' >&2; exit 64; }
readonly RELEASE_ROOT="$RELEASE_BASE/$RELEASE_SHA/source"
readonly CONTROL_VALIDATOR="$RELEASE_ROOT/crm/api/scripts/validate-atendimento-staging-control.mjs"
readonly RELEASE_VALIDATOR="$RELEASE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
readonly RUNTIME_GRANT_LOCKDOWN="$RELEASE_ROOT/scripts/lockdown-atendimento-staging-runtime.sh"
readonly SMOKE="$RELEASE_ROOT/crm/api/scripts/atendimento-staging-signed-smoke.mjs"
readonly UNIT_TEMPLATE="$RELEASE_ROOT/ops/runtime/units/crm-atendimento-staging.service"
[[ "$RELEASE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || { echo 'Immutable release root is invalid.' >&2; exit 64; }

for command_path in /usr/bin/curl /usr/bin/ss /usr/bin/systemctl /usr/bin/sudo /usr/bin/node /usr/bin/sed /usr/bin/mktemp /usr/bin/cmp /usr/bin/readlink /usr/bin/cat /usr/bin/tr /usr/bin/awk /usr/bin/rm /usr/bin/rmdir /usr/bin/test; do
  [[ -x "$command_path" ]] || { echo "Missing required command: $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n true
/usr/bin/sudo -n /usr/bin/test -r "$CONTROL_FILE" || { echo 'Strict staging control is unavailable.' >&2; exit 1; }
/usr/bin/sudo -n /usr/bin/test -f "$CONTROL_VALIDATOR" || { echo 'Strict staging control validator is unavailable.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$RELEASE_VALIDATOR" || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -x "$RUNTIME_GRANT_LOCKDOWN" || { echo 'Staging runtime grant lockdown is unavailable.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$SMOKE" || { echo 'Fixed staging signed smoke is unavailable.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$UNIT_TEMPLATE" || { echo 'Isolated unit template is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$UNIT_FILE" || { echo 'Installed isolated unit is unavailable.' >&2; exit 1; }
/usr/bin/sudo -n /usr/bin/systemctl is-active --quiet "$SERVICE" || { echo "Service is not active: $SERVICE" >&2; exit 1; }
run_sudo_clean /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$RELEASE_ROOT" --release-sha "$RELEASE_SHA" --target staging >/dev/null

snapshot_protected_services() {
  local service main_pid started_at
  for service in "${PROTECTED_SERVICES[@]}"; do
    main_pid="$(/usr/bin/sudo -n /usr/bin/systemctl show --property=MainPID --value "$service" 2>/dev/null || true)"
    started_at="$(/usr/bin/sudo -n /usr/bin/systemctl show --property=ActiveEnterTimestampMonotonic --value "$service" 2>/dev/null || true)"
    printf '%s|%s|%s\n' "$service" "$main_pid" "$started_at"
  done
}

protected_before="$(snapshot_protected_services)"
render_dir="$(/usr/bin/mktemp -d)"
rendered="$render_dir/crm-atendimento-staging.service"
trap '/usr/bin/rm -f "$rendered"; /usr/bin/rmdir "$render_dir" 2>/dev/null || true' EXIT
/usr/bin/sed \
  -e "s|__REPO_ROOT__|$RELEASE_ROOT|g" \
  -e "s|__STATE_ROOT__|/var/lib/skincos-runtime|g" \
  -e "s|__CONFIG_ROOT__|/etc/skincos|g" \
  -e "s|__LOG_ROOT__|/var/log/skincos|g" \
  -e "s|__RELEASE_SHA__|$RELEASE_SHA|g" \
  "$UNIT_TEMPLATE" >"$rendered"
/usr/bin/sudo -n /usr/bin/cmp -s "$rendered" "$UNIT_FILE" || { echo 'Installed staging unit does not match the immutable release.' >&2; exit 1; }

main_pid="$(/usr/bin/sudo -n /usr/bin/systemctl show --property=MainPID --value "$SERVICE")"
[[ "$main_pid" =~ ^[1-9][0-9]*$ ]] || { echo 'Staging runtime has no valid main PID.' >&2; exit 1; }
runtime_cwd="$(/usr/bin/sudo -n /usr/bin/readlink -f "/proc/$main_pid/cwd")"
[[ "$runtime_cwd" == "$RELEASE_ROOT" ]] || { echo 'Staging runtime process is not running from the expected immutable release.' >&2; exit 1; }
runtime_cmdline="$(/usr/bin/sudo -n /usr/bin/cat "/proc/$main_pid/cmdline" | /usr/bin/tr '\0' ' ')"
[[ "$runtime_cmdline" == *"/usr/bin/node"* && "$runtime_cmdline" == *"$RELEASE_ROOT/crm/api/server/atendimentoRuntime.js"* ]] || { echo 'Staging runtime command line is not the isolated entrypoint.' >&2; exit 1; }

listen_line="$(/usr/bin/ss -ltn | /usr/bin/awk -v port=":$PORT" '$4 == "127.0.0.1" port || $4 == "[::1]" port { print; exit }')"
[[ -n "$listen_line" ]] || { echo "Runtime is not bound to loopback port $PORT." >&2; exit 1; }

# Health is deliberately liveness-only: it must remain 200 even while the
# database is unavailable or staging is held in maintenance. Do not turn this
# into a public readiness probe or leak a private readiness token.
health_status="$(/usr/bin/curl --noproxy '*' --proto '=http' -sS --connect-timeout 2 --max-time 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"
[[ "$health_status" == '200' ]] || { echo "Liveness health expected 200, got $health_status." >&2; exit 1; }

# The smoke reads only the fixed private staging env through a literal parser.
# Its probes are loopback-only synthetic auth/replay and a bodyless blocked
# write guard; it never reaches a Clientes or commercial data handler.
run_sudo_clean /usr/bin/node "$SMOKE" --expected-release-sha "$RELEASE_SHA"
run_sudo_clean /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$RELEASE_SHA" >/dev/null
run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --dry-run >/dev/null
protected_after="$(snapshot_protected_services)"
[[ "$protected_before" == "$protected_after" ]] || { echo 'A protected shared service changed during isolated staging validation.' >&2; exit 1; }
printf 'validation_passed=true service=%s release_sha=%s loopback_health=true signed_smoke=true unit_attested=true process_attested=true shared_restart=false\n' "$SERVICE" "$RELEASE_SHA"
