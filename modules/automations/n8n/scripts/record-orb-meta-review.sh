#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/runtime-paths.sh"

OUTPUT_DIR="${1:-$N8N_TMP_DIR/review-video}"
OUTPUT_FILE="${2:-orb-meta-pages-review.mov}"
DISPLAY_ID="${DISPLAY_ID:-1}"
MAX_SECONDS="${MAX_SECONDS:-180}"

mkdir -p "$OUTPUT_DIR"

OUT_PATH="$OUTPUT_DIR/$OUTPUT_FILE"

echo "Recording Orb Meta review to: $OUT_PATH"
echo "Display: $DISPLAY_ID"
echo "Max duration: ${MAX_SECONDS}s"
echo ""
echo "Suggested flow:"
echo "1. https://orb.skincos.com.br/meta-review/login"
echo "2. Login with test reviewer account"
echo "3. Click 'Conectar conta Meta'"
echo "4. Complete Meta OAuth"
echo "5. Select the Page"
echo "6. Publish, then show the updated posts list"
echo ""

exec screencapture -v -k -D"$DISPLAY_ID" -V"$MAX_SECONDS" "$OUT_PATH"
