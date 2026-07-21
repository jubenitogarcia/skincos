-- Personal, single-use CRM invitations. Existing generic invitations remain revoked.

ALTER TABLE crm_invites ADD COLUMN invitee_email TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_invites_invitee_email
  ON crm_invites(invitee_email, revoked, expires_at);

-- Existing bearer tokens must not remain usable after invitation becomes nominal.
UPDATE crm_invites
SET revoked = 1
WHERE invitee_email IS NULL OR TRIM(invitee_email) = '';

-- Prevent concurrent signups through separate invitations from creating duplicate email identities.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_users_email_unique
  ON crm_users(LOWER(email))
  WHERE email IS NOT NULL AND TRIM(email) <> '';
