#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

# This installer deliberately shares the production shape but never receives a
# command, source path or unit destination from an environment variable.
readonly UNIT_DEST='/etc/systemd/system'
readonly STATE_ROOT='/var/lib/skincos-runtime'
readonly CONFIG_ROOT='/etc/skincos'
readonly LOG_ROOT='/var/log/skincos'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/staging'
readonly CONTROL_FILE="$CONFIG_ROOT/atendimento-staging/module-control.json"
readonly SERVICE='crm-atendimento-staging.service'

SOURCE_ROOT=''
APPLY=0

usage() { echo "Usage: $0 --source-root /opt/skincos/releases/<full-sha>/source [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root) shift; SOURCE_ROOT="${1:-}" ;;
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
readonly UNIT_SRC="$SOURCE_ROOT/ops/runtime/units/crm-atendimento-staging.service"
readonly RUNTIME_ENTRYPOINT="$SOURCE_ROOT/crm/api/server/atendimentoRuntime.js"
readonly RELEASE_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
readonly CONTROL_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-staging-control.mjs"
readonly RUNTIME_GRANT_LOCKDOWN="$SOURCE_ROOT/scripts/lockdown-atendimento-staging-runtime.sh"
readonly COORDINATION_CLOSURE="$SOURCE_ROOT/.skincos-global-coordination-atendimento.json"
readonly RELEASE_MANIFEST="$SOURCE_ROOT/.skincos-atendimento-release.json"
coordination_proof="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-/var/lib/skincos-runtime/global-coordination/atendimento-staging-$RELEASE_SHA-$$.json}"
coordination_acquired=0

for command_path in /usr/bin/sudo /usr/bin/sed /usr/bin/systemd-analyze /usr/bin/mktemp /usr/bin/install /usr/bin/node /usr/bin/chmod /usr/bin/rm /usr/bin/rmdir /usr/bin/date /usr/bin/cp /usr/bin/cmp /usr/bin/stat /usr/bin/systemctl /usr/bin/test; do
  [[ -x "$command_path" ]] || { echo "Missing $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n true
/usr/bin/sudo -n /usr/bin/test -f "$UNIT_SRC" || { echo 'Isolated unit template is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$RUNTIME_ENTRYPOINT" || { echo 'Isolated runtime entrypoint is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$RELEASE_VALIDATOR" || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$CONTROL_VALIDATOR" || { echo 'Strict staging control validator is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -x "$RUNTIME_GRANT_LOCKDOWN" || { echo 'Staging runtime grant lockdown is unavailable in immutable release.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$CONTROL_FILE" || { echo 'Strict staging control file is unavailable.' >&2; exit 78; }
/usr/bin/sudo -n /usr/bin/test -f "$RELEASE_MANIFEST" || { echo 'Staging release surface manifest is unavailable.' >&2; exit 78; }
readonly RELEASE_SURFACE="$(run_sudo_clean /usr/bin/node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const surface=Object.prototype.hasOwnProperty.call(value,"surface") ? String(value.surface||"") : "clientes"; if (!/^(clientes|full)$/.test(surface)) process.exit(78); process.stdout.write(surface);' "$RELEASE_MANIFEST")"
run_sudo_clean /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$SOURCE_ROOT" --release-sha "$RELEASE_SHA" --target staging --surface "$RELEASE_SURFACE" >/dev/null
run_sudo_clean /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$RELEASE_SHA" --surface "$RELEASE_SURFACE" >/dev/null
run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --dry-run >/dev/null

umask 0077
render_dir="$(/usr/bin/mktemp -d /tmp/atendimento-staging-unit.XXXXXX)"
/usr/bin/test -d "$render_dir" -a -O "$render_dir"
rendered="$render_dir/crm-atendimento-staging.service"
unit_backup_path=''
unit_backup_committed=0
cleanup_artifacts() {
  /usr/bin/rm -f "$rendered"
  /usr/bin/rmdir "$render_dir" 2>/dev/null || true
  if [[ "$unit_backup_committed" != '1' && "$unit_backup_path" =~ ^/var/backups/skincos/clientes/staging/[0-9]{8}T[0-9]{6}Z-crm-atendimento-staging\.[A-Za-z0-9]{6}\.service$ ]]; then
    run_sudo_clean /usr/bin/rm -f -- "$unit_backup_path" || true
  fi
}
trap cleanup_artifacts EXIT
run_sudo_clean /usr/bin/sed \
  -e "s|__REPO_ROOT__|$SOURCE_ROOT|g" \
  -e "s|__STATE_ROOT__|$STATE_ROOT|g" \
  -e "s|__CONFIG_ROOT__|$CONFIG_ROOT|g" \
  -e "s|__LOG_ROOT__|$LOG_ROOT|g" \
  -e "s|__ATENDIMENTO_SURFACE__|$RELEASE_SURFACE|g" \
  -e "s|__RELEASE_SHA__|$RELEASE_SHA|g" \
  "$UNIT_SRC" >"$rendered"
/usr/bin/chmod 0644 "$rendered"
/usr/bin/systemd-analyze verify "$rendered"

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true service=crm-atendimento-staging.service release_sha=%s surface=%s source=%s shared_restart=false\n' "$RELEASE_SHA" "$RELEASE_SURFACE" "$SOURCE_ROOT"
  exit 0
fi

[[ -f "$COORDINATION_CLOSURE" ]] || { echo 'Atendimento dependency-closure attestation is required for staging service mutation.' >&2; exit 78; }
coordination_run() {
  "$SOURCE_ROOT/scripts/runtime/global-coordination-mini-pc.sh" "$@" --proof-file "$coordination_proof"
}
cleanup_coordination() {
  if (( coordination_acquired == 1 )); then
    coordination_run release >/dev/null 2>&1 || echo 'Unable to release the Atendimento staging surface lease; it will expire fail-closed.' >&2
  fi
  /usr/bin/rm -f "$rendered"
  /usr/bin/rmdir "$render_dir" 2>/dev/null || true
  if [[ "$unit_backup_committed" != '1' && "$unit_backup_path" =~ ^/var/backups/skincos/clientes/staging/[0-9]{8}T[0-9]{6}Z-crm-atendimento-staging\.[A-Za-z0-9]{6}\.service$ ]]; then
    run_sudo_clean /usr/bin/rm -f -- "$unit_backup_path" || true
  fi
}
trap cleanup_coordination EXIT INT TERM
coordination_run acquire \
  --resource deploy:atendimento:staging --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" --operation mutation \
  --idempotency-key "mini-pc:deploy:atendimento:staging:install:$RELEASE_SHA:$$" >/dev/null
coordination_acquired=1
coordination_run check \
  --resource deploy:atendimento:staging --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null

stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
coordination_run check \
  --resource deploy:atendimento:staging --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
/usr/bin/sudo -n /usr/bin/install -d -m 0700 -o root -g root "$BACKUP_ROOT"
unit_backup='none'
if /usr/bin/sudo -n /usr/bin/test -f "$UNIT_DEST/$SERVICE"; then
  # Pre-create a root-private, unique destination. A second installer in the
  # same timestamp cannot overwrite the rollback evidence captured by the
  # first one.
  unit_backup_path="$(run_sudo_clean /usr/bin/mktemp "$BACKUP_ROOT/${stamp}-crm-atendimento-staging.XXXXXX.service")"
  [[ "$unit_backup_path" =~ ^/var/backups/skincos/clientes/staging/[0-9]{8}T[0-9]{6}Z-crm-atendimento-staging\.[A-Za-z0-9]{6}\.service$ ]] || {
    echo 'Unit backup path was not generated from the fixed unique contract.' >&2
    exit 78
  }
  run_sudo_clean /usr/bin/test -f "$unit_backup_path"
  run_sudo_clean /usr/bin/test -O "$unit_backup_path"
  unit_backup="${unit_backup_path##*/}"
  coordination_run check \
    --resource deploy:atendimento:staging --module atendimento --source "$RELEASE_SHA" \
    --closure-file "$COORDINATION_CLOSURE" >/dev/null
  run_sudo_clean /usr/bin/cp -p "$UNIT_DEST/$SERVICE" "$unit_backup_path"
  unit_backup_metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$unit_backup_path")"
  [[ "$unit_backup_metadata" == 'root:root:644' ]] || {
    echo 'Unit backup ownership or mode does not satisfy the rollback contract.' >&2
    exit 78
  }
  run_sudo_clean /usr/bin/cmp -s "$UNIT_DEST/$SERVICE" "$unit_backup_path" || {
    echo 'Unit backup did not preserve the current isolated service definition.' >&2
    exit 78
  }
  unit_backup_committed=1
fi
coordination_run check \
  --resource deploy:atendimento:staging --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
/usr/bin/sudo -n /usr/bin/install -m 0644 "$rendered" "$UNIT_DEST/$SERVICE"
coordination_run check \
  --resource deploy:atendimento:staging --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
/usr/bin/sudo -n /usr/bin/systemctl daemon-reload
# `enable --now` does not replace an already active legacy instance. Restart
# only this dedicated staging unit after the immutable unit file is installed;
# no shared CRM, worker, Orb or tunnel unit is touched.
coordination_run check \
  --resource deploy:atendimento:staging --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
/usr/bin/sudo -n /usr/bin/systemctl enable "$SERVICE" >/dev/null
/usr/bin/sudo -n /usr/bin/true
coordination_run check \
  --resource deploy:atendimento:staging --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
/usr/bin/sudo -n /usr/bin/systemctl restart "$SERVICE"
/usr/bin/sudo -n /usr/bin/systemctl is-active --quiet "$SERVICE"
printf 'installed=true service=%s release_sha=%s surface=%s unit_backup=%s shared_restart=false\n' "$SERVICE" "$RELEASE_SHA" "$RELEASE_SURFACE" "$unit_backup"
