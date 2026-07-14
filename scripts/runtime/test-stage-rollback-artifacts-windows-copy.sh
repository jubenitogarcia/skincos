#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v robocopy.exe >/dev/null 2>&1 || { echo "robocopy test skipped: unavailable"; exit 0; }

tmp_dir="$(mktemp -d /mnt/c/CodexRuntime/tmp/rollback-artifact-test.XXXXXX)"
trap 'rm -rf "$tmp_dir"' EXIT
runtime_root="$tmp_dir/runtime"
legacy_root="$tmp_dir/legacy"
rollback_root="$tmp_dir/rollback"
artifact_root="$runtime_root/artifacts/runtime-cutover/test"

mkdir -p \
  "$legacy_root/modules/automations/n8n/workflows" \
  "$legacy_root/modules/crm/api/node_modules/express" \
  "$rollback_root/modules/automations/n8n/workflows" \
  "$rollback_root/modules/crm/api"
touch "$rollback_root/.git"
printf '{"name":"Livia"}\n' >"$legacy_root/modules/automations/n8n/workflows/livia.active.json"
printf '{}' >"$legacy_root/modules/crm/api/node_modules/express/package.json"

RUNTIME_ROOT="$runtime_root" LEGACY_REPO_ROOT="$legacy_root" ROLLBACK_ARTIFACT_SYNC_TRANSPORT=robocopy \
  "$ROOT_DIR/scripts/runtime/stage-rollback-artifacts.sh" \
    --rollback-root "$rollback_root" \
    --artifact-root "$artifact_root" >/dev/null

[[ -f "$artifact_root/crm/node_modules/express/package.json" ]]
[[ "$(readlink -f "$rollback_root/modules/crm/api/node_modules")" == "$(readlink -f "$artifact_root/crm/node_modules")" ]]
echo "stage rollback artifacts robocopy test passed"
