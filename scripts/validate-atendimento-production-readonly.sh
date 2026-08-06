#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8110}"
SERVICE="crm-atendimento-production.service"
CONFIG_FILE="${CONFIG_FILE:-/etc/skincos/crm-clientes-production-readonly.env}"
CONTROL_FILE="${CONTROL_FILE:-/etc/skincos/atendimento-production/module-control.json}"
EXPECTED_STATE="${EXPECTED_STATE:-active}"

[[ "$EXPECTED_STATE" =~ ^(disabled|maintenance|active)$ ]] || { echo 'EXPECTED_STATE must be disabled, maintenance or active.' >&2; exit 64; }
for command_name in curl psql ss systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }
done
sudo -n true
sudo -n systemctl is-active --quiet "$SERVICE" || { echo "Service is not active: $SERVICE" >&2; exit 1; }
sudo -n test -r "$CONFIG_FILE" || { echo "Runtime config is unavailable: $CONFIG_FILE" >&2; exit 1; }
sudo -n test -r "$CONTROL_FILE" || { echo "Module control is unavailable: $CONTROL_FILE" >&2; exit 1; }

listen_line="$(ss -ltn | awk -v port=":$PORT" '$4 == "127.0.0.1" port || $4 == "[::1]" port { print; exit }')"
[[ -n "$listen_line" ]] || { echo "Runtime is not bound to loopback port $PORT." >&2; exit 1; }

health_body="$(mktemp)"
write_body="$(mktemp)"
trap 'rm -f "$health_body" "$write_body"' EXIT
health_status="$(curl -sS --max-time 10 -o "$health_body" -w '%{http_code}' "http://127.0.0.1:$PORT/api/atendimento/health")"
if [[ "$EXPECTED_STATE" == "active" ]]; then
  [[ "$health_status" == "200" ]] || { echo "Clientes health expected 200, got $health_status." >&2; exit 1; }
else
  [[ "$health_status" == "503" ]] || { echo "Clientes health expected 503 while $EXPECTED_STATE, got $health_status." >&2; exit 1; }
fi
grep -Fq '"readOnlyRuntime":true' "$health_body" || { echo 'Health did not attest readOnlyRuntime=true.' >&2; exit 1; }
grep -Fq '"module":"atendimento"' "$health_body" || { echo 'Health did not attest the Atendimento module.' >&2; exit 1; }

sudo -n -u postgres psql --dbname=skincos_crm_local --set=ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL' | while IFS='|' read -r role_name role_login read_only schema_ok atendimento_ok caixa_ok harmonia_schema_ok harmonia_phone_ok harmonia_opt_out_ok; do
select r.rolname,
       r.rolcanlogin,
       coalesce(array_to_string(r.rolconfig, ','), '') like '%default_transaction_read_only=on%',
       has_schema_privilege(r.rolname, 'crm_atendimento', 'USAGE'),
       has_table_privilege(r.rolname, 'crm_atendimento.global_client_identities', 'SELECT'),
       has_table_privilege(r.rolname, 'crm_caixa.sales', 'SELECT'),
       has_schema_privilege(r.rolname, 'harmonia', 'USAGE'),
       has_column_privilege(r.rolname, 'harmonia.contacts', 'phone_raw', 'SELECT'),
       has_column_privilege(r.rolname, 'harmonia.contacts', 'opted_out_at', 'SELECT')
  from pg_roles r where r.rolname = 'skincos_clientes_ro';
SQL
  [[ "$role_name" == 'skincos_clientes_ro' && "$role_login" == 't' && "$read_only" == 't' && "$schema_ok" == 't' && "$atendimento_ok" == 't' && "$caixa_ok" == 't' && "$harmonia_schema_ok" == 't' && "$harmonia_phone_ok" == 't' && "$harmonia_opt_out_ok" == 't' ]] || {
    echo 'Read-only database role contract is incomplete.' >&2
    exit 1
  }
done

# Prove the API gate with a signed synthetic actor. The request must be rejected
# before the store mutation boundary and no real data is sent.
set -a
# shellcheck disable=SC1090
source "$CONFIG_FILE"
set +a
[[ -n "${ATENDIMENTO_ACTOR_HMAC_KEY:-}" ]] || { echo 'Actor key is not configured.' >&2; exit 1; }
actor_b64="$(printf '%s' '{"id":"clientes-readonly-validation","role":"GESTOR","allowedModules":["atendimento"]}' | base64 -w0 | tr '+/' '-_' | tr -d '=')"
ts="$(date +%s%3N)"
signature="$(printf '%s.%s' "$ts" "$actor_b64" | openssl dgst -sha256 -hmac "$ATENDIMENTO_ACTOR_HMAC_KEY" -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')"
write_status="$(curl -sS --max-time 10 -o "$write_body" -w '%{http_code}' -X POST \
  -H "x-crm-user: $actor_b64" -H "x-crm-ts: $ts" -H "x-crm-signature: $signature" \
  -H 'content-type: application/json' --data '{}' "http://127.0.0.1:$PORT/api/atendimento/commercial/actions")"
[[ "$write_status" == "405" ]] || { echo "Read-only API gate expected 405 for a signed write, got $write_status." >&2; exit 1; }
grep -Fq 'READ_ONLY_RUNTIME' "$write_body" || { echo 'Read-only API gate did not return its stable error.' >&2; exit 1; }

echo "Atendimento production read-only validation passed: service=$SERVICE port=$PORT state=$EXPECTED_STATE"
