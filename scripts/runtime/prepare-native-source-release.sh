#!/usr/bin/env bash
set -euo pipefail

# Stages the tracked source required by the lifecycle units on native Linux.
# It deliberately uses an explicit reviewed commit and `git archive`, so no
# ignored files, local credentials, worktree metadata, node_modules or DrvFS
# path remains a runtime dependency after the units are switched.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CANONICAL_REPO_ROOT="${SKINCOS_CANONICAL_REPO_ROOT:-/mnt/c/CodexShared/Projetos/skincos}"
RELEASE_BASE="${SKINCOS_RELEASE_BASE:-/opt/skincos/releases}"
CURRENT_LINK="${SKINCOS_SOURCE_CURRENT_LINK:-/opt/skincos/current/source}"
RELEASE_ID="${SKINCOS_RELEASE_ID:-}"
DESTINATION="$RELEASE_BASE/$RELEASE_ID/source"
STAGING="$RELEASE_BASE/.source-staging-$RELEASE_ID-$$"
ARCHIVE=""
CRM_NPM_CACHE="${CRM_NPM_CACHE:-/var/lib/skincos-runtime/cache/crm-api}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-native-source-release.sh [--apply]

Set SKINCOS_RELEASE_ID to the reviewed main commit SHA. With --apply, stages
only tracked source in /opt/skincos/releases/<sha>/source, installs the locked
CRM production dependencies on the Linux filesystem, and atomically promotes
/opt/skincos/current/source. It never copies private .env files or worktree
metadata from the Windows checkout.
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

[[ "$RELEASE_ID" =~ ^[0-9a-f]{7,64}$ ]] || { echo 'SKINCOS_RELEASE_ID must be a reviewed hexadecimal commit SHA.' >&2; exit 1; }
[[ ! -e "$DESTINATION" ]] || { echo "Source release destination already exists: $DESTINATION" >&2; exit 1; }
git -C "$CANONICAL_REPO_ROOT" rev-parse --verify --quiet "$RELEASE_ID^{commit}" >/dev/null || {
  echo "Reviewed commit is unavailable from the canonical checkout: $RELEASE_ID" >&2
  exit 1
}

echo "Source release ID: $RELEASE_ID"
echo "Source: $CANONICAL_REPO_ROOT (tracked files only)"
echo "Destination: $DESTINATION"
if [[ "$APPLY" != "1" ]]; then
  echo 'Dry run complete. Use --apply only after CI, backup and cutover gates pass.'
  exit 0
fi

command -v git >/dev/null 2>&1 || { echo 'Missing required command: git' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'Missing required command: npm' >&2; exit 1; }
command -v sudo >/dev/null 2>&1 || { echo 'Missing required command: sudo' >&2; exit 1; }
sudo -n true

cleanup_staging() {
  sudo -n rm -rf "$STAGING"
  [[ -z "$ARCHIVE" ]] || rm -f "$ARCHIVE"
}
trap cleanup_staging EXIT INT TERM

sudo -n install -d -o root -g skincos -m 0750 "$STAGING" "$CRM_NPM_CACHE"
ARCHIVE="$(mktemp /var/tmp/skincos-source-release.XXXXXX.tar)"
git -C "$CANONICAL_REPO_ROOT" archive --format=tar --output="$ARCHIVE" "$RELEASE_ID"
sudo -n tar -xf "$ARCHIVE" -C "$STAGING"
rm -f "$ARCHIVE"
ARCHIVE=""
sudo -n chown -R root:skincos "$STAGING"
sudo -n find "$STAGING" -type d -exec chmod 0750 {} +
sudo -n find "$STAGING" -type f -exec chmod 0640 {} +
sudo -n find "$STAGING" -type f \( -path '*/scripts/*.sh' -o -path '*/scripts/*/*.sh' \) -exec chmod 0750 {} +
sudo -n chown -R skincos:skincos "$CRM_NPM_CACHE"

sudo -n test -f "$STAGING/crm/api/package-lock.json" || { echo 'CRM lockfile is missing from source release.' >&2; exit 1; }
# npm must write node_modules during staging, but the promoted source returns
# to root ownership before any service is allowed to execute it.
sudo -n chown -R skincos:skincos "$STAGING/crm/api"
sudo -n -u skincos env npm_config_cache="$CRM_NPM_CACHE" \
  npm --prefix "$STAGING/crm/api" ci --omit=dev --ignore-scripts
sudo -n test -d "$STAGING/crm/api/node_modules/express" || { echo 'CRM production dependencies were not installed.' >&2; exit 1; }
sudo -n chown -R root:skincos "$STAGING/crm/api"
sudo -n test -f "$STAGING/orb/engine/orb-proxy/server.js" || { echo 'Orb proxy source is missing from source release.' >&2; exit 1; }
sudo -n test -f "$STAGING/integration/ef/requirements.lock" || { echo 'Booking requirements are missing from source release.' >&2; exit 1; }

sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$DESTINATION")"
sudo -n mv "$STAGING" "$DESTINATION"
trap - EXIT INT TERM
sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$CURRENT_LINK")"
sudo -n ln -sfn "$DESTINATION" "$CURRENT_LINK"
echo "Native source release prepared: $CURRENT_LINK -> $DESTINATION"
