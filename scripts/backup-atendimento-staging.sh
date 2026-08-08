#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy
umask 077

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
PENDING_OUTPUT=''
OUTPUT=''

[[ $# -eq 0 ]] || { echo "Usage: $0" >&2; exit 64; }
for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/pg_dump /usr/bin/sha256sum /usr/bin/install /usr/bin/mktemp /usr/bin/chmod /usr/bin/ln /usr/bin/rm /usr/bin/awk /usr/bin/test /usr/bin/stat; do
  [[ -x "$command_path" ]] || { echo "Missing required command: $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n /usr/bin/true
pending_created=0
output_created=0
cleanup_partial_output() {
  if [[ "$pending_created" == '1' ]]; then
    run_sudo_clean /usr/bin/rm -f -- "$PENDING_OUTPUT" || true
  fi
  if [[ "$output_created" == '1' ]]; then
    run_sudo_clean /usr/bin/rm -f -- "$OUTPUT" || true
  fi
}
trap cleanup_partial_output EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
# PostgreSQL must not traverse the root-private backup hierarchy. Root owns a
# private pending file and receives pg_dump's file-format stdout directly; the
# postgres process never receives a backup path. The final hard link is
# created only after the complete dump and its metadata have been verified.
run_sudo_clean /usr/bin/install -d -m 0700 -o root -g root "$BACKUP_DIR"
PENDING_OUTPUT="$(run_sudo_clean /usr/bin/mktemp "$BACKUP_DIR/$STAMP-clientes-staging-preapply.XXXXXX.dump.partial")"
if [[ ! "$PENDING_OUTPUT" =~ ^/var/backups/skincos/clientes/staging/[0-9]{8}T[0-9]{6}Z-clientes-staging-preapply\.[A-Za-z0-9]{6}\.dump\.partial$ ]]; then
  echo 'Pending backup path was not generated from the fixed contract.' >&2
  exit 1
fi
pending_created=1
OUTPUT="${PENDING_OUTPUT%.partial}"
if [[ ! "$OUTPUT" =~ ^/var/backups/skincos/clientes/staging/[0-9]{8}T[0-9]{6}Z-clientes-staging-preapply\.[A-Za-z0-9]{6}\.dump$ ]]; then
  echo 'Backup output path was not generated from the fixed contract.' >&2
  exit 1
fi
readonly PENDING_OUTPUT OUTPUT
run_sudo_clean /usr/bin/test -f "$PENDING_OUTPUT"
run_sudo_clean /usr/bin/test -O "$PENDING_OUTPUT"
run_sudo_clean /usr/bin/chmod 0600 "$PENDING_OUTPUT"
backup_metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$PENDING_OUTPUT")"
[[ "$backup_metadata" == 'root:root:600' ]] || {
  echo 'Pending backup ownership or mode does not satisfy the private rollback contract.' >&2
  exit 1
}
run_postgres_dump_clean --format=custom --no-owner --no-privileges --dbname="$DATABASE" > "$PENDING_OUTPUT"
run_sudo_clean /usr/bin/test -s "$PENDING_OUTPUT"
backup_metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$PENDING_OUTPUT")"
[[ "$backup_metadata" == 'root:root:600' ]] || {
  echo 'Backup ownership or mode does not satisfy the private rollback contract.' >&2
  exit 1
}
PENDING_HASH="$(run_sudo_clean /usr/bin/sha256sum "$PENDING_OUTPUT" | /usr/bin/awk '{print $1}')"
# link(2) refuses an existing destination. Because both names are inside the
# same root-private directory, the handoff is atomic and a concurrent attempt
# cannot replace a committed rollback artifact.
# Do not let a trappable stop split a successful link from the cleanup
# ownership marker. A failed link still has output_created=0, so the EXIT trap
# removes only this invocation's pending file and cannot delete an existing
# destination.
trap '' HUP INT TERM
run_sudo_clean /usr/bin/ln -- "$PENDING_OUTPUT" "$OUTPUT"
output_created=1
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
run_sudo_clean /usr/bin/rm -f -- "$PENDING_OUTPUT"
pending_created=0
backup_metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$OUTPUT")"
[[ "$backup_metadata" == 'root:root:600' ]] || {
  echo 'Backup ownership or mode does not satisfy the private rollback contract.' >&2
  exit 1
}
HASH="$(run_sudo_clean /usr/bin/sha256sum "$OUTPUT" | /usr/bin/awk '{print $1}')"
[[ "$HASH" == "$PENDING_HASH" ]] || {
  echo 'Backup hash changed during the private handoff.' >&2
  exit 1
}
output_created=0
trap - EXIT HUP INT TERM
printf 'backup_created=true database=%s sha256=%s private=true unique=true\n' "$DATABASE" "$HASH"
