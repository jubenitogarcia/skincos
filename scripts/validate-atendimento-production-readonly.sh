#!/usr/bin/bash -p
set -euo pipefail

# Verify the isolated runtime without loading a private env file into a shell.
# The signed smoke owns the narrow literal parser and never prints its secrets.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

run_postgres_clean() {
  /usr/bin/sudo -n -u postgres /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/nonexistent' 'LANG=C' "$@"
}

readonly PORT='8110'
readonly SERVICE='crm-atendimento-production.service'
readonly CONTROL_FILE='/etc/skincos/atendimento-production/module-control.json'
readonly DATABASE='skincos_clientes_production'
readonly APP_ROLE='skincos_clientes_ro'
readonly RELEASE_BASE='/opt/skincos/releases'
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
SURFACE=''
usage() { echo "Usage: $0 --expected-release-sha <full-sha> [--surface <clientes|full>]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-release-sha) shift; RELEASE_SHA="${1:-}" ;;
    --surface) shift; SURFACE="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--expected-release-sha must be a full lowercase SHA.' >&2; exit 64; }
[[ -z "$SURFACE" || "$SURFACE" =~ ^(clientes|full)$ ]] || { echo '--surface must be clientes or full.' >&2; exit 64; }
readonly RELEASE_ROOT="$RELEASE_BASE/$RELEASE_SHA/source"
readonly RELEASE_MANIFEST="/var/lib/skincos-runtime/crm-atendimento-production/release-manifests/$RELEASE_SHA.json"
readonly SMOKE="$RELEASE_ROOT/crm/api/scripts/atendimento-production-signed-smoke.mjs"
readonly CONTROL_VALIDATOR="$RELEASE_ROOT/crm/api/scripts/validate-atendimento-production-control.mjs"
readonly RUNTIME_GRANT_LOCKDOWN="$RELEASE_ROOT/scripts/lockdown-atendimento-production-runtime.sh"
readonly PRODUCTION_DEFERRAL_RELATION='crm_atendimento.production_migration_deferrals'

for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/curl /usr/bin/psql /usr/bin/ss /usr/bin/systemctl /usr/bin/node /usr/bin/test /usr/bin/grep /usr/bin/awk /usr/bin/bash; do
  [[ -x "$command_path" ]] || { echo "Missing required command: $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n true
run_sudo_clean /usr/bin/test -r "$CONTROL_FILE" || { echo 'Module control is unavailable.' >&2; exit 1; }
run_sudo_clean /usr/bin/test -f "$SMOKE" || { echo 'Fixed signed smoke is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -f "$CONTROL_VALIDATOR" || { echo 'Strict production control validator is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -x "$RUNTIME_GRANT_LOCKDOWN" || { echo 'Production runtime grant lockdown is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -f "$RELEASE_MANIFEST" || { echo 'Production release surface manifest is unavailable.' >&2; exit 78; }
release_surface="$(run_sudo_clean /usr/bin/node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const surface=Object.prototype.hasOwnProperty.call(value,"surface") ? String(value.surface||"") : "clientes"; if (!/^(clientes|full)$/.test(surface)) process.exit(78); process.stdout.write(surface);' "$RELEASE_MANIFEST")"
[[ -z "$SURFACE" || "$SURFACE" == "$release_surface" ]] || { echo 'Requested production surface does not match the immutable release manifest.' >&2; exit 1; }
SURFACE="$release_surface"
run_sudo_clean /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$RELEASE_SHA" --surface "$SURFACE" >/dev/null
run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --dry-run >/dev/null
run_sudo_clean /usr/bin/systemctl is-active --quiet "$SERVICE" || { echo "Service is not active: $SERVICE" >&2; exit 1; }

# Source-dependent commercial migrations are deliberately deferred in the
# dedicated production database.  Readiness is still valid for the core and
# clinical read-only runtime, but only when the durable deferral journal and
# the independent clinical/policy tables exist.  The commercial mount remains
# blocked before the shared router and no Caixa/Harmonia privilege is reopened.
source_contract="$(run_postgres_clean /usr/bin/psql --dbname="$DATABASE" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command "select (to_regclass('crm_atendimento.schema_migrations') is not null and to_regclass('crm_atendimento.commercial_policy_config') is not null and to_regclass('$PRODUCTION_DEFERRAL_RELATION') is not null and to_regclass('clinical_approval.rules') is not null);")"
[[ "$source_contract" == 't' ]] || { echo 'Core/clinical production schema contract is incomplete.' >&2; exit 1; }

snapshot_protected_services() {
  local service main_pid started_at
  for service in "${PROTECTED_SERVICES[@]}"; do
    main_pid="$(run_sudo_clean /usr/bin/systemctl show --property=MainPID --value "$service" 2>/dev/null || true)"
    started_at="$(run_sudo_clean /usr/bin/systemctl show --property=ActiveEnterTimestampMonotonic --value "$service" 2>/dev/null || true)"
    printf '%s|%s|%s\n' "$service" "$main_pid" "$started_at"
  done
}

protected_before="$(snapshot_protected_services)"
installed_unit="$(run_sudo_clean /usr/bin/systemctl show --property=FragmentPath --value "$SERVICE")"
[[ "$installed_unit" == "/etc/systemd/system/$SERVICE" ]] || { echo 'Installed unit is not the dedicated immutable override.' >&2; exit 1; }
run_sudo_clean /usr/bin/grep -Fq "WorkingDirectory=$RELEASE_ROOT" "$installed_unit" || { echo 'Installed unit working directory does not match the expected release.' >&2; exit 1; }
if [[ "$SURFACE" == 'clientes' ]]; then
  run_sudo_clean /usr/bin/grep -Fq "Environment=CRM_ATENDIMENTO_SURFACE=clientes" "$installed_unit" || \
    run_sudo_clean /usr/bin/grep -Fq 'Environment=CRM_ATENDIMENTO_CLIENTES_ONLY=true' "$installed_unit" || \
    { echo 'Installed unit surface does not match the expected release.' >&2; exit 1; }
else
  run_sudo_clean /usr/bin/grep -Fq "Environment=CRM_ATENDIMENTO_SURFACE=$SURFACE" "$installed_unit" || { echo 'Installed unit surface does not match the expected release.' >&2; exit 1; }
fi
run_sudo_clean /usr/bin/grep -Fq "ExecStart=/usr/bin/node $RELEASE_ROOT/crm/api/server/atendimentoRuntime.js" "$installed_unit" || { echo 'Installed unit entrypoint does not match the isolated release.' >&2; exit 1; }
unit_exec="$(run_sudo_clean /usr/bin/systemctl show --property=ExecStart --value "$SERVICE")"
[[ "$unit_exec" == *"$RELEASE_ROOT/crm/api/server/atendimentoRuntime.js"* ]] || { echo 'Running unit command does not match the expected release.' >&2; exit 1; }

listen_line="$(/usr/bin/ss -ltn | /usr/bin/awk -v port=":$PORT" '$4 == "127.0.0.1" port || $4 == "[::1]" port { print; exit }')"
[[ -n "$listen_line" ]] || { echo "Runtime is not bound to loopback port $PORT." >&2; exit 1; }

health_status="$(/usr/bin/curl --noproxy '*' -sS --max-time 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"
[[ "$health_status" == '200' ]] || { echo "Liveness health expected 200, got $health_status." >&2; exit 1; }

# These checks contain only role names and booleans. The grant lockdown above
# proves the complete effective read-only/PII contract before this narrower
# schema assertion is evaluated. Identity/source tables are intentionally not
# required here: their migrations are durably deferred until a source mirror
# exists, and the runtime's commercial mount remains a fixed 503 boundary.
run_postgres_clean /usr/bin/psql --dbname="$DATABASE" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<SQL | while IFS='|' read -r role_name role_login readonly connect_ok schema_ok policy_select policy_insert deferral_table deferrals_recorded clinical_table schema_create database_create; do
select r.rolname,
       r.rolcanlogin,
       coalesce(array_to_string(r.rolconfig, ','), '') like '%default_transaction_read_only=on%',
       has_database_privilege(r.rolname, '$DATABASE', 'CONNECT'),
       has_schema_privilege(r.rolname, 'crm_atendimento', 'USAGE'),
       has_table_privilege(r.rolname, 'crm_atendimento.commercial_policy_config', 'SELECT'),
       has_table_privilege(r.rolname, 'crm_atendimento.commercial_policy_config', 'INSERT'),
       to_regclass('$PRODUCTION_DEFERRAL_RELATION') is not null,
       exists (
         select 1 from $PRODUCTION_DEFERRAL_RELATION d
          where d.event_state = 'deferred'
            and d.schema_migration_recorded = false
            and d.reason_code = 'PRODUCTION_SOURCE_MIRROR_NOT_PROVISIONED'
       ),
       to_regclass('clinical_approval.rules') is not null,
       has_schema_privilege(r.rolname, 'crm_atendimento', 'CREATE'),
       has_database_privilege(r.rolname, '$DATABASE', 'CREATE')
  from pg_roles r where r.rolname = '$APP_ROLE';
SQL
  [[ "$role_name" == "$APP_ROLE" && "$role_login" == 't' && "$readonly" == 't' && "$connect_ok" == 't' && "$schema_ok" == 't' && "$policy_select" == 't' && "$policy_insert" == 'f' && "$deferral_table" == 't' && "$deferrals_recorded" == 't' && "$clinical_table" == 't' && "$schema_create" == 'f' && "$database_create" == 'f' ]] || {
    echo 'Read-only database role contract is incomplete.' >&2
    exit 1
  }
done

run_sudo_clean /usr/bin/node "$SMOKE" --expected-release-sha "$RELEASE_SHA" --surface "$SURFACE"
protected_after="$(snapshot_protected_services)"
[[ "$protected_before" == "$protected_after" ]] || { echo 'A protected shared service changed during isolated validation.' >&2; exit 1; }
printf 'validation_passed=true service=%s release_sha=%s surface=%s shared_restart=false commercial_reads_disabled=true\n' "$SERVICE" "$RELEASE_SHA" "$SURFACE"
