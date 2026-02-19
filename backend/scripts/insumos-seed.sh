#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

API_URL="${INSUMOS_API_URL:-http://127.0.0.1:8787/insumos}"
SEED_TOKEN="${INSUMOS_SEED_TOKEN:-}"
PAYLOAD_PATH="${1:-}"

if [[ -z "$PAYLOAD_PATH" ]]; then
  echo "Uso: $(basename "$0") <backup.json>"
  echo "Env:"
  echo "  INSUMOS_API_URL   Base da API (default: http://127.0.0.1:8787/insumos)"
  echo "  INSUMOS_SEED_TOKEN  Token requerido pelo worker (ALLOW_DEV_SEED=true)"
  exit 1
fi

if [[ ! -f "$PAYLOAD_PATH" ]]; then
  echo "Arquivo não encontrado: $PAYLOAD_PATH" >&2
  exit 1
fi

if [[ -z "$SEED_TOKEN" ]]; then
  echo "Faltando INSUMOS_SEED_TOKEN (configure no worker local via .dev.vars)" >&2
  exit 1
fi

echo "[insumos-seed] Enviando payload para $API_URL/admin/seed"
curl -fsS "$API_URL/admin/seed" \
  -H "content-type: application/json" \
  -H "x-seed-token: ${SEED_TOKEN}" \
  --data-binary "@${PAYLOAD_PATH}" | cat
echo
