#!/usr/bin/env bash
set -euo pipefail

# Password values are supplied from the operator secret source and are never
# persisted or printed by this script. Re-running is safe and rotates only the
# explicitly supplied staging principals.
[[ "${SKINCOS_STAGING_PG_ACK:-}" == "1" ]] || { echo 'SKINCOS_STAGING_PG_ACK=1 is required' >&2; exit 2; }

declare -A password_var=(
  [identity]=SKINCOS_PG_IDENTITY_PASSWORD
  [inventory]=SKINCOS_PG_INVENTORY_PASSWORD
  [finance]=SKINCOS_PG_FINANCE_PASSWORD
  [crm]=SKINCOS_PG_CRM_PASSWORD
  [migrator]=SKINCOS_PG_MIGRATOR_PASSWORD
)

for domain in identity inventory finance crm migrator; do
  variable="${password_var[$domain]}"; password="${!variable:-}"
  [[ -n "$password" ]] || { echo "$variable is required" >&2; exit 2; }
  role="skincos_staging_${domain}_app"; [[ "$domain" == migrator ]] && role='skincos_staging_migrator_login'
  limit=4; [[ "$domain" == crm ]] && limit=8; [[ "$domain" == migrator ]] && limit=1
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 -v role="$role" -v password="$password" -v limit="$limit" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOINHERIT CONNECTION LIMIT %s', :'role', :'limit')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I LOGIN NOINHERIT CONNECTION LIMIT %s PASSWORD %L', :'role', :'limit', :'password') \gexec
SELECT format('ALTER ROLE %I SET statement_timeout = %L', :'role', '3000ms') \gexec
SELECT format('ALTER ROLE %I SET lock_timeout = %L', :'role', '1000ms') \gexec
SELECT format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', :'role', '5000ms') \gexec
SQL
done

sudo -n -u postgres psql -d skincos_staging -v ON_ERROR_STOP=1 <<'SQL'
GRANT CONNECT ON DATABASE skincos_staging TO skincos_staging_identity_app,skincos_staging_inventory_app,skincos_staging_finance_app,skincos_staging_crm_app,skincos_staging_migrator_login;
GRANT skincos_staging_identity_owner,skincos_staging_inventory_owner,skincos_staging_finance_owner,skincos_staging_crm_owner TO skincos_staging_migrator_login;
GRANT USAGE ON SCHEMA identity TO skincos_staging_identity_app;
GRANT USAGE ON SCHEMA inventory TO skincos_staging_inventory_app;
GRANT USAGE ON SCHEMA finance TO skincos_staging_finance_app;
GRANT USAGE ON SCHEMA crm_atendimento,harmonia,crm_caixa,crm_sessions TO skincos_staging_crm_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA crm_atendimento,harmonia,crm_caixa,crm_sessions TO skincos_staging_crm_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA crm_atendimento,harmonia,crm_caixa,crm_sessions TO skincos_staging_crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE skincos_staging_crm_owner IN SCHEMA crm_atendimento GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO skincos_staging_crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE skincos_staging_crm_owner IN SCHEMA harmonia GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO skincos_staging_crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE skincos_staging_crm_owner IN SCHEMA crm_caixa GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO skincos_staging_crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE skincos_staging_crm_owner IN SCHEMA crm_sessions GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO skincos_staging_crm_app;
SQL
