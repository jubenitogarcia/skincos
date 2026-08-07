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
seed_response_file="$(mktemp "${TMPDIR:-/tmp}/insumos-seed-response.XXXXXX")"
cleanup_seed_response() {
  rm -f "$seed_response_file"
}
trap cleanup_seed_response EXIT
http_status="$(curl -sS -o "$seed_response_file" -w '%{http_code}' "$API_URL/admin/seed" \
  -H "content-type: application/json" \
  -H "x-seed-token: ${SEED_TOKEN}" \
  --data-binary "@${PAYLOAD_PATH}")"
if [[ "$http_status" != "200" ]]; then
  safe_error="$(INSUMOS_SEED_RESPONSE_FILE="$seed_response_file" node - "$http_status" <<'NODE'
const fs = require('node:fs')
const crypto = require('node:crypto')
const status = String(process.argv[2] || 'unknown')
let message = ''
try {
  const parsed = JSON.parse(fs.readFileSync(process.env.INSUMOS_SEED_RESPONSE_FILE, 'utf8'))
  message = String(parsed?.error || parsed?.code || '')
} catch {
  // The response may be an HTML proxy error. Never echo it into runtime logs.
}
const exactCode = /^[A-Z][A-Z0-9_:-]{0,127}$/.test(message) ? message : ''
const classification =
  /foreign key constraint failed/i.test(message) ? 'SQL_FOREIGN_KEY_CONSTRAINT' :
  /unique constraint failed/i.test(message) ? 'SQL_UNIQUE_CONSTRAINT' :
  /no such (?:column|table)/i.test(message) ? 'SQL_SCHEMA_MISMATCH' :
  /timeout|timed out/i.test(message) ? 'TIMEOUT' :
  (message ? `UNCLASSIFIED_${crypto.createHash('sha256').update(message).digest('hex').slice(0, 12)}` : 'NO_SAFE_ERROR')
process.stdout.write(`INSUMOS_SEED_HTTP_${status}_${exactCode || classification}`)
NODE
)"
  echo "[insumos-seed] $safe_error" >&2
  exit 1
fi
seed_response="$(<"$seed_response_file")"

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
