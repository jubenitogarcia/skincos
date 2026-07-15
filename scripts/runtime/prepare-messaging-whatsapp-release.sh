#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/messaging/channels/whatsapp/engine"
RELEASE_BASE="${MESSAGING_RELEASE_BASE:-/opt/skincos/releases}"
CURRENT_LINK="${MESSAGING_CURRENT_LINK:-/opt/skincos/current/messaging-whatsapp}"
RELEASE_ID="${MESSAGING_RELEASE_ID:-}"
DESTINATION="$RELEASE_BASE/$RELEASE_ID/messaging-whatsapp"
STAGING="$RELEASE_BASE/.staging-$RELEASE_ID-$$"
NPM_CACHE="${MESSAGING_NPM_CACHE:-/var/lib/skincos-runtime/cache/npm}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-messaging-whatsapp-release.sh [--apply]

Stages the WhatsApp engine as a native Linux release. With --apply it copies
only tracked source and lockfiles, installs dependencies, generates Prisma,
builds dist/main.js, and atomically updates the current symlink. It never reads
or copies .env files; systemd loads the private environment separately.

Set MESSAGING_RELEASE_ID to the reviewed main commit SHA before invoking this
script. It is explicit because WSL cannot reliably resolve Windows worktree
gitdir indirections during a production cutover.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

[[ -f "$SOURCE_DIR/package-lock.json" ]] || { echo "Missing lockfile: $SOURCE_DIR/package-lock.json" >&2; exit 1; }
[[ -f "$SOURCE_DIR/src/main.ts" ]] || { echo "Missing source entrypoint: $SOURCE_DIR/src/main.ts" >&2; exit 1; }
[[ "$RELEASE_ID" =~ ^[0-9a-f]{7,64}$ ]] || { echo 'MESSAGING_RELEASE_ID must be a reviewed hexadecimal commit SHA.' >&2; exit 1; }
[[ ! -e "$DESTINATION" ]] || { echo "Release destination already exists: $DESTINATION" >&2; exit 1; }

echo "Release ID: $RELEASE_ID"
echo "Source: $SOURCE_DIR"
echo "Destination: $DESTINATION"
if [[ "$APPLY" != "1" ]]; then
  echo "Dry run complete. Use --apply after backup, CI and cutover gates pass."
  exit 0
fi

command -v rsync >/dev/null 2>&1 || { echo 'Missing required command: rsync' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'Missing required command: npm' >&2; exit 1; }
command -v sudo >/dev/null 2>&1 || { echo 'Missing required command: sudo' >&2; exit 1; }
sudo -n true

cleanup_staging() {
  sudo -n rm -rf "$STAGING"
}
trap cleanup_staging EXIT INT TERM

sudo -n install -d -o skincos -g skincos -m 0750 "$STAGING" "$NPM_CACHE"
sudo -n rsync -a --delete \
  --exclude '.env' --exclude '.env.*' --exclude 'node_modules' --exclude 'dist' \
  "$SOURCE_DIR/" "$STAGING/"
sudo -n chown -R skincos:skincos "$STAGING"

sudo -n -u skincos env npm_config_cache="$NPM_CACHE" \
  npm --prefix "$STAGING" ci --ignore-scripts
sudo -n -u skincos npm --prefix "$STAGING" run db:generate
sudo -n -u skincos npm --prefix "$STAGING" run build
[[ -f "$STAGING/dist/main.js" ]] || { echo "Build did not produce dist/main.js" >&2; exit 1; }

sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$DESTINATION")"
sudo -n mv "$STAGING" "$DESTINATION"
trap - EXIT INT TERM
sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$CURRENT_LINK")"
sudo -n ln -sfn "$DESTINATION" "$CURRENT_LINK"
echo "Native WhatsApp release prepared: $CURRENT_LINK -> $DESTINATION"
