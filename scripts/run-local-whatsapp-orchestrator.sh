#!/usr/bin/env bash
set -euo pipefail

# Local-only adapter for the CRM Pages shell. It reuses the Evolution credential
# from the protected native runtime without copying it into the checkout, Pages
# bindings, browser, or logs.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
PORT="${CRM_LOCAL_WA_ORCHESTRATOR_PORT:-8110}"
ENV_FILE="${CRM_LOCAL_WA_NATIVE_ENV_FILE:-/etc/skincos/crm-whatsapp.env}"
RUNTIME_HOME="${CRM_LOCAL_WA_RUNTIME_HOME:-/mnt/c/CodexRuntime/operator/admin/skincos/whatsapp-local-adapter}"
RUN_AS_USER="${CRM_LOCAL_WA_RUN_AS_USER:-admin}"
SOURCE_HOME="${CRM_LOCAL_WA_SOURCE_HOME:-/home/$RUN_AS_USER/.cache/skincos/whatsapp-local-adapter/source}"
RUNTIME_ID="${CRM_RUNTIME_ID:-}"
ROLE_POLICY_FILE="${CRM_ROLE_POLICY_FILE:-$ROOT_DIR/crm/console/modules/localRolePolicy.json}"
BASE_DATABASE_NAME="skincos_crm_local"
POSTGRES_SOCKET_DIR="/var/run/postgresql"

CRM_LOCAL_WA_PSQL_BIN="${CRM_LOCAL_WA_PSQL_BIN:-/usr/bin/psql}"
CRM_LOCAL_WA_CREATEDB_BIN="${CRM_LOCAL_WA_CREATEDB_BIN:-/usr/bin/createdb}"
CRM_LOCAL_WA_DROPDB_BIN="${CRM_LOCAL_WA_DROPDB_BIN:-/usr/bin/dropdb}"
CRM_LOCAL_WA_PG_DUMP_BIN="${CRM_LOCAL_WA_PG_DUMP_BIN:-/usr/bin/pg_dump}"
CRM_LOCAL_WA_RUNUSER_BIN="${CRM_LOCAL_WA_RUNUSER_BIN:-/usr/sbin/runuser}"
CRM_LOCAL_WA_FLOCK_BIN="${CRM_LOCAL_WA_FLOCK_BIN:-/usr/bin/flock}"
CRM_LOCAL_WA_SHA256SUM_BIN="${CRM_LOCAL_WA_SHA256SUM_BIN:-/usr/bin/sha256sum}"

crm_local_wa_runtime_database_name() {
  local runtime_id="${1:-}"
  local digest
  if [[ ! "$runtime_id" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]]; then
    echo "[whatsapp-local] CRM_RUNTIME_ID deve conter somente letras minúsculas, números, ponto, hífen ou sublinhado." >&2
    return 2
  fi
  digest="$(printf '%s' "$runtime_id" | "$CRM_LOCAL_WA_SHA256SUM_BIN" | awk '{print $1}')"
  if [[ ! "$digest" =~ ^[a-f0-9]{64}$ ]]; then
    echo "[whatsapp-local] Não foi possível derivar a identidade PostgreSQL de $runtime_id." >&2
    return 2
  fi
  printf 'skincos_crm_local_%s\n' "${digest:0:20}"
}

crm_local_wa_database_url() {
  local database_user="${1:-}"
  local database_name="${2:-}"
  if [[ ! "$database_user" =~ ^[a-z_][a-z0-9_-]{0,62}$ ||
        ! "$database_name" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
    echo "[whatsapp-local] Identidade PostgreSQL local inválida." >&2
    return 2
  fi
  printf 'postgresql://%s@/%s?host=%s\n' "$database_user" "$database_name" "$POSTGRES_SOCKET_DIR"
}

crm_local_wa_run_as() {
  local account="$1"
  shift
  "$CRM_LOCAL_WA_RUNUSER_BIN" -u "$account" -- "$@"
}

crm_local_wa_database_exists() {
  local database_name="$1"
  local result
  result="$(
    crm_local_wa_run_as postgres "$CRM_LOCAL_WA_PSQL_BIN" \
      --dbname "postgresql:///postgres?host=$POSTGRES_SOCKET_DIR" \
      --no-align --tuples-only --quiet \
      --command "select 1 from pg_database where datname = '$database_name'"
  )"
  [[ "$(printf '%s' "$result" | tr -d '[:space:]')" == "1" ]]
}

crm_local_wa_runtime_marker() {
  local database_name="$1"
  local database_url
  database_url="$(crm_local_wa_database_url "$RUN_AS_USER" "$database_name")"
  crm_local_wa_run_as "$RUN_AS_USER" "$CRM_LOCAL_WA_PSQL_BIN" \
    --dbname "$database_url" \
    --no-align --tuples-only --quiet \
    --command "select runtime_id from public.skincos_crm_local_runtime where singleton is true limit 1" \
    2>/dev/null || true
}

crm_local_wa_drop_temporary_database() {
  local database_name="$1"
  crm_local_wa_run_as postgres "$CRM_LOCAL_WA_DROPDB_BIN" \
    --host "$POSTGRES_SOCKET_DIR" \
    --if-exists \
    "$database_name" >/dev/null 2>&1 || true
}

crm_local_wa_verify_database() {
  local database_name="$1"
  local expected_runtime_id="$2"
  local database_url
  local identity
  database_url="$(crm_local_wa_database_url "$RUN_AS_USER" "$database_name")"
  identity="$(
    crm_local_wa_run_as "$RUN_AS_USER" "$CRM_LOCAL_WA_PSQL_BIN" \
      --dbname "$database_url" \
      --no-align --tuples-only --quiet \
      --command "select current_database() || '|' || current_setting('transaction_read_only')"
  )"
  if [[ "$identity" != "$database_name|off" ]]; then
    echo "[whatsapp-local] O banco isolado de $expected_runtime_id não está acessível e gravável." >&2
    return 2
  fi
  if [[ "$(crm_local_wa_runtime_marker "$database_name")" != "$expected_runtime_id" ]]; then
    echo "[whatsapp-local] O banco $database_name pertence a outro runtime ou está incompleto; ele não será reutilizado." >&2
    return 2
  fi
}

crm_local_wa_prepare_runtime_database() {
  local target_database="$1"
  local expected_runtime_id="$2"
  local base_database_url="postgresql://postgres@/$BASE_DATABASE_NAME?host=$POSTGRES_SOCKET_DIR"
  local temporary_database
  local temporary_database_url
  local base_identity
  local publish_status=0
  local marker_sql

  if [[ ! "$target_database" =~ ^[a-z_][a-z0-9_]{0,62}$ ||
        ! "$expected_runtime_id" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]]; then
    echo "[whatsapp-local] Identidade do banco isolado inválida." >&2
    return 2
  fi

  mkdir -p "$RUNTIME_HOME"
  exec {database_lock_fd}>"$RUNTIME_HOME/postgres-create.lock"
  "$CRM_LOCAL_WA_FLOCK_BIN" "$database_lock_fd"

  if crm_local_wa_database_exists "$target_database"; then
    crm_local_wa_verify_database "$target_database" "$expected_runtime_id"
    "$CRM_LOCAL_WA_FLOCK_BIN" -u "$database_lock_fd"
    exec {database_lock_fd}>&-
    return 0
  fi

  base_identity="$(
    crm_local_wa_run_as postgres "$CRM_LOCAL_WA_PSQL_BIN" \
      --dbname "$base_database_url" \
      --no-align --tuples-only --quiet \
      --command "select current_database() || '|' || current_setting('transaction_read_only')"
  )"
  if [[ "$base_identity" != "$BASE_DATABASE_NAME|off" ]]; then
    echo "[whatsapp-local] O espelho PostgreSQL local $BASE_DATABASE_NAME não está acessível e gravável." >&2
    return 2
  fi

  temporary_database="${target_database}_tmp_$$_${RANDOM}"
  if [[ ${#temporary_database} -gt 63 || ! "$temporary_database" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
    echo "[whatsapp-local] Nome temporário PostgreSQL inválido para $expected_runtime_id." >&2
    return 2
  fi
  if crm_local_wa_database_exists "$temporary_database"; then
    echo "[whatsapp-local] O banco temporário $temporary_database já existe; nenhuma base será sobrescrita." >&2
    return 2
  fi

  crm_local_wa_run_as postgres "$CRM_LOCAL_WA_CREATEDB_BIN" \
    --host "$POSTGRES_SOCKET_DIR" \
    --owner "$RUN_AS_USER" \
    --template template0 \
    "$temporary_database"
  temporary_database_url="$(crm_local_wa_database_url "$RUN_AS_USER" "$temporary_database")"

  if ! crm_local_wa_run_as postgres "$CRM_LOCAL_WA_PG_DUMP_BIN" \
      --dbname "$base_database_url" \
      --format plain \
      --no-owner \
      --no-privileges |
    crm_local_wa_run_as "$RUN_AS_USER" "$CRM_LOCAL_WA_PSQL_BIN" \
      --dbname "$temporary_database_url" \
      --set ON_ERROR_STOP=1 \
      --quiet; then
    echo "[whatsapp-local] Falha ao clonar o espelho local para $expected_runtime_id." >&2
    crm_local_wa_drop_temporary_database "$temporary_database"
    return 2
  fi

  marker_sql="$(cat <<'SQL'
create table if not exists public.skincos_crm_local_runtime (
  singleton boolean primary key default true check (singleton),
  runtime_id text not null unique,
  source_database text not null,
  created_at timestamptz not null default now()
);
insert into public.skincos_crm_local_runtime(singleton, runtime_id, source_database)
values (true, :'runtime_id', :'source_database')
on conflict (singleton) do nothing;
SQL
)"
  if ! printf '%s\n' "$marker_sql" |
    crm_local_wa_run_as "$RUN_AS_USER" "$CRM_LOCAL_WA_PSQL_BIN" \
      --dbname "$temporary_database_url" \
      --set ON_ERROR_STOP=1 \
      --set "runtime_id=$expected_runtime_id" \
      --set "source_database=$BASE_DATABASE_NAME" \
      --quiet \
      --file -; then
    echo "[whatsapp-local] Falha ao identificar o banco isolado de $expected_runtime_id." >&2
    crm_local_wa_drop_temporary_database "$temporary_database"
    return 2
  fi

  crm_local_wa_run_as postgres "$CRM_LOCAL_WA_PSQL_BIN" \
    --dbname "postgresql:///postgres?host=$POSTGRES_SOCKET_DIR" \
    --set ON_ERROR_STOP=1 \
    --quiet \
    --command "alter database $temporary_database rename to $target_database" ||
    publish_status=$?

  if [[ "$publish_status" != "0" ]]; then
    # A publisher outside this filesystem lock may have won the database-name
    # race. Accept only the exact same runtime marker, then discard our private
    # temporary clone. Never replace an existing database by name alone.
    if crm_local_wa_database_exists "$target_database" &&
      [[ "$(crm_local_wa_runtime_marker "$target_database")" == "$expected_runtime_id" ]]; then
      crm_local_wa_drop_temporary_database "$temporary_database"
    else
      crm_local_wa_drop_temporary_database "$temporary_database"
      echo "[whatsapp-local] O banco isolado de $expected_runtime_id não pôde ser publicado com segurança." >&2
      return 2
    fi
  fi

  crm_local_wa_verify_database "$target_database" "$expected_runtime_id"
  printf '[whatsapp-local] PostgreSQL isolado pronto: %s (%s).\n' "$target_database" "$expected_runtime_id"
  "$CRM_LOCAL_WA_FLOCK_BIN" -u "$database_lock_fd"
  exec {database_lock_fd}>&-
}

crm_local_wa_validate_privileged_inputs() {
  local canonical_root
  local canonical_runtime_home
  local canonical_source_home
  local expected_runtime_home
  local expected_source_base
  local expected_role
  local source_suffix
  local source_leaf

  if [[ "$LOCAL_WA_ADAPTER_RUN_AS_USER" != "admin" ]]; then
    echo "[whatsapp-local] O estágio privilegiado aceita somente o operador local admin." >&2
    return 2
  fi
  if [[ "$LOCAL_WA_ADAPTER_ENV_FILE" != "/etc/skincos/crm-whatsapp.env" ]]; then
    echo "[whatsapp-local] O arquivo de credenciais protegido não pertence à allowlist local." >&2
    return 2
  fi
  if [[ ! "$LOCAL_WA_ADAPTER_PORT" =~ ^[0-9]{4,5}$ ||
        "$LOCAL_WA_ADAPTER_PORT" -lt 1024 ||
        "$LOCAL_WA_ADAPTER_PORT" -gt 65535 ]]; then
    echo "[whatsapp-local] Porta inválida para o adapter local." >&2
    return 2
  fi

  canonical_root="$(readlink -f -- "$LOCAL_WA_ADAPTER_ROOT" 2>/dev/null || true)"
  canonical_runtime_home="$(readlink -m -- "$LOCAL_WA_ADAPTER_RUNTIME_HOME" 2>/dev/null || true)"
  canonical_source_home="$(readlink -m -- "$LOCAL_WA_ADAPTER_SOURCE_HOME" 2>/dev/null || true)"
  if [[ -z "$canonical_root" ||
        "$LOCAL_WA_ADAPTER_ROOT" != "$canonical_root" ||
        "$LOCAL_WA_ADAPTER_RUNTIME_HOME" != "$canonical_runtime_home" ||
        "$LOCAL_WA_ADAPTER_SOURCE_HOME" != "$canonical_source_home" ]]; then
    echo "[whatsapp-local] Os caminhos do estágio privilegiado devem ser absolutos, canônicos e livres de symlinks." >&2
    return 2
  fi

  if [[ "$LOCAL_WA_ADAPTER_RUNTIME_ID" == "gestor--full" ]]; then
    expected_role="GESTOR"
    expected_runtime_home="/mnt/c/CodexRuntime/operator/admin/skincos/runtime/crm-local/instances/gestor/full/state/whatsapp"
    source_leaf="${canonical_root##*/}"
    if [[ ! "$source_leaf" =~ ^crm-local-gestor-main(-[A-Za-z0-9._-]+)?$ ||
          "${canonical_root%/*}" != "/mnt/c/CodexRuntime/operator/admin/skincos/source" ]]; then
      echo "[whatsapp-local] A fonte do CRM completo não pertence à raiz privada autorizada." >&2
      return 2
    fi
  elif [[ "$LOCAL_WA_ADAPTER_RUNTIME_ID" =~ ^crm-local--([a-z0-9][a-z0-9._-]{0,127})--(gestor|consultor)$ ]]; then
    expected_role="${BASH_REMATCH[2]^^}"
    expected_runtime_home="/mnt/c/CodexRuntime/operator/admin/skincos/runtime/crm-local/instances/${BASH_REMATCH[2]}/${BASH_REMATCH[1]}/state/whatsapp"
    source_leaf="${canonical_root##*/}"
    if [[ ! "$source_leaf" =~ ^[a-f0-9]{24}$ ||
          "${canonical_root%/*}" != "/mnt/c/CodexRuntime/operator/admin/skincos/source/crm-local/immutable" ]]; then
      echo "[whatsapp-local] A fonte modular não pertence à raiz imutável autorizada." >&2
      return 2
    fi
  elif [[ "$LOCAL_WA_ADAPTER_RUNTIME_ID" =~ ^crm-thread-preview--([a-z0-9][a-z0-9._-]{0,127})--(gestor|consultor)$ ]]; then
    expected_role="${BASH_REMATCH[2]^^}"
    expected_runtime_home="/mnt/c/CodexRuntime/operator/admin/skincos/runtime/crm-local/thread-previews/${BASH_REMATCH[2]}/${BASH_REMATCH[1]}/state/whatsapp"
    source_leaf="${canonical_root##*/}"
    if [[ ! "$source_leaf" =~ ^[a-f0-9]{24}$ ||
          "${canonical_root%/*}" != "/mnt/c/CodexRuntime/operator/admin/skincos/source/crm-local/immutable" ]]; then
      echo "[whatsapp-local] A fonte da prévia da thread não pertence à raiz imutável autorizada." >&2
      return 2
    fi
  else
    echo "[whatsapp-local] A identidade do runtime não pertence ao contrato local autorizado." >&2
    return 2
  fi

  if [[ "$LOCAL_WA_ADAPTER_ROLE" != "$expected_role" ||
        "$canonical_runtime_home" != "$expected_runtime_home" ]]; then
    echo "[whatsapp-local] Papel ou diretório de estado não corresponde à identidade do runtime." >&2
    return 2
  fi

  expected_source_base="/home/admin/.cache/skincos/crm-local/$LOCAL_WA_ADAPTER_RUNTIME_ID/whatsapp"
  if [[ "$canonical_source_home" != "$expected_source_base" ]]; then
    source_suffix="${canonical_source_home#"$expected_source_base"-}"
    if [[ "$canonical_source_home" != "$expected_source_base-"* ||
          ! "$source_suffix" =~ ^[a-f0-9]{16}$ ]]; then
      echo "[whatsapp-local] O cache do adapter está fora da raiz privada derivada do runtime." >&2
      return 2
    fi
  fi

  if [[ ! -d "$canonical_root/crm/api" ||
        "$(readlink -f -- "$LOCAL_WA_ADAPTER_ROLE_POLICY_FILE" 2>/dev/null || true)" != "$canonical_root/crm/console/modules/localRolePolicy.json" ||
        ! -f "$canonical_root/crm/console/modules/localRolePolicy.json" ]]; then
    echo "[whatsapp-local] Fonte da API ou política de papéis não corresponde à revisão privada autorizada." >&2
    return 2
  fi
  if [[ ! "$LOCAL_WA_ADAPTER_EMAIL" =~ ^[a-z0-9._+-]+@local\.test$ ]]; then
    echo "[whatsapp-local] A identidade do adapter deve permanecer no domínio sintético local.test." >&2
    return 2
  fi
}

crm_local_wa_root_main() {
  if [[ "$(id -u)" != "0" ]]; then
    echo "[whatsapp-local] O estágio privilegiado do adapter exige root." >&2
    return 2
  fi

  : "${LOCAL_WA_ADAPTER_ROOT:?}"
  : "${LOCAL_WA_ADAPTER_ENV_FILE:?}"
  : "${LOCAL_WA_ADAPTER_PORT:?}"
  : "${LOCAL_WA_ADAPTER_RUNTIME_HOME:?}"
  : "${LOCAL_WA_ADAPTER_SOURCE_HOME:?}"
  : "${LOCAL_WA_ADAPTER_RUN_AS_USER:?}"
  : "${LOCAL_WA_ADAPTER_RUNTIME_ID:?}"
  : "${LOCAL_WA_ADAPTER_DATABASE_NAME:?}"
  : "${LOCAL_WA_ADAPTER_DATABASE_URL:?}"
  : "${LOCAL_WA_ADAPTER_ROLE_POLICY_FILE:?}"
  : "${LOCAL_WA_ADAPTER_EMAIL:?}"
  : "${LOCAL_WA_ADAPTER_ROLE:?}"
  : "${LOCAL_WA_ADAPTER_RUNTIME_DIAGNOSTICS+x}"
  readonly LOCAL_WA_ADAPTER_ROOT LOCAL_WA_ADAPTER_ENV_FILE LOCAL_WA_ADAPTER_PORT
  readonly LOCAL_WA_ADAPTER_RUNTIME_HOME LOCAL_WA_ADAPTER_SOURCE_HOME
  readonly LOCAL_WA_ADAPTER_RUN_AS_USER LOCAL_WA_ADAPTER_RUNTIME_ID
  readonly LOCAL_WA_ADAPTER_DATABASE_NAME LOCAL_WA_ADAPTER_DATABASE_URL
  readonly LOCAL_WA_ADAPTER_ROLE_POLICY_FILE
  readonly LOCAL_WA_ADAPTER_EMAIL LOCAL_WA_ADAPTER_ROLE
  readonly LOCAL_WA_ADAPTER_RUNTIME_DIAGNOSTICS

  crm_local_wa_validate_privileged_inputs

  set -a
  # The file belongs to the native runtime. Never print or persist its values.
  source "$LOCAL_WA_ADAPTER_ENV_FILE"
  set +a

  : "${EVOLUTION_API_URL:?EVOLUTION_API_URL is required in the native WhatsApp environment}"
  : "${EVOLUTION_API_KEY:?EVOLUTION_API_KEY is required in the native WhatsApp environment}"

  # The protected native environment supplies credentials only. Reassert every
  # launcher path and identity after sourcing it so generic names in that file
  # cannot redirect this privileged stage.
  ROOT_DIR="$LOCAL_WA_ADAPTER_ROOT"
  ENV_FILE="$LOCAL_WA_ADAPTER_ENV_FILE"
  PORT="$LOCAL_WA_ADAPTER_PORT"
  RUNTIME_HOME="$LOCAL_WA_ADAPTER_RUNTIME_HOME"
  SOURCE_HOME="$LOCAL_WA_ADAPTER_SOURCE_HOME"
  RUN_AS_USER="$LOCAL_WA_ADAPTER_RUN_AS_USER"
  RUNTIME_ID="$LOCAL_WA_ADAPTER_RUNTIME_ID"
  ROLE_POLICY_FILE="$LOCAL_WA_ADAPTER_ROLE_POLICY_FILE"
  PATH="/usr/sbin:/usr/bin:/sbin:/bin"
  export PATH
  BASE_DATABASE_NAME="skincos_crm_local"
  POSTGRES_SOCKET_DIR="/var/run/postgresql"
  CRM_LOCAL_WA_PSQL_BIN="/usr/bin/psql"
  CRM_LOCAL_WA_CREATEDB_BIN="/usr/bin/createdb"
  CRM_LOCAL_WA_DROPDB_BIN="/usr/bin/dropdb"
  CRM_LOCAL_WA_PG_DUMP_BIN="/usr/bin/pg_dump"
  CRM_LOCAL_WA_RUNUSER_BIN="/usr/sbin/runuser"
  CRM_LOCAL_WA_FLOCK_BIN="/usr/bin/flock"
  CRM_LOCAL_WA_SHA256SUM_BIN="/usr/bin/sha256sum"

  local expected_database_name
  local expected_database_url
  expected_database_name="$(crm_local_wa_runtime_database_name "$RUNTIME_ID")"
  expected_database_url="$(crm_local_wa_database_url "$RUN_AS_USER" "$expected_database_name")"
  if [[ "$LOCAL_WA_ADAPTER_DATABASE_NAME" != "$expected_database_name" ||
        "$LOCAL_WA_ADAPTER_DATABASE_URL" != "$expected_database_url" ]]; then
    echo "[whatsapp-local] A identidade do banco isolado mudou entre os estágios do launcher." >&2
    return 2
  fi
  if [[ "$ROLE_POLICY_FILE" != /* || ! -f "$ROLE_POLICY_FILE" || ! -r "$ROLE_POLICY_FILE" ]]; then
    echo "[whatsapp-local] A política local de papéis não está acessível em caminho absoluto." >&2
    return 2
  fi

  # A local adapter must never start the background Harmonia worker inherited
  # from the native environment.
  export HARMONIA_WORKER_ENABLED=false

  install -d -m 0750 -o "$RUN_AS_USER" -g "$RUN_AS_USER" \
    "$RUNTIME_HOME" "$RUNTIME_HOME/var" \
    "$(dirname "$SOURCE_HOME")" "$SOURCE_HOME"

  crm_local_wa_prepare_runtime_database "$expected_database_name" "$RUNTIME_ID"

  # Run a private staged copy from the WSL filesystem. The editable source
  # remains the versioned worktree; this cache avoids Windows/WSL file latency.
  exec 9>"$RUNTIME_HOME/npm-ci.lock"
  flock 9
  runuser -u "$RUN_AS_USER" -- rsync -a --delete --exclude node_modules \
    "$ROOT_DIR/crm/api/" "$SOURCE_HOME/"
  local package_lock_state="$RUNTIME_HOME/package-lock.sha256"
  if [[ ! -f "$SOURCE_HOME/package-lock.json" ]]; then
    echo "[whatsapp-local] package-lock.json ausente no espelho local." >&2
    return 2
  fi
  local package_lock_hash
  local recorded_package_lock_hash=""
  package_lock_hash="$(sha256sum "$SOURCE_HOME/package-lock.json" | awk '{print $1}')"
  [[ -f "$package_lock_state" ]] && recorded_package_lock_hash="$(tr -d '\r\n' < "$package_lock_state")"
  if [[ ! -d "$SOURCE_HOME/node_modules/express" || "$package_lock_hash" != "$recorded_package_lock_hash" ]]; then
    runuser -u "$RUN_AS_USER" -- /usr/bin/npm --prefix "$SOURCE_HOME" ci --omit=dev --no-audit --no-fund
    local package_lock_state_tmp="${package_lock_state}.tmp.$$"
    printf '%s\n' "$package_lock_hash" > "$package_lock_state_tmp"
    chown "$RUN_AS_USER:$RUN_AS_USER" "$package_lock_state_tmp"
    chmod 0640 "$package_lock_state_tmp"
    mv -f "$package_lock_state_tmp" "$package_lock_state"
  fi
  flock -u 9

  export NODE_ENV=development
  export NO_AUTH=true
  export CRM_LOCAL_NO_AUTH=true
  export WA_CHANNEL_OWNER_ENFORCED=false
  export WA_ORCHESTRATOR_PROVIDER=evolution
  export CRM_RUNTIME_HOME="$RUNTIME_HOME"
  export VAR_DIR="$RUNTIME_HOME/var"
  export CRM_API_PORT="$PORT"
  export CRM_API_HOST=127.0.0.1
  export PORT
  export DEV_AUTH_EMAIL="$LOCAL_WA_ADAPTER_EMAIL"
  export DEV_AUTH_ROLE="$LOCAL_WA_ADAPTER_ROLE"
  export DATABASE_URL="$expected_database_url"
  export CRM_ROLE_POLICY_FILE="$ROLE_POLICY_FILE"
  export CRM_LOCAL_RUNTIME_DIAGNOSTICS="$LOCAL_WA_ADAPTER_RUNTIME_DIAGNOSTICS"
  export EVOLUTION_INSTANCE_PREFIX="${EVOLUTION_INSTANCE_PREFIX:-crm-channel-}"

  # Keep the native credential in the inherited process environment. Do not put
  # it in a command argument, which would expose it through process inspection.
  exec runuser -u "$RUN_AS_USER" --preserve-environment -- \
    /usr/bin/node "$SOURCE_HOME/server.js"
}

crm_local_wa_main() {
  if [[ "${1:-}" == "--root-stage" ]]; then
    crm_local_wa_root_main
    return
  fi
  if [[ $# -ne 0 ]]; then
    echo "[whatsapp-local] Opção desconhecida: $1" >&2
    return 2
  fi

  local target_database_name
  local target_database_url
  target_database_name="$(crm_local_wa_runtime_database_name "$RUNTIME_ID")"
  target_database_url="$(crm_local_wa_database_url "$RUN_AS_USER" "$target_database_name")"
  if [[ -n "${CRM_LOCAL_WA_DATABASE_URL:-}" && "$CRM_LOCAL_WA_DATABASE_URL" != "$target_database_url" ]]; then
    echo "[whatsapp-local] CRM_LOCAL_WA_DATABASE_URL não corresponde ao banco derivado de CRM_RUNTIME_ID." >&2
    return 2
  fi

  if ! sudo -n test -f "$ENV_FILE"; then
    echo "[whatsapp-local] Configuração nativa ausente: CRM_LOCAL_WA_NATIVE_ENV_FILE" >&2
    return 2
  fi
  if ! sudo -n test -r "$ENV_FILE"; then
    echo "[whatsapp-local] Não foi possível ler a configuração nativa protegida. Configure CRM_LOCAL_WA_NATIVE_ENV_FILE ou a permissão local necessária." >&2
    return 2
  fi

  exec sudo -n /usr/bin/env \
    LOCAL_WA_ADAPTER_ROOT="$ROOT_DIR" \
    LOCAL_WA_ADAPTER_ENV_FILE="$ENV_FILE" \
    LOCAL_WA_ADAPTER_PORT="$PORT" \
    LOCAL_WA_ADAPTER_RUNTIME_HOME="$RUNTIME_HOME" \
    LOCAL_WA_ADAPTER_SOURCE_HOME="$SOURCE_HOME" \
    LOCAL_WA_ADAPTER_RUN_AS_USER="$RUN_AS_USER" \
    LOCAL_WA_ADAPTER_RUNTIME_ID="$RUNTIME_ID" \
    LOCAL_WA_ADAPTER_DATABASE_NAME="$target_database_name" \
    LOCAL_WA_ADAPTER_DATABASE_URL="$target_database_url" \
    LOCAL_WA_ADAPTER_ROLE_POLICY_FILE="$ROLE_POLICY_FILE" \
    LOCAL_WA_ADAPTER_EMAIL="${LOCAL_AUTH_EMAIL:-dev@local.test}" \
    LOCAL_WA_ADAPTER_ROLE="${LOCAL_AUTH_ROLE:-GESTOR}" \
    LOCAL_WA_ADAPTER_RUNTIME_DIAGNOSTICS="${CRM_LOCAL_RUNTIME_DIAGNOSTICS:-}" \
    /bin/bash "$SCRIPT_PATH" --root-stage
}

if [[ "${CRM_LOCAL_WA_LIBRARY_ONLY:-0}" != "1" ]]; then
  crm_local_wa_main "$@"
fi
