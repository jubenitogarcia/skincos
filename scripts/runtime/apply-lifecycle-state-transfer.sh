#!/usr/bin/env bash
set -euo pipefail

# Applies a Windows-initiated transfer that already resides on the native Linux
# filesystem. This script deliberately never traverses /mnt/c.

TRANSFER_ROOT=""
APPLY=0
FINAL_SYNC=0
STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-/mnt/c/CodexRuntime/artifacts}"

usage() {
  cat <<'EOF'
Usage: scripts/runtime/apply-lifecycle-state-transfer.sh --transfer-root <native-linux-path> [--apply] [--final-sync]

Validates and applies a transfer created by transfer-lifecycle-state.ps1.
The transfer root must be under the native Linux filesystem; /mnt/c is refused.
Without --apply it validates the manifest and reports the planned operation.
--final-sync overlays the final stopped-service delta; it never deletes native
or legacy content.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --transfer-root) TRANSFER_ROOT="${2:-}"; shift ;;
    --apply) APPLY=1 ;;
    --final-sync) FINAL_SYNC=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

[[ -n "$TRANSFER_ROOT" && -d "$TRANSFER_ROOT" ]] || { echo "--transfer-root must name an existing native transfer directory." >&2; exit 1; }
[[ "$TRANSFER_ROOT" != /mnt/c/* ]] || { echo "Transfer root must be native Linux storage, never /mnt/c." >&2; exit 1; }
[[ "$FINAL_SYNC" == "0" || "$APPLY" == "1" ]] || { echo "--final-sync requires --apply." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }
command -v rsync >/dev/null || { echo "rsync is required for native-to-native application." >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 1; }
command -v tar >/dev/null || { echo "tar is required." >&2; exit 1; }
command -v sudo >/dev/null || { echo "sudo is required." >&2; exit 1; }
sudo -n true

manifest="$TRANSFER_ROOT/inventory.json"
payload_archive="$TRANSFER_ROOT/payload.tar"
[[ -f "$manifest" && -f "$payload_archive" ]] || { echo "Transfer is missing inventory.json or payload.tar." >&2; exit 1; }
python3 - "$manifest" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8-sig') as handle:
    document = json.load(handle)
if document.get('schema') != 1 or document.get('mode') not in {'precopy', 'final'}:
    raise SystemExit('Unsupported lifecycle transfer manifest.')
entries = document.get('entries')
if not isinstance(entries, dict) or not entries:
    raise SystemExit('Transfer manifest has no entries.')
PY
expected_archive_sha="$(python3 - "$manifest" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8-sig') as handle:
    print(json.load(handle)['stateArchive']['sha256'])
PY
)"
actual_archive_sha="$(sha256sum "$payload_archive" | awk '{print $1}')"
[[ "$expected_archive_sha" == "$actual_archive_sha" ]] || { echo "Lifecycle state archive checksum mismatch." >&2; exit 1; }
payload="$TRANSFER_ROOT/payload"
if [[ ! -d "$payload" ]]; then
  mkdir -p "$payload"
  if ! tar -tf "$payload_archive" | awk '
    $0 !~ /^(n8n\/evolution-api\/(instances|store)|crm-api\/var|booking-api\/(chrome-profile|report|debug))(\/|$)/ { invalid=1 }
    $0 ~ /(^|\/)\.\.($|\/)/ { invalid=1 }
    END { exit invalid ? 1 : 0 }
  '; then
    echo "Lifecycle state archive contains an unexpected path." >&2
    exit 1
  fi
  tar -xf "$payload_archive" -C "$payload"
fi

copy_tree() {
  local relative="$1" destination="$2"
  local source="$payload/$relative"
  [[ -d "$source" ]] || return 0
  echo "TREE $relative -> $destination"
  [[ "$APPLY" == "1" ]] || return 0
  sudo -n install -d -o skincos -g skincos -m 0750 "$destination"
  local -a args=(-a)
  [[ "$FINAL_SYNC" == "0" ]] && args+=(--ignore-existing)
  sudo -n rsync "${args[@]}" "$source/" "$destination/"
  sudo -n chown -R skincos:skincos "$destination"
  sudo -n find "$destination" -type d -exec chmod 0750 {} +
  sudo -n find "$destination" -type f -exec chmod 0640 {} +
}

install_private_file() {
  local relative="$1" destination="$2"
  local source="$TRANSFER_ROOT/$relative"
  if [[ ! -f "$source" ]] && ! sudo -n test -f "$source"; then
    source="$(python3 - "$manifest" "$relative" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8-sig') as handle:
    value = json.load(handle).get('nativeSources', {}).get(sys.argv[2], '')
if value.startswith('/etc/skincos/') and '..' not in value.split('/'):
    print(value)
PY
)"
    [[ -n "$source" ]] && sudo -n test -f "$source" || { echo "Required transfer item missing: $relative" >&2; exit 1; }
  fi
  echo "PRIVATE $relative -> $destination"
  if [[ "$APPLY" == "1" ]]; then
    sudo -n install -D -o root -g skincos -m 0640 "$source" "$destination"
  fi
}

rewrite_credential_path() {
  local config="$1" credential="$2"
  [[ "$APPLY" == "1" ]] || return 0
  local escaped
  escaped="$(printf '%s' "$credential" | sed 's/[&|]/\\&/g')"
  sudo -n sed -i -E "s|^([[:space:]]*credentials-file:[[:space:]]*).*|\\1$escaped|" "$config"
}

copy_tree n8n/evolution-api/instances "$STATE_ROOT/messaging-whatsapp/instances"
copy_tree n8n/evolution-api/store "$STATE_ROOT/messaging-whatsapp/store"
copy_tree crm-api/var "$STATE_ROOT/crm/var"
copy_tree booking-api/chrome-profile "$STATE_ROOT/booking/chrome-profile"
copy_tree booking-api/report "$ARTIFACT_ROOT/booking/report"
copy_tree booking-api/debug "$ARTIFACT_ROOT/booking/debug"

install_private_file config/orb.env "$CONFIG_ROOT/orb.env"
install_private_file config/orb-business.env "$CONFIG_ROOT/orb-business.env"
install_private_file config/messaging-whatsapp.env "$CONFIG_ROOT/messaging-whatsapp.env"
install_private_file config/crm.env "$CONFIG_ROOT/crm.env"
install_private_file config/booking.env "$CONFIG_ROOT/booking.env"
install_private_file config/cloudflare/orb/config.yml "$CONFIG_ROOT/cloudflare/orb/config.yml"
install_private_file config/cloudflare/orb/credential.json "$CONFIG_ROOT/cloudflare-orb.json"
install_private_file config/cloudflare/runtime/config.yml "$CONFIG_ROOT/cloudflare/runtime/config.yml"
install_private_file config/cloudflare/runtime/credential.json "$CONFIG_ROOT/cloudflare-runtime.json"

if [[ "$APPLY" == "1" ]]; then
  sudo -n install -D -o root -g skincos -m 0640 /dev/stdin "$CONFIG_ROOT/cloudflare/runtime/tunnel.env" <<EOF
CLOUDFLARED_CONFIG_PATH=$CONFIG_ROOT/cloudflare/runtime/config.yml
EOF
  rewrite_credential_path "$CONFIG_ROOT/cloudflare/orb/config.yml" "$CONFIG_ROOT/cloudflare-orb.json"
  rewrite_credential_path "$CONFIG_ROOT/cloudflare/runtime/config.yml" "$CONFIG_ROOT/cloudflare-runtime.json"
  sudo -n chown -R root:skincos "$CONFIG_ROOT"
  sudo -n find "$CONFIG_ROOT" -type d -exec chmod 0750 {} +
  sudo -n find "$CONFIG_ROOT" -type f -exec chmod 0640 {} +
fi

if [[ "$APPLY" == "1" ]]; then
  echo "Lifecycle transfer $([[ "$FINAL_SYNC" == "1" ]] && echo final-sync || echo pre-copy) validated and applied."
else
  echo "Lifecycle transfer $([[ "$FINAL_SYNC" == "1" ]] && echo final-sync || echo pre-copy) validated."
fi
