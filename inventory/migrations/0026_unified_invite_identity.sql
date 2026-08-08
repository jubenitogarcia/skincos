-- Keep the personal delivery address and the corporate login identity
-- separate.  `invitee_email` is the address that receives the one-time
-- invitation; `corporate_email` is the immutable CRM login reserved by the
-- unified team onboarding flow.
--
-- This migration is additive. Existing unified rows are backfilled through
-- their onboarding foreign reference, while legacy generic invites remain
-- nullable and retain their historical semantics.
ALTER TABLE crm_invites ADD COLUMN corporate_email TEXT;

UPDATE crm_invites
SET corporate_email = (
  SELECT LOWER(TRIM(o.corporate_email))
  FROM crm_employee_onboarding o
  WHERE o.invite_id = crm_invites.id
  LIMIT 1
)
WHERE corporate_email IS NULL OR TRIM(corporate_email) = '';

CREATE INDEX IF NOT EXISTS idx_crm_invites_corporate_email
  ON crm_invites(LOWER(corporate_email), revoked, uses_count, expires_at);
