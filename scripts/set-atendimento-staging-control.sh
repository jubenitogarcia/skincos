#!/usr/bin/env bash
set -euo pipefail

readonly CONTROL_FILE='/etc/skincos/atendimento-staging/module-control.json'
# Control JSON may describe active release state, so retain its snapshots in a
# root-private location separate from PostgreSQL dump artifacts.
readonly BACKUP_ROOT='/var/backups/skincos/clientes/staging-control'

STATE=''
RELEASE_SHA=''
REASON='clientes-staging-read-only'
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/set-atendimento-staging-control.sh --state <disabled|maintenance|active|canary> [--release-sha <full-sha>] [--reason <text>] [--apply]

The default is dry-run. Active or canary requires a full immutable release SHA.
Every generated control remains synthetic and read-only with commercial writes
disabled; this script never starts a service or changes a tunnel.
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
if [[ "$STATE" == 'active' || "$STATE" == 'canary' ]]; then
  [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--release-sha must be a full lowercase SHA for active or canary state.' >&2; exit 64; }
elif [[ -n "$RELEASE_SHA" && ! "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo '--release-sha must be a full lowercase SHA when supplied.' >&2
  exit 64
fi
[[ "$REASON" =~ ^[A-Za-z0-9._:-]{1,120}$ ]] || { echo '--reason contains unsupported characters.' >&2; exit 64; }

for command_name in sudo install date mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing $command_name" >&2; exit 1; }
done
sudo -n true

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_json='null'
if [[ -n "$RELEASE_SHA" ]]; then
  release_json="\"$RELEASE_SHA\""
fi
tmp_control="$(mktemp)"
trap 'rm -f "$tmp_control"' EXIT
cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"$STATE","releaseSha":$release_json,"readOnly":true,"commercialContactWritesEnabled":false,"syntheticOnly":true,"reason":"$REASON","updatedAt":"$stamp"}
EOF

if [[ "$APPLY" == '1' ]]; then
  sudo -n test -f "$CONTROL_FILE" || { echo "Control file is missing: $CONTROL_FILE" >&2; exit 1; }
  sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"
  sudo -n cp -p "$CONTROL_FILE" "$BACKUP_ROOT/${stamp}-module-control.json"
  sudo -n install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"
  printf 'module_control=%s release_sha=%s read_only=true commercial_writes=false applied=true\n' "$STATE" "${RELEASE_SHA:-none}"
else
  printf 'module_control=%s release_sha=%s read_only=true commercial_writes=false dry_run=true\n' "$STATE" "${RELEASE_SHA:-none}"
fi
