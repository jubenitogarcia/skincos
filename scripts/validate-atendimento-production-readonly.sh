#!/usr/bin/env bash
set -euo pipefail

# Verify the isolated runtime without loading a private env file into a shell.
# The signed smoke owns the narrow literal parser and never prints its secrets.
readonly PORT='8110'
readonly SERVICE='crm-atendimento-production.service'
readonly CONTROL_FILE='/etc/skincos/atendimento-production/module-control.json'
readonly DATABASE='skincos_clientes_production'
readonly APP_ROLE='skincos_clientes_ro'
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SMOKE="$ROOT_DIR/crm/api/scripts/atendimento-production-signed-smoke.mjs"
readonly PROTECTED_SERVICES=(
  'crm.service'
  'crm-atendimento-staging.service'
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

for command_name in curl psql ss systemctl sudo node; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }
done
sudo -n true
sudo -n test -r "$CONTROL_FILE" || { echo 'Module control is unavailable.' >&2; exit 1; }
sudo -n systemctl is-active --quiet "$SERVICE" || { echo "Service is not active: $SERVICE" >&2; exit 1; }
[[ -f "$SMOKE" ]] || { echo 'Fixed signed smoke is unavailable.' >&2; exit 78; }

snapshot_protected_services() {
  local service main_pid started_at
  for service in "${PROTECTED_SERVICES[@]}"; do
    main_pid="$(sudo -n systemctl show --property=MainPID --value "$service" 2>/dev/null || true)"
    started_at="$(sudo -n systemctl show --property=ActiveEnterTimestampMonotonic --value "$service" 2>/dev/null || true)"
    printf '%s|%s|%s\n' "$service" "$main_pid" "$started_at"
  done
}

protected_before="$(snapshot_protected_services)"
listen_line="$(ss -ltn | awk -v port=":$PORT" '$4 == "127.0.0.1" port || $4 == "[::1]" port { print; exit }')"
[[ -n "$listen_line" ]] || { echo "Runtime is not bound to loopback port $PORT." >&2; exit 1; }

health_status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"
[[ "$health_status" == '200' ]] || { echo "Liveness health expected 200, got $health_status." >&2; exit 1; }

# These checks contain only role names and booleans.  The app role has no
# cross-database raw phone grant, no DDL and no mutation permission.
sudo -n -u postgres psql --dbname="$DATABASE" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<SQL | while IFS='|' read -r role_name role_login readonly connect_ok schema_ok identity_select policy_select identity_insert schema_create database_create; do
select r.rolname,
       r.rolcanlogin,
       coalesce(array_to_string(r.rolconfig, ','), '') like '%default_transaction_read_only=on%',
       has_database_privilege(r.rolname, '$DATABASE', 'CONNECT'),
       has_schema_privilege(r.rolname, 'crm_atendimento', 'USAGE'),
       has_table_privilege(r.rolname, 'crm_atendimento.global_client_identities', 'SELECT'),
       has_table_privilege(r.rolname, 'crm_atendimento.commercial_policy_config', 'SELECT'),
       has_table_privilege(r.rolname, 'crm_atendimento.global_client_identities', 'INSERT'),
       has_schema_privilege(r.rolname, 'crm_atendimento', 'CREATE'),
       has_database_privilege(r.rolname, '$DATABASE', 'CREATE')
  from pg_roles r where r.rolname = '$APP_ROLE';
SQL
  [[ "$role_name" == "$APP_ROLE" && "$role_login" == 't' && "$readonly" == 't' && "$connect_ok" == 't' && "$schema_ok" == 't' && "$identity_select" == 't' && "$policy_select" == 't' && "$identity_insert" == 'f' && "$schema_create" == 'f' && "$database_create" == 'f' ]] || {
    echo 'Read-only database role contract is incomplete.' >&2
    exit 1
  }
done

sudo -n /usr/bin/node "$SMOKE" --expected-release-sha "$RELEASE_SHA"
protected_after="$(snapshot_protected_services)"
[[ "$protected_before" == "$protected_after" ]] || { echo 'A protected shared service changed during isolated validation.' >&2; exit 1; }
printf 'validation_passed=true service=%s release_sha=%s shared_restart=false\n' "$SERVICE" "$RELEASE_SHA"
