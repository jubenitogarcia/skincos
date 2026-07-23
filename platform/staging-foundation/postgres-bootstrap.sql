\set ON_ERROR_STOP on

SELECT 'CREATE ROLE skincos_staging_owner NOLOGIN NOINHERIT' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_staging_owner') \gexec
SELECT 'CREATE ROLE skincos_staging_migrator NOLOGIN NOINHERIT' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_staging_migrator') \gexec
SELECT 'CREATE ROLE skincos_staging_identity_owner NOLOGIN NOINHERIT' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_staging_identity_owner') \gexec
SELECT 'CREATE ROLE skincos_staging_inventory_owner NOLOGIN NOINHERIT' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_staging_inventory_owner') \gexec
SELECT 'CREATE ROLE skincos_staging_finance_owner NOLOGIN NOINHERIT' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_staging_finance_owner') \gexec
SELECT 'CREATE ROLE skincos_staging_identity_runtime NOLOGIN NOINHERIT' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_staging_identity_runtime') \gexec
SELECT 'CREATE ROLE skincos_staging_inventory_runtime NOLOGIN NOINHERIT' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_staging_inventory_runtime') \gexec
SELECT 'CREATE ROLE skincos_staging_finance_runtime NOLOGIN NOINHERIT' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skincos_staging_finance_runtime') \gexec

GRANT skincos_staging_identity_owner, skincos_staging_inventory_owner, skincos_staging_finance_owner TO skincos_staging_migrator;
SELECT 'CREATE DATABASE skincos_staging OWNER skincos_staging_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'skincos_staging') \gexec

\connect skincos_staging
REVOKE ALL ON DATABASE skincos_staging FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION skincos_staging_identity_owner;
CREATE SCHEMA IF NOT EXISTS inventory AUTHORIZATION skincos_staging_inventory_owner;
CREATE SCHEMA IF NOT EXISTS finance AUTHORIZATION skincos_staging_finance_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE skincos_staging TO skincos_staging_migrator, skincos_staging_identity_runtime, skincos_staging_inventory_runtime, skincos_staging_finance_runtime;
GRANT USAGE ON SCHEMA identity TO skincos_staging_identity_runtime;
GRANT USAGE ON SCHEMA inventory TO skincos_staging_inventory_runtime;
GRANT USAGE ON SCHEMA finance TO skincos_staging_finance_runtime;

-- Login credentials are deliberately not created here. They must be generated
-- and stored in the approved secret manager during each runtime cutover.
