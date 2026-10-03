#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "$EUID" -eq 0 && $# -eq 2 ]] || { printf 'usage: root install-native-pr-admission.sh <immutable-source> <sha>\n' >&2; exit 1; }
source_dir="$(realpath -e -- "$1")"
source_sha="$2"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ && "$source_dir" == "/opt/skincos-native-pr-admission/releases/$source_sha/source" ]] || { printf 'immutable source identity is invalid\n' >&2; exit 1; }
[[ -f "$source_dir/.native-pr-admission-source-sha" && "$(cat "$source_dir/.native-pr-admission-source-sha")" == "$source_sha" ]] || exit 1
[[ -z "$(find "$source_dir" -xdev \( ! -user root -o -perm /022 \) -print -quit)" ]] || { printf 'immutable source ownership is invalid\n' >&2; exit 1; }
for file in /etc/skincos/github-app/config.json /etc/skincos/github-app/private-key.pem /etc/skincos/global-coordination/runtime.env; do
  [[ -f "$file" && ! -L "$file" && "$(stat -c '%U:%a' "$file")" == 'root:600' ]] || { printf 'native issuer custody is not ready\n' >&2; exit 1; }
done
remote_sha="$(curl --fail --silent --show-error --max-time 30 --proto '=https' https://api.github.com/repos/jubenitogarcia/skincos/commits/main | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])')"
[[ "$remote_sha" == "$source_sha" ]] || { printf 'only exact canonical main may be installed\n' >&2; exit 1; }
checkpoint="/var/lib/skincos-native-pr-admission-checkpoints/$(date -u +%Y%m%dT%H%M%SZ)-$source_sha"
install -d -m 0700 "$checkpoint"
for unit in skincos-native-pr-admission.service skincos-native-pr-admission.timer; do
  [[ ! -e "/etc/systemd/system/$unit" ]] || cp -p "/etc/systemd/system/$unit" "$checkpoint/$unit"
done
readlink -f /opt/skincos-native-pr-admission/current > "$checkpoint/previous-release" || true
systemctl is-enabled skincos-native-pr-admission.timer > "$checkpoint/previous-timer" 2>/dev/null || true
systemctl is-active skincos-native-pr-admission.timer > "$checkpoint/previous-active" 2>/dev/null || true
rollback() {
  local result=$?
  if [[ "$result" -ne 0 ]]; then
    for unit in skincos-native-pr-admission.service skincos-native-pr-admission.timer; do
      if [[ -f "$checkpoint/$unit" ]]; then cp -p "$checkpoint/$unit" "/etc/systemd/system/$unit"; else rm -f -- "/etc/systemd/system/$unit"; fi
    done
    if [[ -s "$checkpoint/previous-release" ]]; then
      ln -s "$(cat "$checkpoint/previous-release")" /opt/skincos-native-pr-admission/current.rollback
      mv -Tf /opt/skincos-native-pr-admission/current.rollback /opt/skincos-native-pr-admission/current
    elif [[ -L /opt/skincos-native-pr-admission/current ]]; then rm -- /opt/skincos-native-pr-admission/current; fi
    systemctl daemon-reload
    if [[ "$(cat "$checkpoint/previous-timer")" == enabled ]]; then systemctl enable skincos-native-pr-admission.timer; else systemctl disable skincos-native-pr-admission.timer || true; fi
    if [[ "$(cat "$checkpoint/previous-active")" == active ]]; then systemctl start skincos-native-pr-admission.timer; fi
    printf 'native PR admission install failed; restored checkpoint %s\n' "$checkpoint" >&2
  fi
  return "$result"
}
trap rollback EXIT
systemctl stop skincos-native-pr-admission.timer skincos-native-pr-admission.service 2>/dev/null || true
install -m 0644 "$source_dir/ops/runtime/native-pr-admission/skincos-native-pr-admission.service" /etc/systemd/system/skincos-native-pr-admission.service
install -m 0644 "$source_dir/ops/runtime/native-pr-admission/skincos-native-pr-admission.timer" /etc/systemd/system/skincos-native-pr-admission.timer
ln -s "$source_dir/.." /opt/skincos-native-pr-admission/current.new
mv -Tf /opt/skincos-native-pr-admission/current.new /opt/skincos-native-pr-admission/current
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/skincos-native-pr-admission.service /etc/systemd/system/skincos-native-pr-admission.timer
# Execute the same sandbox with publication disabled before enabling recurrence.
systemd-run --quiet --wait --pipe --collect --unit=skincos-native-pr-admission-preflight \
  --property=DynamicUser=yes --property=ProtectHome=yes --property=ProtectSystem=strict \
  --property=PrivateTmp=yes --property=NoNewPrivileges=yes --property=PrivateDevices=yes \
  --property=InaccessiblePaths=/mnt/c --property=StateDirectory=skincos-native-pr-admission \
  --property=StateDirectoryMode=0700 --property=RuntimeDirectory=skincos-native-pr-admission-preflight \
  --property=RuntimeDirectoryMode=0700 --property=UMask=0077 \
  --property=LoadCredential=github-app-config:/etc/skincos/github-app/config.json \
  --property=LoadCredential=github-app-key:/etc/skincos/github-app/private-key.pem \
  --property=LoadCredential=global-coordination-env:/etc/skincos/global-coordination/runtime.env \
  /usr/bin/node "$source_dir/scripts/codex-native-pr-admission.mjs" --preflight
systemctl enable --now skincos-native-pr-admission.timer
trap - EXIT
printf 'native PR admission installed at %s; checkpoint %s\n' "$source_sha" "$checkpoint"
