\set ON_ERROR_STOP on

WITH expected(rolname) AS (
  VALUES
    ('skincos_staging_owner'), ('skincos_staging_migrator'),
    ('skincos_staging_identity_owner'), ('skincos_staging_inventory_owner'), ('skincos_staging_finance_owner'),
    ('skincos_staging_identity_runtime'), ('skincos_staging_inventory_runtime'), ('skincos_staging_finance_runtime')
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM expected e LEFT JOIN pg_roles r USING (rolname)
  WHERE r.rolname IS NULL OR r.rolcanlogin OR r.rolinherit
) THEN 'invalid' ELSE 'ok' END;

SELECT COUNT(*)
FROM pg_namespace
WHERE nspname IN ('identity', 'inventory', 'finance');
