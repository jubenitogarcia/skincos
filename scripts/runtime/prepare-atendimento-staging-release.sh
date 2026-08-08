#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy \
  GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
  GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_ATTR_NOSYSTEM GIT_EXEC_PATH \
  NPM_CONFIG_USERCONFIG NPM_CONFIG_GLOBALCONFIG npm_config_userconfig npm_config_globalconfig

readonly RELEASE_BASE='/opt/skincos/releases'
readonly NPM_CACHE='/var/lib/skincos-runtime/cache/crm-api'

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/nonexistent' 'LANG=C' "$@"
}

run_skincos_npm() {
  /usr/bin/sudo -n -u skincos /usr/bin/env -i \
    "PATH=$SAFE_PATH" 'HOME=/nonexistent' 'LANG=C' "npm_config_cache=$NPM_CACHE" \
    /usr/bin/npm "$@"
}

RELEASE_SHA=""
PREDECESSOR_SHA=""
APPLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-sha) shift; RELEASE_SHA="${1:-}" ;;
    --predecessor-sha) shift; PREDECESSOR_SHA="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) echo "Usage: $0 --release-sha <full-main-sha> --predecessor-sha <full-previous-sha> [--apply]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "--release-sha must be a full lowercase SHA." >&2; exit 1; }
[[ "$PREDECESSOR_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "--predecessor-sha must be a full lowercase SHA." >&2; exit 1; }
ROOT_DIR="$(cd -- "$(/usr/bin/dirname -- "${BASH_SOURCE[0]}")/../.." && /usr/bin/pwd -P)"
readonly DESTINATION="$RELEASE_BASE/$RELEASE_SHA/source"
readonly STAGING="$RELEASE_BASE/.atendimento-staging-$RELEASE_SHA-$$"

resolve_checkout_git_dir() {
  local marker git_dir drive rest
  if [[ -d "$ROOT_DIR/.git" ]]; then
    git_dir="$ROOT_DIR/.git"
  elif [[ -f "$ROOT_DIR/.git" ]]; then
    IFS= read -r marker < "$ROOT_DIR/.git" || true
    [[ "$marker" == gitdir:\ * ]] || { echo 'Checkout Git pointer is invalid.' >&2; exit 78; }
    git_dir="${marker#gitdir: }"
    if [[ "$git_dir" =~ ^([A-Za-z]):[\\/](.*)$ ]]; then
      drive="${BASH_REMATCH[1],,}"
      rest="${BASH_REMATCH[2]//\\//}"
      git_dir="/mnt/$drive/$rest"
    elif [[ "$git_dir" != /* ]]; then
      git_dir="$ROOT_DIR/$git_dir"
    fi
  else
    echo 'Checkout Git directory is unavailable.' >&2
    exit 78
  fi
  git_dir="$(/usr/bin/readlink -f -- "$git_dir")"
  [[ "$git_dir" == /* && -d "$git_dir" && -f "$git_dir/HEAD" ]] || {
    echo 'Checkout Git directory is not a readable repository.' >&2
    exit 78
  }
  printf '%s\n' "$git_dir"
}

readonly VERIFIED_GIT_DIR="$(resolve_checkout_git_dir)"
unset GIT_DIR GIT_WORK_TREE

git_clean() {
  /usr/bin/env -i \
    "PATH=$SAFE_PATH" 'HOME=/nonexistent' 'LANG=C' \
    "GIT_DIR=$VERIFIED_GIT_DIR" "GIT_WORK_TREE=$ROOT_DIR" \
    'GIT_CONFIG_NOSYSTEM=1' 'GIT_ATTR_NOSYSTEM=1' 'GIT_OPTIONAL_LOCKS=0' \
    /usr/bin/git -c "safe.directory=$ROOT_DIR" -C "$ROOT_DIR" "$@"
}

# Both paths are derived only from fixed roots, a validated SHA and the shell
# PID.  Keep this guard next to the destructive cleanup below: a GitHub
# Environment or caller cannot redirect a release or the cache via an env var.
assert_release_targets() {
  [[ "$DESTINATION" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || {
    echo 'Immutable release destination is invalid.' >&2
    exit 64
  }
  [[ "$STAGING" =~ ^/opt/skincos/releases/\.atendimento-staging-[0-9a-f]{40}-[0-9]+$ ]] || {
    echo 'Staging release target is invalid.' >&2
    exit 64
  }
  [[ "$(dirname "$STAGING")" == "$RELEASE_BASE" ]] || {
    echo 'Staging release target escapes the fixed release root.' >&2
    exit 64
  }
}
assert_release_targets

for command_path in /usr/bin/bash /usr/bin/sudo /usr/bin/env /usr/bin/git /usr/bin/mktemp /usr/bin/rm /usr/bin/install /usr/bin/tar /usr/bin/chown /usr/bin/find /usr/bin/chmod /usr/bin/test /usr/bin/npm /usr/bin/mv /usr/bin/dirname /usr/bin/pwd /usr/bin/readlink /usr/bin/true; do
  [[ -x "$command_path" ]] || { echo "Missing $command_path" >&2; exit 1; }
done

actual_sha="$(git_clean rev-parse "$RELEASE_SHA^{commit}")"
[[ "$actual_sha" == "$RELEASE_SHA" ]] || { echo "Release SHA is not present in this checkout." >&2; exit 1; }
main_sha="$(git_clean rev-parse 'origin/main^{commit}')"
[[ "$actual_sha" == "$main_sha" ]] || { echo "Release SHA must equal the fetched origin/main commit." >&2; exit 1; }
actual_predecessor="$(git_clean rev-parse "$PREDECESSOR_SHA^{commit}")"
[[ "$actual_predecessor" == "$PREDECESSOR_SHA" && "$actual_predecessor" != "$actual_sha" ]] || {
  echo "Predecessor SHA must be a distinct full commit present in this checkout." >&2
  exit 1
}
git_clean merge-base --is-ancestor "$actual_predecessor" "$actual_sha" || {
  echo "Predecessor SHA is not an ancestor of the requested release." >&2
  exit 1
}
tree_sha="$(git_clean rev-parse "$RELEASE_SHA^{tree}")"
[[ ! -e "$DESTINATION" ]] || { echo "Release already exists: $DESTINATION" >&2; exit 1; }
if [[ "$APPLY" != "1" ]]; then
  echo "release_sha=$RELEASE_SHA"
  echo "predecessor_sha=$PREDECESSOR_SHA"
  echo "source_tree=$tree_sha"
  echo "destination=$DESTINATION"
  echo "dry_run=true"
  exit 0
fi

/usr/bin/sudo -n /usr/bin/true
umask 0077
lineage_file="$(/usr/bin/mktemp /tmp/atendimento-staging-lineage.XXXXXX)"
printf '{"releaseId":"%s","parentReleaseId":"%s","verifiedAncestor":true,"sourceTree":"%s","target":"staging"}\n' \
  "$RELEASE_SHA" "$PREDECESSOR_SHA" "$tree_sha" >"$lineage_file"
cleanup() {
  /usr/bin/rm -f -- "$lineage_file"
  # Do not let a future refactor turn cleanup into a broad or caller-directed
  # delete.  The validation is deliberately repeated at the sink.
  if [[ "$STAGING" =~ ^/opt/skincos/releases/\.atendimento-staging-[0-9a-f]{40}-[0-9]+$ ]] && \
    [[ "$(dirname "$STAGING")" == "$RELEASE_BASE" ]]; then
    run_sudo_clean /usr/bin/rm -rf -- "$STAGING" || true
  fi
}
trap cleanup EXIT INT TERM
run_sudo_clean /usr/bin/install -d -o root -g skincos -m 0750 "$STAGING" "$RELEASE_BASE" "$RELEASE_BASE/$RELEASE_SHA" "$NPM_CACHE"
git_clean archive --format=tar "$RELEASE_SHA" | run_sudo_clean /usr/bin/tar -xf - -C "$STAGING"
run_sudo_clean /usr/bin/chown -R root:skincos "$STAGING"
run_sudo_clean /usr/bin/find "$STAGING" -type d -exec /usr/bin/chmod 0750 {} +
run_sudo_clean /usr/bin/find "$STAGING" -type f -exec /usr/bin/chmod 0640 {} +
run_sudo_clean /usr/bin/find "$STAGING" -type f \( -path '*/scripts/*.sh' -o -path '*/scripts/*/*.sh' \) -exec /usr/bin/chmod 0750 {} +
run_sudo_clean /usr/bin/test -f "$STAGING/crm/api/package-lock.json" || { echo "CRM lockfile missing" >&2; exit 1; }
run_sudo_clean /usr/bin/chown -R skincos:skincos "$STAGING/crm/api"
run_skincos_npm --prefix "$STAGING/crm/api" ci --omit=dev --ignore-scripts
run_sudo_clean /usr/bin/chown -R root:skincos "$STAGING/crm/api"
run_sudo_clean /usr/bin/install -m 0640 -o root -g skincos "$lineage_file" "$STAGING/.skincos-release-lineage.json"
run_sudo_clean /usr/bin/install -m 0640 -o root -g skincos /dev/stdin "$STAGING/.skincos-atendimento-release.json" <<EOF
{"releaseSha":"$RELEASE_SHA","sourceTree":"$tree_sha","target":"staging","domain":"atendimento","syntheticOnly":true}
EOF
run_sudo_clean /usr/bin/mv -- "$STAGING" "$DESTINATION"
/usr/bin/rm -f -- "$lineage_file"
trap - EXIT INT TERM
echo "release_sha=$RELEASE_SHA"
echo "source_tree=$tree_sha"
echo "destination=$DESTINATION"
echo "staged=true"
