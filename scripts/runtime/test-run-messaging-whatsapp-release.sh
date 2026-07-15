#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAUNCHER="$ROOT_DIR/scripts/runtime/run-messaging-whatsapp-release.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/release/node_modules" "$tmp_dir/release/dist" "$tmp_dir/bin"
printf 'process.exit(0);\n' >"$tmp_dir/release/dist/main.js"
printf 'PRIVATE_TEST_VALUE=loaded\n' >"$tmp_dir/runtime.env"
printf '%s\n' '#!/usr/bin/env bash' 'test "$PRIVATE_TEST_VALUE" = loaded' 'test "$1" = dist/main.js' >"$tmp_dir/bin/node"
chmod +x "$tmp_dir/bin/node"

MESSAGING_RELEASE_ROOT="$tmp_dir/release" EVOLUTION_API_ENV_FILE="$tmp_dir/runtime.env" NODE_BIN="$tmp_dir/bin/node" \
  "$LAUNCHER"

rm -f "$tmp_dir/release/dist/main.js"
if MESSAGING_RELEASE_ROOT="$tmp_dir/release" EVOLUTION_API_ENV_FILE="$tmp_dir/runtime.env" NODE_BIN="$tmp_dir/bin/node" "$LAUNCHER"; then
  echo 'Launcher must fail closed without the built artifact.' >&2
  exit 1
fi

echo 'Messaging WhatsApp native release launcher checks passed'
