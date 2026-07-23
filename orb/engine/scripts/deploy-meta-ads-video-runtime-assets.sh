#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET='/var/lib/skincos-runtime/orb/scripts/meta-ads'
CHECKPOINT="/var/lib/skincos-runtime/orb/checkpoints/meta-ads-video-assets-$(date -u +%Y%m%dT%H%M%SZ)"

sudo -n install -d -o skincos -g skincos -m 0750 "$TARGET" "$CHECKPOINT"
for name in process-video-asset.js slice-video-chunk.js; do
  if sudo -n test -f "$TARGET/$name"; then
    sudo -n cp -a "$TARGET/$name" "$CHECKPOINT/$name"
  fi
  sudo -n install -o skincos -g skincos -m 0750 "$SOURCE_ROOT/scripts/meta-ads/$name" "$TARGET/$name"
done
sudo -n -u skincos node --check "$TARGET/process-video-asset.js"
sudo -n -u skincos node --check "$TARGET/slice-video-chunk.js"
printf '%s\n' "$CHECKPOINT"
