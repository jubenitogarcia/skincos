-- Expand the onboarding ledger with a resumable, auditable saga state.
-- The columns are nullable for already-created legacy rows; no existing scope
-- or account state is rewritten by this migration.
ALTER TABLE crm_employee_onboarding ADD COLUMN provisioning_state TEXT;
ALTER TABLE crm_employee_onboarding ADD COLUMN invite_token_encrypted TEXT;
ALTER TABLE crm_employee_onboarding ADD COLUMN compensation_state TEXT;
ALTER TABLE crm_employee_onboarding ADD COLUMN last_error_code TEXT;
ALTER TABLE crm_employee_onboarding ADD COLUMN correlation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_crm_employee_onboarding_provisioning ON crm_employee_onboarding(provisioning_state, updated_at DESC);

