#!/usr/bin/bash
set -euo pipefail

# Unprivileged typed-WSL entry point. It only selects the pinned release;
# publication logic and custody helpers are loaded from that release.
[[ "$(id -u)" != 0 && "${WSL_DISTRO_NAME:-}" == Ubuntu-24.04 ]] || {
  echo 'Token Vault publisher must run as the Ubuntu-24.04 operator.' >&2
  exit 78
}

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
readonly publisher="$release_root/scripts/token-vault-native-release.mjs"
[[ -f "$publisher" && ! -L "$publisher" ]] || { echo 'Pinned native Token Vault publisher is unavailable.' >&2; exit 78; }
cd -- "$release_root"
exec /usr/bin/node "$publisher" "$@"
