#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT_DIR/tmp"

if [ ! -d "$TMP_DIR" ]; then
  echo "tmp/ não existe em $ROOT_DIR"
  exit 0
fi

patterns=(
  "orb-credential*"
  "workflow-export"
  "workflow-export.json"
  "execution_*"
  "livia.json"
  "review.cookies"
  "test-login.body"
  "test-login.cookies"
  "test-login.headers"
  "credentials-backup-latest"
)

echo "Limpando artefatos sensíveis em $TMP_DIR"

for pattern in "${patterns[@]}"; do
  while IFS= read -r target; do
    [ -n "$target" ] || continue
    echo "rm -rf $target"
    rm -rf "$target"
  done < <(find "$TMP_DIR" -maxdepth 1 -name "$pattern" -print)
done

echo "Busca residual por padrões sensíveis em tmp/:"
rg -n "Bearer EAA|access_token\\\":\\\"EA|IGAA|clientSecret\\\":\\\"|client_secret\\\"\\s*:\\s*\\\"|oauthTokenData" "$TMP_DIR" || true

echo "Espaço atual:"
df -h "$ROOT_DIR"
