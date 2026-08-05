#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${ATENDIMENTO_STAGING_BACKUP_DIR:-/mnt/c/CodexRuntime/operator/admin/skincos/backups/clientes}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
OUTPUT="$BACKUP_DIR/${STAMP}-clientes-staging-preapply.dump"
sudo -n -u postgres pg_dump --format=custom --no-owner --no-privileges --dbname=skincos_staging --file="$OUTPUT"
chmod 0600 "$OUTPUT"
HASH="$(sha256sum "$OUTPUT" | awk '{print $1}')"
printf 'backup=%s\nsha256=%s\n' "$OUTPUT" "$HASH"
