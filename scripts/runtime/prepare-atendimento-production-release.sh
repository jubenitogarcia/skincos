#!/usr/bin/bash -p
set -euo pipefail

# Register an already staged native source release for the isolated service.
# Source staging itself is handled by the main-custodied release pipeline;
# this script neither changes the shared source pointer nor restarts a unit.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

readonly RELEASE_BASE='/opt/skincos/releases'
readonly STATE_ROOT='/var/lib/skincos-runtime/crm-atendimento-production'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/production-readonly'

RELEASE_SHA=''
PREDECESSOR_SHA=''
APPLY=0
usage() { echo "Usage: $0 --release-sha <full-sha> --predecessor-sha <full-sha> [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-sha) shift; RELEASE_SHA="${1:-}" ;;
    --predecessor-sha) shift; PREDECESSOR_SHA="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ && "$PREDECESSOR_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Release and predecessor must be full lowercase SHAs.' >&2; exit 64; }
[[ "$RELEASE_SHA" != "$PREDECESSOR_SHA" ]] || { echo 'Release and predecessor must differ.' >&2; exit 64; }
readonly SOURCE_ROOT="$RELEASE_BASE/$RELEASE_SHA/source"
readonly VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/node /usr/bin/install /usr/bin/date /usr/bin/mktemp /usr/bin/test /usr/bin/rm /usr/bin/printf; do
  [[ -x "$command_path" ]] || { echo "Missing $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n true
run_sudo_clean /usr/bin/test -f "$VALIDATOR" || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/node "$VALIDATOR" --source-root "$SOURCE_ROOT" --release-sha "$RELEASE_SHA" --predecessor-sha "$PREDECESSOR_SHA" >/dev/null

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true release_sha=%s predecessor_sha=%s isolated_service=crm-atendimento-production.service shared_restart=false\n' "$RELEASE_SHA" "$PREDECESSOR_SHA"
  exit 0
fi

stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
manifest_dir="$STATE_ROOT/release-manifests"
manifest="$manifest_dir/$RELEASE_SHA.json"
run_sudo_clean /usr/bin/install -d -m 0750 -o root -g skincos "$manifest_dir"
run_sudo_clean /usr/bin/install -d -m 0750 -o root -g postgres "$BACKUP_ROOT"
if run_sudo_clean /usr/bin/test -f "$manifest"; then
  echo 'Release manifest already exists; immutable release registration is idempotent.'
  exit 0
fi

umask 0077
tmp="$(/usr/bin/mktemp /tmp/atendimento-production-manifest.XXXXXX)"
/usr/bin/test -f "$tmp" -a -O "$tmp"
trap '/usr/bin/rm -f "$tmp"' EXIT
/usr/bin/printf '%s\n' "{\"schemaVersion\":1,\"releaseSha\":\"$RELEASE_SHA\",\"predecessorSha\":\"$PREDECESSOR_SHA\",\"preparedAt\":\"$stamp\",\"readOnly\":true,\"syntheticOnly\":true}" >"$tmp"
run_sudo_clean /usr/bin/install -m 0640 -o root -g skincos "$tmp" "$manifest"
printf 'prepared=true release_sha=%s predecessor_sha=%s manifest_registered=true shared_restart=false\n' "$RELEASE_SHA" "$PREDECESSOR_SHA"
