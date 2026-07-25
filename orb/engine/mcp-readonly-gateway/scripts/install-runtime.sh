#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${1:-/opt/skincos/current/source}"
SNAPSHOT_INDEX_SOURCE="${2:-${MCP_SNAPSHOT_INDEX_SOURCE:-}}"
RUNTIME_ROOT=/var/lib/skincos-runtime/orb-mcp-readonly
LOG_ROOT=/var/log/skincos/orb-mcp-readonly
ENV_FILE=/etc/skincos/orb-mcp-readonly-gateway.env
UNIT_SOURCE="$SOURCE_ROOT/orb/engine/mcp-readonly-gateway/systemd/skincos-orb-mcp-readonly.service"
[[ "$SOURCE_ROOT" == /opt/skincos/current/source || "$SOURCE_ROOT" == /opt/skincos/releases/*/source ]] || { echo 'The active gateway source must be a native immutable release under /opt/skincos.' >&2; exit 1; }
[[ -f "$SOURCE_ROOT/orb/engine/mcp-readonly-gateway/server.mjs" ]] || { echo "Gateway source is unavailable: $SOURCE_ROOT" >&2; exit 1; }
[[ -n "$SNAPSHOT_INDEX_SOURCE" && -f "$SNAPSHOT_INDEX_SOURCE" ]] || { echo 'A prebuilt snapshot index is required.' >&2; exit 1; }
command -v systemd-analyze >/dev/null 2>&1 || { echo 'Missing required command: systemd-analyze' >&2; exit 1; }
sudo -n systemd-analyze verify "$UNIT_SOURCE"
restore_legacy_proxy() {
  systemctl disable --now skincos-orb-mcp-readonly.service || true
  echo 'Gateway installation failed; the retired predecessor was not revived.' >&2
}
trap restore_legacy_proxy ERR

set -a
. /etc/skincos/orb.env
set +a

if [[ -f "$ENV_FILE" ]]; then
  set -a
  . "$ENV_FILE"
  set +a
fi
if [[ -z "${MCP_DB_PASSWORD:-}" ]]; then
  MCP_DB_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')"
fi
sudo -n -u postgres psql -d "$DB_POSTGRESDB_DATABASE" \
  -v mcp_password="$MCP_DB_PASSWORD" -v db_name="$DB_POSTGRESDB_DATABASE" -v schema_name="$DB_POSTGRESDB_SCHEMA" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_mcp_ro') THEN
    CREATE ROLE skincos_mcp_ro NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
  END IF;
END $$;
SELECT format('ALTER ROLE skincos_mcp_ro PASSWORD %L', :'mcp_password') \gexec
ALTER ROLE skincos_mcp_ro SET default_transaction_read_only = on;
ALTER ROLE skincos_mcp_ro SET statement_timeout = '8s';
ALTER ROLE skincos_mcp_ro SET lock_timeout = '2s';
SELECT format('REVOKE ALL ON DATABASE %I FROM skincos_mcp_ro', :'db_name') \gexec
SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM skincos_mcp_ro', :'schema_name') \gexec
SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM skincos_mcp_ro', :'schema_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO skincos_mcp_ro', :'db_name') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO skincos_mcp_ro', :'schema_name') \gexec
SELECT format('GRANT SELECT ON TABLE %I.workflow_entity, %I.execution_entity, %I.execution_data, %I.tag_entity, %I.workflows_tags, %I.folder, %I.project TO skincos_mcp_ro', :'schema_name', :'schema_name', :'schema_name', :'schema_name', :'schema_name', :'schema_name', :'schema_name') \gexec
SQL

install -m 0640 -o root -g root /dev/null "$ENV_FILE"
printf 'MCP_DB_PASSWORD=%q\nMCP_LISTEN_HOST=127.0.0.1\nMCP_LISTEN_PORT=8766\nMCP_AUTH_UPSTREAM_URL=http://127.0.0.1:5678/mcp-server/http\nMCP_OAUTH_AUTHORITY=https://orb.skincos.com.br\nMCP_DB_HOST=%q\nMCP_DB_PORT=%q\nMCP_DB_USER=skincos_mcp_ro\nMCP_DB_DATABASE=%q\nMCP_DB_SCHEMA=%q\nMCP_AUDIT_PATH=%q\nMCP_SNAPSHOT_INDEX_PATH=%q\nMCP_BACKUP_ROOT=/var/backups/skincos/orb/daily\n' "$MCP_DB_PASSWORD" "$DB_POSTGRESDB_HOST" "$DB_POSTGRESDB_PORT" "$DB_POSTGRESDB_DATABASE" "$DB_POSTGRESDB_SCHEMA" "$LOG_ROOT/audit.jsonl" "$RUNTIME_ROOT/snapshots/workflow-index.json" >"$ENV_FILE"

install -d -m 0750 -o skincos -g skincos "$RUNTIME_ROOT" "$RUNTIME_ROOT/snapshots" "$LOG_ROOT"
install -m 0640 -o skincos -g skincos "$SNAPSHOT_INDEX_SOURCE" "$RUNTIME_ROOT/snapshots/workflow-index.json"
install -m 0644 -o root -g root "$UNIT_SOURCE" /etc/systemd/system/skincos-orb-mcp-readonly.service
systemctl daemon-reload
systemctl disable --now skincos-mcp-poc-proxy.service || true
systemctl enable --now skincos-orb-mcp-readonly.service
systemctl restart skincos-orb-mcp-readonly.service
for attempt in {1..10}; do
  if systemctl is-active --quiet skincos-orb-mcp-readonly.service && curl --fail --silent --show-error http://127.0.0.1:8766/.well-known/oauth-protected-resource/mcp >/dev/null; then
    trap - ERR
    echo 'SKINCOS Orb MCP read-only gateway installed and healthy.'
    exit 0
  fi
  sleep 1
done
echo 'Gateway health check failed.' >&2
exit 1
trap - ERR
