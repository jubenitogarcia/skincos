-- Target schema for the independent Identity D1.
-- This migration is not applied to the shared skincos-db compatibility source.
CREATE TABLE IF NOT EXISTS identity_users (
  subject TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CONSULTOR',
  photo_url TEXT,
  allowed_units_json TEXT,
  allowed_modules_json TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_users_email_unique ON identity_users(LOWER(email)) WHERE email IS NOT NULL AND TRIM(email) <> '';

CREATE TABLE IF NOT EXISTS identity_invites (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, token_hint TEXT, role TEXT NOT NULL,
  allowed_units_json TEXT, allowed_modules_json TEXT, invitee_email TEXT, max_uses INTEGER NOT NULL DEFAULT 1,
  uses_count INTEGER NOT NULL DEFAULT 0, expires_at TEXT, revoked INTEGER NOT NULL DEFAULT 0, note TEXT,
  created_by_subject TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS identity_invites_invitee_email ON identity_invites(invitee_email, revoked, expires_at);

CREATE TABLE IF NOT EXISTS identity_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL, subject TEXT NOT NULL,
  email TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, sent_at TEXT,
  verified_at TEXT, grant_hash TEXT, verification_attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT
);
CREATE INDEX IF NOT EXISTS identity_password_resets_active_email ON identity_password_resets(email, sent_at, expires_at, used_at);

CREATE TABLE IF NOT EXISTS identity_user_prefs (subject TEXT PRIMARY KEY, prefs_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS identity_auth_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, username TEXT, ip TEXT, success INTEGER NOT NULL DEFAULT 0, reason TEXT);
CREATE INDEX IF NOT EXISTS identity_auth_attempts_user_ts ON identity_auth_attempts(username, ts);
CREATE INDEX IF NOT EXISTS identity_auth_attempts_ip_ts ON identity_auth_attempts(ip, ts);
