#!/usr/bin/env bash
set -euo pipefail

# Exercises the final native-only backup path without PostgreSQL or a live
# service. No test path traverses DrvFS and the negative case proves that a
# future unit cannot silently reintroduce /mnt/c backup I/O.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d /tmp/skincos-backup-storage-copy-test.XXXXXX)"
runtime_root="$test_root/runtime"
backup_root="$test_root/backups"
fake_bin="$test_root/fake-bin"

cleanup() {
  if [[ "${KEEP_BACKUP_STORAGE_TEST:-0}" == "1" ]]; then
    echo "backup storage test preserved: $test_root" >&2
    return
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$runtime_root/n8n-home/.n8n/storage/nested" "$runtime_root/env" "$runtime_root/health" "$fake_bin"
printf 'payload\n' > "$runtime_root/n8n-home/.n8n/storage/nested/file.txt"
printf 'config\n' > "$runtime_root/n8n-home/.n8n/config"
printf 'N8N_ENCRYPTION_KEY=test-only\n' > "$runtime_root/env/n8n.env"
printf 'N8N_DEFAULT_UNIT_SLUG=test-only\n' > "$runtime_root/env/n8n-business.env"

cat > "$fake_bin/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) shift ;;
    -u) shift 2 ;;
    *) exec "$@" ;;
  esac
done
EOF
cat > "$fake_bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
printf 'dump\n'
EOF
cat > "$fake_bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "--list" ]]; then printf 'restore-list\n'; fi
exit 0
EOF
cat > "$fake_bin/psql" <<'EOF'
#!/usr/bin/env bash
printf '1\n'
EOF
cat > "$fake_bin/createdb" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$fake_bin/dropdb" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$fake_bin"/*

run_backup() {
  PATH="$fake_bin:$PATH" \
    N8N_ROOT="$repo_root" \
    N8N_RUNTIME_HOME="$runtime_root" \
    N8N_ENV_FILE="$runtime_root/env/n8n.env" \
    N8N_BUSINESS_ENV_FILE="$runtime_root/env/n8n-business.env" \
    N8N_DATA_HOME="$runtime_root/n8n-home" \
    N8N_STATE_HOME="$runtime_root/n8n-home/.n8n" \
    N8N_STORAGE_PATH="$runtime_root/n8n-home/.n8n/storage" \
    N8N_CONFIG_PATH="$runtime_root/n8n-home/.n8n/config" \
    N8N_HEALTH_DIR="$runtime_root/health" \
    BACKUP_ROOT="$backup_root" \
    BACKUP_STORAGE_COPY_TRANSPORT=tar \
    MANAGE_N8N_SERVICE=0 \
    VERIFY_RESTORE=1 \
    RETENTION_COUNT=1 \
    bash "$repo_root/scripts/backup-n8n.sh"
}

run_backup
sleep 1
run_backup

mapfile -t backups < <(find "$backup_root" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*' -print)
[[ "${#backups[@]}" == "1" ]]
backup_dir="${backups[0]}"
[[ -f "$backup_dir/storage.tar" ]]
[[ ! -e "$backup_dir/storage" ]]
[[ -f "$backup_dir/runtime/env/n8n.env" ]]
[[ -f "$backup_dir/runtime/env/n8n-business.env" ]]
tar -tf "$backup_dir/storage.tar" | grep -q './nested/file.txt'
grep -q '"restoreVerified": true' "$backup_dir/manifest.json"
grep -q '"storageFormat": "tar"' "$backup_dir/manifest.json"
grep -Eq '"storageArchiveSha256": "[0-9a-f]{64}"' "$backup_dir/manifest.json"
grep -Eq '"storageBytes": [1-9][0-9]*' "$backup_dir/manifest.json"

if PATH="$fake_bin:$PATH" \
  N8N_ROOT="$repo_root" \
  N8N_RUNTIME_HOME="$runtime_root" \
  N8N_STORAGE_PATH=/mnt/c/forbidden-storage \
  BACKUP_ROOT="$backup_root" \
  bash "$repo_root/scripts/backup-n8n.sh" >"$test_root/rejected.out" 2>"$test_root/rejected.err"; then
  echo 'DrvFS backup path was unexpectedly accepted.' >&2
  exit 1
fi
grep -q 'must be native Linux paths' "$test_root/rejected.err"

echo "native backup storage test passed"
