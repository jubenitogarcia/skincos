#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/runtime/assert-workflow-runtime-retention.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

release='0123456789abcdef0123456789abcdef01234567'
runtime="$TMP_DIR/runtime"
releases="$TMP_DIR/releases"
mkdir -p "$runtime/workflow-runtime-manifests/WGXr4vYkv9UoJ8zc" "$releases/$release/source/orb/engine"
cat >"$runtime/workflow-runtime-manifests/WGXr4vYkv9UoJ8zc/9f7beced-c075-46d1-be78-0e26968e135e.json" <<EOF
{"releaseRoot":"$releases/$release/source/orb/engine"}
EOF

N8N_RUNTIME_HOME="$runtime" SKINCOS_RELEASE_BASE="$releases" "$SCRIPT" >/dev/null
if N8N_RUNTIME_HOME="$runtime" SKINCOS_RELEASE_BASE="$releases" "$SCRIPT" --candidate-delete "$release" >/dev/null 2>&1; then
  echo 'Expected protected release cleanup refusal.' >&2
  exit 1
fi
echo 'PASS: workflow manifest references protect immutable releases from cleanup.'
