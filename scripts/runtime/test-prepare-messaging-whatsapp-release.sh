#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREPARE="$ROOT_DIR/scripts/runtime/prepare-messaging-whatsapp-release.sh"

bash -n "$PREPARE"

mkdir_line="$(grep -nF 'install -d -o skincos -g skincos -m 0750 "$STAGING/dist"' "$PREPARE" | cut -d: -f1)"
build_line="$(grep -nF 'npm --prefix "$STAGING" run build' "$PREPARE" | cut -d: -f1)"
[[ -n "$mkdir_line" && -n "$build_line" && "$mkdir_line" -lt "$build_line" ]] || {
  echo 'Messaging release preparation must create native dist before the build.' >&2
  exit 1
}

echo 'Messaging WhatsApp native release preparation checks passed'
