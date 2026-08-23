-- Unified team identity is additive. Existing onboarding, invite and schedule
-- rows remain readable and historical names are intentionally preserved.
ALTER TABLE crm_employee_onboarding ADD COLUMN requested_username TEXT;
ALTER TABLE crm_invites ADD COLUMN requested_username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_employee_onboarding_requested_username
  ON crm_employee_onboarding(lower(requested_username))
  WHERE requested_username IS NOT NULL AND trim(requested_username) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_invites_requested_username
  ON crm_invites(lower(requested_username))
  WHERE requested_username IS NOT NULL AND trim(requested_username) <> '' AND revoked = 0;

CREATE TABLE IF NOT EXISTS crm_employee_team (
  workforce_employee_id TEXT PRIMARY KEY,
  onboarding_id TEXT NOT NULL UNIQUE,
  schedule_professional_id TEXT,
  schedule_status TEXT,
  schedule_role TEXT,
  schedule_shift TEXT,
  schedule_nickname TEXT,
  schedule_instagram TEXT,
  schedule_color TEXT,
  units_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_employee_team_onboarding
  ON crm_employee_team(onboarding_id);
CREATE INDEX IF NOT EXISTS idx_crm_employee_team_schedule
  ON crm_employee_team(schedule_professional_id);

-- Source links are never inferred from names. Ambiguous or unreviewed links
-- stay visible for a human decision before becoming effective.
CREATE TABLE IF NOT EXISTS crm_employee_identity_links (
  id TEXT PRIMARY KEY,
  workforce_employee_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  match_method TEXT NOT NULL,
  confidence TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source, source_id),
  UNIQUE(workforce_employee_id, source)
);
CREATE INDEX IF NOT EXISTS idx_crm_employee_identity_links_review
  ON crm_employee_identity_links(source, review_status, created_at DESC);
