#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/runtime/prepare-native-source-release.sh"

bash -n "$SCRIPT"

required=(
  '--archive <native-tar> --sha256 <sha256> --lineage <json> --lineage-sha256 <sha256> [--apply --stage-only]'
  'Windows creates and transfers the archive first'
  '[[ "$RELEASE_ARCHIVE" != /mnt/* ]]'
  'actual_archive_sha256="$(sha256sum "$RELEASE_ARCHIVE"'
  'actual_lineage_sha256="$(sha256sum "$RELEASE_LINEAGE"'
  'value.verifiedAncestor !== true'
  '.skincos-release-lineage.json'
  'sudo -n tar -xf "$RELEASE_ARCHIVE" -C "$STAGING"'
  'find "$STAGING" -type f'
  'workflow-runtime-manifest.js'
  'apply-livia-runtime-isolation.js'
  'Missing required command: setfacl'
  'u:postgres:rwx'
  'LIVIA_BUILD_JOB_GRAPH_SOURCE="$STAGING/orb/engine/compose2-current.js"'
  '--assert-runtime-compatibility'
  '--assert-output-contract'
  '--assert-job-graph-contracts'
  'Direct source-pointer changes are disabled'
)

for pattern in "${required[@]}"; do
  grep -F -- "$pattern" "$SCRIPT" >/dev/null || {
    echo "Missing native source release transfer guard: $pattern" >&2
    exit 1
  }
done

if grep -F -- 'git -C "$CANONICAL_REPO_ROOT" archive' "$SCRIPT" >/dev/null; then
  echo 'Source release must not archive through the Windows checkout from WSL.' >&2
  exit 1
fi

LIVIA_BUILD_JOB_GRAPH_SOURCE="$ROOT_DIR/orb/engine/compose2-current.js" \
  node "$ROOT_DIR/orb/engine/scripts/livia/build-platform-job-graph.js" --assert-runtime-compatibility >/dev/null
LIVIA_BUILD_JOB_GRAPH_SOURCE="$ROOT_DIR/orb/engine/compose2-current.js" \
  node "$ROOT_DIR/orb/engine/scripts/livia/build-platform-job-graph.js" --assert-output-contract >/dev/null
LIVIA_BUILD_JOB_GRAPH_SOURCE="$ROOT_DIR/orb/engine/compose2-current.js" \
  node "$ROOT_DIR/orb/engine/scripts/livia/build-platform-job-graph.js" --assert-job-graph-contracts >/dev/null

"$ROOT_DIR/scripts/runtime/test-workflow-runtime-retention.sh" >/dev/null

echo 'PASS: native source release accepts only a checksum-verified Linux archive.'
