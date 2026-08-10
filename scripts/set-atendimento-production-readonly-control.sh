#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/nonexistent' 'LANG=C' "$@"
}

readonly SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$SCRIPT_ROOT/scripts/runtime/global-coordination-native.sh"

readonly CONTROL_FILE='/etc/skincos/atendimento-production/module-control.json'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/production-readonly'
STATE=''
RELEASE_SHA=''
COORDINATION_SOURCE_SHA="${SKINCOS_GLOBAL_COORDINATION_SOURCE_SHA:-}"
COORDINATION_CLOSURE="${SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE:-}"
COORDINATION_PROOF_FILE="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-}"
COORDINATION_REUSE=0
REASON='clientes-production-readonly'
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/set-atendimento-production-readonly-control.sh --state <disabled|maintenance|active|canary> [--release-sha <full-sha>] [--source-sha <full-sha>] [--coordination-closure <json>] [--coordination-proof-file <private-proof>] [--coordination-reuse] [--reason <text>] [--apply]

Active production Clientes requires a full immutable release SHA. The default
is a dry-run; --apply creates a private backup before replacing the control
file. No process or public route is changed by this script.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state) shift; STATE="${1:-}" ;;
    --release-sha) shift; RELEASE_SHA="${1:-}" ;;
    --source-sha) shift; COORDINATION_SOURCE_SHA="${1:-}" ;;
    --coordination-closure) shift; COORDINATION_CLOSURE="${1:-}" ;;
    --coordination-proof-file) shift; COORDINATION_PROOF_FILE="${1:-}" ;;
    --coordination-reuse) COORDINATION_REUSE=1 ;;
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
if [[ "$APPLY" == '1' ]]; then
  if [[ -z "$COORDINATION_SOURCE_SHA" && "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    COORDINATION_SOURCE_SHA="$RELEASE_SHA"
  fi
  [[ "$COORDINATION_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--source-sha must be a full lowercase SHA for apply.' >&2; exit 78; }
  [[ -n "$COORDINATION_CLOSURE" && -f "$COORDINATION_CLOSURE" ]] || { echo '--coordination-closure must identify an existing Atendimento attestation for apply.' >&2; exit 78; }
  if [[ "$COORDINATION_REUSE" == '1' ]]; then
    [[ "$COORDINATION_PROOF_FILE" = /* && -f "$COORDINATION_PROOF_FILE" ]] || { echo '--coordination-proof-file must identify an existing private proof for coordination reuse.' >&2; exit 78; }
    export SKINCOS_GLOBAL_COORDINATION_REUSE=1
    export SKINCOS_GLOBAL_COORDINATION_PROOF_FILE="$COORDINATION_PROOF_FILE"
  fi
fi

for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/install /usr/bin/date /usr/bin/mktemp /usr/bin/cat /usr/bin/rm /usr/bin/cp /usr/bin/chmod /usr/bin/test; do
  [[ -x "$command_path" ]] || { echo "Missing $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n /usr/bin/true

stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
release_json='null'
if [[ -n "$RELEASE_SHA" ]]; then
  release_json="\"$RELEASE_SHA\""
fi
umask 0077
tmp_control="$(/usr/bin/mktemp /tmp/atendimento-production-control.XXXXXX)"
/usr/bin/test -f "$tmp_control" -a -O "$tmp_control"
coordination_acquired=0
cleanup_control() {
  /usr/bin/rm -f "$tmp_control"
  if [[ "$coordination_acquired" == '1' ]]; then
    native_coordination_cleanup || true
    coordination_acquired=0
  fi
}
trap cleanup_control EXIT INT TERM
/usr/bin/cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"$STATE","releaseSha":$release_json,"readOnly":true,"commercialContactWritesEnabled":false,"syntheticOnly":true,"reason":"$REASON","updatedAt":"$stamp"}
EOF

if [[ "$APPLY" == '1' ]]; then
  native_coordination_init deploy:atendimento:production atendimento "$COORDINATION_SOURCE_SHA" "$COORDINATION_CLOSURE" mutation
  native_coordination_acquire "mini-pc:deploy:atendimento:production:control:$COORDINATION_SOURCE_SHA:$$" >/dev/null
  coordination_acquired=1
  native_coordination_check
  run_sudo_clean /usr/bin/test -f "$CONTROL_FILE" || { echo "Control file is missing: $CONTROL_FILE" >&2; exit 1; }
  native_coordination_check
  run_sudo_clean /usr/bin/install -d -m 0700 -o root -g root "$BACKUP_ROOT"
  backup="$(run_sudo_clean /usr/bin/mktemp "$BACKUP_ROOT/${stamp}-module-control.XXXXXX.json")"
  [[ "$backup" =~ ^/var/backups/skincos/clientes/production-readonly/[0-9]{8}T[0-9]{6}Z-module-control\.[A-Za-z0-9]{6}\.json$ ]] || { echo 'Control backup path was not generated from the fixed contract.' >&2; exit 1; }
  native_coordination_check
  run_sudo_clean /usr/bin/cp -p "$CONTROL_FILE" "$backup"
  native_coordination_check
  run_sudo_clean /usr/bin/chmod 0600 "$backup"
  native_coordination_check
  run_sudo_clean /usr/bin/install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"
  printf 'module_control=%s release_sha=%s read_only=true commercial_writes=false applied=true\n' "$STATE" "${RELEASE_SHA:-none}"
else
  printf 'module_control=%s release_sha=%s read_only=true commercial_writes=false dry_run=true\n' "$STATE" "${RELEASE_SHA:-none}"
fi
