#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v robocopy.exe >/dev/null 2>&1 || { echo "robocopy test skipped: unavailable"; exit 0; }

tmp_dir="$(mktemp -d /mnt/c/CodexRuntime/tmp/lifecycle-layout-test.XXXXXX)"
trap 'rm -rf "$tmp_dir"' EXIT
runtime_root="$tmp_dir/runtime"
legacy_root="$tmp_dir/legacy"
layout_env=(
  "RUNTIME_ROOT=$runtime_root"
  "STATE_ROOT=$runtime_root/state"
  "CONFIG_ROOT=$runtime_root/config"
  "LOG_ROOT=$runtime_root/logs"
  "TMP_ROOT=$runtime_root/tmp"
  "ARTIFACT_ROOT=$runtime_root/artifacts"
)

mkdir -p \
  "$runtime_root/n8n/n8n-home" \
  "$runtime_root/n8n/evolution-api/instances" \
  "$runtime_root/n8n/evolution-api/store" \
  "$legacy_root/orb/engine/workflows"
printf 'source-v1\n' >"$runtime_root/n8n/n8n-home/payload.txt"
printf '{"name":"Livia"}\n' >"$legacy_root/orb/engine/workflows/livia.active.json"

env "${layout_env[@]}" LEGACY_REPO_ROOT="$legacy_root" LIFECYCLE_SYNC_TRANSPORT=robocopy \
  "$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --apply >/dev/null

[[ "$(<"$runtime_root/state/orb/n8n-home/payload.txt")" == "source-v1" ]]
[[ -f "$runtime_root/state/orb/workflows/livia.active.json" ]]

printf 'destination-preserved\n' >"$runtime_root/state/orb/n8n-home/payload.txt"
printf 'source-v2\n' >"$runtime_root/n8n/n8n-home/payload.txt"
env "${layout_env[@]}" LEGACY_REPO_ROOT="$legacy_root" LIFECYCLE_SYNC_TRANSPORT=robocopy \
  "$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --apply >/dev/null
[[ "$(<"$runtime_root/state/orb/n8n-home/payload.txt")" == "destination-preserved" ]]

env "${layout_env[@]}" LEGACY_REPO_ROOT="$legacy_root" LIFECYCLE_SYNC_TRANSPORT=robocopy \
  "$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --apply --final-sync >/dev/null
[[ "$(<"$runtime_root/state/orb/n8n-home/payload.txt")" == "source-v2" ]]
echo "prepare lifecycle layout robocopy test passed"
