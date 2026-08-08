-- Keep the CRM account relationship explicit and independent from contact data.
-- The relationship is created atomically with invite registration; unresolved
-- historical accounts remain unlinked for the exception queue.
CREATE TABLE IF NOT EXISTS crm_employee_account_links (
  id TEXT PRIMARY KEY,
  workforce_employee_id TEXT NOT NULL UNIQUE,
  onboarding_id TEXT NOT NULL UNIQUE,
  crm_username TEXT NOT NULL UNIQUE,
  link_method TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (review_status IN ('CONFIRMED', 'PENDING_REVIEW', 'REJECTED')),
  review_note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_employee_account_links_review
  ON crm_employee_account_links(review_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_employee_account_links_workforce
  ON crm_employee_account_links(workforce_employee_id);

CREATE INDEX IF NOT EXISTS idx_crm_employee_account_links_onboarding
  ON crm_employee_account_links(onboarding_id);
