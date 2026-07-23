-- Additive ownership marker for the Identity extraction.
-- crm_* remains the physical compatibility schema in this release. Do not
-- rename, copy or delete users/sessions as part of this migration.
CREATE TABLE IF NOT EXISTS identity_schema_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO identity_schema_state(key, value, updated_at)
VALUES ('identity_adoption', 'crm_tables_compatibility_mode', CURRENT_TIMESTAMP);
