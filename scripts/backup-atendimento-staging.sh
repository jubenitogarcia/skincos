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
OUTPUT=''
TEMP_OUTPUT=''

[[ $# -eq 0 ]] || { echo "Usage: $0" >&2; exit 64; }
for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/pg_dump /usr/bin/sha256sum /usr/bin/install /usr/bin/mktemp /usr/bin/chmod /usr/bin/chown /usr/bin/rm /usr/bin/awk /usr/bin/test /usr/bin/stat; do
  [[ -x "$command_path" ]] || { echo "Missing required command: $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n /usr/bin/true
output_created=0
cleanup_partial_output() {
  if [[ -n "$TEMP_OUTPUT" ]]; then
    run_sudo_clean /usr/bin/rm -f -- "$TEMP_OUTPUT" || true
  fi
  if [[ "$output_created" == '1' ]]; then
    run_sudo_clean /usr/bin/rm -f -- "$OUTPUT" || true
  fi
}
trap cleanup_partial_output EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
run_sudo_clean /usr/bin/install -d -m 0750 -o root -g postgres "$BACKUP_DIR"
# The directory deliberately has no group write bit. Root creates a unique
# output there, then temporarily hands that file (not the directory) to
# postgres. Concurrent attempts therefore cannot truncate or remove the same
# rollback artifact.
OUTPUT="$(run_sudo_clean /usr/bin/mktemp "$BACKUP_DIR/$STAMP-clientes-staging-preapply.XXXXXX.dump")"
if [[ ! "$OUTPUT" =~ ^/var/backups/skincos/clientes/staging/[0-9]{8}T[0-9]{6}Z-clientes-staging-preapply\.[A-Za-z0-9]{6}\.dump$ ]]; then
  echo 'Backup output path was not generated from the fixed contract.' >&2
  exit 1
fi
run_sudo_clean /usr/bin/test -f "$OUTPUT"
run_sudo_clean /usr/bin/test -O "$OUTPUT"
readonly OUTPUT
output_created=1
# The backup directory is intentionally not traversable by the postgres role.
# Capture into a root-created, mode-0600 temporary file under /tmp, then copy
# the completed dump into the fixed root-private destination. This preserves
# the no-caller-destination contract without granting postgres directory access
# to the rollback artifact.
TEMP_OUTPUT="$(run_sudo_clean /usr/bin/mktemp '/tmp/skincos-clientes-staging-preapply.XXXXXX.dump')"
if [[ ! "$TEMP_OUTPUT" =~ ^/tmp/skincos-clientes-staging-preapply\.[A-Za-z0-9]{6}\.dump$ ]]; then
  echo 'Temporary backup output path was not generated from the fixed contract.' >&2
  exit 1
fi
run_sudo_clean /usr/bin/test -f "$TEMP_OUTPUT"
run_sudo_clean /usr/bin/chown postgres:postgres "$TEMP_OUTPUT"
run_sudo_clean /usr/bin/chmod 0600 "$TEMP_OUTPUT"
run_postgres_dump_clean --format=custom --no-owner --no-privileges --dbname="$DATABASE" --file="$TEMP_OUTPUT"
run_sudo_clean /usr/bin/test -s "$TEMP_OUTPUT"
run_sudo_clean /usr/bin/install -m 0600 -o root -g root "$TEMP_OUTPUT" "$OUTPUT"
run_sudo_clean /usr/bin/rm -f -- "$TEMP_OUTPUT"
TEMP_OUTPUT=''
backup_metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$OUTPUT")"
[[ "$backup_metadata" == 'root:root:600' ]] || {
  echo 'Backup ownership or mode does not satisfy the private rollback contract.' >&2
  exit 1
}
HASH="$(run_sudo_clean /usr/bin/sha256sum "$OUTPUT" | /usr/bin/awk '{print $1}')"
output_created=0
trap - EXIT HUP INT TERM
printf 'backup_created=true database=%s sha256=%s private=true unique=true\n' "$DATABASE" "$HASH"
