#!/usr/bin/env bash
set -euo pipefail

# A Git worktree is intentionally source-only. This helper stages the two
# non-Git runtime inputs required by the legacy rollback path in CodexRuntime
# and attaches them to the retained rollback worktree as symlinks. It does not
# copy secrets, modify a service, or stop a process.

RUNTIME_ROOT="${RUNTIME_ROOT:-/mnt/c/CodexRuntime}"
LEGACY_REPO_ROOT="${LEGACY_REPO_ROOT:-/mnt/c/CodexShared/Projetos/skincos}"
ROLLBACK_ROOT=""
ARTIFACT_ROOT=""
SOURCE_LIVIA_WORKFLOW=""
SOURCE_CRM_NODE_MODULES=""

usage() {
  cat <<'EOF'
Usage:
  scripts/runtime/stage-rollback-artifacts.sh \
    --rollback-root <legacy-worktree> \
    --artifact-root <CodexRuntime-artifact-directory>

The artifact directory must be under C:\CodexRuntime. The helper copies the
runtime Livia workflow and CRM production dependencies there, then creates
verified symlinks in the retained rollback worktree. It requires a new, empty
artifact directory so an existing rollback bundle is never overwritten. Run it
before the dry-run and retain the artifacts until the post-cut backup and smoke
checks complete.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rollback-root) ROLLBACK_ROOT="${2:-}"; shift ;;
    --artifact-root) ARTIFACT_ROOT="${2:-}"; shift ;;
    --source-livia-workflow) SOURCE_LIVIA_WORKFLOW="${2:-}"; shift ;;
    --source-crm-node-modules) SOURCE_CRM_NODE_MODULES="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

require_cmd rsync
require_cmd readlink
require_cmd sha256sum
[[ -n "$ROLLBACK_ROOT" && -e "$ROLLBACK_ROOT/.git" ]] || { echo "--rollback-root must name a retained Git worktree." >&2; exit 1; }
[[ -n "$ARTIFACT_ROOT" ]] || { echo "--artifact-root is required." >&2; exit 1; }

runtime_root_real="$(readlink -f "$RUNTIME_ROOT")"
artifact_root_real="$(readlink -m "$ARTIFACT_ROOT")"
case "$artifact_root_real" in
  "$runtime_root_real"/*) ;;
  *) echo "--artifact-root must be inside $RUNTIME_ROOT." >&2; exit 1 ;;
esac
if [[ -e "$ARTIFACT_ROOT" ]] && find "$ARTIFACT_ROOT" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  echo "--artifact-root must be a new or empty directory; do not overwrite an existing rollback bundle." >&2
  exit 1
fi

SOURCE_LIVIA_WORKFLOW="${SOURCE_LIVIA_WORKFLOW:-$LEGACY_REPO_ROOT/modules/automations/n8n/workflows/livia.active.json}"
SOURCE_CRM_NODE_MODULES="${SOURCE_CRM_NODE_MODULES:-$LEGACY_REPO_ROOT/modules/crm/api/node_modules}"
[[ -f "$SOURCE_LIVIA_WORKFLOW" ]] || { echo "Missing source Livia workflow: $SOURCE_LIVIA_WORKFLOW" >&2; exit 1; }
[[ -d "$SOURCE_CRM_NODE_MODULES/express" ]] || { echo "Missing source CRM dependencies: $SOURCE_CRM_NODE_MODULES/express" >&2; exit 1; }

workflow_target="$ARTIFACT_ROOT/orb/workflows/livia.active.json"
dependencies_target="$ARTIFACT_ROOT/crm/node_modules"
mkdir -p "$(dirname "$workflow_target")" "$(dirname "$dependencies_target")"
install -m 0640 "$SOURCE_LIVIA_WORKFLOW" "$workflow_target"
rsync -a "$SOURCE_CRM_NODE_MODULES/" "$dependencies_target/"

link_artifact() {
  local target="$1"
  local link="$2"
  mkdir -p "$(dirname "$link")"
  if [[ -L "$link" ]]; then
    [[ "$(readlink -f "$link")" == "$(readlink -f "$target")" ]] || {
      echo "Existing rollback link points elsewhere: $link" >&2
      return 1
    }
    return 0
  fi
  [[ ! -e "$link" ]] || { echo "Rollback path already exists and is not a symlink: $link" >&2; return 1; }
  ln -s "$target" "$link"
}

link_artifact "$workflow_target" "$ROLLBACK_ROOT/modules/automations/n8n/workflows/livia.active.json"
link_artifact "$dependencies_target" "$ROLLBACK_ROOT/modules/crm/api/node_modules"

cat <<EOF
Rollback artifacts staged.
  workflow_sha256=$(sha256sum "$workflow_target" | awk '{print $1}')
  workflow=$workflow_target
  crm_dependencies=$dependencies_target
EOF
