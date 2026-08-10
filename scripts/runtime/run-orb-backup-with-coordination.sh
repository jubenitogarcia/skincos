#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy \
  GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

readonly SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly RESOURCE='global:orb-backup'
readonly CLOSURE="$SCRIPT_ROOT/.skincos-global-coordination-orb.json"
readonly COORDINATION_ENV_FILE="${SKINCOS_GLOBAL_COORDINATION_ENV_FILE:-/etc/skincos/global-coordination/orb-backup.env}"
coordination_acquired=0

load_private_coordination_environment() {
  [[ "$COORDINATION_ENV_FILE" = /* && "$COORDINATION_ENV_FILE" != *$'\n'* && "$COORDINATION_ENV_FILE" != *$'\r'* ]] || {
    echo 'Orb backup coordination environment path is invalid.' >&2
    exit 78
  }
  [[ -f "$COORDINATION_ENV_FILE" ]] || {
    echo 'Orb backup coordination environment is unavailable.' >&2
    exit 78
  }
  local mode line key value
  mode="$(stat -c '%a' "$COORDINATION_ENV_FILE")"
  [[ "$mode" == '600' || "$mode" == '640' ]] || {
    echo 'Orb backup coordination environment must be mode 0600 or 0640.' >&2
    exit 78
  }
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || {
      echo 'Orb backup coordination environment contains an invalid record.' >&2
      exit 78
    }
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    [[ "$key" == SKINCOS_GLOBAL_COORDINATOR_URL || "$key" == SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET ]] || {
      echo 'Orb backup coordination environment contains an unsupported key.' >&2
      exit 78
    }
    export "$key=$value"
  done < "$COORDINATION_ENV_FILE"
}

load_private_coordination_environment

[[ "$SCRIPT_ROOT" =~ ^/opt/skincos/releases/([0-9a-f]{40})/source$ ]] || {
  echo 'Orb backup must run from an immutable native release, never a checkout.' >&2
  exit 78
}
readonly SOURCE_SHA="${BASH_REMATCH[1]}"
[[ -f "$CLOSURE" ]] || { echo 'Orb dependency-closure attestation is unavailable.' >&2; exit 78; }

# shellcheck disable=SC1091
source "$SCRIPT_ROOT/scripts/runtime/global-coordination-native.sh"
native_coordination_init "$RESOURCE" orb "$SOURCE_SHA" "$CLOSURE" mutation

cleanup() {
  if [[ "$coordination_acquired" == '1' ]]; then
    native_coordination_cleanup || echo 'Unable to release the Orb backup lease; it will expire fail-closed.' >&2
    coordination_acquired=0
  fi
}
trap cleanup EXIT INT TERM

native_coordination_acquire "mini-pc:${RESOURCE}:$SOURCE_SHA:$$" >/dev/null
coordination_acquired=1
native_coordination_check
/usr/bin/sudo -n /usr/bin/systemctl start orb-backup.service
native_coordination_check
printf 'orb_backup_generated=true source_sha=%s resource=%s\n' "$SOURCE_SHA" "$RESOURCE"
