#!/usr/bin/bash -p
set -euo pipefail

# Restore only the checkpointed pre-apply version of the inactive Meta Ads
# workflow.  This is intentionally separate from source-pointer rollback: it
# is for a failed Token Vault activation/readback after the native source has
# already been promoted.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV CDPATH ENV GIT_DIR GIT_WORK_TREE NODE_OPTIONS npm_config_prefix N8N_RUNTIME_HOME

source_root='/opt/skincos/current/source'
expected_version=''
rollback_version=''
rollback_snapshot=''
apply=0

usage() {
  echo 'Usage: rollback-meta-ads-publish-tracking-release.sh [--source-root <immutable-source>] --expected-version <post-apply-uuid> --rollback-version <checkpoint-uuid> --rollback-snapshot <absolute workflow.live.json> --apply' >&2
}

while (($#)); do
  case "$1" in
    --source-root)
      (($# >= 2)) || { usage; exit 64; }
      source_root="$2"
      shift 2
      ;;
    --expected-version)
      (($# >= 2)) || { usage; exit 64; }
      expected_version="$2"
      shift 2
      ;;
    --rollback-version)
      (($# >= 2)) || { usage; exit 64; }
      rollback_version="$2"
      shift 2
      ;;
    --rollback-snapshot)
      (($# >= 2)) || { usage; exit 64; }
      rollback_snapshot="$2"
      shift 2
      ;;
    --apply)
      apply=1
      shift
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

(( apply == 1 )) || { echo 'Refusing a non-applied tracking rollback.' >&2; exit 64; }
[[ "$expected_version" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo 'expected-version must be a UUID.' >&2; exit 64; }
[[ "$rollback_version" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo 'rollback-version must be a UUID.' >&2; exit 64; }
[[ "$expected_version" != "$rollback_version" ]] || { echo 'expected-version and rollback-version must differ.' >&2; exit 64; }
[[ "$rollback_snapshot" == /* ]] || { echo 'rollback-snapshot must be an absolute path.' >&2; exit 64; }
[[ "$(id -un)" == 'postgres' ]] || { echo 'Meta Ads tracking rollback requires the PostgreSQL peer user.' >&2; exit 77; }

source_root="$(readlink -f -- "$source_root")"
[[ "$source_root" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
  echo 'Meta Ads tracking rollback requires an immutable /opt/skincos/releases/<sha>/source root.' >&2
  exit 65
}
readonly source_root
readonly rollback_script="$source_root/orb/engine/scripts/restore-meta-ads-publish-workflow-snapshot.js"
readonly alignment_script="$source_root/orb/engine/scripts/inspect-meta-ads-publish-version-alignment.js"
readonly node_bin='/usr/bin/node'
[[ -x "$node_bin" ]] || { echo 'Native Node runtime is unavailable.' >&2; exit 69; }
[[ -r "$rollback_script" && -r "$alignment_script" ]] || { echo 'Required immutable Meta Ads rollback entrypoint is unavailable.' >&2; exit 66; }

"$node_bin" "$rollback_script" \
  "--expected-version=$expected_version" \
  "--rollback-version=$rollback_version" \
  "--rollback-snapshot=$rollback_snapshot" \
  --apply

# A restored version is intentionally older than the immutable candidate, so
# source/live preflight must not be used here.  This validates that the
# inactive workflow remains executable under the strict n8n schema contract.
"$node_bin" "$alignment_script" --strict
printf 'Meta Ads tracking workflow restored from checkpoint using immutable source: %s\n' "$source_root"
