-- Employee onboarding is an additive Identity ledger. It stores only ciphertext
-- for personal contact details; the hash supports dedupe without disclosure.
CREATE TABLE IF NOT EXISTS crm_employee_onboarding (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  corporate_email TEXT NOT NULL COLLATE NOCASE,
  personal_email_encrypted TEXT NOT NULL,
  personal_email_hash TEXT NOT NULL,
  mobile_phone_encrypted TEXT NOT NULL,
  mobile_phone_hash TEXT NOT NULL,
  profile TEXT NOT NULL,
  job_title TEXT NOT NULL,
  department_name TEXT NOT NULL,
  units_json TEXT NOT NULL,
  account_status TEXT NOT NULL CHECK (account_status IN ('PENDING_ACCESS','INVITED','ACTIVE','SUSPENDED','TERMINATED')),
  invite_id TEXT,
  idempotency_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_employee_onboarding_corporate_email ON crm_employee_onboarding(corporate_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_employee_onboarding_idempotency ON crm_employee_onboarding(idempotency_key) WHERE idempotency_key IS NOT NULL AND TRIM(idempotency_key) <> '';
CREATE INDEX IF NOT EXISTS idx_crm_employee_onboarding_status ON crm_employee_onboarding(account_status, created_at DESC);

-- Durable server-side session inventory. Existing signed cookies remain valid;
-- new sessions can be registered/revoked without exposing cookie material.
CREATE TABLE IF NOT EXISTS crm_identity_sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  session_version INTEGER NOT NULL,
  device_label TEXT,
  user_agent_hash TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_identity_sessions_user ON crm_identity_sessions(username, revoked_at, last_seen_at DESC);
