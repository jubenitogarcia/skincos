#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${1:-}"
DESTINATION_ROOT="${2:-/home/admin/.cache/skincos-local-root}"

if [[ -z "$SOURCE_ROOT" || "$SOURCE_ROOT" != /* ]]; then
  echo "Usage: $0 /absolute/source/root [/absolute/destination/root]" >&2
  exit 2
fi
if [[ "$DESTINATION_ROOT" != /home/admin/.cache/skincos-local-root ]]; then
  echo "The local website destination must remain inside the admin WSL cache." >&2
  exit 2
fi
if [[ ! -d "$SOURCE_ROOT/website" ]]; then
  echo "Website source not found at $SOURCE_ROOT/website." >&2
  exit 1
fi
if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required in Ubuntu-24.04 before starting the local website." >&2
  exit 1
fi

mkdir -p "$DESTINATION_ROOT/website"
rsync -a --delete \
  --exclude node_modules \
  --exclude .next \
  "$SOURCE_ROOT/website/" \
  "$DESTINATION_ROOT/website/"

echo "[website-local] Linux source prepared at $DESTINATION_ROOT/website."
