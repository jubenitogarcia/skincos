-- Execute once through the PostgreSQL migration pipeline as the cluster owner.
-- LOGIN/password/credential rotation is performed outside Git for each role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_crm_harmonia') THEN CREATE ROLE skincos_crm_harmonia NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_crm_atendimento') THEN CREATE ROLE skincos_crm_atendimento NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_crm_caixa') THEN CREATE ROLE skincos_crm_caixa NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_crm_tracking') THEN CREATE ROLE skincos_crm_tracking NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_crm_migrator') THEN CREATE ROLE skincos_crm_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF;
END $$;

GRANT USAGE ON SCHEMA harmonia TO skincos_crm_harmonia;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA harmonia TO skincos_crm_harmonia;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA harmonia TO skincos_crm_harmonia;
GRANT USAGE ON SCHEMA crm_atendimento TO skincos_crm_atendimento, skincos_crm_caixa;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA crm_atendimento TO skincos_crm_atendimento;
GRANT SELECT ON ALL TABLES IN SCHEMA crm_atendimento TO skincos_crm_tracking;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA crm_atendimento TO skincos_crm_atendimento;
GRANT USAGE ON SCHEMA crm_caixa TO skincos_crm_caixa;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA crm_caixa TO skincos_crm_caixa;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA crm_caixa TO skincos_crm_caixa;
GRANT USAGE, CREATE ON SCHEMA harmonia, crm_atendimento, crm_caixa TO skincos_crm_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA harmonia, crm_atendimento, crm_caixa TO skincos_crm_migrator;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA harmonia, crm_atendimento, crm_caixa TO skincos_crm_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA harmonia GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skincos_crm_harmonia;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm_atendimento GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skincos_crm_atendimento;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm_caixa GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skincos_crm_caixa;
