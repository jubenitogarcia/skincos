#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_HOME="${CRM_RUNTIME_HOME:-/mnt/c/CodexRuntime/operator/admin/skincos/runtime/atendimento-mirror}"
RUNTIME_ENV_FILE="${SKINCOS_CRM_API_ENV_FILE:-/etc/skincos/crm.env}"
SOURCE_ENV_FILE="${ATENDIMENTO_SOURCE_ENV_FILE:-/etc/skincos/atendimento-source.env}"
OPERATOR_ENV_FILE="${SKINCOS_ATENDIMENTO_OPERATOR_ENV_FILE:-/mnt/c/CodexRuntime/operator/admin/skincos/private/atendimento-mirror.env}"
MODE="${1:---dry-run}"

usage() {
  cat <<EOF
Uso: ./scripts/sync-atendimento-local-mirror.sh [--status|--preflight|--dry-run|--apply]

  --status   Mostra o estado do clone local, sem acessar a origem.
  --preflight Valida a origem somente leitura e retorna evidências sanitizadas, sem alterar bancos.
  --dry-run  Valida a origem somente leitura e mostra o resumo da cópia.
  --apply    Faz backup, substitui o clone local após confirmação e valida o CRM.

Arquivos privados esperados:
  $OPERATOR_ENV_FILE  Overlay do operador (preferido; fora do repositório)
  $RUNTIME_ENV_FILE          DATABASE_URL do destino local
  $SOURCE_ENV_FILE           Origem Google Sheets somente leitura, snapshot ou PostgreSQL
EOF
}

case "$MODE" in
  --status|--preflight|--dry-run|--apply) ;;
  -h|--help) usage; exit 0 ;;
  *) echo "[atendimento-mirror] Opcao invalida: $MODE" >&2; usage >&2; exit 2 ;;
esac

if [[ -r "$RUNTIME_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$RUNTIME_ENV_FILE"
  set +a
fi

# The source configuration is allowed to describe only the read-side source.
# Preserve a destination inherited from the operator/runtime so a stray
# DATABASE_URL in that file can never retarget a local mirror command.
DESTINATION_DATABASE_URL="${DATABASE_URL:-}"

if [[ "$MODE" != "--status" && -r "$SOURCE_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SOURCE_ENV_FILE"
  set +a
fi

if [[ -n "$DESTINATION_DATABASE_URL" ]]; then
  DATABASE_URL="$DESTINATION_DATABASE_URL"
fi

# The private operator overlay is loaded last intentionally. It is the only
# supported place for admin-readable source credentials and safely overrides
# legacy runtime/source values without placing secrets in the shared checkout.
if [[ -r "$OPERATOR_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$OPERATOR_ENV_FILE"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[atendimento-mirror] Runtime local indisponível para admin: $RUNTIME_ENV_FILE" >&2
  echo "[atendimento-mirror] Forneça DATABASE_URL somente via $OPERATOR_ENV_FILE ou SKINCOS_CRM_API_ENV_FILE." >&2
  exit 1
fi

if [[ "$MODE" == "--status" ]]; then
  # invoke-skincos-wsl.ps1 já executa este fluxo como o operador admin. O
  # banco local usa essa identidade de peer; não troque para o usuário de
  # serviço skincos antes da conexão.
  exec env \
    DATABASE_URL="$DATABASE_URL" \
    CRM_RUNTIME_HOME="$RUNTIME_HOME" \
    node "$ROOT_DIR/crm/api/scripts/sync-atendimento-local-mirror.mjs" --status
fi

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
      echo "[atendimento-mirror] ATENDIMENTO_SOURCE_DATABASE_URL nao configurada. Use $OPERATOR_ENV_FILE ou uma origem legível em $SOURCE_ENV_FILE." >&2
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
# O operador admin lê os arquivos privados e acessa o banco local por peer.
# O usuário skincos é reservado ao serviço e não deve ser usado como launcher.
env "${env_args[@]}" node "${node_args[@]}"

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
