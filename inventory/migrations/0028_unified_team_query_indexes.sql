-- Keep the unified team list bounded and deterministic as the roster grows.
-- The route still applies the unit scope in SQL and in application code; these
-- indexes only accelerate the status/order path and do not change any data.
CREATE INDEX IF NOT EXISTS idx_crm_employee_onboarding_status_created
  ON crm_employee_onboarding(account_status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_crm_employee_onboarding_created
  ON crm_employee_onboarding(created_at DESC, id DESC);
