#!/usr/bin/bash
set -euo pipefail

# Unprivileged typed-WSL entry point. It only selects the pinned release;
# credential custody and publication logic are loaded from that release.
[[ "$(id -u)" != 0 && "${WSL_DISTRO_NAME:-}" == Ubuntu-24.04 ]] || {
  echo 'Token Vault publisher must run as the Ubuntu-24.04 operator.' >&2
  exit 78
}

mode='publish'
if [[ "${1:-}" == readiness || "${1:-}" == publish ]]; then
  mode="$1"
  shift
fi
source_sha=''
for ((index = 1; index <= $#; index += 1)); do
  if [[ "${!index}" == --source-sha ]]; then
    next=$((index + 1))
    [[ $next -le $# && -z "$source_sha" ]] || { echo 'Token Vault source SHA is repeated or missing.' >&2; exit 64; }
    source_sha="${!next}"
  fi
done
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full lowercase Token Vault source SHA is required.' >&2; exit 64; }
readonly release_root="/opt/skincos/releases/$source_sha/source"
readonly custody="$release_root/scripts/runtime/token-vault-native-secret-custody.mjs"
[[ -f "$custody" && ! -L "$custody" ]] || { echo 'Pinned native Token Vault custody entry point is unavailable.' >&2; exit 78; }
exec /usr/bin/sudo -n /usr/bin/node "$custody" "$mode" "$@"
