#!/usr/bin/env bash
set -euo pipefail

# Installs only the bounded root helper and its fixed wrapper. This installer
# intentionally creates no service, timer, cloud resource, privilege rule, or
# source/destination argument surface. A root-owned policy is armed later via
# the helper's strict bootstrap input.

readonly ROOT_DIR="$(cd -- "$(dirname -- "$BASH_SOURCE")/../.." && pwd -P)"
readonly HELPER_SOURCE="$ROOT_DIR/scripts/runtime/ponto-legacy-snapshot-custody.mjs"
readonly WRAPPER_SOURCE="$ROOT_DIR/scripts/runtime/provision-ponto-legacy-snapshot-custody.sh"
readonly HELPER_LIBRARY_DIR='/usr/local/lib/skincos'
readonly HELPER='/usr/local/sbin/skincos-capture-ponto-legacy-snapshot'
readonly RUNTIME_DIR='/etc/skincos/ponto-legacy-snapshot-custody'
readonly DESTINATION_DIR='/var/lib/skincos/ponto-legacy-snapshot-custody'
readonly SUDOERS_SOURCE="$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers"
readonly SUDOERS_FILE='/etc/sudoers.d/skincos-native-custody'
readonly RUNNER_USER='skincos-actions'
readonly FORBIDDEN_GROUP='skincos'
readonly SUDOERS_ALIAS='Cmnd_Alias SKINCOS_PONTO_LEGACY_SNAPSHOT_CUSTODY = /usr/local/sbin/skincos-capture-ponto-legacy-snapshot capture'
readonly SUDOERS_GRANT='skincos-actions ALL=(root) NOPASSWD: SKINCOS_PONTO_LEGACY_SNAPSHOT_CUSTODY'

APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-ponto-legacy-snapshot-custody.sh [--apply]

Without --apply, validates the fixed helper and wrapper. With --apply, root
installs those fixed files and prepares only root-private custody directories.
The installer never accepts a source path, destination path, or service option.
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
  shift
done

[[ -f "$HELPER_SOURCE" ]] || { echo 'bounded legacy snapshot helper is missing' >&2; exit 78; }
[[ -f "$WRAPPER_SOURCE" ]] || { echo 'bounded legacy snapshot wrapper is missing' >&2; exit 78; }
[[ -f "$SUDOERS_SOURCE" ]] || { echo 'native custody sudoers source is missing' >&2; exit 78; }
node --check "$HELPER_SOURCE"
bash -n "$WRAPPER_SOURCE"

if [[ "$APPLY" -ne 1 ]]; then
  echo 'ponto_legacy_snapshot_custody_contract=valid service_changes=false cloud_changes=false'
  exit 0
fi

[[ "$(id -u)" == '0' ]] || { echo '--apply requires root' >&2; exit 78; }
for command in grep id install node tr visudo; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required" >&2; exit 78; }
done
id "$RUNNER_USER" >/dev/null 2>&1 || { echo 'capture runner account is unavailable' >&2; exit 78; }
if id -nG "$RUNNER_USER" | tr ' ' '\n' | grep -Fxq "$FORBIDDEN_GROUP"; then
  echo 'capture runner account must not be a member of the skincos group' >&2
  exit 78
fi
grep -Fqx "$SUDOERS_ALIAS" "$SUDOERS_SOURCE" || {
  echo 'native custody source lacks the exact legacy snapshot capture alias' >&2
  exit 78
}
grep -Fqx "$SUDOERS_GRANT" "$SUDOERS_SOURCE" || {
  echo 'native custody source lacks the exact legacy snapshot capture grant' >&2
  exit 78
}

install -d -o root -g root -m 0755 "$HELPER_LIBRARY_DIR"
install -d -o root -g root -m 0700 "$RUNTIME_DIR"
install -d -o root -g root -m 0700 "$DESTINATION_DIR"
install -d -o root -g root -m 0700 "$DESTINATION_DIR/authorizations"
install -d -o root -g root -m 0700 "$DESTINATION_DIR/captures"
install -o root -g root -m 0755 "$HELPER_SOURCE" "$HELPER_LIBRARY_DIR/ponto-legacy-snapshot-custody.mjs"
install -o root -g root -m 0755 "$WRAPPER_SOURCE" "$HELPER"
install -o root -g root -m 0440 "$SUDOERS_SOURCE" "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null
grep -Fqx "$SUDOERS_ALIAS" "$SUDOERS_FILE" || {
  echo 'installed native custody file lacks the exact legacy snapshot capture alias' >&2
  exit 78
}
grep -Fqx "$SUDOERS_GRANT" "$SUDOERS_FILE" || {
  echo 'installed native custody file lacks the exact legacy snapshot capture grant' >&2
  exit 78
}

echo 'ponto_legacy_snapshot_custody=installed service_changes=false cloud_changes=false'
