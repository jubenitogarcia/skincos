#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8110}"
SERVICE="crm-atendimento-production.service"
PROTECTED_SERVICES=(
  "crm.service"
  "crm-atendimento-staging.service"
  "crm-jobs.service"
  "cloudflare-runtime.service"
  "cloudflare-orb.service"
  "orb.service"
  "orb-proxy.service"
  "orb-ccg-executor.service"
  "skincos-orb-mcp-readonly.service"
)
CONFIG_FILE="${CONFIG_FILE:-/etc/skincos/crm-clientes-production-readonly.env}"
CONTROL_FILE="${CONTROL_FILE:-/etc/skincos/atendimento-production/module-control.json}"
DB_NAME="skincos_clientes_production"
APP_ROLE="skincos_clientes_ro"
MIGRATOR_ROLE="skincos_clientes_migrator"
EXPECTED_STATE="${EXPECTED_STATE:-active}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://crm-atendimento.skincos.com.br/api/atendimento/health}"
EXPECTED_RELEASE_SHA="${EXPECTED_RELEASE_SHA:-}"
SMOKE_SCRIPT="${SMOKE_SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/crm/atendimento-production-signed-smoke.mjs}"

snapshot_protected_services() {
  local service main_pid started_at
  for service in "${PROTECTED_SERVICES[@]}"; do
    main_pid="$(sudo -n systemctl show --property=MainPID --value "$service" 2>/dev/null || true)"
    started_at="$(sudo -n systemctl show --property=ActiveEnterTimestampMonotonic --value "$service" 2>/dev/null || true)"
    printf '%s|%s|%s\n' "$service" "$main_pid" "$started_at"
  done
}

[[ "$EXPECTED_STATE" =~ ^(disabled|maintenance|active)$ ]] || { echo 'EXPECTED_STATE must be disabled, maintenance or active.' >&2; exit 64; }
[[ "$DB_NAME" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo 'Dedicated Clientes database identifier is invalid.' >&2; exit 64; }
for command_name in curl psql ss systemctl sudo; do command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }; done
sudo -n true
sudo -n systemctl is-active --quiet "$SERVICE" || { echo "Service is not active: $SERVICE" >&2; exit 1; }
sudo -n test -r "$CONFIG_FILE" || { echo "Runtime config is unavailable: $CONFIG_FILE" >&2; exit 1; }
sudo -n test -r "$CONTROL_FILE" || { echo "Module control is unavailable: $CONTROL_FILE" >&2; exit 1; }
sudo -n test -r "$SMOKE_SCRIPT" || { echo "Signed smoke script is unavailable: $SMOKE_SCRIPT" >&2; exit 1; }

listen_line="$(ss -ltn | awk -v port=":$PORT" '$4 == "127.0.0.1" port || $4 == "[::1]" port { print; exit }')"
[[ -n "$listen_line" ]] || { echo "Runtime is not bound to loopback port $PORT." >&2; exit 1; }

health_body="$(mktemp)"
readiness_body="$(mktemp)"
public_health_body="$(mktemp)"
trap 'rm -f "$health_body" "$readiness_body" "$public_health_body"' EXIT
health_status="$(curl -sS --max-time 10 -o "$health_body" -w '%{http_code}' "http://127.0.0.1:$PORT/api/atendimento/health")"
if [[ "$EXPECTED_STATE" == "active" ]]; then
  [[ "$health_status" == "200" ]] || { echo "Clientes health expected 200, got $health_status." >&2; exit 1; }
else
  [[ "$health_status" == "503" ]] || { echo "Clientes health expected 503 while $EXPECTED_STATE, got $health_status." >&2; exit 1; }
fi
grep -Fq '"readOnlyRuntime":true' "$health_body" || { echo 'Health did not attest readOnlyRuntime=true.' >&2; exit 1; }
grep -Fq '"module":"atendimento"' "$health_body" || { echo 'Health did not attest the Atendimento module.' >&2; exit 1; }
if [[ -n "$EXPECTED_RELEASE_SHA" ]]; then
  grep -Fq "\"releaseSha\":\"$EXPECTED_RELEASE_SHA\"" "$health_body" || { echo 'Health release SHA does not match the expected immutable release.' >&2; exit 1; }
fi

readiness_status="$(curl -sS --max-time 10 -o "$readiness_body" -w '%{http_code}' "http://127.0.0.1:$PORT/api/atendimento/readiness")"
if [[ "$EXPECTED_STATE" == "active" ]]; then
  [[ "$readiness_status" == "200" ]] || { echo "Internal readiness expected 200, got $readiness_status." >&2; exit 1; }
else
  [[ "$readiness_status" == "503" ]] || { echo "Internal readiness expected 503 while $EXPECTED_STATE, got $readiness_status." >&2; exit 1; }
fi

public_health_status="$(curl -sS --max-time 15 -o "$public_health_body" -w '%{http_code}' "$PUBLIC_HEALTH_URL")"
[[ "$public_health_status" == "200" ]] || { echo "Dedicated public health expected 200, got $public_health_status." >&2; exit 1; }
grep -Fq '"readOnlyRuntime":true' "$public_health_body" || { echo 'Public health did not attest readOnlyRuntime=true.' >&2; exit 1; }
if grep -Eqi 'email|phone|phone_raw|customer_name|document|cpf|token|secret|password' "$public_health_body"; then
  echo 'Public health contains a forbidden sensitive field.' >&2
  exit 1
fi

sudo -n -u postgres psql --dbname="$DB_NAME" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<SQL | while IFS='|' read -r role_name role_login read_only app_connect schema_ok create_denied dml_denied caixa_ok harmonia_schema_ok harmonia_phone_ok harmonia_opt_out_ok migrator_separate; do
select r.rolname,
       r.rolcanlogin,
       coalesce(array_to_string(r.rolconfig, ','), '') like '%default_transaction_read_only=on%',
       has_database_privilege(r.rolname, '$DB_NAME', 'CONNECT'),
       has_schema_privilege(r.rolname, 'crm_atendimento', 'USAGE'),
       not has_schema_privilege(r.rolname, 'crm_atendimento', 'CREATE'),
       not has_table_privilege(r.rolname, 'crm_atendimento.global_client_identities', 'INSERT'),
       has_table_privilege(r.rolname, 'crm_caixa.sales', 'SELECT'),
       has_schema_privilege(r.rolname, 'harmonia', 'USAGE'),
       has_column_privilege(r.rolname, 'harmonia.contacts', 'phone_raw', 'SELECT'),
       has_column_privilege(r.rolname, 'harmonia.contacts', 'opted_out_at', 'SELECT'),
       r.rolname <> '$MIGRATOR_ROLE'
  from pg_roles r where r.rolname = '$APP_ROLE';
SQL
  [[ "$role_name" == "$APP_ROLE" && "$role_login" == 't' && "$read_only" == 't' && "$app_connect" == 't' && "$schema_ok" == 't' && "$create_denied" == 't' && "$dml_denied" == 't' && "$caixa_ok" == 't' && "$harmonia_schema_ok" == 't' && "$harmonia_phone_ok" == 't' && "$harmonia_opt_out_ok" == 't' && "$migrator_separate" == 't' ]] || {
    echo 'Read-only application database role contract is incomplete.' >&2
    exit 1
  }
done

sudo -n -u postgres psql --dbname="$DB_NAME" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL' | while IFS='|' read -r contact_writes canary_count; do
select commercial_contact_writes_enabled,
       coalesce(cardinality(commercial_contact_canary_identity_ids), 0)
  from crm_atendimento.commercial_policy_config where singleton = true;
SQL
  [[ "$contact_writes" == 'f' && "$canary_count" == '0' ]] || { echo 'Commercial contact writes or canary is not fail-closed.' >&2; exit 1; }
done

sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align <<SQL | while IFS='|' read -r migrator_login owner_login membership; do
select
  (select rolcanlogin from pg_roles where rolname = '$MIGRATOR_ROLE'),
  (select rolcanlogin from pg_roles where rolname = 'skincos_clientes_owner'),
  exists (select 1 from pg_auth_members m join pg_roles child on child.oid = m.member join pg_roles parent on parent.oid = m.roleid where child.rolname = '$MIGRATOR_ROLE' and parent.rolname = 'skincos_clientes_owner');
SQL
  [[ "$migrator_login" == 't' && "$owner_login" == 'f' && "$membership" == 't' ]] || { echo 'Migration role/owner separation is incomplete.' >&2; exit 1; }
done

sudo -n -u postgres psql --dbname="$DB_NAME" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<SQL | while IFS='|' read -r database_ddl_ok public_ddl_ok; do
select
  (not has_database_privilege('$APP_ROLE', '$DB_NAME', 'CREATE')
   and not has_database_privilege('$APP_ROLE', '$DB_NAME', 'TEMPORARY')),
  not has_schema_privilege('$APP_ROLE', 'public', 'CREATE');
SQL
  [[ "$database_ddl_ok" == 't' && "$public_ddl_ok" == 't' ]] || { echo 'Application role retains database or public-schema DDL privilege.' >&2; exit 1; }
done

protected_before="$(snapshot_protected_services)"
smoke_args=(--env-file "$CONFIG_FILE" --base-url "http://127.0.0.1:$PORT")
if [[ -n "$EXPECTED_RELEASE_SHA" ]]; then smoke_args+=(--expected-release-sha "$EXPECTED_RELEASE_SHA"); fi
smoke_json="$(sudo -n -u skincos /usr/bin/node "$SMOKE_SCRIPT" "${smoke_args[@]}")"
# The signed smoke covers GET /api/atendimento/commercial/policy and blocks
# POST /api/atendimento/commercial/actions before the store mutation boundary.
protected_after="$(snapshot_protected_services)"
[[ "$protected_before" == "$protected_after" ]] || { echo 'A shared CRM, worker, tunnel or Orb module changed during Atendimento validation.' >&2; exit 1; }
echo "$smoke_json" | grep -Fq '"replayRejected":true' || { echo 'Signed smoke did not prove replay rejection.' >&2; exit 1; }
echo "$smoke_json" | grep -Fq '"releaseShaMatches":true' || { echo 'Signed smoke did not prove the promoted release SHA.' >&2; exit 1; }
echo "$smoke_json" | grep -Fq '"writeRejected":true' || { echo 'Signed smoke did not prove the read-only write gate.' >&2; exit 1; }

echo "Atendimento production read-only validation passed: service=$SERVICE port=$PORT state=$EXPECTED_STATE health=$health_status readiness=$readiness_status public_health=$public_health_status shared_restart=false"
