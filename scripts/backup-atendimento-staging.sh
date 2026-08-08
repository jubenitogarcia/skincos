#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/nonexistent' 'LANG=C' "$@"
}

run_postgres_dump_clean() {
  /usr/bin/sudo -n -u postgres /usr/bin/env -i \
    "PATH=$SAFE_PATH" 'HOME=/var/lib/postgresql' 'LANG=C' /usr/bin/pg_dump "$@"
}

# A pre-migration backup must never accept a caller-controlled destination.
# The fixed native path stays outside the repository and is inaccessible to
# the shared CRM service account.
readonly BACKUP_DIR='/var/backups/skincos/clientes/staging'
readonly DATABASE='skincos_staging'
readonly STAMP="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
readonly OUTPUT="$BACKUP_DIR/${STAMP}-clientes-staging-preapply.dump"

[[ $# -eq 0 ]] || { echo "Usage: $0" >&2; exit 64; }
for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/pg_dump /usr/bin/sha256sum /usr/bin/install /usr/bin/chmod /usr/bin/awk; do
  [[ -x "$command_path" ]] || { echo "Missing required command: $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n /usr/bin/true
run_sudo_clean /usr/bin/install -d -m 0750 -o root -g postgres "$BACKUP_DIR"
run_postgres_dump_clean --format=custom --no-owner --no-privileges --dbname="$DATABASE" --file="$OUTPUT"
run_sudo_clean /usr/bin/chmod 0600 "$OUTPUT"
HASH="$(run_sudo_clean /usr/bin/sha256sum "$OUTPUT" | /usr/bin/awk '{print $1}')"
printf 'backup_created=true database=%s sha256=%s\n' "$DATABASE" "$HASH"
