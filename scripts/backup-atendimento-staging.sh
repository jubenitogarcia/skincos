#!/usr/bin/env bash
set -euo pipefail

# A pre-migration backup must never accept a caller-controlled destination.
# The fixed native path stays outside the repository and is inaccessible to
# the shared CRM service account.
readonly BACKUP_DIR='/var/backups/skincos/clientes/staging'
readonly DATABASE='skincos_staging'
readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
readonly OUTPUT="$BACKUP_DIR/${STAMP}-clientes-staging-preapply.dump"

[[ $# -eq 0 ]] || { echo "Usage: $0" >&2; exit 64; }
for command_name in sudo pg_dump sha256sum install; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }
done
sudo -n true
sudo -n install -d -m 0750 -o root -g postgres "$BACKUP_DIR"
sudo -n -u postgres pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE" --file="$OUTPUT"
sudo -n chmod 0600 "$OUTPUT"
HASH="$(sudo -n sha256sum "$OUTPUT" | awk '{print $1}')"
printf 'backup_created=true database=%s sha256=%s\n' "$DATABASE" "$HASH"
