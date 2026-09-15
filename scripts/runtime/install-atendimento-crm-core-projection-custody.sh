#!/usr/bin/bash -p
set -euo pipefail

# Installs only one fixed root helper. It neither starts a service nor changes
# database data, Core, Cloudflare, Pages, routing, runtime writers, or sudoers.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

# This is deliberately distinct from the externally-custodied staging baseline
# helper.  The preflight installer must never replace the helper invoked by
# atendimento-crm-core-projection-backfill.yml with `prepare-staging-baseline`.
readonly HELPER='/usr/local/sbin/skincos-preflight-atendimento-crm-core-source-metadata'
readonly CONFIG_FILE='/etc/skincos/crm-core-projection-exporter.env'
readonly HELPER_ACTION='preflight-source-metadata'

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && /usr/bin/pwd -P)"
SOURCE_ROOT="$ROOT_DIR"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-atendimento-crm-core-projection-custody.sh \
  [--source-root /opt/skincos/releases/<full-sha>/source] [--apply]

Without --apply, validates the fixed helper contract and source syntax only.
With --apply, installs the root-owned helper bound to one immutable release.
It does not provision a database credential, run a preflight, start or restart
a service, alter data, deliver a projection, publish a route, or change a
legacy writer. The helper itself fails closed until its root-only config exists.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root)
      [[ $# -ge 2 ]] || { echo '--source-root requires a value' >&2; exit 64; }
      SOURCE_ROOT="$2"
      shift 2
      ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
done

if [[ "$APPLY" == '1' ]]; then
  [[ "$SOURCE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
    echo '--apply requires an immutable /opt/skincos/releases/<40-hex-sha>/source path' >&2
    exit 64
  }
else
  [[ "$SOURCE_ROOT" == "$ROOT_DIR" || "$SOURCE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
    echo '--source-root must be this checkout or an immutable release path' >&2
    exit 64
  }
fi

readonly CLI="$SOURCE_ROOT/crm/api/scripts/preflight-atendimento-crm-core-projection-source.mjs"
readonly PREFLIGHT_MODULE="$SOURCE_ROOT/crm/api/server/atendimento/projectionSourceMetadataPreflight.js"
readonly EXPORTER_MODULE="$SOURCE_ROOT/integration/atendimento/crm-core-projection-exporter/src/atendimentoProjectionExporter.mjs"
readonly SOURCE_MODULE="$SOURCE_ROOT/integration/atendimento/crm-core-projection-exporter/src/atendimentoConfirmedUnitScopedProjectionSource.mjs"
readonly POLICY_MODULE="$SOURCE_ROOT/shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js"
readonly SOURCE_CONTRACT_MODULE="$SOURCE_ROOT/shared/crm-auth/atendimentoCrmCoreProjectionSourceContract.js"
readonly INSTALLER_SOURCE="$ROOT_DIR/scripts/runtime/install-atendimento-crm-core-projection-custody.sh"
readonly REQUIRED_SOURCE_FILES=("$CLI" "$PREFLIGHT_MODULE" "$EXPORTER_MODULE" "$SOURCE_MODULE" "$POLICY_MODULE" "$SOURCE_CONTRACT_MODULE")

for required in "${REQUIRED_SOURCE_FILES[@]}"; do
  [[ -f "$required" && ! -L "$required" ]] || { echo "Required CRM projection preflight source is missing: $required" >&2; exit 78; }
done

for binary in /usr/bin/bash /usr/bin/node /usr/bin/install /usr/bin/mktemp /usr/bin/stat /usr/bin/chmod /usr/bin/chown /usr/bin/env /usr/bin/timeout; do
  [[ -x "$binary" ]] || { echo "Required binary is missing: $binary" >&2; exit 78; }
done

/usr/bin/bash -n "$INSTALLER_SOURCE"
/usr/bin/node --check "$CLI"
/usr/bin/node --check "$PREFLIGHT_MODULE"
/usr/bin/node --check "$SOURCE_CONTRACT_MODULE"

if [[ "$APPLY" != '1' ]]; then
  printf 'atendimento_crm_core_projection_custody_contract=valid action=%s config=%s apply=false\n' "$HELPER_ACTION" "$CONFIG_FILE"
  exit 0
fi

[[ "$(/usr/bin/id -u)" == '0' ]] || { echo '--apply requires root' >&2; exit 78; }

assert_root_owned_immutable() {
  local path="$1"
  local label="$2"
  local metadata uid gid mode links
  [[ -f "$path" && ! -L "$path" ]] || { echo "$label must be a regular non-symlink file: $path" >&2; exit 78; }
  metadata="$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$path")"
  IFS=':' read -r uid gid mode links <<<"$metadata"
  [[ "$uid" == '0' && "$gid" == '0' && "$links" == '1' && "$mode" =~ ^[0-7]{3,4}$ && $((8#$mode & 18)) == 0 ]] || {
    echo "$label is not root-owned immutable source: $path" >&2
    exit 78
  }
}

assert_root_owned_directory() {
  local path="$1"
  local label="$2"
  local metadata uid gid mode
  [[ -d "$path" && ! -L "$path" ]] || { echo "$label must be a real directory: $path" >&2; exit 78; }
  metadata="$(/usr/bin/stat -c '%u:%g:%a' -- "$path")"
  IFS=':' read -r uid gid mode <<<"$metadata"
  [[ "$uid" == '0' && "$gid" == '0' && "$mode" =~ ^[0-7]{3,4}$ && $((8#$mode & 18)) == 0 ]] || {
    echo "$label is not root-owned and non-writable: $path" >&2
    exit 78
  }
}

assert_root_owned_directory "$SOURCE_ROOT" 'CRM projection release source'
for required in "${REQUIRED_SOURCE_FILES[@]}"; do
  assert_root_owned_immutable "$required" 'CRM projection preflight source'
done

helper_stage="$(/usr/bin/mktemp /var/tmp/skincos-preflight-atendimento-crm-core-source-metadata.XXXXXX)"
cleanup_helper_stage() { /usr/bin/rm -f -- "$helper_stage"; }
trap cleanup_helper_stage EXIT INT TERM

cat >"$helper_stage" <<EOF
#!/usr/bin/bash -p
set -euo pipefail
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="\$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \\
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy
readonly RELEASE_SOURCE='$SOURCE_ROOT'
readonly CONFIG_FILE='$CONFIG_FILE'
readonly ACTION='$HELPER_ACTION'
readonly CLI="\$RELEASE_SOURCE/crm/api/scripts/preflight-atendimento-crm-core-projection-source.mjs"

fail() { echo "\$1" >&2; exit 78; }
[[ \$# == 1 && "\${1:-}" == "\$ACTION" ]] || { echo 'CRM projection custody action is invalid' >&2; exit 64; }
[[ -d "\$RELEASE_SOURCE" && ! -L "\$RELEASE_SOURCE" && -f "\$CLI" && ! -L "\$CLI" ]] || fail 'CRM projection custody release is unavailable'
release_metadata="\$(/usr/bin/stat -c '%u:%g:%a' -- "\$RELEASE_SOURCE" 2>/dev/null || true)"
IFS=':' read -r release_uid release_gid release_mode <<<"\$release_metadata"
[[ "\$release_uid" == '0' && "\$release_gid" == '0' && "\$release_mode" =~ ^[0-7]{3,4}$ && \$((8#\$release_mode & 18)) == 0 ]] || fail 'CRM projection custody release is not immutable'
cli_metadata="\$(/usr/bin/stat -c '%u:%g:%a:%h' -- "\$CLI" 2>/dev/null || true)"
IFS=':' read -r cli_uid cli_gid cli_mode cli_links <<<"\$cli_metadata"
[[ "\$cli_uid" == '0' && "\$cli_gid" == '0' && "\$cli_links" == '1' && "\$cli_mode" =~ ^[0-7]{3,4}$ && \$((8#\$cli_mode & 18)) == 0 ]] || fail 'CRM projection custody release is not immutable'
[[ -f "\$CONFIG_FILE" && ! -L "\$CONFIG_FILE" ]] || fail 'CRM projection exporter config must be a regular file'
metadata="\$(/usr/bin/stat -c '%u:%g:%a:%h' -- "\$CONFIG_FILE" 2>/dev/null || true)"
[[ "\$metadata" == '0:0:600:1' ]] || fail 'CRM projection exporter config must be root:root mode 0600'

database_url=''
seen=0
while IFS= read -r raw || [[ -n "\$raw" ]]; do
  line="\$raw"
  [[ "\$line" =~ ^[[:space:]]*$ || "\$line" =~ ^[[:space:]]*# ]] && continue
  [[ "\$line" =~ ^[[:space:]]*CRM_CORE_PROJECTION_EXPORTER_DATABASE_URL=(.*)$ ]] || fail 'CRM projection exporter config contains an unsupported key'
  (( seen == 0 )) || fail 'CRM projection exporter config repeats its database key'
  database_url="\${BASH_REMATCH[1]}"
  database_url="\${database_url#\"\${database_url%%[![:space:]]*}\"}"
  database_url="\${database_url%\"\${database_url##*[![:space:]]}\"}"
  if [[ "\$database_url" =~ ^\".*\"$ || "\$database_url" =~ ^\'.*\'$ ]]; then
    database_url="\${database_url:1:-1}"
  fi
  # Bash variables cannot carry NUL bytes. Reject the line-breaking controls
  # that could change this one-key custody format without testing an empty
  # NUL pattern, which would otherwise reject every valid value.
  [[ -n "\$database_url" && "\$database_url" != *\$'\\n'* && "\$database_url" != *\$'\\r'* ]] || fail 'CRM projection exporter database URL is invalid'
  seen=1
done < "\$CONFIG_FILE"
[[ \$seen == 1 ]] || fail 'CRM projection exporter config is missing its database key'

exec /usr/bin/env -i \\
  HOME=/root \\
  PATH="\$SAFE_PATH" \\
  NODE_ENV=production \\
  CRM_CORE_PROJECTION_EXPORTER_DATABASE_URL="\$database_url" \\
  /usr/bin/timeout --signal=KILL 180s \\
  /usr/bin/node "\$CLI"
EOF

/usr/bin/chmod 0700 "$helper_stage"
/usr/bin/bash -n "$helper_stage"
/usr/bin/install -o root -g root -m 0700 "$helper_stage" "$HELPER"
/usr/bin/rm -f -- "$helper_stage"
trap - EXIT INT TERM

printf 'atendimento_crm_core_projection_custody=installed action=%s release_source=%s services_changed=false\n' "$HELPER_ACTION" "$SOURCE_ROOT"
