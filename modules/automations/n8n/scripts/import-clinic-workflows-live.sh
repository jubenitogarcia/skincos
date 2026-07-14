#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="$(cd "$ROOT_DIR/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

APPLY=0
PROJECT_ID=""
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EXPORT_ROOT="$N8N_RUNTIME_HOME/exports/clinic-orb-live-$STAMP"
TMP_ROOT="${TMPDIR:-/tmp}/skincos-clinic-orb-live-$STAMP"
WORKFLOW_DIR="$ROOT_DIR/workflows"
WORKFLOW_STAGE_DIR="$TMP_ROOT/workflows"
CREDENTIAL_STAGE_DIR="$TMP_ROOT/credentials"
BUSINESS_ENV_BACKUP="$EXPORT_ROOT/n8n-business.env.before-import"
N8N_ENV_BACKUP="$EXPORT_ROOT/n8n.env.before-import"
WORKFLOW_FILES=(
  "WORKFLOW_01_INBOUND_TRIAGEM.json"
  "WORKFLOW_02_AGENDAMENTO.json"
  "WORKFLOW_03_LEMBRETES_E_CONFIRMACAO.json"
  "WORKFLOW_04_NOSHOW_REATIVACAO.json"
)
POSTGRES_CREDENTIAL_ID="skincos-postgres-clinic"
GOOGLE_CAL_CREDENTIAL_ID="skincos-google-calendar"
POSTGRES_CREDENTIAL_NAME="Postgres (Skincos)"
GOOGLE_CAL_CREDENTIAL_NAME="Google Calendar (Skincos)"
GOOGLE_DRIVE_EXPORT_ID="jO1yl4X4hfN2kBxd"
GOOGLE_DRIVE_EXPORT_STAGE="$N8N_RUNTIME_HOME/exports/20260706T182418Z/credential-export-stage/$GOOGLE_DRIVE_EXPORT_ID.json"
MIGRATION_FILE="$ROOT_DIR/db/migrations/20260217_wa_n8n.sql"

usage() {
  cat <<'EOF'
Usage: modules/automations/n8n/scripts/import-clinic-workflows-live.sh [--apply] [--project-id <id>]

Prepares the clinic orb workflows for the live shared n8n runtime:
- backs up the live postgres DB and runtime env files;
- restores the wa_n8n schema migration if it is missing from the target DB;
- fills recoverable business env values from local runtime evidence;
- imports Postgres and Google Calendar credentials into the live n8n DB;
- imports the four clinic workflows with active=false and patched credential IDs.

Without --apply, runs a dry-check and stages no live changes.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --project-id)
      shift
      PROJECT_ID="${1:-}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift || true
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_file() {
  [[ -f "$1" ]] || {
    echo "Missing required file: $1" >&2
    exit 1
  }
}

load_env_file() {
  local file="$1"
  require_file "$file"
  # shellcheck disable=SC1090
  source <(tr -d '\r' <"$file")
}

upsert_env_line() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped
  escaped="$(printf '%s' "$value" | sed 's/[&|]/\\&/g')"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

query_runtime_db() {
  local sql="$1"
  PGPASSWORD="$DB_POSTGRESDB_PASSWORD" \
    psql -h "$DB_POSTGRESDB_HOST" \
      -p "$DB_POSTGRESDB_PORT" \
      -U "$DB_POSTGRESDB_USER" \
      -d "$DB_POSTGRESDB_DATABASE" \
      -At -F '|' \
      -c "set search_path to \"$DB_POSTGRESDB_SCHEMA\",public; $sql"
}

n8n_cli() {
  env \
    HOME=/home/skincos \
    N8N_ROOT="$N8N_ROOT" \
    N8N_RUNTIME_HOME="$N8N_RUNTIME_HOME" \
    N8N_ENV_FILE="$N8N_ENV_FILE" \
    N8N_BUSINESS_ENV_FILE="$N8N_BUSINESS_ENV_FILE" \
    N8N_DATA_HOME="$N8N_DATA_HOME" \
    N8N_USER_FOLDER="$N8N_DATA_HOME" \
    N8N_LOG_DIR="$N8N_LOG_DIR" \
    N8N_HEALTH_DIR="$N8N_HEALTH_DIR" \
    N8N_TMP_DIR="$N8N_TMP_DIR" \
    N8N_BINARY_DATA_DIR="$N8N_BINARY_DATA_DIR" \
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false \
    DB_TYPE="$DB_TYPE" \
    DB_POSTGRESDB_HOST="$DB_POSTGRESDB_HOST" \
    DB_POSTGRESDB_PORT="$DB_POSTGRESDB_PORT" \
    DB_POSTGRESDB_DATABASE="$DB_POSTGRESDB_DATABASE" \
    DB_POSTGRESDB_USER="$DB_POSTGRESDB_USER" \
    DB_POSTGRESDB_PASSWORD="$DB_POSTGRESDB_PASSWORD" \
    DB_POSTGRESDB_SCHEMA="$DB_POSTGRESDB_SCHEMA" \
    n8n "$@"
}

require_cmd node
require_cmd psql
require_cmd pg_dump
require_cmd n8n
require_cmd sudo

load_env_file "$N8N_ENV_FILE"
load_env_file "$N8N_BUSINESS_ENV_FILE"

require_file "$MIGRATION_FILE"

if [[ -f "$EVOLUTION_ENV_FILE" ]]; then
  load_env_file "$EVOLUTION_ENV_FILE"
fi

DB_TYPE="${DB_TYPE:-}"
DB_POSTGRESDB_HOST="${DB_POSTGRESDB_HOST:-}"
DB_POSTGRESDB_PORT="${DB_POSTGRESDB_PORT:-}"
DB_POSTGRESDB_DATABASE="${DB_POSTGRESDB_DATABASE:-}"
DB_POSTGRESDB_USER="${DB_POSTGRESDB_USER:-}"
DB_POSTGRESDB_PASSWORD="${DB_POSTGRESDB_PASSWORD:-}"
DB_POSTGRESDB_SCHEMA="${DB_POSTGRESDB_SCHEMA:-public}"

if [[ -z "$DB_TYPE" || "$DB_TYPE" != "postgresdb" ]]; then
  echo "This helper expects the live n8n runtime to use DB_TYPE=postgresdb." >&2
  exit 1
fi

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(query_runtime_db "select id from project order by name limit 1;")"
fi

if [[ -z "$PROJECT_ID" ]]; then
  echo "Could not resolve a live n8n project id." >&2
  exit 1
fi

mkdir -p "$TMP_ROOT" "$WORKFLOW_STAGE_DIR" "$CREDENTIAL_STAGE_DIR"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

echo "== runtime =="
echo "n8n_root=$N8N_ROOT"
echo "runtime_home=$N8N_RUNTIME_HOME"
echo "project_id=$PROJECT_ID"
echo "db_host=$DB_POSTGRESDB_HOST"
echo "db_name=$DB_POSTGRESDB_DATABASE"
echo "db_schema=$DB_POSTGRESDB_SCHEMA"

echo "== project =="
query_runtime_db "select id, name, type from project where id = '$PROJECT_ID';"

echo "== current clinic workflow count =="
query_runtime_db "select count(*) from workflow_entity where name like 'SKINCOS | %';"

echo "== current expected credentials =="
query_runtime_db "select id, name, type from credentials_entity where name in ('$POSTGRES_CREDENTIAL_NAME', '$GOOGLE_CAL_CREDENTIAL_NAME') order by name;"

echo "== recoverable business env values =="
echo "AUTHENTICATION_API_KEY length=${#AUTHENTICATION_API_KEY}"
echo "DATABASE_URL length=${#DATABASE_URL}"
echo "GOOGLE_CLIENT_ID length=${#GOOGLE_CLIENT_ID}"
echo "GOOGLE_CLIENT_SECRET length=${#GOOGLE_CLIENT_SECRET}"
echo "GOOGLE_CALENDAR_ID length=${#GOOGLE_CALENDAR_ID}"
echo "N8N_DEFAULT_TEST_PHONE length=${#N8N_DEFAULT_TEST_PHONE}"

if [[ -f "$GOOGLE_DRIVE_EXPORT_STAGE" ]]; then
  echo "google_drive_export_stage=present"
else
  echo "google_drive_export_stage=missing"
fi

echo "== wa_n8n schema =="
query_runtime_db "select schema_name from information_schema.schemata where schema_name = 'wa_n8n';"

node - "$GOOGLE_DRIVE_EXPORT_STAGE" "$CREDENTIAL_STAGE_DIR" "$POSTGRES_CREDENTIAL_ID" "$GOOGLE_CAL_CREDENTIAL_ID" "$POSTGRES_CREDENTIAL_NAME" "$GOOGLE_CAL_CREDENTIAL_NAME" "$DB_POSTGRESDB_HOST" "$DB_POSTGRESDB_PORT" "$DB_POSTGRESDB_DATABASE" "$DB_POSTGRESDB_USER" "$DB_POSTGRESDB_PASSWORD" <<'NODE'
const fs = require('fs');
const path = require('path');

const [
  ,
  ,
  googleStagePath,
  credentialStageDir,
  postgresCredentialId,
  googleCredentialId,
  postgresCredentialName,
  googleCredentialName,
  dbHost,
  dbPort,
  dbDatabase,
  dbUser,
  dbPassword,
] = process.argv;

const postgresCredential = {
  id: postgresCredentialId,
  name: postgresCredentialName,
  type: 'postgres',
  data: {
    host: dbHost,
    port: Number(dbPort),
    database: dbDatabase,
    user: dbUser,
    password: dbPassword,
    maxConnections: 100,
    allowUnauthorizedCerts: false,
    ssl: 'disable',
  },
  isManaged: false,
  isGlobal: false,
  isResolvable: false,
  resolvableAllowFallback: false,
  resolverId: null,
};

fs.writeFileSync(
  path.join(credentialStageDir, `${postgresCredentialId}.json`),
  JSON.stringify(postgresCredential, null, 2),
);

if (fs.existsSync(googleStagePath)) {
  const source = JSON.parse(fs.readFileSync(googleStagePath, 'utf8'));
  source.id = googleCredentialId;
  source.name = googleCredentialName;
  source.type = 'googleCalendarOAuth2Api';
  fs.writeFileSync(
    path.join(credentialStageDir, `${googleCredentialId}.json`),
    JSON.stringify(source, null, 2),
  );
}
NODE

node - "$WORKFLOW_DIR" "$WORKFLOW_STAGE_DIR" "$POSTGRES_CREDENTIAL_ID" "$GOOGLE_CAL_CREDENTIAL_ID" "$POSTGRES_CREDENTIAL_NAME" "$GOOGLE_CAL_CREDENTIAL_NAME" "${WORKFLOW_FILES[@]}" <<'NODE'
const fs = require('fs');
const path = require('path');

const [
  ,
  ,
  workflowDir,
  workflowStageDir,
  postgresCredentialId,
  googleCredentialId,
  postgresCredentialName,
  googleCredentialName,
  ...workflowFiles
] = process.argv;

for (const file of workflowFiles) {
  const sourcePath = path.join(workflowDir, file);
  const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  payload.active = false;

  for (const node of payload.nodes ?? []) {
    if (!node.credentials) continue;
    if (node.credentials.postgres) {
      node.credentials.postgres.id = postgresCredentialId;
      node.credentials.postgres.name = postgresCredentialName;
    }
    if (node.credentials.googleCalendarOAuth2Api) {
      node.credentials.googleCalendarOAuth2Api.id = googleCredentialId;
      node.credentials.googleCalendarOAuth2Api.name = googleCredentialName;
    }
  }

  fs.writeFileSync(path.join(workflowStageDir, file), JSON.stringify(payload, null, 2));
}
NODE

echo "== staged workflows =="
for file in "$WORKFLOW_STAGE_DIR"/*.json; do
  node - "$file" <<'NODE'
const fs = require('fs');
const filePath = process.argv[2];
const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const credentials = [];
for (const node of payload.nodes ?? []) {
  if (!node.credentials) continue;
  if (node.credentials.postgres) {
    credentials.push(`postgres:${node.credentials.postgres.id}`);
  }
  if (node.credentials.googleCalendarOAuth2Api) {
    credentials.push(`googleCalendar:${node.credentials.googleCalendarOAuth2Api.id}`);
  }
}
console.log(`${payload.name}|active=${payload.active}|${Array.from(new Set(credentials)).join(',')}`);
NODE
done

if [[ "$APPLY" != "1" ]]; then
  echo "Dry run only. Re-run with --apply to back up the live runtime, apply wa_n8n, import credentials, and import workflows."
  exit 0
fi

mkdir -p "$EXPORT_ROOT"
cp -p "$N8N_ENV_FILE" "$N8N_ENV_BACKUP"
cp -p "$N8N_BUSINESS_ENV_FILE" "$BUSINESS_ENV_BACKUP"

echo "== backup postgres runtime db =="
PGPASSWORD="$DB_POSTGRESDB_PASSWORD" \
  pg_dump -h "$DB_POSTGRESDB_HOST" \
    -p "$DB_POSTGRESDB_PORT" \
    -U "$DB_POSTGRESDB_USER" \
    -d "$DB_POSTGRESDB_DATABASE" \
    -Fc \
    -f "$EXPORT_ROOT/n8n_runtime.before-clinic-orb.dump"

echo "== patch business env =="
if [[ -n "${AUTHENTICATION_API_KEY:-}" && -z "${EVOLUTION_API_KEY:-}" ]]; then
  upsert_env_line "$N8N_BUSINESS_ENV_FILE" "EVOLUTION_API_KEY" "$AUTHENTICATION_API_KEY"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  upsert_env_line "$N8N_BUSINESS_ENV_FILE" "DATABASE_URL" "postgresql://${DB_POSTGRESDB_USER}:${DB_POSTGRESDB_PASSWORD}@${DB_POSTGRESDB_HOST}:${DB_POSTGRESDB_PORT}/${DB_POSTGRESDB_DATABASE}"
fi

if [[ -z "${N8N_DEFAULT_UNIT_SLUG:-}" ]]; then
  upsert_env_line "$N8N_BUSINESS_ENV_FILE" "N8N_DEFAULT_UNIT_SLUG" "skincos"
fi

if [[ -z "${N8N_DEFAULT_UNIT_NAME:-}" ]]; then
  upsert_env_line "$N8N_BUSINESS_ENV_FILE" "N8N_DEFAULT_UNIT_NAME" "Skincos"
fi

if [[ -f "$GOOGLE_DRIVE_EXPORT_STAGE" && ( -z "${GOOGLE_CLIENT_ID:-}" || -z "${GOOGLE_CLIENT_SECRET:-}" ) ]]; then
  eval "$(
    node - "$GOOGLE_DRIVE_EXPORT_STAGE" "$N8N_CONFIG_PATH" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const [,, exportPath, configPath] = process.argv;
const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const encryptionKey = config.encryptionKey;
function getKeyAndIv(salt, encryptionKey) {
  const password = Buffer.concat([Buffer.from(encryptionKey, 'binary'), salt]);
  const hash1 = crypto.createHash('md5').update(password).digest();
  const hash2 = crypto.createHash('md5').update(Buffer.concat([hash1, password])).digest();
  const iv = crypto.createHash('md5').update(Buffer.concat([hash2, password])).digest();
  const key = Buffer.concat([hash1, hash2]);
  return [key, iv];
}
function decrypt(data) {
  const input = Buffer.from(data, 'base64');
  const salt = input.subarray(8, 16);
  const [key, iv] = getKeyAndIv(salt, encryptionKey);
  const contents = input.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(contents), decipher.final()]).toString('utf8');
}
const payload = JSON.parse(decrypt(exported.data));
console.log(`GOOGLE_CLIENT_ID_EXTRACTED=${JSON.stringify(payload.clientId || '')}`);
console.log(`GOOGLE_CLIENT_SECRET_EXTRACTED=${JSON.stringify(payload.clientSecret || '')}`);
NODE
  )"
  if [[ -z "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_CLIENT_ID_EXTRACTED:-}" ]]; then
    upsert_env_line "$N8N_BUSINESS_ENV_FILE" "GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_ID_EXTRACTED"
  fi
  if [[ -z "${GOOGLE_CLIENT_SECRET:-}" && -n "${GOOGLE_CLIENT_SECRET_EXTRACTED:-}" ]]; then
    upsert_env_line "$N8N_BUSINESS_ENV_FILE" "GOOGLE_CLIENT_SECRET" "$GOOGLE_CLIENT_SECRET_EXTRACTED"
  fi
fi

echo "== apply wa_n8n migration =="
PGPASSWORD="$DB_POSTGRESDB_PASSWORD" \
  psql -h "$DB_POSTGRESDB_HOST" \
    -p "$DB_POSTGRESDB_PORT" \
    -U "$DB_POSTGRESDB_USER" \
    -d "$DB_POSTGRESDB_DATABASE" \
    -v ON_ERROR_STOP=1 \
    -f "$MIGRATION_FILE"

echo "== import credentials =="
n8n_cli import:credentials --separate --input="$CREDENTIAL_STAGE_DIR" --projectId="$PROJECT_ID"

echo "== import workflows =="
n8n_cli import:workflow --separate --input="$WORKFLOW_STAGE_DIR" --projectId="$PROJECT_ID"

echo "== imported clinic workflows =="
query_runtime_db "select id, name, active from workflow_entity where name like 'SKINCOS | %' order by name;"

echo "== imported expected credentials =="
query_runtime_db "select id, name, type from credentials_entity where name in ('$POSTGRES_CREDENTIAL_NAME', '$GOOGLE_CAL_CREDENTIAL_NAME') order by name;"

echo "== wa_n8n tables =="
query_runtime_db "select table_name from information_schema.tables where table_schema = 'wa_n8n' order by table_name;"

echo "Completed live import in inactive mode."
echo "Backup: $EXPORT_ROOT/n8n_runtime.before-clinic-orb.dump"
