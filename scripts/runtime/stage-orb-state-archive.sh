#!/usr/bin/env bash
set -euo pipefail

# Extract a Windows-produced Orb state archive once, on the native Linux
# filesystem. This deliberately replaces recursive DrvFS copies of n8n-home.
# The archive contains state only: custom-node dependencies are rebuilt from
# the package manifests on Linux.

STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
RUNTIME_USER="${SKINCOS_RUNTIME_USER:-skincos}"
NPM_CACHE="${N8N_NPM_CACHE:-$STATE_ROOT/cache/orb/npm}"
ARCHIVE=""
ARCHIVE_SHA256=""
EXTRACTED_HOME=""
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/stage-orb-state-archive.sh (--archive <state.tar> | --extracted-home <native-n8n-home>) --sha256 <sha256> [--apply]

Validates and extracts a state-only n8n-home archive into
/var/lib/skincos-runtime/staging. The archive must contain a top-level
n8n-home directory and must exclude nodes/node_modules. The helper normalizes
the custom-node lockfile only when npm proves it is inconsistent with the
declared exact dependencies, then performs npm ci with lifecycle scripts
disabled. It never changes the legacy runtime or starts/stops services.

On this Windows host, prefer --extracted-home after the Windows-native
transfer helper writes the archive through \\wsl$ into a Linux home directory.
That path avoids WSL reading the multi-gigabyte archive over /mnt/c.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --archive) ARCHIVE="${2:-}"; shift ;;
    --sha256) ARCHIVE_SHA256="${2:-}"; shift ;;
    --extracted-home) EXTRACTED_HOME="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

if [[ -n "$ARCHIVE" && -n "$EXTRACTED_HOME" ]]; then
  echo "Use either --archive or --extracted-home, not both." >&2
  exit 1
fi
if [[ -z "$ARCHIVE" && -z "$EXTRACTED_HOME" ]]; then
  echo "One of --archive or --extracted-home is required." >&2
  exit 1
fi
if [[ -n "$ARCHIVE" && ! -f "$ARCHIVE" ]]; then
  echo "--archive must name an existing file." >&2
  exit 1
fi
[[ "$ARCHIVE_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]] || { echo "--sha256 must be a SHA-256 digest." >&2; exit 1; }
require_cmd npm
require_cmd sudo
require_cmd sha256sum
if [[ -n "$ARCHIVE" ]]; then
  require_cmd tar
  require_cmd awk
  actual_sha="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
  [[ "${actual_sha,,}" == "${ARCHIVE_SHA256,,}" ]] || { echo "Orb state archive checksum mismatch." >&2; exit 1; }

  # Refuse archives that could escape the staging root or smuggle unrelated
  # paths. Listing is intentionally performed before extraction.
  if ! tar -tf "$ARCHIVE" | awk '
    $0 !~ /^n8n-home(\/|$)/ { invalid=1 }
    $0 ~ /(^|\/)\.\.($|\/)/ { invalid=1 }
    END { exit invalid ? 1 : 0 }
  '; then
    echo "Orb state archive has an invalid entry path." >&2
    exit 1
  fi
else
  actual_sha="${ARCHIVE_SHA256,,}"
  extracted_real="$(realpath "$EXTRACTED_HOME")"
  [[ "$extracted_real" != /mnt/* ]] || { echo "--extracted-home must be on the native Linux filesystem." >&2; exit 1; }
  EXTRACTED_HOME="$extracted_real"
fi

staging_root="$STATE_ROOT/staging"
stage_id="orb-n8n-home-${actual_sha:0:16}"
stage_dir="$staging_root/$stage_id"
home="$stage_dir/n8n-home"

validate_staged_home() {
  local candidate="$1"
  sudo -n test -f "$candidate/.n8n/config" || { echo "Missing n8n config in staged state." >&2; return 1; }
  sudo -n test -f "$candidate/database.sqlite" || { echo "Missing n8n runtime database in staged state." >&2; return 1; }
  sudo -n test -d "$candidate/storage" || { echo "Missing n8n storage in staged state." >&2; return 1; }
  sudo -n test -f "$candidate/nodes/package.json" && sudo -n test -f "$candidate/nodes/package-lock.json" || {
    echo "Missing custom-node package manifests in staged state." >&2; return 1;
  }
  ! sudo -n test -e "$candidate/nodes/node_modules" && ! sudo -n test -e "$candidate/.n8n/nodes/node_modules" || {
    echo "State archive must not contain Windows custom-node dependencies." >&2; return 1;
  }
}

if [[ "$APPLY" != "1" ]]; then
  [[ -n "$ARCHIVE" ]] && echo "Verified archive checksum: $actual_sha"
  [[ -n "$EXTRACTED_HOME" ]] && echo "Verified Windows transfer checksum: $actual_sha"
  echo "Would stage native Orb state at: $stage_dir"
  exit 0
fi

sudo -n true
id "$RUNTIME_USER" >/dev/null 2>&1 || { echo "Runtime user does not exist: $RUNTIME_USER" >&2; exit 1; }
sudo -n install -d -o "$RUNTIME_USER" -g "$RUNTIME_USER" -m 0750 "$staging_root"
if sudo -n test -e "$stage_dir"; then
  sudo -n test -f "$home/.n8n/config" && sudo -n test -f "$home/database.sqlite" &&
    sudo -n test -d "$home/storage" && sudo -n test -f "$home/nodes/package.json" &&
    sudo -n test -f "$home/nodes/package-lock.json" && sudo -n test -d "$home/nodes/node_modules" &&
    sudo -n test -L "$home/.n8n/nodes/node_modules" &&
    sudo -n grep -Fx "archive_sha256=$actual_sha" "$home/state-archive.manifest" >/dev/null || {
      echo "Refusing to reuse incomplete or mismatched staged Orb state: $stage_dir" >&2
      exit 1
    }
  echo "STAGED_ORB_STATE_HOME=$home"
  exit 0
fi

temporary_dir="$(sudo -n mktemp -d "$staging_root/.${stage_id}.XXXXXX")"
sudo -n chown "$RUNTIME_USER:$RUNTIME_USER" "$temporary_dir"
preserve_temporary=0
cleanup() {
  if [[ "$preserve_temporary" == "1" ]]; then
    echo "Preserved failed native staging at $temporary_dir" >&2
  else
    sudo -n rm -rf "$temporary_dir"
  fi
}
trap cleanup EXIT
if [[ -n "$ARCHIVE" ]]; then
  sudo -n tar -xf "$ARCHIVE" -C "$temporary_dir"
else
  validate_staged_home "$EXTRACTED_HOME"
  sudo -n mv "$EXTRACTED_HOME" "$temporary_dir/n8n-home"
  preserve_temporary=1
fi
validate_staged_home "$temporary_dir/n8n-home"
sudo -n chown -R "$RUNTIME_USER:$RUNTIME_USER" "$temporary_dir"

# The legacy runtime can contain a stale root lock entry even though its
# package.json pins the version in use. npm install --package-lock-only changes
# only the lock representation; npm ci then gives the native runtime a fully
# deterministic dependency tree without executing package lifecycle scripts.
nodes_dir="$temporary_dir/n8n-home/nodes"
before_lock="$(sudo -n sha256sum "$nodes_dir/package-lock.json" | awk '{print $1}')"
sudo -n install -d -o "$RUNTIME_USER" -g "$RUNTIME_USER" -m 0750 "$NPM_CACHE"
sudo -n -u "$RUNTIME_USER" env \
  npm_config_cache="$NPM_CACHE" npm_config_audit=false npm_config_fund=false npm_config_ignore_scripts=true \
  npm install --package-lock-only --ignore-scripts --prefix "$nodes_dir" >/dev/null
after_lock="$(sudo -n sha256sum "$nodes_dir/package-lock.json" | awk '{print $1}')"
sudo -n -u "$RUNTIME_USER" env \
  npm_config_cache="$NPM_CACHE" npm_config_audit=false npm_config_fund=false npm_config_ignore_scripts=true \
  npm ci --omit=dev --ignore-scripts --prefix "$nodes_dir" >/dev/null

sudo -n mkdir -p "$temporary_dir/n8n-home/.n8n/nodes"
sudo -n ln -s ../../nodes/node_modules "$temporary_dir/n8n-home/.n8n/nodes/node_modules"
sudo -n chown -h "$RUNTIME_USER:$RUNTIME_USER" "$temporary_dir/n8n-home/.n8n/nodes/node_modules"
sudo -n tee "$temporary_dir/n8n-home/state-archive.manifest" >/dev/null <<EOF
archive_sha256=$actual_sha
package_lock_before_sha256=$before_lock
package_lock_after_sha256=$after_lock
EOF
sudo -n chown "$RUNTIME_USER:$RUNTIME_USER" "$temporary_dir/n8n-home/state-archive.manifest"
sudo -n mv "$temporary_dir" "$stage_dir"
preserve_temporary=0
trap - EXIT
echo "STAGED_ORB_STATE_HOME=$home"
