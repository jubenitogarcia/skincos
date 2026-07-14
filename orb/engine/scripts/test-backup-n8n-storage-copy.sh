#!/usr/bin/env bash
set -euo pipefail

# Exercises the Windows-hosted storage branch without PostgreSQL or a live
# service. The fake database commands keep the test focused on the snapshot,
# manifest and restore-verification control flow.

robocopy_bin="$(command -v robocopy.exe 2>/dev/null || true)"
if [[ -z "$robocopy_bin" ]]; then
  for candidate in /mnt/c/Windows/System32/robocopy.exe /mnt/c/WINDOWS/system32/robocopy.exe; do
    if [[ -x "$candidate" ]]; then
      robocopy_bin="$candidate"
      break
    fi
  done
fi
[[ -n "$robocopy_bin" ]] || { echo "backup robocopy test skipped: unavailable"; exit 0; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="/mnt/c/CodexRuntime/tmp/backup-storage-copy-test.$$"
runtime_root="$test_root/runtime"
backup_root="$test_root/backups"
fake_bin="$test_root/fake-bin"

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$runtime_root/n8n-home/.n8n/storage/nested" "$runtime_root/env" "$runtime_root/health" "$fake_bin"
printf 'payload\n' > "$runtime_root/n8n-home/.n8n/storage/nested/file.txt"
printf 'config\n' > "$runtime_root/n8n-home/.n8n/config"
printf 'N8N_ENCRYPTION_KEY=test-only\n' > "$runtime_root/env/n8n.env"

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
set -euo pipefail
for arg in "$@"; do
  case "$arg" in
    --file=*) printf 'dump\n' > "${arg#--file=}"; exit 0 ;;
  esac
done
exit 1
EOF
cat > "$fake_bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--list" ]]; then
  printf 'restore-list\n'
fi
EOF
cat > "$fake_bin/psql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
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

PATH="$fake_bin:$PATH" \
  N8N_ROOT="$repo_root" \
  N8N_RUNTIME_HOME="$runtime_root" \
  N8N_ENV_FILE="$runtime_root/env/n8n.env" \
  N8N_DATA_HOME="$runtime_root/n8n-home" \
  N8N_STATE_HOME="$runtime_root/n8n-home/.n8n" \
  N8N_STORAGE_PATH="$runtime_root/n8n-home/.n8n/storage" \
  N8N_CONFIG_PATH="$runtime_root/n8n-home/.n8n/config" \
  N8N_HEALTH_DIR="$runtime_root/health" \
  BACKUP_ROOT="$backup_root" \
  BACKUP_STORAGE_COPY_TRANSPORT=robocopy \
  ROBOCOPY_BIN="$robocopy_bin" \
  MANAGE_N8N_SERVICE=0 \
  VERIFY_RESTORE=1 \
  RETENTION_COUNT=1 \
  bash "$repo_root/scripts/backup-n8n.sh"

backup_dir="$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*' -print -quit)"
[[ -f "$backup_dir/storage/nested/file.txt" ]]
grep -q '"restoreVerified": true' "$backup_dir/manifest.json"
grep -q '"storageBytes": null' "$backup_dir/manifest.json"

echo "backup robocopy storage test passed"
