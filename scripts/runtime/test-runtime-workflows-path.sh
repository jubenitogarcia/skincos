#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
expected="$(mktemp -d)"
trap 'rm -rf "$expected"' EXIT

N8N_WORKFLOWS_DIR="$expected" node - "$ROOT_DIR/orb/engine/scripts/lib/runtime-paths.js" <<'NODE'
const assert = require('node:assert/strict');
const runtimePaths = require(process.argv[2]);
assert.equal(runtimePaths.workflowsDir, process.env.N8N_WORKFLOWS_DIR);
NODE

echo "runtime workflows path test passed"
