#!/usr/bin/env bash
set -euo pipefail

[[ "${SKINCOS_STAGING_PG_ACK:-}" == "1" ]] || { echo 'SKINCOS_STAGING_PG_ACK=1 is required' >&2; exit 2; }
HBA_FILE="$(sudo -n -u postgres psql -d postgres -Atqc 'show hba_file')"
MARKER='# SKINCOS isolated staging TLS roles'
if ! sudo -n grep -Fq "$MARKER" "$HBA_FILE"; then
  backup="/var/backups/skincos/postgres/$(date -u +%Y%m%dT%H%M%SZ)-pg_hba.conf"
  sudo -n install -d -m 0700 /var/backups/skincos/postgres
  sudo -n cp --preserve=mode,ownership,timestamps "$HBA_FILE" "$backup"
  block="$MARKER\nhostssl skincos_staging skincos_staging_identity_app,skincos_staging_inventory_app,skincos_staging_finance_app,skincos_staging_crm_app,skincos_staging_migrator_login 127.0.0.1/32 scram-sha-256\nhostssl skincos_staging skincos_staging_identity_app,skincos_staging_inventory_app,skincos_staging_finance_app,skincos_staging_crm_app,skincos_staging_migrator_login ::1/128 scram-sha-256\nhostnossl skincos_staging skincos_staging_identity_app,skincos_staging_inventory_app,skincos_staging_finance_app,skincos_staging_crm_app,skincos_staging_migrator_login 127.0.0.1/32 reject\nhostnossl skincos_staging skincos_staging_identity_app,skincos_staging_inventory_app,skincos_staging_finance_app,skincos_staging_crm_app,skincos_staging_migrator_login ::1/128 reject"
  temp_file="$(mktemp)"; trap 'rm -f "$temp_file"' EXIT
  { printf '%b\n\n' "$block"; sudo -n cat "$HBA_FILE"; } > "$temp_file"
  sudo -n install -o postgres -g postgres -m 0640 "$temp_file" "$HBA_FILE"
fi
sudo -n systemctl reload postgresql
