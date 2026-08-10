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

readonly CONTROL_FILE='/etc/skincos/atendimento-staging/module-control.json'
# Control JSON may describe active release state, so retain its snapshots in a
# root-private location separate from PostgreSQL dump artifacts.
readonly BACKUP_ROOT='/var/backups/skincos/clientes/staging-control'

STATE=''
RELEASE_SHA=''
COORDINATION_SOURCE_SHA="${SKINCOS_GLOBAL_COORDINATION_SOURCE_SHA:-}"
COORDINATION_CLOSURE="${SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE:-}"
REASON='clientes-staging-read-only'
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/set-atendimento-staging-control.sh --state <disabled|maintenance|active|canary> [--release-sha <full-sha>] [--source-sha <full-sha>] [--coordination-closure <json>] [--reason <text>] [--apply]

The default is dry-run. Active or canary requires a full immutable release SHA.
Every generated control remains synthetic and read-only with commercial writes
disabled; this script never starts a service or changes a tunnel.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state) shift; STATE="${1:-}" ;;
    --release-sha) shift; RELEASE_SHA="${1:-}" ;;
    --source-sha) shift; COORDINATION_SOURCE_SHA="${1:-}" ;;
    --coordination-closure) shift; COORDINATION_CLOSURE="${1:-}" ;;
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
fi

for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/install /usr/bin/date /usr/bin/mktemp /usr/bin/cat /usr/bin/rm /usr/bin/cp /usr/bin/cmp /usr/bin/stat /usr/bin/test; do
  [[ -x "$command_path" ]] || { echo "Missing $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n /usr/bin/true

stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
release_json='null'
if [[ -n "$RELEASE_SHA" ]]; then
  release_json="\"$RELEASE_SHA\""
fi
tmp_control="$(/usr/bin/mktemp /tmp/atendimento-staging-control.XXXXXX)"
CONTROL_BACKUP_NAME='none'
CONTROL_BACKUP_PATH=''
CONTROL_BACKUP_COMMITTED=0
coordination_acquired=0
cleanup_artifacts() {
  /usr/bin/rm -f "$tmp_control"
  if [[ "$CONTROL_BACKUP_COMMITTED" != '1' && "$CONTROL_BACKUP_PATH" =~ ^/var/backups/skincos/clientes/staging-control/[0-9]{8}T[0-9]{6}Z-module-control\.[A-Za-z0-9]{6}\.json$ ]]; then
    if [[ "$coordination_acquired" != '1' ]] || native_coordination_check >/dev/null 2>&1; then
      run_sudo_clean /usr/bin/rm -f -- "$CONTROL_BACKUP_PATH" || true
    fi
  fi
  if [[ "$coordination_acquired" == '1' ]]; then
    native_coordination_cleanup || true
    coordination_acquired=0
  fi
}
trap cleanup_artifacts EXIT
/usr/bin/cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"$STATE","releaseSha":$release_json,"readOnly":true,"commercialContactWritesEnabled":false,"syntheticOnly":true,"reason":"$REASON","updatedAt":"$stamp"}
EOF

if [[ "$APPLY" == '1' ]]; then
  native_coordination_init deploy:atendimento:staging atendimento "$COORDINATION_SOURCE_SHA" "$COORDINATION_CLOSURE" mutation
  native_coordination_acquire "mini-pc:deploy:atendimento:staging:control:$COORDINATION_SOURCE_SHA:$$" >/dev/null
  coordination_acquired=1
  native_coordination_check
  run_sudo_clean /usr/bin/test -f "$CONTROL_FILE" || { echo "Control file is missing: $CONTROL_FILE" >&2; exit 1; }
  native_coordination_check
  run_sudo_clean /usr/bin/install -d -m 0700 -o root -g root "$BACKUP_ROOT"
  # The pre-created root-private filename is the collision-resistant identity
  # of the control snapshot. It cannot overwrite a prior promotion's proof.
  CONTROL_BACKUP_PATH="$(run_sudo_clean /usr/bin/mktemp "$BACKUP_ROOT/${stamp}-module-control.XXXXXX.json")"
  [[ "$CONTROL_BACKUP_PATH" =~ ^/var/backups/skincos/clientes/staging-control/[0-9]{8}T[0-9]{6}Z-module-control\.[A-Za-z0-9]{6}\.json$ ]] || {
    echo 'Control backup path was not generated from the fixed unique contract.' >&2
    exit 78
  }
  run_sudo_clean /usr/bin/test -f "$CONTROL_BACKUP_PATH"
  run_sudo_clean /usr/bin/test -O "$CONTROL_BACKUP_PATH"
  CONTROL_BACKUP_NAME="${CONTROL_BACKUP_PATH##*/}"
  native_coordination_check
  run_sudo_clean /usr/bin/cp -p "$CONTROL_FILE" "$CONTROL_BACKUP_PATH"
  control_backup_metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$CONTROL_BACKUP_PATH")"
  [[ "$control_backup_metadata" == 'root:skincos:640' ]] || {
    echo 'Control backup ownership or mode does not satisfy the rollback contract.' >&2
    exit 78
  }
  run_sudo_clean /usr/bin/cmp -s "$CONTROL_FILE" "$CONTROL_BACKUP_PATH" || {
    echo 'Control backup did not preserve the current staging control.' >&2
    exit 78
  }
  CONTROL_BACKUP_COMMITTED=1
  native_coordination_check
  run_sudo_clean /usr/bin/install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"
  printf 'module_control=%s release_sha=%s read_only=true commercial_writes=false control_backup=%s applied=true\n' "$STATE" "${RELEASE_SHA:-none}" "$CONTROL_BACKUP_NAME"
else
  printf 'module_control=%s release_sha=%s read_only=true commercial_writes=false control_backup=none dry_run=true\n' "$STATE" "${RELEASE_SHA:-none}"
fi
