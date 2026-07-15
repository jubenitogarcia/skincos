#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'sudo -n rm -rf "$tmp_dir"' EXIT
fixture="$tmp_dir/n8n-home"
mkdir -p "$fixture/.n8n" "$fixture/storage" "$fixture/nodes"
printf 'config\n' >"$fixture/.n8n/config"
printf 'database\n' >"$fixture/database.sqlite"
printf 'storage\n' >"$fixture/storage/payload"
cat >"$fixture/nodes/package.json" <<'EOF'
{"name":"fixture-nodes","private":true,"dependencies":{}}
EOF
cat >"$fixture/nodes/package-lock.json" <<'EOF'
{"name":"fixture-nodes","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fixture-nodes","dependencies":{}}}}
EOF
archive="$tmp_dir/orb-state.tar"
tar -cf "$archive" -C "$tmp_dir" n8n-home
checksum="$(sha256sum "$archive" | awk '{print $1}')"
runtime_user="$(id -un)"
state_root="$tmp_dir/state"

STATE_ROOT="$state_root" SKINCOS_RUNTIME_USER="$runtime_user" \
  "$ROOT_DIR/scripts/runtime/stage-orb-state-archive.sh" --archive "$archive" --sha256 "$checksum" --apply >/dev/null
staged_home="$state_root/staging/orb-n8n-home-${checksum:0:16}/n8n-home"
[[ -f "$staged_home/state-archive.manifest" ]]
[[ -L "$staged_home/.n8n/nodes/node_modules" ]]
[[ "$(readlink "$staged_home/.n8n/nodes/node_modules")" == "../../nodes/node_modules" ]]

if STATE_ROOT="$state_root" SKINCOS_RUNTIME_USER="$runtime_user" \
  "$ROOT_DIR/scripts/runtime/stage-orb-state-archive.sh" --archive "$archive" --sha256 "$(printf '0%.0s' {1..64})" >/dev/null 2>&1; then
  echo "Checksum mismatch unexpectedly passed" >&2
  exit 1
fi

extracted_home="$tmp_dir/extracted-n8n-home"
cp -a "$fixture" "$extracted_home"
extracted_checksum="$(printf '1%.0s' {1..64})"
STATE_ROOT="$state_root" SKINCOS_RUNTIME_USER="$runtime_user" \
  "$ROOT_DIR/scripts/runtime/stage-orb-state-archive.sh" --extracted-home "$extracted_home" --sha256 "$extracted_checksum" --apply >/dev/null
staged_extracted="$state_root/staging/orb-n8n-home-${extracted_checksum:0:16}/n8n-home"
[[ -f "$staged_extracted/state-archive.manifest" ]]
[[ ! -e "$extracted_home" ]]
echo "stage Orb state archive test passed"
