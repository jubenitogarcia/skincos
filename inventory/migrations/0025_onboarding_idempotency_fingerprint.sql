-- Bind resumable onboarding retries to the complete normalized request.
-- The digest contains no raw e-mail, phone or name values.
ALTER TABLE crm_employee_onboarding ADD COLUMN request_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_employee_onboarding_request_fingerprint
  ON crm_employee_onboarding(request_fingerprint);
