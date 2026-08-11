#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
HELPER="$ROOT_DIR/scripts/runtime/provision-global-coordination-custody.sh"
INSTALLER="$ROOT_DIR/scripts/runtime/install-native-custody-runner.sh"
UNIT="$ROOT_DIR/ops/runtime/units/skincos-native-custody-runner.service"
BOOTSTRAP="$ROOT_DIR/scripts/bootstrap-native-custody-runner.ps1"

valid_output="$(printf 'https://coordination.example.workers.dev\n%s\n' "$(printf 's%.0s' {1..40})" | bash "$HELPER" validate)"
[[ "$valid_output" == 'custody_input=valid' ]] || { echo 'valid custody input was rejected' >&2; exit 1; }

if printf 'http://coordination.example.workers.dev\n%s\n' "$(printf 's%.0s' {1..40})" | bash "$HELPER" validate >/dev/null 2>&1; then
  echo 'insecure coordinator URL was accepted' >&2
  exit 1
fi

if printf 'https://coordination.example.workers.dev\nshort\n' | bash "$HELPER" validate >/dev/null 2>&1; then
  echo 'short coordination secret was accepted' >&2
  exit 1
fi

grep -Fqx 'NoNewPrivileges=false' "$UNIT" || {
  echo 'native custody runner must permit its fixed sudoers helper to elevate' >&2
  exit 1
}
grep -Fqx 'ReadWritePaths=/etc/skincos/global-coordination' "$UNIT" || {
  echo 'native custody runner must expose only the private custody directory as an additional writable path' >&2
  exit 1
}
grep -Fqx "readonly CUSTODY_DIR='/etc/skincos/global-coordination'" "$INSTALLER" || {
  echo 'native custody installer must own the custody directory bootstrap' >&2
  exit 1
}
grep -Fq 'install -d -o root -g admin -m 0750 "$CUSTODY_DIR"' "$INSTALLER" || {
  echo 'native custody installer must create the empty custody directory before systemd starts' >&2
  exit 1
}
grep -Fq 'systemctl restart "$UNIT_NAME"' "$INSTALLER" || {
  echo 'native custody installer must restart an already active runner after unit changes' >&2
  exit 1
}
grep -Fq '$standardInput = $registrationToken + [char]10' "$BOOTSTRAP" || {
  echo 'native custody bootstrap must terminate the registration token with LF, not Windows CRLF' >&2
  exit 1
}
if grep -Fq '$standardInput = $registrationToken + [Environment]::NewLine' "$BOOTSTRAP"; then
  echo 'native custody bootstrap must not use the Windows platform newline for the Bash token contract' >&2
  exit 1
fi

echo 'native custody contract checks passed'
