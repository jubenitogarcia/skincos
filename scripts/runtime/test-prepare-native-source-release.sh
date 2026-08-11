#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/runtime/prepare-native-source-release.sh"

bash -n "$SCRIPT"

required=(
  '--archive <native-tar> --sha256 <sha256> --lineage <json> --lineage-sha256 <sha256> [--coordination-closure <json>]... [--apply --stage-only]'
  'Windows creates and transfers the archive first'
  '[[ "$RELEASE_ARCHIVE" != /mnt/* ]]'
  'actual_archive_sha256="$(sha256sum "$RELEASE_ARCHIVE"'
  'actual_lineage_sha256="$(sha256sum "$RELEASE_LINEAGE"'
  'value.verifiedAncestor !== true'
  '--coordination-closure'
  'At least one --coordination-closure attestation is required'
  'coordination_native_runtime_closure'
  'A native-runtime dependency-closure attestation is required'
  '.skincos-global-coordination-'
  'coordination closure identity or digest is invalid'
  '.skincos-release-lineage.json'
  'readonly ARCHIVE_PREFIX="skincos-$RELEASE_ID/"'
  'tar -tzf "$RELEASE_ARCHIVE"'
  'Source archive must contain only the expected top-level prefix'
  'sudo -n tar -xzf "$RELEASE_ARCHIVE" --strip-components=1 -C "$STAGING"'
  'for acl_dir in "$RELEASE_BASE" "$RELEASE_BASE/$RELEASE_ID"'
  'find "$STAGING" -type f'
  'workflow-runtime-manifest.js'
  'apply-livia-runtime-isolation.js'
  'prepare-livia-production-candidate.js'
  'validate-livia-workflow.js'
  'patch-livia-drive-publication-marks.js'
  'patch-livia-token-vault-preflight.js'
  'patch-livia-accessibility-contract.js'
  'patch-livia-facebook-carousel-contract.js'
  'patch-livia-schedule-cadence.js'
  'patch-livia-today-first-selection.js'
  'patch-livia-job-graph-payload-file.js'
  'patch-livia-notification-contract.js'
  'patch-livia-ai-reel-covers.js'
  'patch-livia-runtime-isolation.js'
  'Missing required command: setfacl'
  'u:postgres:rwx'
  'inspect-meta-ads-publish-version-alignment.js'
  'validate-meta-ads-publish-preflight.js'
  'workflow-src/meta-ads-publish'
  'setfacl -Rm u:postgres:rX'
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
