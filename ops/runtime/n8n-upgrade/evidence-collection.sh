#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
OUT=${N8N_EVIDENCE_DIR:-}
if dry_run_notice; then
  info 'coleta planejada: metadados, hashes, status, migrations e health; sem logs brutos ou segredos.'
  exit 0
fi
[[ -n "$OUT" ]] || die 'N8N_EVIDENCE_DIR ausente.'
require_private_path "$OUT"
mkdir -p "$OUT"
date -u +%Y%m%dT%H%M%SZ > "$OUT/collected-at.txt"
sha256sum "$N8N_MANIFEST" > "$OUT/version-manifest.sha256"
systemctl show orb orb-proxy messaging-whatsapp crm booking cloudflare-orb cloudflare-runtime -p ActiveState -p SubState -p MainPID > "$OUT/services.txt"
ss -ltn > "$OUT/listeners.txt"
if command -v n8n >/dev/null 2>&1; then n8n --version > "$OUT/n8n-version.txt"; fi
curl --silent --show-error --max-time 10 http://127.0.0.1:5678/healthz > "$OUT/orb-health.json" || true
info 'evidência sanitizada coletada; não incluir arquivos de banco, credenciais, cookies ou logs brutos no PR.'
