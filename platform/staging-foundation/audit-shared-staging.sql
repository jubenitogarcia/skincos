-- Read-only schema inventory for the legacy shared staging D1.
SELECT name, type
FROM sqlite_master
WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
ORDER BY name;
