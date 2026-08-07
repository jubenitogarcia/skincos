#!/usr/bin/env bash
set -euo pipefail

# Install only the immutable isolated Atendimento unit.  Every destination is
# fixed; no Environment or GitHub value is evaluated as a command or path.
readonly UNIT_DEST='/etc/systemd/system'
readonly STATE_ROOT='/var/lib/skincos-runtime'
readonly CONFIG_ROOT='/etc/skincos'
readonly LOG_ROOT='/var/log/skincos'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/production-readonly'

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
readonly UNIT_SRC="$SOURCE_ROOT/ops/runtime/units/crm-atendimento-production.service"
readonly RUNTIME_ENTRYPOINT="$SOURCE_ROOT/crm/api/server/atendimentoRuntime.js"
readonly RELEASE_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
readonly RELEASE_MANIFEST="$STATE_ROOT/crm-atendimento-production/release-manifests/$RELEASE_SHA.json"

for command_name in sudo sed systemd-analyze mktemp install grep node; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing $command_name" >&2; exit 1; }
done
sudo -n true
sudo -n test -f "$UNIT_SRC" || { echo 'Isolated unit template is unavailable in immutable release.' >&2; exit 78; }
sudo -n test -f "$RUNTIME_ENTRYPOINT" || { echo 'Isolated runtime entrypoint is unavailable in immutable release.' >&2; exit 78; }
sudo -n test -f "$RELEASE_VALIDATOR" || { echo 'Immutable release validator is unavailable.' >&2; exit 78; }
sudo -n test -f "$RELEASE_MANIFEST" || { echo 'Release must be registered before the production unit can be installed.' >&2; exit 78; }
sudo -n /usr/bin/node "$RELEASE_VALIDATOR" --source-root "$SOURCE_ROOT" --release-sha "$RELEASE_SHA" >/dev/null
sudo -n grep -Fq "\"releaseSha\":\"$RELEASE_SHA\"" "$RELEASE_MANIFEST" || { echo 'Registered release manifest SHA mismatch.' >&2; exit 78; }
sudo -n grep -Fq '"readOnly":true' "$RELEASE_MANIFEST" || { echo 'Registered release manifest is not read-only.' >&2; exit 78; }

render_dir="$(mktemp -d)"
rendered="$render_dir/crm-atendimento-production.service"
trap 'rm -f "$rendered"; rmdir "$render_dir" 2>/dev/null || true' EXIT
sed \
  -e "s|__REPO_ROOT__|$SOURCE_ROOT|g" \
  -e "s|__STATE_ROOT__|$STATE_ROOT|g" \
  -e "s|__CONFIG_ROOT__|$CONFIG_ROOT|g" \
  -e "s|__LOG_ROOT__|$LOG_ROOT|g" \
  -e "s|__RELEASE_SHA__|$RELEASE_SHA|g" \
  "$UNIT_SRC" >"$rendered"
chmod 0644 "$rendered"
systemd-analyze verify "$rendered"

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true service=crm-atendimento-production.service release_sha=%s source=%s shared_restart=false\n' "$RELEASE_SHA" "$SOURCE_ROOT"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"
if sudo -n test -f "$UNIT_DEST/crm-atendimento-production.service"; then
  sudo -n cp -p "$UNIT_DEST/crm-atendimento-production.service" "$BACKUP_ROOT/${stamp}-crm-atendimento-production.service"
fi
sudo -n install -m 0644 "$rendered" "$UNIT_DEST/crm-atendimento-production.service"
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now crm-atendimento-production.service >/dev/null
sudo -n systemctl is-active --quiet crm-atendimento-production.service
printf 'installed=true service=crm-atendimento-production.service release_sha=%s shared_restart=false\n' "$RELEASE_SHA"
