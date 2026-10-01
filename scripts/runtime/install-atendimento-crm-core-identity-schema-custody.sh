#!/usr/bin/bash -p
set -euo pipefail

# Installs one fixed, root-owned helper. It deliberately performs no database
# operation itself: schema application remains an explicit helper action.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy \
  GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
  GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_ATTR_NOSYSTEM GIT_EXEC_PATH \
  NODE_OPTIONS NODE_PATH NPM_CONFIG_USERCONFIG NPM_CONFIG_GLOBALCONFIG \
  npm_config_userconfig npm_config_globalconfig

readonly HELPER='/usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging'
readonly SUDOERS_FILE='/etc/sudoers.d/skincos-atendimento-crm-core-identity-schema-custody'
readonly STATE_ROOT='/var/lib/skincos-runtime/crm-core-identity-schema-custody'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/staging'
readonly RUNNER_UNIT='skincos-native-custody-runner.service'

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && /usr/bin/pwd -P)"
SOURCE_ROOT="$ROOT_DIR"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-atendimento-crm-core-identity-schema-custody.sh \
  [--source-root /opt/skincos/releases/<full-sha>/source] [--apply]

Without --apply, validates the fixed helper and native-custody-runner contract.
With --apply, root binds the helper to exactly one immutable staging release,
installs its literal sudoers policy, creates only private custody state
directories, and reloads/restarts only skincos-native-custody-runner.service.
It does not read credentials, apply a migration, start/stop CRM, alter data,
write identities, backfill, change database privileges, publish an external
deployment, or touch production.
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

readonly TEMPLATE="$SOURCE_ROOT/scripts/runtime/atendimento-crm-core-identity-schema-custody-wrapper.sh.template"
readonly RUNNER="$SOURCE_ROOT/crm/api/scripts/run-atendimento-crm-core-identity-schema-staging.mjs"
readonly RELEASE_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-release.mjs"
readonly CONTROL_VALIDATOR="$SOURCE_ROOT/crm/api/scripts/validate-atendimento-staging-control.mjs"
readonly BACKUP_SCRIPT="$SOURCE_ROOT/scripts/backup-atendimento-staging.sh"
readonly COORDINATION_ADAPTER="$SOURCE_ROOT/scripts/runtime/global-coordination-native.sh"
readonly COORDINATION_CLOSURE="$SOURCE_ROOT/.skincos-global-coordination-atendimento.json"
readonly SUDOERS_SOURCE="$SOURCE_ROOT/ops/runtime/github-actions-runner/skincos-atendimento-crm-core-identity-schema-custody.sudoers"
readonly UNIT_SOURCE="$SOURCE_ROOT/ops/runtime/units/$RUNNER_UNIT"
readonly INSTALLER_SOURCE="$ROOT_DIR/scripts/runtime/install-atendimento-crm-core-identity-schema-custody.sh"
readonly REQUIRED_SOURCE_FILES=(
  "$TEMPLATE"
  "$RUNNER"
  "$RELEASE_VALIDATOR"
  "$CONTROL_VALIDATOR"
  "$BACKUP_SCRIPT"
  "$COORDINATION_ADAPTER"
  "$SUDOERS_SOURCE"
  "$UNIT_SOURCE"
)
readonly APPLY_REQUIRED_SOURCE_FILES=("$COORDINATION_CLOSURE")

for required in "${REQUIRED_SOURCE_FILES[@]}"; do
  [[ -f "$required" && ! -L "$required" ]] || {
    echo "Required identity-schema custody source is missing: $required" >&2
    exit 78
  }
done

if [[ "$APPLY" == '1' ]]; then
  for required in "${APPLY_REQUIRED_SOURCE_FILES[@]}"; do
    [[ -f "$required" && ! -L "$required" ]] || {
      echo "Required immutable identity-schema custody source is missing: $required" >&2
      exit 78
    }
  done
fi

for binary in /usr/bin/bash /usr/bin/node /usr/bin/install /usr/bin/mktemp /usr/bin/stat /usr/bin/chmod /usr/bin/chown /usr/bin/env /usr/bin/timeout /usr/bin/sed /usr/bin/rm /usr/bin/systemctl /usr/sbin/visudo; do
  [[ -x "$binary" ]] || { echo "Required binary is missing: $binary" >&2; exit 78; }
done

/usr/bin/bash -n "$INSTALLER_SOURCE"
/usr/bin/bash -n "$TEMPLATE"
/usr/bin/node --check "$RUNNER"
/usr/bin/node --check "$RELEASE_VALIDATOR"
/usr/bin/node --check "$CONTROL_VALIDATOR"
/usr/sbin/visudo -cf "$SUDOERS_SOURCE" >/dev/null

if [[ "$APPLY" != '1' ]]; then
  printf 'atendimento_crm_core_identity_schema_custody_contract=valid helper=%s apply=false\n' "$HELPER"
  exit 0
fi

[[ "$(/usr/bin/id -u)" == '0' ]] || { echo '--apply requires root' >&2; exit 78; }

mode_is_non_writable() {
  local mode="$1"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  [[ "${mode: -2:1}" != [2367] && "${mode: -1}" != [2367] ]]
}

assert_root_owned_directory() {
  local target="$1" metadata uid gid mode
  [[ -d "$target" && ! -L "$target" ]] || { echo "Immutable release directory is unavailable: $target" >&2; exit 78; }
  metadata="$(/usr/bin/stat -c '%u:%g:%a' -- "$target")"
  IFS=':' read -r uid gid mode <<<"$metadata"
  [[ "$uid" == '0' ]] && mode_is_non_writable "$mode" || {
    echo "Immutable release directory is unsafe: $target" >&2
    exit 78
  }
}

assert_root_owned_file() {
  local target="$1" metadata uid gid mode links
  [[ -f "$target" && ! -L "$target" ]] || { echo "Immutable release source is unavailable: $target" >&2; exit 78; }
  metadata="$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$target")"
  IFS=':' read -r uid gid mode links <<<"$metadata"
  [[ "$uid" == '0' && "$links" == '1' ]] && mode_is_non_writable "$mode" || {
    echo "Immutable release source is unsafe: $target" >&2
    exit 78
  }
}

assert_root_owned_directory "$SOURCE_ROOT"
for required in "${REQUIRED_SOURCE_FILES[@]}"; do
  assert_root_owned_file "$required"
done
for required in "${APPLY_REQUIRED_SOURCE_FILES[@]}"; do
  assert_root_owned_file "$required"
done

for target in "$STATE_ROOT" "$BACKUP_ROOT"; do
  if [[ -e "$target" || -L "$target" ]]; then
    [[ -d "$target" && ! -L "$target" ]] || {
      echo "Private custody directory is not a real directory: $target" >&2
      exit 78
    }
  else
    /usr/bin/install -d -o root -g root -m 0700 "$target"
  fi
  [[ -d "$target" && ! -L "$target" && "$(/usr/bin/stat -c '%u:%g:%a' -- "$target")" == '0:0:700' ]] || {
    echo "Private custody directory metadata is unsafe: $target" >&2
    exit 78
  }
done

release_sha="${SOURCE_ROOT#/opt/skincos/releases/}"
release_sha="${release_sha%/source}"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Immutable release SHA could not be derived' >&2; exit 78; }

helper_stage="$(/usr/bin/mktemp /var/tmp/skincos-run-atendimento-crm-core-identity-schema-staging.XXXXXX)"
rollback_dir="$(/usr/bin/mktemp -d /var/tmp/skincos-atendimento-identity-schema-custody-rollback.XXXXXX)"
[[ "$rollback_dir" =~ ^/var/tmp/skincos-atendimento-identity-schema-custody-rollback\.[A-Za-z0-9]+$ ]] || {
  echo 'Identity schema installer rollback target is invalid' >&2
  exit 78
}
/usr/bin/chmod 0700 "$rollback_dir"

snapshot_target() {
  local target="$1" snapshot="$2" expected_mode="$3" metadata
  if [[ ! -e "$target" && ! -L "$target" ]]; then
    printf '0'
    return 0
  fi
  [[ -f "$target" && ! -L "$target" ]] || {
    echo "Existing identity schema custody target is unsafe: $target" >&2
    exit 78
  }
  metadata="$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$target")"
  [[ "$metadata" == "0:0:$expected_mode:1" ]] || {
    echo "Existing identity schema custody target has unsafe metadata: $target" >&2
    exit 78
  }
  /usr/bin/install -o root -g root -m "$expected_mode" "$target" "$rollback_dir/$snapshot"
  printf '1'
}

restore_target() {
  local target="$1" snapshot="$2" expected_mode="$3" existed="$4"
  if [[ "$existed" == '1' ]]; then
    /usr/bin/install -o root -g root -m "$expected_mode" "$rollback_dir/$snapshot" "$target"
  else
    /usr/bin/rm -f -- "$target"
  fi
}

helper_existed=0
sudoers_existed=0
unit_existed=0
rollback_required=0
cleanup_install() {
  local status="$?"
  trap - EXIT INT TERM
  set +e
  if [[ "$rollback_required" == '1' ]]; then
    restore_target "$HELPER" helper 0700 "$helper_existed"
    restore_target "$SUDOERS_FILE" sudoers 0440 "$sudoers_existed"
    restore_target "/etc/systemd/system/$RUNNER_UNIT" unit 0644 "$unit_existed"
    /usr/bin/systemctl daemon-reload
    /usr/bin/systemctl restart "$RUNNER_UNIT"
  fi
  /usr/bin/rm -f -- "$helper_stage"
  /usr/bin/rm -rf -- "$rollback_dir"
  exit "$status"
}
trap cleanup_install EXIT INT TERM

/usr/bin/sed \
  -e "s|__RELEASE_SOURCE__|$SOURCE_ROOT|g" \
  -e "s|__RELEASE_SHA__|$release_sha|g" \
  "$TEMPLATE" > "$helper_stage"
/usr/bin/chmod 0700 "$helper_stage"
/usr/bin/bash -n "$helper_stage"

/usr/bin/systemctl is-active --quiet "$RUNNER_UNIT" || {
  echo 'Native custody runner must already be active before installing the identity schema helper' >&2
  exit 78
}
helper_existed="$(snapshot_target "$HELPER" helper 0700)"
sudoers_existed="$(snapshot_target "$SUDOERS_FILE" sudoers 0440)"
unit_existed="$(snapshot_target "/etc/systemd/system/$RUNNER_UNIT" unit 0644)"
rollback_required=1

/usr/bin/install -o root -g root -m 0700 "$helper_stage" "$HELPER"
/usr/bin/install -o root -g root -m 0440 "$SUDOERS_SOURCE" "$SUDOERS_FILE"
/usr/bin/install -o root -g root -m 0644 "$UNIT_SOURCE" "/etc/systemd/system/$RUNNER_UNIT"
/usr/sbin/visudo -cf "$SUDOERS_FILE" >/dev/null
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl restart "$RUNNER_UNIT"
/usr/bin/systemctl is-active --quiet "$RUNNER_UNIT"
rollback_required=0
/usr/bin/rm -f -- "$helper_stage"
/usr/bin/rm -rf -- "$rollback_dir"
trap - EXIT INT TERM

printf 'atendimento_crm_core_identity_schema_custody=installed release_sha=%s crm_runtime_changed=false custody_runner_restarted=true\n' "$release_sha"
