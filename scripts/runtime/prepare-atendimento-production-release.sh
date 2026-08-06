#!/usr/bin/env bash
set -euo pipefail

# Stage one immutable, main-custodied Atendimento release. This script only
# archives tracked source and installs locked API dependencies; it never
# changes the active symlink or restarts any service.
RELEASE_SHA=""
PREDECESSOR_SHA=""
APPLY=0
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_BASE="${SKINCOS_RELEASE_BASE:-/opt/skincos/releases}"
DESTINATION=""
STAGING=""
NPM_CACHE="${CRM_NPM_CACHE:-/var/lib/skincos-runtime/cache/crm-api}"

usage() { echo "Usage: $0 --release-sha <full-main-sha> --predecessor-sha <full-sha> [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-sha) [[ $# -ge 2 ]] || { usage >&2; exit 64; }; RELEASE_SHA="$2"; shift 2 ;;
    --predecessor-sha) [[ $# -ge 2 ]] || { usage >&2; exit 64; }; PREDECESSOR_SHA="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
done
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--release-sha must be full lowercase SHA.' >&2; exit 64; }
[[ "$PREDECESSOR_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--predecessor-sha must be full lowercase SHA.' >&2; exit 64; }
DESTINATION="$RELEASE_BASE/$RELEASE_SHA/source"
STAGING="$RELEASE_BASE/.atendimento-production-staging-$RELEASE_SHA-$$"
actual_sha="$(git -C "$ROOT_DIR" rev-parse "$RELEASE_SHA^{commit}")"
[[ "$actual_sha" == "$RELEASE_SHA" ]] || { echo 'Release SHA is not present in this checkout.' >&2; exit 1; }
main_sha="$(git -C "$ROOT_DIR" rev-parse 'origin/main^{commit}')"
[[ "$main_sha" == "$RELEASE_SHA" ]] || { echo 'Production release must equal the current origin/main SHA.' >&2; exit 1; }
git -C "$ROOT_DIR" merge-base --is-ancestor "$PREDECESSOR_SHA" "$RELEASE_SHA" || { echo 'Predecessor is not an ancestor of the production release.' >&2; exit 1; }
tree_sha="$(git -C "$ROOT_DIR" rev-parse "$RELEASE_SHA^{tree}")"
[[ ! -e "$DESTINATION" ]] || { echo "Release already exists: $DESTINATION" >&2; exit 73; }

if [[ "$APPLY" != "1" ]]; then
  printf 'release_sha=%s\nsource_tree=%s\npredecessor_sha=%s\ndestination=%s\ndry_run=true\n' "$RELEASE_SHA" "$tree_sha" "$PREDECESSOR_SHA" "$DESTINATION"
  exit 0
fi

for command_name in git npm sudo; do command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }; done
sudo -n true
sudo -n install -d -o root -g skincos -m 0750 "$STAGING" "$RELEASE_BASE" "$RELEASE_BASE/$RELEASE_SHA" "$NPM_CACHE"
cleanup() { sudo -n rm -rf "$STAGING"; }
trap cleanup EXIT INT TERM
git -C "$ROOT_DIR" archive --format=tar "$RELEASE_SHA" | sudo -n tar -xf - -C "$STAGING"
sudo -n chown -R root:skincos "$STAGING"
sudo -n find "$STAGING" -type d -exec chmod 0750 {} +
sudo -n find "$STAGING" -type f -exec chmod 0640 {} +
sudo -n find "$STAGING" -type f \( -path '*/scripts/*.sh' -o -path '*/scripts/*/*.sh' \) -exec chmod 0750 {} +
sudo -n test -f "$STAGING/crm/api/package-lock.json" || { echo 'CRM lockfile missing.' >&2; exit 1; }
sudo -n chown -R skincos:skincos "$STAGING/crm/api"
sudo -n -u skincos env npm_config_cache="$NPM_CACHE" npm --prefix "$STAGING/crm/api" ci --omit=dev --ignore-scripts
sudo -n test -d "$STAGING/crm/api/node_modules/express" || { echo 'CRM production dependencies were not installed.' >&2; exit 1; }
sudo -n chown -R root:skincos "$STAGING/crm/api"
sudo -n install -m 0640 -o root -g skincos /dev/stdin "$STAGING/.skincos-atendimento-release.json" <<EOF
{"releaseSha":"$RELEASE_SHA","sourceTree":"$tree_sha","predecessorSha":"$PREDECESSOR_SHA","target":"production","domain":"atendimento","syntheticOnly":false,"readOnly":true}
EOF
sudo -n mv "$STAGING" "$DESTINATION"
trap - EXIT INT TERM
printf 'release_sha=%s\nsource_tree=%s\npredecessor_sha=%s\ndestination=%s\nstaged=true\n' "$RELEASE_SHA" "$tree_sha" "$PREDECESSOR_SHA" "$DESTINATION"
