#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

API_URL="${INSUMOS_API_URL:-http://127.0.0.1:8787/insumos}"
SEED_TOKEN="${INSUMOS_SEED_TOKEN:-}"
EXPECTED_SNAPSHOT_ID="${INSUMOS_SEED_EXPECT_SNAPSHOT_ID:-}"
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

echo "[insumos-seed] Enviando snapshot para $API_URL/admin/seed"
seed_response="$(curl -fsS "$API_URL/admin/seed" \
  -H "content-type: application/json" \
  -H "x-seed-token: ${SEED_TOKEN}" \
  --data-binary "@${PAYLOAD_PATH}")"

INSUMOS_SEED_RESPONSE="$seed_response" node - "$EXPECTED_SNAPSHOT_ID" <<'NODE'
const expectedSnapshotId = String(process.argv[2] || '')
try {
  const response = JSON.parse(process.env.INSUMOS_SEED_RESPONSE || '{}')
  if (response?.success !== true || response?.data?.restored !== true) {
    throw new Error('INSUMOS_SEED_RESPONSE_INVALID')
  }
  const snapshot = response?.data?.snapshot
  if (expectedSnapshotId) {
    if (!snapshot || String(snapshot.snapshotId || '') !== expectedSnapshotId) {
      throw new Error('INSUMOS_SEED_SNAPSHOT_MISMATCH')
    }
    const counts = snapshot.counts
    if (!counts || typeof counts !== 'object' || Object.values(counts).some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error('INSUMOS_SEED_COUNTS_INVALID')
    }
    process.stdout.write(`${JSON.stringify({
      restored: true,
      snapshotId: snapshot.snapshotId,
      d1Sha256: snapshot.d1Sha256,
      counts,
    })}\n`)
  } else {
    process.stdout.write(JSON.stringify({ restored: true }) + '\n')
  }
} catch (error) {
  console.error(`[insumos-seed] ${error.message || error}`)
  process.exit(1)
}
NODE
