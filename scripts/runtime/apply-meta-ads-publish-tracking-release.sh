#!/usr/bin/bash -p
set -euo pipefail

# Apply the Meta Ads tracking contract only from an already-promoted immutable
# native source release. This entrypoint is executed as the PostgreSQL peer
# user; Cloudflare Worker activation is deliberately sequenced after it by
# deploy-token-vault.yml while the workflow is inactive.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV CDPATH ENV GIT_DIR GIT_WORK_TREE NODE_OPTIONS npm_config_prefix

source_root='/opt/skincos/current/source'
expected_version=''
apply=0

usage() {
  echo 'Usage: apply-meta-ads-publish-tracking-release.sh [--source-root <immutable-source>] --expected-version <uuid> --apply' >&2
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
    --expected-version=*)
      expected_version="${1#*=}"
      shift
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

(( apply == 1 )) || { echo 'Refusing a non-applied tracking release; use the read-only preflight separately.' >&2; exit 64; }
[[ "$expected_version" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo 'expected-version must be a UUID.' >&2; exit 64; }
[[ "$(id -un)" == 'postgres' ]] || { echo 'Meta Ads tracking apply requires the PostgreSQL peer user.' >&2; exit 77; }

source_root="$(readlink -f -- "$source_root")"
[[ "$source_root" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
  echo 'Meta Ads tracking release requires an immutable /opt/skincos/releases/<sha>/source root.' >&2
  exit 65
}
readonly source_root
readonly release_sha="$(basename "$(dirname "$source_root")")"

readonly node_bin='/usr/bin/node'
[[ -x "$node_bin" ]] || { echo 'Native Node runtime is unavailable.' >&2; exit 69; }
for file in \
  "$source_root/orb/engine/workflows/meta-ads-publish.current.json" \
  "$source_root/orb/engine/scripts/sync-meta-ads-publish-sources.js" \
  "$source_root/orb/engine/scripts/apply-meta-ads-publish-workflow-snapshot.js" \
  "$source_root/orb/engine/scripts/inspect-meta-ads-publish-version-alignment.js" \
  "$source_root/orb/engine/scripts/validate-meta-ads-publish-preflight.js"; do
  [[ -r "$file" ]] || { echo "Required immutable Meta Ads source file is unavailable: $(basename "$file")" >&2; exit 66; }
done

"$node_bin" "$source_root/orb/engine/scripts/sync-meta-ads-publish-sources.js" check

# This strict inspection proves that the only safe transition surface is
# inactive before the version-checked PostgreSQL update is attempted.
"$node_bin" "$source_root/orb/engine/scripts/inspect-meta-ads-publish-version-alignment.js" --strict
"$node_bin" \
  "$source_root/orb/engine/scripts/apply-meta-ads-publish-workflow-snapshot.js" \
  "$source_root/orb/engine/workflows/meta-ads-publish.current.json" \
  "--expected-version=$expected_version" \
  --apply

# The final readback compares the immutable source, every mapped Code node,
# the live n8n graph and the tracking reconciliation structure. It performs
# no Meta mutation.
"$node_bin" "$source_root/orb/engine/scripts/validate-meta-ads-publish-preflight.js"
printf 'Meta Ads tracking workflow applied from immutable source: %s\n' "$release_sha"
