#!/usr/bin/bash -p
set -euo pipefail

# Native custody wrapper for the staging-only Influencer Intelligence schema
# runner. It accepts only an immutable release SHA, never a checkout path,
# database URL, secret, or caller-selected checkpoint destination.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy \
  GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
  GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_ATTR_NOSYSTEM GIT_EXEC_PATH \
  NODE_OPTIONS NODE_PATH NPM_CONFIG_USERCONFIG NPM_CONFIG_GLOBALCONFIG \
  npm_config_userconfig npm_config_globalconfig

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/root' 'LANG=C' "$@"
}

ACTION=''
RELEASE_SHA=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|--apply|--verify)
      [[ -z "$ACTION" ]] || { echo 'Exactly one migration action is required.' >&2; exit 64; }
      ACTION="$1"
      ;;
    --release-sha)
      shift
      RELEASE_SHA="${1:-}"
      ;;
    *)
      echo 'Usage: run-influencer-intelligence-staging-migration.sh --dry-run|--apply|--verify --release-sha <full-main-sha>' >&2
      exit 64
      ;;
  esac
  shift
done

[[ "$ACTION" =~ ^--(dry-run|apply|verify)$ ]] || { echo 'Exactly one migration action is required.' >&2; exit 64; }
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--release-sha must be a full lowercase SHA.' >&2; exit 64; }

readonly RELEASE_ROOT="/opt/skincos/releases/$RELEASE_SHA/source"
readonly RUNNER="$RELEASE_ROOT/scripts/staging/influencer-intelligence-migration.mjs"
readonly COORDINATION_CLOSURE="$RELEASE_ROOT/.skincos-global-coordination-influencer-intelligence.json"
readonly COORDINATION_ADAPTER="$RELEASE_ROOT/scripts/runtime/global-coordination-native.sh"
readonly COORDINATION_CLIENT="$RELEASE_ROOT/scripts/runtime/global-coordination-mini-pc.sh"
readonly CHECKPOINT_ROOT='/var/backups/skincos/influencer-intelligence/staging'
readonly COORDINATION_ENV_FILE='/etc/skincos/global-coordination/native-runtime.env'

[[ "$RELEASE_ROOT" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || { echo 'Immutable staging release root is invalid.' >&2; exit 64; }
run_sudo_clean /usr/bin/test -f "$RUNNER" || { echo 'Influencer Intelligence staging runner is unavailable in the immutable release.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -f "$COORDINATION_CLOSURE" || { echo 'Influencer Intelligence dependency-closure attestation is unavailable in the immutable release.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -f "$COORDINATION_ADAPTER" || { echo 'Native coordination adapter is unavailable in the immutable release.' >&2; exit 78; }
run_sudo_clean /usr/bin/test -x "$COORDINATION_CLIENT" || { echo 'Native coordination client is unavailable in the immutable release.' >&2; exit 78; }

coordination_acquired=0
cleanup_coordination() {
  local exit_status="$?"
  trap - EXIT INT TERM
  if [[ "$coordination_acquired" == '1' ]]; then
    native_coordination_cleanup || echo 'Unable to release the Influencer Intelligence staging lease; it will expire fail-closed.' >&2
    coordination_acquired=0
  fi
  exit "$exit_status"
}

load_private_coordination_environment() {
  [[ "$COORDINATION_ENV_FILE" == '/etc/skincos/global-coordination/native-runtime.env' ]] || {
    echo 'Influencer Intelligence coordination environment path is not fixed.' >&2
    exit 78
  }
  [[ -f "$COORDINATION_ENV_FILE" ]] || {
    echo 'Influencer Intelligence coordination custody is unavailable.' >&2
    exit 78
  }
  local mode line key value
  local has_url=0 has_shared=0 has_active=0 has_key_id=0
  mode="$(stat -c '%a' "$COORDINATION_ENV_FILE")"
  [[ "$mode" == '600' || "$mode" == '640' ]] || {
    echo 'Influencer Intelligence coordination custody has unsafe permissions.' >&2
    exit 78
  }
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || {
      echo 'Influencer Intelligence coordination custody contains an invalid record.' >&2
      exit 78
    }
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case "$key" in
      SKINCOS_GLOBAL_COORDINATOR_URL) has_url=1 ;;
      SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET) has_shared=1 ;;
      SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY) has_active=1 ;;
      SKINCOS_GLOBAL_COORDINATION_KEY_ID) has_key_id=1 ;;
      *)
        echo 'Influencer Intelligence coordination custody contains an unsupported key.' >&2
        exit 78
        ;;
    esac
    export "$key=$value"
  done < "$COORDINATION_ENV_FILE"
  [[ "$has_url" == '1' && -n "${SKINCOS_GLOBAL_COORDINATOR_URL:-}" ]] || {
    echo 'Influencer Intelligence coordination custody has no coordinator URL.' >&2
    exit 78
  }
  if [[ "$has_active" == '1' || "$has_key_id" == '1' ]]; then
    [[ "$has_active" == '1' && "$has_key_id" == '1' && -n "${SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY:-}" && -n "${SKINCOS_GLOBAL_COORDINATION_KEY_ID:-}" ]] || {
      echo 'Influencer Intelligence active coordination custody is incomplete.' >&2
      exit 78
    }
    [[ "${SKINCOS_GLOBAL_COORDINATION_KEY_ID}" != 'legacy-v1' ]] || {
      echo 'Influencer Intelligence active coordination custody cannot use the legacy key id.' >&2
      exit 78
    }
    [[ "$has_shared" == '0' ]] || {
      echo 'Influencer Intelligence active coordination custody must not retain the legacy secret record.' >&2
      exit 78
    }
  else
    [[ "$has_shared" == '1' && -n "${SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET:-}" ]] || {
      echo 'Influencer Intelligence coordination custody has no secret.' >&2
      exit 78
    }
  fi
}

checkpoint=''
if [[ "$ACTION" == '--apply' ]]; then
  # A migration is a mutable database operation even though the application
  # and provider runtime remain OFF. The global lease binds the operation to
  # the exact release and its dependency closure before any checkpoint path
  # is created or the database runner is invoked.
  load_private_coordination_environment
  # The staging migration owns its coordination identity; callers cannot
  # redirect the lease to another mission, thread or actor.
  unset GLOBAL_COORDINATION_MISSION_ID GLOBAL_COORDINATION_THREAD_ID GLOBAL_COORDINATION_ACTOR
  export GLOBAL_COORDINATION_MISSION_ID='codex:skincos:influencer-intelligence-staging'
  export GLOBAL_COORDINATION_THREAD_ID="staging-migration:$RELEASE_SHA"
  export GLOBAL_COORDINATION_ACTOR='native-staging-migration-runner'
  # shellcheck disable=SC1091
  source "$COORDINATION_ADAPTER"
  native_coordination_init mutate:influencer-intelligence:staging influencer-intelligence "$RELEASE_SHA" "$COORDINATION_CLOSURE" mutation
  trap cleanup_coordination EXIT INT TERM
  native_coordination_acquire "mini-pc:mutate:influencer-intelligence:staging:migration:$RELEASE_SHA:$$" >/dev/null
  coordination_acquired=1
  native_coordination_check

  run_sudo_clean /usr/bin/install -d -m 0700 -o root -g root "$CHECKPOINT_ROOT"
  stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
  checkpoint="$CHECKPOINT_ROOT/influencer-intelligence-staging-${stamp}-${RELEASE_SHA}.json"
  [[ "$checkpoint" =~ ^/var/backups/skincos/influencer-intelligence/staging/influencer-intelligence-staging-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}\.json$ ]] || {
    echo 'Checkpoint path did not satisfy the fixed private contract.' >&2
    exit 78
  }
  run_sudo_clean /usr/bin/test ! -e "$checkpoint"
  native_coordination_check
fi

runner_args=("$ACTION" --target staging)
if [[ "$ACTION" == '--apply' ]]; then
  runner_args+=(--release-sha "$RELEASE_SHA" --checkpoint "$checkpoint")
fi

run_status=0
run_sudo_clean /usr/bin/node "$RUNNER" "${runner_args[@]}" || run_status=$?
if [[ "$ACTION" == '--apply' ]]; then
  native_coordination_check || run_status=70
  native_coordination_cleanup || run_status=70
  coordination_acquired=0
fi
exit "$run_status"
