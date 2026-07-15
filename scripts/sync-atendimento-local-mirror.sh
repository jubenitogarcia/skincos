#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_HOME="${CRM_RUNTIME_HOME:-/var/lib/skincos-runtime/crm}"
RUNTIME_ENV_FILE="${SKINCOS_CRM_API_ENV_FILE:-/etc/skincos/crm.env}"
SOURCE_ENV_FILE="${ATENDIMENTO_SOURCE_ENV_FILE:-/etc/skincos/atendimento-source.env}"
MODE="${1:---dry-run}"

usage() {
  cat <<EOF
Uso: ./scripts/sync-atendimento-local-mirror.sh [--status|--dry-run|--apply]

  --status   Mostra o estado do clone local, sem acessar a origem.
  --dry-run  Valida a origem somente leitura e mostra o resumo da cópia.
  --apply    Faz backup, substitui o clone local após confirmação e valida o CRM.

Arquivos privados esperados:
  $RUNTIME_ENV_FILE          DATABASE_URL do destino local
  $SOURCE_ENV_FILE           Origem Google Sheets somente leitura, snapshot ou PostgreSQL
EOF
}

case "$MODE" in
  --status|--dry-run|--apply) ;;
  -h|--help) usage; exit 0 ;;
  *) echo "[atendimento-mirror] Opcao invalida: $MODE" >&2; usage >&2; exit 2 ;;
esac

if [[ ! -f "$RUNTIME_ENV_FILE" ]]; then
  echo "[atendimento-mirror] Runtime local ausente: $RUNTIME_ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$RUNTIME_ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[atendimento-mirror] DATABASE_URL local nao configurada." >&2
  exit 1
fi

if [[ "$MODE" == "--status" ]]; then
  exec sudo -n -u skincos env \
    DATABASE_URL="$DATABASE_URL" \
    CRM_RUNTIME_HOME="$RUNTIME_HOME" \
    node "$ROOT_DIR/crm/api/scripts/sync-atendimento-local-mirror.mjs" --status
fi

if [[ ! -f "$SOURCE_ENV_FILE" ]]; then
  echo "[atendimento-mirror] Origem ainda nao configurada: $SOURCE_ENV_FILE" >&2
  echo "[atendimento-mirror] Defina ATENDIMENTO_SOURCE_DATABASE_URL com uma credencial PostgreSQL somente leitura." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SOURCE_ENV_FILE"
set +a

SOURCE_MODE="${ATENDIMENTO_SOURCE_MODE:-postgresql}"
case "$SOURCE_MODE" in
  google-sheets-live)
    if [[ -z "${ATENDIMENTO_GOOGLE_SA_FILE:-}" || ! -r "$ATENDIMENTO_GOOGLE_SA_FILE" ]]; then
      echo "[atendimento-mirror] ATENDIMENTO_GOOGLE_SA_FILE ausente ou sem permissao de leitura." >&2
      exit 1
    fi
    ;;
  google-sheets-snapshot)
    if [[ -z "${ATENDIMENTO_GOOGLE_XLSX_FILE:-}" || -z "${GERENCIA_GOOGLE_XLSX_FILE:-}" ]]; then
      echo "[atendimento-mirror] Os dois snapshots XLSX sao obrigatorios." >&2
      exit 1
    fi
    if [[ ! -r "$ATENDIMENTO_GOOGLE_XLSX_FILE" || ! -r "$GERENCIA_GOOGLE_XLSX_FILE" ]]; then
      echo "[atendimento-mirror] Um dos snapshots XLSX nao pode ser lido." >&2
      exit 1
    fi
    ;;
  postgresql)
    if [[ -z "${ATENDIMENTO_SOURCE_DATABASE_URL:-}" ]]; then
      echo "[atendimento-mirror] ATENDIMENTO_SOURCE_DATABASE_URL nao configurada." >&2
      exit 1
    fi
    ;;
  *)
    echo "[atendimento-mirror] ATENDIMENTO_SOURCE_MODE invalido: $SOURCE_MODE" >&2
    exit 1
    ;;
esac

if [[ "$MODE" == "--apply" ]]; then
  echo "[atendimento-mirror] A atualizacao substituira as simulacoes locais apos gerar backup."
  read -r -p "Digite SINCRONIZAR para continuar: " confirmation
  if [[ "$confirmation" != "SINCRONIZAR" ]]; then
    echo "[atendimento-mirror] Atualizacao cancelada."
    exit 0
  fi
fi

node_args=("$ROOT_DIR/crm/api/scripts/sync-atendimento-local-mirror.mjs" "$MODE")
env_args=(
  DATABASE_URL="$DATABASE_URL"
  CRM_RUNTIME_HOME="$RUNTIME_HOME"
  ATENDIMENTO_SOURCE_MODE="$SOURCE_MODE"
)
if [[ "$SOURCE_MODE" == 'google-sheets-live' ]]; then
  env_args+=(ATENDIMENTO_GOOGLE_SA_FILE="$ATENDIMENTO_GOOGLE_SA_FILE")
elif [[ "$SOURCE_MODE" == 'google-sheets-snapshot' ]]; then
  env_args+=(
    ATENDIMENTO_GOOGLE_XLSX_FILE="$ATENDIMENTO_GOOGLE_XLSX_FILE"
    GERENCIA_GOOGLE_XLSX_FILE="$GERENCIA_GOOGLE_XLSX_FILE"
  )
else
  env_args+=(ATENDIMENTO_SOURCE_DATABASE_URL="$ATENDIMENTO_SOURCE_DATABASE_URL")
fi
sudo -n -u skincos env "${env_args[@]}" node "${node_args[@]}"

if [[ "$MODE" != "--apply" ]]; then
  exit 0
fi

sudo -n systemctl restart crm.service
for _ in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:8099/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8099/health >/dev/null

CRM_BUILD_BEFORE_START=0 bash "$ROOT_DIR/scripts/run-local-crm.sh" --skip-build --exit-after-smoke
