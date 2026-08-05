#!/usr/bin/env bash
set -euo pipefail

STATE="${1:-}"
RELEASE_SHA="${2:-}"
case "$STATE" in disabled|maintenance|active) ;; *) echo "Usage: $0 <disabled|maintenance|active> <full-release-sha>" >&2; exit 1 ;; esac
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "release SHA must be a full lowercase SHA" >&2; exit 1; }
CONTROL_FILE="/etc/skincos/atendimento/module-control.json"
BACKUP_ROOT="/var/backups/skincos/clientes"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
sudo -n true
sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"
if sudo -n test -f "$CONTROL_FILE"; then sudo -n cp -p "$CONTROL_FILE" "$BACKUP_ROOT/${stamp}-module-control.json"; fi
cat >"$tmp" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"$STATE","releaseSha":"$RELEASE_SHA","syntheticOnly":true,"reason":"clientes-staging-controlled-transition","updatedAt":"$stamp"}
EOF
sudo -n install -m 0640 -o root -g skincos "$tmp" "$CONTROL_FILE"
echo "module_control=$STATE release_sha=$RELEASE_SHA"
