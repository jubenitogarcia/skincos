-- Add an opaque, durable identity alias without changing the username primary
-- key or existing session semantics. The later CRM delivery contract may use
-- only this value; legacy actor.subject remains username-based in v1.
ALTER TABLE crm_users ADD COLUMN identity_subject TEXT;

-- Backfill once in the same additive migration. The value contains no profile
-- data and does not derive from the username or e-mail address.
UPDATE crm_users
SET identity_subject = 'idn:' || lower(hex(randomblob(16)))
WHERE identity_subject IS NULL OR trim(identity_subject) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_users_identity_subject
ON crm_users(identity_subject)
WHERE identity_subject IS NOT NULL;
