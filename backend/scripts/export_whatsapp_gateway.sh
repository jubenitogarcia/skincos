#!/usr/bin/env bash
set -euo pipefail

# Export selected whatsapp-gateway core source into a target directory (e.g., chat-module repo)
# Usage: ./scripts/export_whatsapp_gateway.sh /path/to/chat-module/packages/whatsapp-core/src

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_ROOT="$ROOT_DIR/messaging/channels/whatsapp/gateway/apps/whatsapp-api/src"
TARGET_DIR="${1:-}"

if [ -z "$TARGET_DIR" ]; then
  echo "ERROR: target directory argument required" >&2
  exit 1
fi

if [ ! -d "$SRC_ROOT" ]; then
  echo "ERROR: source root $SRC_ROOT not found" >&2
  exit 1
fi

echo "==> Preparing target directory: $TARGET_DIR"
mkdir -p "$TARGET_DIR"

echo "==> Copying core modules"
rsync -av --delete \
  "$SRC_ROOT/Client.js" \
  "$SRC_ROOT/authStrategies" \
  "$SRC_ROOT/factories" \
  "$SRC_ROOT/structures" \
  "$SRC_ROOT/util" \
  "$SRC_ROOT/webCache" \
  "$TARGET_DIR/"

echo "==> Writing provenance file"
COMMIT_SHA=$(cd "$ROOT_DIR" && git rev-parse HEAD)
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$(dirname "$TARGET_DIR")/UPSTREAM_WHATSAPP_CORE.json" <<EOF
{
  "source_repo": "https://github.com/jubenitogarcia/SKINCOS-AI",
  "submodule_path": "messaging/channels/whatsapp/gateway/apps/whatsapp-api/src",
  "export_commit": "$COMMIT_SHA",
  "exported_at": "$DATE"
}
EOF

echo "==> Done. Remember to add a package.json for whatsapp-core if not present."
