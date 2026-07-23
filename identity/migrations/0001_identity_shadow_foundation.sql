-- Identity owns this schema independently from the legacy crm_* tables.
-- The migration intentionally contains no password or session material copied
-- from the shared D1. Shadow subjects are pseudonymous and non-loginable.
CREATE TABLE IF NOT EXISTS identity_users (
  id TEXT PRIMARY KEY,
  source_ordinal INTEGER NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  allowed_units_json TEXT NOT NULL,
  allowed_modules_json TEXT NOT NULL,
  ativo INTEGER NOT NULL CHECK(ativo IN (0,1)),
  session_version INTEGER NOT NULL DEFAULT 0,
  migration_state TEXT NOT NULL DEFAULT 'shadow' CHECK(migration_state IN ('shadow','active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_invites (
  id TEXT PRIMARY KEY,
  migration_state TEXT NOT NULL DEFAULT 'shadow' CHECK(migration_state IN ('shadow','active','disabled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_password_resets (
  id TEXT PRIMARY KEY,
  migration_state TEXT NOT NULL DEFAULT 'shadow' CHECK(migration_state IN ('shadow','active','disabled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_user_prefs (
  subject_id TEXT PRIMARY KEY REFERENCES identity_users(id),
  prefs_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_compatibility_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO identity_compatibility_state(key,value,updated_at)
VALUES ('legacy_shared_d1_mode','read-primary',CURRENT_TIMESTAMP);
