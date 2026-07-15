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
  "$runtime_root/n8n/env" \
  "$runtime_root/n8n/evolution-api/instances" \
  "$runtime_root/n8n/evolution-api/store" \
  "$legacy_root/orb/engine/workflows"
printf 'source-v1\n' >"$runtime_root/n8n/n8n-home/payload.txt"
printf 'AUTHENTICATION_API_KEY=test-only-private-key\n' >"$runtime_root/n8n/env/evolution-api.env"
printf '{"name":"Livia"}\n' >"$legacy_root/orb/engine/workflows/livia.active.json"

env "${layout_env[@]}" LEGACY_REPO_ROOT="$legacy_root" LIFECYCLE_SYNC_TRANSPORT=robocopy \
  "$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --apply >/dev/null

[[ ! -e "$runtime_root/state/orb/n8n-home/payload.txt" ]]
[[ -f "$runtime_root/state/orb/workflows/livia.active.json" ]]
grep -Fx 'WA_ORCHESTRATOR_PROVIDER=evolution' "$runtime_root/config/crm-whatsapp.env" >/dev/null
grep -Fx 'EVOLUTION_API_URL=http://127.0.0.1:8080' "$runtime_root/config/crm-whatsapp.env" >/dev/null
grep -Fx 'EVOLUTION_API_KEY=test-only-private-key' "$runtime_root/config/crm-whatsapp.env" >/dev/null

printf 'source-v2\n' >"$runtime_root/n8n/n8n-home/payload.txt"
env "${layout_env[@]}" LEGACY_REPO_ROOT="$legacy_root" LIFECYCLE_SYNC_TRANSPORT=robocopy \
  "$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --apply >/dev/null
[[ ! -e "$runtime_root/state/orb/n8n-home/payload.txt" ]]

env "${layout_env[@]}" LEGACY_REPO_ROOT="$legacy_root" LIFECYCLE_SYNC_TRANSPORT=robocopy \
  "$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --apply --final-sync >/dev/null
[[ ! -e "$runtime_root/state/orb/n8n-home/payload.txt" ]]

# The cutover path must be able to avoid *all* legacy reads after the
# Windows-native transfer is staged. It may not recreate secrets or state from
# the test legacy root even during the final window.
rm -rf "$runtime_root/state" "$runtime_root/config"
mkdir -p "$runtime_root/config"
printf 'AUTHENTICATION_API_KEY=test-only-private-key\n' >"$runtime_root/config/messaging-whatsapp.env"
env "${layout_env[@]}" LEGACY_REPO_ROOT="$legacy_root" LIFECYCLE_SYNC_TRANSPORT=robocopy \
  "$ROOT_DIR/scripts/runtime/prepare-lifecycle-layout.sh" --apply --final-sync --skip-legacy-transfer >/dev/null
[[ ! -e "$runtime_root/state/messaging-whatsapp/instances" ]]
[[ ! -e "$runtime_root/config/orb.env" ]]
grep -Fx 'EVOLUTION_API_KEY=test-only-private-key' "$runtime_root/config/crm-whatsapp.env" >/dev/null
runtime_paths="$runtime_root/config/orb-runtime-paths.env"
[[ -f "$runtime_paths" ]]
grep -Fx "N8N_USER_FOLDER=$runtime_root/state/orb/n8n-home" "$runtime_paths" >/dev/null
grep -Fx "N8N_STORAGE_PATH=$runtime_root/state/orb/n8n-home/.n8n/storage" "$runtime_paths" >/dev/null
grep -Fx "N8N_LOG_FILE_LOCATION=$runtime_root/logs/orb/n8n.log" "$runtime_paths" >/dev/null
grep -Fx 'N8N_RESTRICT_FILE_ACCESS_TO=/tmp' "$runtime_paths" >/dev/null
! grep -q '/mnt/c/CodexRuntime/n8n' "$runtime_paths"
echo "prepare lifecycle layout excludes Orb n8n-home test passed"
