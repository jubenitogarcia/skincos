#!/usr/bin/bash -p
set -euo pipefail

# Install only the immutable isolated Atendimento unit. Every destination is
# fixed; no environment or GitHub value is evaluated as a command or path.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

readonly UNIT_DEST='/etc/systemd/system'
readonly STATE_ROOT='/var/lib/skincos-runtime'
readonly CONFIG_ROOT='/etc/skincos'
readonly LOG_ROOT='/var/log/skincos'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/production-readonly'
readonly SERVICE='crm-atendimento-production.service'

SOURCE_ROOT=''
APPLY=0
COORDINATION_PROOF_FILE=''
COORDINATION_REUSE=0

usage() { echo "Usage: $0 --source-root /opt/skincos/releases/<full-sha>/source [--coordination-proof-file <private-proof>] [--coordination-reuse] [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root) shift; SOURCE_ROOT="${1:-}" ;;
    --coordination-proof-file) shift; COORDINATION_PROOF_FILE="${1:-}" ;;
    --coordination-reuse) COORDINATION_REUSE=1 ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

if [[ ! "$SOURCE_ROOT" =~ ^/opt/skincos/releases/([0-9a-f]{40})/source$ ]]; then
  echo 'SOURCE_ROOT must be an immutable native release path with a full lowercase SHA.' >&2
  exit 64
fi
readonly RELEASE_SHA="${BASH_REMATCH[1]}"
readonly UNIT_SRC="$SOURCE_ROOT/ops/runtime/units/crm-atendimento-production.service"
readonly RUNTIME_ENTRYPOINT="$SOURCE_ROOT/crm/api/server/atendimentoRuntime.js"
readonly RELEASE_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
readonly CONTROL_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-production-control.mjs"
readonly RUNTIME_GRANT_LOCKDOWN="$SOURCE_ROOT/scripts/lockdown-atendimento-production-runtime.sh"
readonly RELEASE_MANIFEST="$STATE_ROOT/crm-atendimento-production/release-manifests/$RELEASE_SHA.json"
readonly CONTROL_FILE="$CONFIG_ROOT/atendimento-production/module-control.json"
readonly COORDINATION_CLOSURE="$SOURCE_ROOT/.skincos-global-coordination-atendimento.json"
coordination_proof="${COORDINATION_PROOF_FILE:-${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-/var/lib/skincos-runtime/global-coordination/atendimento-production-$RELEASE_SHA-$$.json}}"
if [[ "$COORDINATION_REUSE" == '1' ]]; then
  export SKINCOS_GLOBAL_COORDINATION_REUSE=1
  export SKINCOS_GLOBAL_COORDINATION_PROOF_FILE="$coordination_proof"
fi
coordination_acquired=0
coordination_owned=0

for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/sed /usr/bin/systemd-analyze /usr/bin/mktemp /usr/bin/install /usr/bin/node /usr/bin/chmod /usr/bin/rm /usr/bin/rmdir /usr/bin/date /usr/bin/cp /usr/bin/systemctl /usr/bin/test /usr/bin/grep /usr/bin/bash; do
  [[ -x "$command_path" ]] || { echo "Missing $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n true
/usr/bin/sudo -n /usr/bin/test -f "$UNIT_SRC" || { echo 'Isolated unit template is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$RUNTIME_ENTRYPOINT" || { echo 'Isolated runtime entrypoint is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$RELEASE_VALIDATOR" || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$CONTROL_VALIDATOR" || { echo 'Strict production control validator is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -x "$RUNTIME_GRANT_LOCKDOWN" || { echo 'Production runtime grant lockdown is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$RELEASE_MANIFEST" || { echo 'Release must be registered before the production unit can be installed.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$CONTROL_FILE" || { echo 'Strict production control file is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$SOURCE_ROOT" --release-sha "$RELEASE_SHA" >/dev/null
run_sudo_clean /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$RELEASE_SHA" >/dev/null
run_sudo_clean /usr/bin/grep -Fq "\"releaseSha\":\"$RELEASE_SHA\"" "$RELEASE_MANIFEST" || { echo 'Registered release manifest SHA mismatch.' >&2; exit 78; }
run_sudo_clean /usr/bin/grep -Fq '"readOnly":true' "$RELEASE_MANIFEST" || { echo 'Registered release manifest is not read-only.' >&2; exit 78; }
run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --dry-run >/dev/null

umask 0077
render_dir="$(/usr/bin/mktemp -d /tmp/atendimento-production-unit.XXXXXX)"
/usr/bin/test -d "$render_dir" -a -O "$render_dir"
rendered="$render_dir/$SERVICE"
trap '/usr/bin/rm -f "$rendered"; /usr/bin/rmdir "$render_dir" 2>/dev/null || true' EXIT
/usr/bin/sed \
  -e "s|__REPO_ROOT__|$SOURCE_ROOT|g" \
  -e "s|__STATE_ROOT__|$STATE_ROOT|g" \
  -e "s|__CONFIG_ROOT__|$CONFIG_ROOT|g" \
  -e "s|__LOG_ROOT__|$LOG_ROOT|g" \
  -e "s|__RELEASE_SHA__|$RELEASE_SHA|g" \
  "$UNIT_SRC" >"$rendered"
/usr/bin/chmod 0644 "$rendered"
/usr/bin/systemd-analyze verify "$rendered"

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true service=%s release_sha=%s source=%s shared_restart=false\n' "$SERVICE" "$RELEASE_SHA" "$SOURCE_ROOT"
  exit 0
fi

[[ -f "$COORDINATION_CLOSURE" ]] || { echo 'Atendimento dependency-closure attestation is required for production service mutation.' >&2; exit 78; }
coordination_run() {
  "$SOURCE_ROOT/scripts/runtime/global-coordination-mini-pc.sh" "$@" --proof-file "$coordination_proof"
}
cleanup_coordination() {
  if (( coordination_acquired == 1 && coordination_owned == 1 )); then
    coordination_run release >/dev/null 2>&1 || echo 'Unable to release the Atendimento production surface lease; it will expire fail-closed.' >&2
  fi
  /usr/bin/rm -f "$rendered"
  /usr/bin/rmdir "$render_dir" 2>/dev/null || true
}
trap cleanup_coordination EXIT INT TERM
if [[ "$COORDINATION_REUSE" == '1' ]]; then
  coordination_run check \
    --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
    --closure-file "$COORDINATION_CLOSURE" >/dev/null
else
  coordination_run acquire \
    --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
    --closure-file "$COORDINATION_CLOSURE" --operation mutation \
    --idempotency-key "mini-pc:deploy:atendimento:production:install:$RELEASE_SHA:$$" >/dev/null
fi
coordination_acquired=1
if [[ "$COORDINATION_REUSE" == '1' ]]; then
  coordination_owned=0
else
  coordination_owned=1
fi
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null

stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
run_sudo_clean /usr/bin/install -d -m 0700 -o root -g root "$BACKUP_ROOT"
if run_sudo_clean /usr/bin/test -f "$UNIT_DEST/$SERVICE"; then
  coordination_run check \
    --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
    --closure-file "$COORDINATION_CLOSURE" >/dev/null
  run_sudo_clean /usr/bin/cp -p "$UNIT_DEST/$SERVICE" "$BACKUP_ROOT/${stamp}-$SERVICE"
fi
# Reapply the seal after any privileged release preparation and before the
# unit is installed or restarted. A failed seal leaves the current runtime
# untouched.
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --apply
run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --dry-run >/dev/null
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
run_sudo_clean /usr/bin/install -m 0644 "$rendered" "$UNIT_DEST/$SERVICE"
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
run_sudo_clean /usr/bin/systemctl daemon-reload
# `enable --now` does not replace an active legacy instance. Restart only this
# dedicated service after its immutable unit is installed.
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
run_sudo_clean /usr/bin/systemctl enable "$SERVICE" >/dev/null
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
run_sudo_clean /usr/bin/systemctl restart "$SERVICE"
run_sudo_clean /usr/bin/systemctl is-active --quiet "$SERVICE"
printf 'installed=true service=%s release_sha=%s shared_restart=false\n' "$SERVICE" "$RELEASE_SHA"
