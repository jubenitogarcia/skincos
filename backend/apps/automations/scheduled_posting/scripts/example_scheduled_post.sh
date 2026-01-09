#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

YEAR="$(date +%Y)"
MONTH="$(date +%m)"
DAY="$(date +%d)"

TARGET_DIR="$VAR_DIR/scheduled_posting/Scheduled/$YEAR/$MONTH"
mkdir -p "$TARGET_DIR"

echo "======================================"
echo "  Exemplo Scheduled Post"
echo "======================================"
echo ""
echo "📁 Target: $TARGET_DIR"

echo "Este é um arquivo de teste para o dia $DAY" > "$TARGET_DIR/${DAY}_test_file.txt"
echo "✅ Criado: ${DAY}_test_file.txt"

if [[ -f "image.jpg" ]]; then
  cp "image.jpg" "$TARGET_DIR/${DAY}_image.jpg"
  echo "✅ Copiado: image.jpg -> ${DAY}_image.jpg"
fi

if [[ -f "video.mp4" ]]; then
  cp "video.mp4" "$TARGET_DIR/${DAY}_video.mp4"
  echo "✅ Copiado: video.mp4 -> ${DAY}_video.mp4"
fi

echo ""
echo "Próximo passo:"
echo "  ./backend/scripts/dev.sh scheduled-posting test"
