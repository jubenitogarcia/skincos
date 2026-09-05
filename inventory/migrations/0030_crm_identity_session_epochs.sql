-- Preserve session epochs when a username is removed, restored, or reused.
-- V2 legacy cookies without a tracked sid validate against username + session_version,
-- so the version must never be reset when the same username returns.

CREATE TABLE IF NOT EXISTS crm_identity_session_epochs (
  username TEXT COLLATE NOCASE PRIMARY KEY,
  session_version INTEGER NOT NULL CHECK (session_version >= 0),
  updated_at TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_identity_session_epochs_updated_at
ON crm_identity_session_epochs(updated_at DESC);

INSERT INTO crm_identity_session_epochs (username, session_version, updated_at, reason)
SELECT username, MAX(session_version), CURRENT_TIMESTAMP, 'MIGRATION_BACKFILL'
FROM (
  SELECT username, COALESCE(session_version, 0) AS session_version FROM crm_users
  UNION ALL
  SELECT username, COALESCE(session_version, 0) AS session_version FROM crm_identity_sessions
)
GROUP BY username
ON CONFLICT(username) DO UPDATE SET
  session_version = MAX(crm_identity_session_epochs.session_version, excluded.session_version),
  updated_at = excluded.updated_at,
  reason = excluded.reason;

CREATE TRIGGER IF NOT EXISTS trg_crm_users_session_epoch_before_delete
BEFORE DELETE ON crm_users
FOR EACH ROW
BEGIN
  UPDATE crm_identity_sessions
  SET revoked_at = CURRENT_TIMESTAMP,
      revoke_reason = 'USERNAME_RETIRED'
  WHERE LOWER(username) = LOWER(OLD.username)
    AND revoked_at IS NULL;

  INSERT INTO crm_identity_session_epochs (username, session_version, updated_at, reason)
  VALUES (
    OLD.username,
    MAX(
      COALESCE(OLD.session_version, 0),
      COALESCE((SELECT MAX(session_version) FROM crm_identity_sessions WHERE LOWER(username) = LOWER(OLD.username)), 0)
    ),
    CURRENT_TIMESTAMP,
    'USERNAME_RETIRED'
  )
  ON CONFLICT(username) DO UPDATE SET
    session_version = MAX(crm_identity_session_epochs.session_version, excluded.session_version),
    updated_at = excluded.updated_at,
    reason = excluded.reason;
END;

CREATE TRIGGER IF NOT EXISTS trg_crm_users_session_epoch_after_insert
AFTER INSERT ON crm_users
FOR EACH ROW
BEGIN
  UPDATE crm_users
  SET session_version = MAX(
    COALESCE(NEW.session_version, 0),
    COALESCE(
      (SELECT session_version + 1 FROM crm_identity_session_epochs WHERE username = NEW.username),
      COALESCE(NEW.session_version, 0)
    )
  )
  WHERE username = NEW.username;

  INSERT INTO crm_identity_session_epochs (username, session_version, updated_at, reason)
  SELECT username, session_version, CURRENT_TIMESTAMP, 'USERNAME_ACTIVATED'
  FROM crm_users
  WHERE username = NEW.username
  ON CONFLICT(username) DO UPDATE SET
    session_version = MAX(crm_identity_session_epochs.session_version, excluded.session_version),
    updated_at = excluded.updated_at,
    reason = excluded.reason;
END;

CREATE TRIGGER IF NOT EXISTS trg_crm_users_session_epoch_before_username_change
BEFORE UPDATE OF username ON crm_users
FOR EACH ROW
WHEN LOWER(NEW.username) <> LOWER(OLD.username)
BEGIN
  UPDATE crm_identity_sessions
  SET revoked_at = CURRENT_TIMESTAMP,
      revoke_reason = 'USERNAME_RENAMED'
  WHERE LOWER(username) = LOWER(OLD.username)
    AND revoked_at IS NULL;

  INSERT INTO crm_identity_session_epochs (username, session_version, updated_at, reason)
  VALUES (
    OLD.username,
    MAX(
      COALESCE(OLD.session_version, 0),
      COALESCE((SELECT MAX(session_version) FROM crm_identity_sessions WHERE LOWER(username) = LOWER(OLD.username)), 0)
    ),
    CURRENT_TIMESTAMP,
    'USERNAME_RENAMED'
  )
  ON CONFLICT(username) DO UPDATE SET
    session_version = MAX(crm_identity_session_epochs.session_version, excluded.session_version),
    updated_at = excluded.updated_at,
    reason = excluded.reason;
END;

CREATE TRIGGER IF NOT EXISTS trg_crm_users_session_epoch_after_username_change
AFTER UPDATE OF username ON crm_users
FOR EACH ROW
WHEN LOWER(NEW.username) <> LOWER(OLD.username)
BEGIN
  UPDATE crm_users
  SET session_version = MAX(
    COALESCE(NEW.session_version, 0),
    COALESCE(
      (SELECT session_version + 1 FROM crm_identity_session_epochs WHERE username = NEW.username),
      COALESCE(NEW.session_version, 0)
    )
  )
  WHERE username = NEW.username;

  INSERT INTO crm_identity_session_epochs (username, session_version, updated_at, reason)
  SELECT username, session_version, CURRENT_TIMESTAMP, 'USERNAME_RENAMED'
  FROM crm_users
  WHERE username = NEW.username
  ON CONFLICT(username) DO UPDATE SET
    session_version = MAX(crm_identity_session_epochs.session_version, excluded.session_version),
    updated_at = excluded.updated_at,
    reason = excluded.reason;
END;
