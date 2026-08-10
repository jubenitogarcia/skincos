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

readonly BACKUP_DIR='/var/backups/skincos/clientes/production-readonly'
readonly DATABASE='skincos_clientes_production'
readonly STAMP="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
PENDING_OUTPUT=''
OUTPUT=''
pending_created=0
output_created=0

[[ $# -eq 0 ]] || { echo "Usage: $0" >&2; exit 64; }
for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/pg_dump /usr/bin/sha256sum /usr/bin/install /usr/bin/mktemp /usr/bin/chmod /usr/bin/ln /usr/bin/rm /usr/bin/awk /usr/bin/test /usr/bin/stat /usr/bin/date; do
  [[ -x "$command_path" ]] || { echo "Missing required command: $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n /usr/bin/true

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

run_sudo_clean /usr/bin/install -d -m 0700 -o root -g root "$BACKUP_DIR"
PENDING_OUTPUT="$(run_sudo_clean /usr/bin/mktemp "$BACKUP_DIR/$STAMP-skincos_clientes_production-preapply.XXXXXX.dump.partial")"
if [[ ! "$PENDING_OUTPUT" =~ ^/var/backups/skincos/clientes/production-readonly/[0-9]{8}T[0-9]{6}Z-skincos_clientes_production-preapply\.[A-Za-z0-9]{6}\.dump\.partial$ ]]; then
  echo 'Pending backup path was not generated from the fixed production contract.' >&2
  exit 1
fi
pending_created=1
OUTPUT="${PENDING_OUTPUT%.partial}"
if [[ ! "$OUTPUT" =~ ^/var/backups/skincos/clientes/production-readonly/[0-9]{8}T[0-9]{6}Z-skincos_clientes_production-preapply\.[A-Za-z0-9]{6}\.dump$ ]]; then
  echo 'Backup output path was not generated from the fixed production contract.' >&2
  exit 1
fi
readonly PENDING_OUTPUT OUTPUT
run_sudo_clean /usr/bin/test -f "$PENDING_OUTPUT"
run_sudo_clean /usr/bin/test -O "$PENDING_OUTPUT"
run_sudo_clean /usr/bin/chmod 0600 "$PENDING_OUTPUT"
metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$PENDING_OUTPUT")"
[[ "$metadata" == 'root:root:600' ]] || { echo 'Private production backup spool ownership/mode invalid.' >&2; exit 1; }
run_postgres_dump_clean --format=custom --no-owner --no-privileges --dbname="$DATABASE" > "$PENDING_OUTPUT"
run_sudo_clean /usr/bin/test -s "$PENDING_OUTPUT"
HASH_PENDING="$(run_sudo_clean /usr/bin/sha256sum "$PENDING_OUTPUT" | /usr/bin/awk '{print $1}')"
trap '' HUP INT TERM
run_sudo_clean /usr/bin/ln -- "$PENDING_OUTPUT" "$OUTPUT"
output_created=1
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
run_sudo_clean /usr/bin/rm -f -- "$PENDING_OUTPUT"
pending_created=0
metadata="$(run_sudo_clean /usr/bin/stat -c '%U:%G:%a' "$OUTPUT")"
[[ "$metadata" == 'root:root:600' ]] || { echo 'Production backup ownership/mode changed during handoff.' >&2; exit 1; }
HASH="$(run_sudo_clean /usr/bin/sha256sum "$OUTPUT" | /usr/bin/awk '{print $1}')"
[[ "$HASH" == "$HASH_PENDING" ]] || { echo 'Production backup hash changed during handoff.' >&2; exit 1; }
output_created=0
trap - EXIT HUP INT TERM
printf '%s\n' "backup_created=true database=$DATABASE sha256=$HASH private=true unique=true"
