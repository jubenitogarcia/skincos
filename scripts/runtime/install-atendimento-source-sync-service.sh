#!/usr/bin/bash -p
set -euo pipefail

# Install only the dedicated source-sync units. This never starts or restarts
# the HTTP runtime, shared CRM, jobs, Orb, tunnel or Cloudflare unit.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

readonly UNIT_DEST='/etc/systemd/system'
readonly CONFIG_ROOT='/etc/skincos'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/source-sync-runtime'
readonly DATA_BACKUP_ROOT='/var/backups/skincos/clientes/production-source-sync'
readonly LOG_ROOT='/var/log/skincos'
readonly SERVICE='crm-atendimento-source-sync.service'
readonly TIMER='crm-atendimento-source-sync.timer'
readonly SOURCE_ENV="$CONFIG_ROOT/crm-atendimento-source-sync.env"

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && /usr/bin/pwd -P)"
SOURCE_ROOT="$ROOT_DIR"
APPLY=0
ENABLE=0
COORDINATION_PROOF_FILE=''
COORDINATION_REUSE=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-atendimento-source-sync-service.sh \
  [--source-root /opt/skincos/releases/<full-sha>/source] \
  [--coordination-proof-file <private-proof>] [--coordination-reuse] \
  [--apply] [--enable]

Without --apply, renders both units and verifies them with systemd-analyze.
--apply installs the units and reloads systemd; it never starts a service.
--enable additionally enables the timer, but does not trigger an immediate
run. The private source environment must already exist before --enable.
Production source data remains fail-closed until that environment selects
apply and confirms it explicitly.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root)
      [[ "$#" -ge 2 ]] || { echo '--source-root requires a value' >&2; exit 64; }
      SOURCE_ROOT="$2"
      shift 2
      continue
      ;;
    --coordination-proof-file)
      [[ "$#" -ge 2 ]] || { echo '--coordination-proof-file requires a value' >&2; exit 64; }
      COORDINATION_PROOF_FILE="$2"
      shift 2
      continue
      ;;
    --coordination-reuse) COORDINATION_REUSE=1 ;;
    --apply) APPLY=1 ;;
    --enable) ENABLE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

if [[ "$ENABLE" == '1' && "$APPLY" != '1' ]]; then
  echo '--enable requires --apply' >&2
  exit 64
fi

if [[ "$APPLY" == '1' ]]; then
  [[ "$SOURCE_ROOT" =~ ^/opt/skincos/releases/([0-9a-f]{40})/source$ ]] || {
    echo '--apply requires an immutable /opt/skincos/releases/<40-hex-sha>/source path' >&2
    exit 64
  }
else
  [[ "$SOURCE_ROOT" == "$ROOT_DIR" || "$SOURCE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
    echo '--source-root must be the checkout or an immutable release path' >&2
    exit 64
  }
fi

readonly RELEASE_SHA="$(basename "$(dirname "$SOURCE_ROOT")")"
if [[ "$SOURCE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]]; then
  [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Immutable release SHA is invalid.' >&2; exit 78; }
fi
readonly UNIT_SRC="$SOURCE_ROOT/ops/runtime/units/$SERVICE"
readonly TIMER_SRC="$SOURCE_ROOT/ops/runtime/units/$TIMER"
readonly RUNNER="$SOURCE_ROOT/crm/api/scripts/run-atendimento-source-sync.mjs"
readonly COORDINATION_CLOSURE="$SOURCE_ROOT/.skincos-global-coordination-atendimento.json"
coordination_proof="${COORDINATION_PROOF_FILE:-${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-/var/lib/skincos-runtime/global-coordination/atendimento-source-sync-$RELEASE_SHA-$$.json}}"
coordination_acquired=0
coordination_owned=0

for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/sed /usr/bin/systemd-analyze /usr/bin/mktemp /usr/bin/install /usr/bin/chmod /usr/bin/rm /usr/bin/rmdir /usr/bin/date /usr/bin/cp /usr/bin/stat /usr/bin/systemctl /usr/bin/setfacl /usr/bin/test /usr/bin/bash; do
  [[ -x "$command_path" ]] || { echo "Missing $command_path" >&2; exit 1; }
done
[[ -f "$UNIT_SRC" && -f "$TIMER_SRC" && -f "$RUNNER" ]] || {
  echo 'Atendimento source-sync unit or runner is unavailable in the selected source.' >&2
  exit 78
}

if [[ "$APPLY" == '1' ]]; then
  /usr/bin/sudo -n true
  [[ -f "$COORDINATION_CLOSURE" ]] || {
    echo 'Atendimento dependency-closure attestation is required for production unit mutation.' >&2
    exit 78
  }
  if [[ "$ENABLE" == '1' ]]; then
    run_sudo_clean /usr/bin/test -f "$SOURCE_ENV" || {
      echo "Private source environment is required before enabling the timer: $SOURCE_ENV" >&2
      exit 78
    }
    env_metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$SOURCE_ENV")"
    [[ "$env_metadata" == 'root:skincos:640' ]] || {
      echo 'Private source environment must be root:skincos mode 0640.' >&2
      exit 78
    }
  fi
fi

escape() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
umask 0077
render_dir="$(/usr/bin/mktemp -d /tmp/atendimento-source-sync-unit.XXXXXX)"
rendered_service="$render_dir/$SERVICE"
rendered_timer="$render_dir/$TIMER"
cleanup_render() {
  /usr/bin/rm -f "$rendered_service" "$rendered_timer"
  /usr/bin/rmdir "$render_dir" 2>/dev/null || true
  if [[ "$coordination_acquired" == '1' && "$coordination_owned" == '1' ]]; then
    coordination_run release >/dev/null 2>&1 || echo 'Unable to release the Atendimento production surface lease; it will expire fail-closed.' >&2
  fi
}
trap cleanup_render EXIT INT TERM
/usr/bin/sed \
  -e "s|__REPO_ROOT__|$(escape "$SOURCE_ROOT")|g" \
  -e "s|__BACKUP_ROOT__|$(escape "$DATA_BACKUP_ROOT")|g" \
  -e "s|__LOG_ROOT__|$(escape "$LOG_ROOT")|g" \
  "$UNIT_SRC" >"$rendered_service"
/usr/bin/sed \
  -e "s|__REPO_ROOT__|$(escape "$SOURCE_ROOT")|g" \
  "$TIMER_SRC" >"$rendered_timer"
/usr/bin/chmod 0644 "$rendered_service" "$rendered_timer"
/usr/bin/systemd-analyze verify "$rendered_service" "$rendered_timer"

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true service=%s timer=%s source=%s shared_restart=false immediate_run=false\n' "$SERVICE" "$TIMER" "$SOURCE_ROOT"
  exit 0
fi

coordination_run() {
  "$SOURCE_ROOT/scripts/runtime/global-coordination-mini-pc.sh" "$@" --proof-file "$coordination_proof"
}
if [[ "$COORDINATION_REUSE" == '1' ]]; then
  export SKINCOS_GLOBAL_COORDINATION_REUSE=1
  export SKINCOS_GLOBAL_COORDINATION_PROOF_FILE="$coordination_proof"
  coordination_run check \
    --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
    --closure-file "$COORDINATION_CLOSURE" >/dev/null
  coordination_acquired=1
else
  coordination_run acquire \
    --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
    --closure-file "$COORDINATION_CLOSURE" --operation mutation \
    --idempotency-key "mini-pc:deploy:atendimento:production:source-sync:$RELEASE_SHA:$$" >/dev/null
  coordination_acquired=1
  coordination_owned=1
fi
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null

stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
run_sudo_clean /usr/bin/install -d -m 0700 -o root -g root "$BACKUP_ROOT"
run_sudo_clean /usr/bin/install -d -m 0770 -o root -g skincos "$DATA_BACKUP_ROOT"
run_sudo_clean /usr/bin/install -d -m 0750 -o skincos -g skincos "$LOG_ROOT/crm-atendimento-source-sync"
run_sudo_clean /usr/bin/test -d /var/backups/skincos || { echo 'Native backup parent is unavailable.' >&2; exit 78; }
run_sudo_clean /usr/bin/setfacl -m 'u:skincos:--x,g::---,m::--x' /var/backups/skincos
for pair in "$SERVICE:$rendered_service" "$TIMER:$rendered_timer"; do
  unit_name="${pair%%:*}"
  rendered_path="${pair#*:}"
  current_path="$UNIT_DEST/$unit_name"
  if run_sudo_clean /usr/bin/test -f "$current_path"; then
    coordination_run check \
      --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
      --closure-file "$COORDINATION_CLOSURE" >/dev/null
    backup_path="$(run_sudo_clean /usr/bin/mktemp "$BACKUP_ROOT/${stamp}-$unit_name.XXXXXX")"
    run_sudo_clean /usr/bin/cp -p "$current_path" "$backup_path"
  fi
  coordination_run check \
    --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
    --closure-file "$COORDINATION_CLOSURE" >/dev/null
  run_sudo_clean /usr/bin/install -m 0644 "$rendered_path" "$current_path"
done
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
run_sudo_clean /usr/bin/systemctl daemon-reload
if [[ "$ENABLE" == '1' ]]; then
  coordination_run check \
    --resource deploy:atendimento:production --module atendimento --source "$RELEASE_SHA" \
    --closure-file "$COORDINATION_CLOSURE" >/dev/null
  run_sudo_clean /usr/bin/systemctl enable "$TIMER" >/dev/null
fi
printf 'installed=true service=%s timer=%s release_sha=%s enabled=%s shared_restart=false immediate_run=false\n' "$SERVICE" "$TIMER" "$RELEASE_SHA" "$ENABLE"
