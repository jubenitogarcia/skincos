-- Password-reset codes are valid only after mail delivery is recorded.
ALTER TABLE crm_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE crm_password_resets ADD COLUMN sent_at TEXT;
ALTER TABLE crm_password_resets ADD COLUMN verified_at TEXT;
ALTER TABLE crm_password_resets ADD COLUMN grant_hash TEXT;
ALTER TABLE crm_password_resets ADD COLUMN verification_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crm_password_resets ADD COLUMN last_attempt_at TEXT;

-- UUID reset tokens were never delivered to production users. Retire all of them
-- so a migration cannot leave an undisclosed legacy credential usable.
UPDATE crm_password_resets
SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP)
WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_password_resets_active_email
  ON crm_password_resets(email, sent_at, expires_at, used_at);
