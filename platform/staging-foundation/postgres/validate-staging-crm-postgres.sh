#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
identity_password="$(openssl rand -hex 32)"
inventory_password="$(openssl rand -hex 32)"
finance_password="$(openssl rand -hex 32)"
crm_password="$(openssl rand -hex 32)"
migrator_password="$(openssl rand -hex 32)"

sudo -n -u postgres psql -d postgres -f "$ROOT_DIR/platform/staging-foundation/postgres-bootstrap.sql" >/dev/null
SKINCOS_STAGING_PG_ACK=1 \
SKINCOS_PG_IDENTITY_PASSWORD="$identity_password" \
SKINCOS_PG_INVENTORY_PASSWORD="$inventory_password" \
SKINCOS_PG_FINANCE_PASSWORD="$finance_password" \
SKINCOS_PG_CRM_PASSWORD="$crm_password" \
SKINCOS_PG_MIGRATOR_PASSWORD="$migrator_password" \
  bash "$ROOT_DIR/platform/staging-foundation/postgres/provision-staging-principals.sh" >/dev/null
SKINCOS_STAGING_PG_ACK=1 bash "$ROOT_DIR/platform/staging-foundation/postgres/apply-staging-hba.sh"

DATABASE_URL="postgresql://skincos_staging_migrator_login:${migrator_password}@127.0.0.1:5432/skincos_staging" \
PGTLS_CA_FILE=/etc/ssl/certs/ssl-cert-snakeoil.pem \
PGTLS_SERVER_NAME=jubenitogarcia.localdomain \
PG_MIGRATION_SET_ROLE=skincos_staging_crm_owner \
  node "$ROOT_DIR/crm/api/scripts/apply-postgres-migrations.mjs"

PGPASSWORD="$crm_password" psql "host=jubenitogarcia.localdomain hostaddr=127.0.0.1 port=5432 dbname=skincos_staging user=skincos_staging_crm_app sslmode=verify-full sslrootcert=/etc/ssl/certs/ssl-cert-snakeoil.pem" -Atqc 'select ssl from pg_stat_ssl where pid=pg_backend_pid()' | grep -qx t
if PGPASSWORD="$crm_password" psql "host=127.0.0.1 port=5432 dbname=skincos_staging user=skincos_staging_crm_app sslmode=disable" -Atqc 'select 1' >/dev/null 2>&1; then
  echo 'non-TLS staging CRM connection was accepted' >&2
  exit 1
fi

for domain in identity inventory finance; do
  password_var="${domain}_password"
  password="${!password_var}"
  PGPASSWORD="$password" psql "host=jubenitogarcia.localdomain hostaddr=127.0.0.1 port=5432 dbname=skincos_staging user=skincos_staging_${domain}_app sslmode=verify-full sslrootcert=/etc/ssl/certs/ssl-cert-snakeoil.pem" -Atqc "select has_schema_privilege(current_user, '$domain', 'usage')" | grep -qx t
done

if PGPASSWORD="$crm_password" psql "host=jubenitogarcia.localdomain hostaddr=127.0.0.1 port=5432 dbname=skincos_staging user=skincos_staging_crm_app sslmode=verify-full sslrootcert=/etc/ssl/certs/ssl-cert-snakeoil.pem" -Atqc "select has_schema_privilege(current_user, 'identity', 'usage')" | grep -qx t; then
  echo 'CRM app role has unexpected Identity schema access' >&2
  exit 1
fi
if PGPASSWORD="$crm_password" psql "host=jubenitogarcia.localdomain hostaddr=127.0.0.1 port=5432 dbname=skincos_staging user=skincos_staging_crm_app sslmode=verify-full sslrootcert=/etc/ssl/certs/ssl-cert-snakeoil.pem" -Atqc 'create table crm_atendimento.role_isolation_probe(id int)' >/dev/null 2>&1; then
  echo 'CRM app role unexpectedly created DDL' >&2
  exit 1
fi

DATABASE_URL="postgresql://skincos_staging_crm_app:${crm_password}@127.0.0.1:5432/skincos_staging" \
PGTLS_CA_FILE=/etc/ssl/certs/ssl-cert-snakeoil.pem \
PGTLS_SERVER_NAME=jubenitogarcia.localdomain \
  node "$ROOT_DIR/crm/api/scripts/validate-postgres-staging.mjs"

echo 'staging PostgreSQL roles, TLS, migrations and CRM pools validated'
