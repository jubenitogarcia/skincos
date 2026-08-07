#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_BASE='/opt/skincos/releases'
readonly NPM_CACHE='/var/lib/skincos-runtime/cache/crm-api'

RELEASE_SHA=""
APPLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-sha) shift; RELEASE_SHA="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) echo "Usage: $0 --release-sha <full-main-sha> [--apply]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "--release-sha must be a full lowercase SHA." >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DESTINATION="$RELEASE_BASE/$RELEASE_SHA/source"
readonly STAGING="$RELEASE_BASE/.atendimento-staging-$RELEASE_SHA-$$"

# Both paths are derived only from fixed roots, a validated SHA and the shell
# PID.  Keep this guard next to the destructive cleanup below: a GitHub
# Environment or caller cannot redirect a release or the cache via an env var.
assert_release_targets() {
  [[ "$DESTINATION" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
    echo 'Immutable release destination is invalid.' >&2
    exit 64
  }
  [[ "$STAGING" =~ ^/opt/skincos/releases/\.atendimento-staging-[0-9a-f]{40}-[0-9]+$ ]] || {
    echo 'Staging release target is invalid.' >&2
    exit 64
  }
  [[ "$(dirname "$STAGING")" == "$RELEASE_BASE" ]] || {
    echo 'Staging release target escapes the fixed release root.' >&2
    exit 64
  }
}
assert_release_targets

actual_sha="$(git -C "$ROOT_DIR" rev-parse "$RELEASE_SHA^{commit}")"
[[ "$actual_sha" == "$RELEASE_SHA" ]] || { echo "Release SHA is not present in this checkout." >&2; exit 1; }
tree_sha="$(git -C "$ROOT_DIR" rev-parse "$RELEASE_SHA^{tree}")"
[[ ! -e "$DESTINATION" ]] || { echo "Release already exists: $DESTINATION" >&2; exit 1; }
if [[ "$APPLY" != "1" ]]; then
  echo "release_sha=$RELEASE_SHA"
  echo "source_tree=$tree_sha"
  echo "destination=$DESTINATION"
  echo "dry_run=true"
  exit 0
fi

sudo -n true
command -v git >/dev/null 2>&1 || { echo "Missing git" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Missing npm" >&2; exit 1; }
sudo -n install -d -o root -g skincos -m 0750 "$STAGING" "$RELEASE_BASE" "$RELEASE_BASE/$RELEASE_SHA" "$NPM_CACHE"
cleanup() {
  # Do not let a future refactor turn cleanup into a broad or caller-directed
  # delete.  The validation is deliberately repeated at the sink.
  [[ "$STAGING" =~ ^/opt/skincos/releases/\.atendimento-staging-[0-9a-f]{40}-[0-9]+$ ]] || return 1
  [[ "$(dirname "$STAGING")" == "$RELEASE_BASE" ]] || return 1
  sudo -n /usr/bin/rm -rf -- "$STAGING"
}
trap cleanup EXIT INT TERM
git -C "$ROOT_DIR" archive --format=tar "$RELEASE_SHA" | sudo -n tar -xf - -C "$STAGING"
sudo -n chown -R root:skincos "$STAGING"
sudo -n find "$STAGING" -type d -exec chmod 0750 {} +
sudo -n find "$STAGING" -type f -exec chmod 0640 {} +
sudo -n find "$STAGING" -type f \( -path '*/scripts/*.sh' -o -path '*/scripts/*/*.sh' \) -exec chmod 0750 {} +
sudo -n test -f "$STAGING/crm/api/package-lock.json" || { echo "CRM lockfile missing" >&2; exit 1; }
sudo -n chown -R skincos:skincos "$STAGING/crm/api"
sudo -n -u skincos env npm_config_cache="$NPM_CACHE" npm --prefix "$STAGING/crm/api" ci --omit=dev --ignore-scripts
sudo -n chown -R root:skincos "$STAGING/crm/api"
sudo -n install -m 0640 -o root -g skincos /dev/stdin "$STAGING/.skincos-atendimento-release.json" <<EOF
{"releaseSha":"$RELEASE_SHA","sourceTree":"$tree_sha","target":"staging","domain":"atendimento","syntheticOnly":true}
EOF
sudo -n mv "$STAGING" "$DESTINATION"
trap - EXIT INT TERM
echo "release_sha=$RELEASE_SHA"
echo "source_tree=$tree_sha"
echo "destination=$DESTINATION"
echo "staged=true"
