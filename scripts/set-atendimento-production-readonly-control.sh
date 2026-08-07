#!/usr/bin/env bash
set -euo pipefail

readonly CONTROL_FILE='/etc/skincos/atendimento-production/module-control.json'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/production-readonly'
STATE=""
RELEASE_SHA=""
REASON="clientes-production-readonly"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/set-atendimento-production-readonly-control.sh --state <disabled|maintenance|active|canary> [--release-sha <full-sha>] [--reason <text>] [--apply]

Active production Clientes requires a full immutable release SHA. The default
is a dry-run; --apply creates a private backup before replacing the control
file. No process or public route is changed by this script.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state) shift; STATE="${1:-}" ;;
    --release-sha) shift; RELEASE_SHA="${1:-}" ;;
    --reason) shift; REASON="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

[[ "$STATE" =~ ^(disabled|maintenance|active|canary)$ ]] || { echo '--state must be disabled, maintenance, active or canary.' >&2; exit 64; }
if [[ "$STATE" == "active" || "$STATE" == "canary" ]]; then
  [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--release-sha must be a full lowercase SHA for active or canary state.' >&2; exit 64; }
elif [[ -n "$RELEASE_SHA" && ! "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo '--release-sha must be a full lowercase SHA when supplied.' >&2
  exit 64
fi
[[ "$REASON" =~ ^[A-Za-z0-9._:-]{1,120}$ ]] || { echo '--reason contains unsupported characters.' >&2; exit 64; }
command -v install >/dev/null 2>&1 || { echo 'Missing install' >&2; exit 1; }
command -v date >/dev/null 2>&1 || { echo 'Missing date' >&2; exit 1; }
sudo -n true

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ "$APPLY" == "1" ]]; then
  sudo -n test -f "$CONTROL_FILE" || { echo "Control file is missing: $CONTROL_FILE" >&2; exit 1; }
  sudo -n install -d -m 0750 -o root -g postgres "$BACKUP_ROOT"
  sudo -n cp -p "$CONTROL_FILE" "$BACKUP_ROOT/${stamp}-module-control.json"
fi

tmp_control="$(mktemp)"
trap 'rm -f "$tmp_control"' EXIT
release_json='null'
if [[ -n "$RELEASE_SHA" ]]; then
  release_json="\"$RELEASE_SHA\""
fi
cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"$STATE","releaseSha":$release_json,"readOnly":true,"commercialContactWritesEnabled":false,"syntheticOnly":true,"reason":"$REASON","updatedAt":"$stamp"}
EOF
if [[ "$APPLY" == "1" ]]; then
  sudo -n install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"
  echo "Atendimento production control updated: state=$STATE release_sha=${RELEASE_SHA:-none}"
else
  echo "Atendimento production control verified: state=$STATE release_sha=${RELEASE_SHA:-none} (dry-run)"
fi
