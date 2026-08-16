#!/usr/bin/env bash
set -euo pipefail

# Materialize a website worktree into a private WSL cache without ever building
# or installing dependencies in the source worktree.  This is intentionally a
# small, explicit contract rather than a general-purpose copy command.
#
# Required environment:
#   PREVIEW_MATERIALIZE_SOURCE_ROOT       Existing checkout containing website/
#   PREVIEW_MATERIALIZE_DESTINATION_ROOT  Private output root; website/ is made here
#   PREVIEW_MATERIALIZE_ALLOWED_ROOT      Existing private root containing destination
#   PREVIEW_MATERIALIZE_DEPENDENCY_ROOT   Private dependency cache root; website/node_modules lives here
#
# Optional environment:
#   PREVIEW_MATERIALIZE_DEPENDENCY_STATE_FILE
#     Private state file. Defaults to <dependency-root>/website/.preview-dependencies.state.

require_environment() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    echo "${name} is required." >&2
    exit 2
  fi
  if [[ "$value" != /* ]]; then
    echo "${name} must be an absolute WSL path." >&2
    exit 2
  fi
}

canonical_existing_directory() {
  local path="$1"
  if [[ ! -d "$path" ]]; then
    echo "Directory does not exist: $path" >&2
    exit 2
  fi
  realpath -e -- "$path"
}

canonical_planned_path() {
  realpath -m -- "$1"
}

require_descendant_of() {
  local candidate="$1"
  local root="$2"
  local label="$3"

  if [[ "$candidate" != "$root"/* ]]; then
    echo "${label} must be a descendant of PREVIEW_MATERIALIZE_ALLOWED_ROOT." >&2
    exit 2
  fi
}

require_environment PREVIEW_MATERIALIZE_SOURCE_ROOT
require_environment PREVIEW_MATERIALIZE_DESTINATION_ROOT
require_environment PREVIEW_MATERIALIZE_ALLOWED_ROOT
require_environment PREVIEW_MATERIALIZE_DEPENDENCY_ROOT

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required to materialize the local website preview." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to prepare the local website preview dependencies." >&2
  exit 1
fi

ALLOWED_ROOT="$(canonical_existing_directory "$PREVIEW_MATERIALIZE_ALLOWED_ROOT")"
SOURCE_ROOT="$(canonical_existing_directory "$PREVIEW_MATERIALIZE_SOURCE_ROOT")"
SOURCE_WEBSITE="$(canonical_existing_directory "$SOURCE_ROOT/website")"
DESTINATION_ROOT="$(canonical_planned_path "$PREVIEW_MATERIALIZE_DESTINATION_ROOT")"
DEPENDENCY_ROOT="$(canonical_planned_path "$PREVIEW_MATERIALIZE_DEPENDENCY_ROOT")"
DESTINATION_WEBSITE="$(canonical_planned_path "$DESTINATION_ROOT/website")"
DEPENDENCY_WEBSITE="$(canonical_planned_path "$DEPENDENCY_ROOT/website")"
DEPENDENCY_STATE_FILE="$(canonical_planned_path "${PREVIEW_MATERIALIZE_DEPENDENCY_STATE_FILE:-$DEPENDENCY_WEBSITE/.preview-dependencies.state}")"

require_descendant_of "$DESTINATION_ROOT" "$ALLOWED_ROOT" "PREVIEW_MATERIALIZE_DESTINATION_ROOT"
require_descendant_of "$DEPENDENCY_ROOT" "$ALLOWED_ROOT" "PREVIEW_MATERIALIZE_DEPENDENCY_ROOT"
require_descendant_of "$DEPENDENCY_STATE_FILE" "$ALLOWED_ROOT" "PREVIEW_MATERIALIZE_DEPENDENCY_STATE_FILE"

if [[ "$DESTINATION_ROOT" == "$DEPENDENCY_ROOT" || "$DESTINATION_ROOT" == "$DEPENDENCY_ROOT"/* || "$DEPENDENCY_ROOT" == "$DESTINATION_ROOT"/* ]]; then
  echo "The materialized source root and dependency root must be distinct private directories." >&2
  exit 2
fi
if [[ "$DESTINATION_ROOT" == "$SOURCE_ROOT" || "$DESTINATION_ROOT" == "$SOURCE_ROOT"/* || "$SOURCE_ROOT" == "$DESTINATION_ROOT"/* ]]; then
  echo "The materialized destination must not overlap the source checkout." >&2
  exit 2
fi
if [[ "$DEPENDENCY_ROOT" == "$SOURCE_ROOT" || "$DEPENDENCY_ROOT" == "$SOURCE_ROOT"/* || "$SOURCE_ROOT" == "$DEPENDENCY_ROOT"/* ]]; then
  echo "The dependency cache must not overlap the source checkout." >&2
  exit 2
fi
if [[ "$DEPENDENCY_STATE_FILE" == "$SOURCE_ROOT" || "$DEPENDENCY_STATE_FILE" == "$SOURCE_ROOT"/* ]]; then
  echo "The dependency state file must not overlap the source checkout." >&2
  exit 2
fi

SOURCE_PACKAGE_JSON="$SOURCE_WEBSITE/package.json"
SOURCE_LOCK_FILE="$SOURCE_WEBSITE/package-lock.json"
if [[ ! -f "$SOURCE_PACKAGE_JSON" || ! -f "$SOURCE_LOCK_FILE" ]]; then
  echo "The website source must contain package.json and package-lock.json for npm ci." >&2
  exit 1
fi

DEPENDENCY_FINGERPRINT="$({
  for manifest_name in package.json package-lock.json npm-shrinkwrap.json .npmrc; do
    source_manifest="$SOURCE_WEBSITE/$manifest_name"
    if [[ -f "$source_manifest" ]]; then
      printf '%s\0present\0' "$manifest_name"
      sha256sum "$source_manifest" | awk '{print $1}'
    else
      printf '%s\0missing\0' "$manifest_name"
    fi
  done
} | sha256sum | awk '{print $1}')"
DEPENDENCY_FINGERPRINT="sha256:$DEPENDENCY_FINGERPRINT"

mkdir -p "$DESTINATION_WEBSITE" "$DEPENDENCY_WEBSITE" "$(dirname "$DEPENDENCY_STATE_FILE")"

# `--delete-excluded` is deliberate: stale generated outputs and test/document
# trees must not survive a source refresh.  Dependencies are attached below,
# after the materialized tree is complete.
rsync -a --delete --delete-excluded \
  --exclude '/node_modules/' \
  --exclude '/.next/' \
  --exclude '/.next-codex-preview/' \
  --exclude '/.open-next/' \
  --exclude '/.wrangler/' \
  --exclude '/docs/' \
  --exclude '/logs/' \
  --exclude '/reports/' \
  --exclude '/tests/' \
  --exclude '/tmp/' \
  --exclude '/.git/' \
  "$SOURCE_WEBSITE/" "$DESTINATION_WEBSITE/"

# npm ci runs only inside the private dependency cache.  Mirror the manifests
# needed by npm there first; .npmrc remains private if the source uses one.
for manifest_name in package.json package-lock.json .npmrc; do
  source_manifest="$SOURCE_WEBSITE/$manifest_name"
  dependency_manifest="$DEPENDENCY_WEBSITE/$manifest_name"
  if [[ -f "$source_manifest" ]]; then
    rsync -a "$source_manifest" "$dependency_manifest"
  else
    rm -f "$dependency_manifest"
  fi
done

previous_dependency_fingerprint=""
if [[ -f "$DEPENDENCY_STATE_FILE" ]]; then
  previous_dependency_fingerprint="$(awk -F= '$1 == "dependencyFingerprint" { print $2; exit }' "$DEPENDENCY_STATE_FILE" 2>/dev/null || true)"
fi

if [[ -L "$DEPENDENCY_WEBSITE/node_modules" ]]; then
  # Never let npm ci follow a pre-existing link.  The dependency root is
  # private and validated above, so removing the link cannot touch its target.
  rm -f "$DEPENDENCY_WEBSITE/node_modules"
fi

if [[ ! -d "$DEPENDENCY_WEBSITE/node_modules" || "$previous_dependency_fingerprint" != "$DEPENDENCY_FINGERPRINT" ]]; then
  npm --prefix "$DEPENDENCY_WEBSITE" ci
  state_temporary="$DEPENDENCY_STATE_FILE.tmp.$$"
  (
    umask 077
    printf 'version=1\ndependencyFingerprint=%s\n' "$DEPENDENCY_FINGERPRINT" > "$state_temporary"
  )
  mv -f "$state_temporary" "$DEPENDENCY_STATE_FILE"
fi

DESTINATION_NODE_MODULES="$DESTINATION_WEBSITE/node_modules"
if [[ -e "$DESTINATION_NODE_MODULES" || -L "$DESTINATION_NODE_MODULES" ]]; then
  rm -rf "$DESTINATION_NODE_MODULES"
fi
ln -s "$DEPENDENCY_WEBSITE/node_modules" "$DESTINATION_NODE_MODULES"

printf '[website-local-preview] materialized source=%s destination=%s lock=%s dependencies=%s\n' \
  "$SOURCE_ROOT" "$DESTINATION_ROOT" "$DEPENDENCY_FINGERPRINT" "$DEPENDENCY_WEBSITE/node_modules"
